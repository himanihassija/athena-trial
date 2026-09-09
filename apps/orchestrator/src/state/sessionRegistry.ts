/**
 * In-memory classroom session registry — PS31 §3.2, §3.8.
 *
 * One `ClassroomSession` per live classroom. Holds the authoritative copy of
 * everything the plan says the orchestration layer owns: role registry, floor
 * state, agent policy, rolling transcript, quiz state, and detected gaps.
 *
 * Storage is deliberately in-process. The plan's §4 lists Postgres for
 * durability, but the floor state machine needs a single long-lived writer, so
 * the in-memory object stays the source of truth during a session and is
 * flushed to the database at session end (see report/). A second orchestrator
 * replica would need sticky routing by sessionId.
 */

import { randomUUID } from 'node:crypto';
import {
  DEFAULT_AGENT_POLICY,
  emptyStudentStats,
  type AgentPolicy,
  type CatchupMessage,
  type FloorSnapshot,
  type JoinClassroomRequest,
  type LearningGap,
  type Participant,
  type ProficiencyTag,
  type PublicParticipant,
  type QuizAnswer,
  type QuizQuestion,
  type Role,
  type SpeakTrigger,
  type StudentProfile,
  type TranscriptSegment,
  type InterventionRecord,
  type WhiteboardPublicState,
} from '@echosphere/shared-types';
import { initialFloor } from '../floor/floorMachine.js';
import type { LessonStore } from '../lesson/lessonStore.js';
import { createLessonStore } from '../lesson/lessonStore.js';

/** How many transcript segments the rolling context window keeps (§3.4). */
const ROLLING_TRANSCRIPT_WINDOW = 40;

/** Agora RTC uid reserved for the AI co-teacher. Matches the web client's constant. */
export const AGENT_UID = '123456';

/**
 * The teacher account a lesson belongs to.
 *
 * Mirrors the verified JWT claims rather than re-reading them from Supabase:
 * by the time a session exists the token has already been checked, and a class
 * must not stop working because an auth lookup is slow mid-lesson.
 */
export interface SessionOwner {
  userId: string;
  email: string;
  displayName: string | null;
}

export interface ClassroomSession {
  sessionId: string;
  /** Agora RTC/RTM channel name. Derived from sessionId so both are guessable from either. */
  channel: string;
  title: string;
  createdAt: number;
  endedAt: number | null;

  /**
   * The signed-in teacher who created this lesson, if any.
   *
   * Null for a lesson created anonymously — which is every lesson while
   * AUTH_REQUIRED is off. Carried in memory so that `persistSessionEnd` can
   * record ownership at the end without re-deriving who started the class, and
   * so the report route can check the caller is the owner.
   */
  owner: SessionOwner | null;

  /** Runtime agent id returned by ConvoAI /join. Null until the agent is started. */
  agentId: string | null;

  participants: Map<string, Participant>;
  /** Agora reports events by uid; this resolves them to participants (§3.8). */
  uidToParticipantId: Map<string, string>;

  floor: FloorSnapshot;
  policy: AgentPolicy;

  /**
   * The student the agent is currently answering. Set when a student addresses
   * the agent and cleared when the agent finishes. The custom LLM endpoint reads
   * this to pick the right explanation depth (§3.5) — Agora's LLM request has no
   * speaker identity of its own, so the orchestrator must carry it across.
   */
  activeQuestionerId: string | null;

  /**
   * Permission for the agent to produce one turn, and why it was granted.
   *
   * The ConvoAI engine answers every user turn on its own initiative — it never
   * asks. So without this, the floor state machine governs only the speech the
   * orchestrator starts, and the agent's ordinary replies bypass §3.3 entirely.
   * A permit is issued when someone addresses her or the teacher invokes her,
   * and any agent turn that begins without one is interrupted.
   */
  speakPermit: { grantedAt: number; reason: SpeakTrigger } | null;

  /**
   * Whether the agent's CURRENT turn was already authorized to begin.
   *
   * Set true the first time `handleAgentState` allows a thinking/speaking
   * transition, and left true until the turn ends or is explicitly revoked
   * (mute, teacher barge-in, floor closed). Without this, enforcement
   * re-validated the standing permit's TTL against every state-change event,
   * including ones that happen mid-turn — so a real answer that ran past the
   * permit's window (ASR settle + LLM generation + a genuinely long spoken
   * answer easily exceeds it) was cut off mid-sentence for no visible reason.
   * Authorization, once granted, now covers the whole turn; only an explicit
   * revocation can stop it early.
   */
  authorizedTurnInProgress: boolean;
  /**
   * When the last turn was authorised. Agent state arrives over RTM and is
   * neither ordered nor guaranteed, so a momentary non-speaking state can clear
   * `authorizedTurnInProgress` while she is still mid-sentence. This lets a
   * state change arriving just after that be recognised as the same turn
   * continuing rather than a new, un-permitted one.
   */
  lastAuthorisedTurnAt: number | null;

  /**
   * Agent turn ids whose control payload has already been acted on.
   *
   * A turn reaches the orchestrator as several relays that grow as she speaks,
   * and the control object is appended at the very END of a turn — so it exists
   * only in the last, longest relay. Acting on every relay that carries it
   * would fire the same quiz or diagram repeatedly; acting on none of them,
   * which is what used to happen, dropped it entirely.
   */
  agentControlAppliedTurns: Set<number>;

  /**
   * A quiz the agent has been asked to pose but has not reported yet.
   *
   * The agent composes the question itself and returns it on the control
   * channel, so the request and the resulting question arrive one round trip
   * apart. This holds the requester's intent — topic and who it was aimed at —
   * across that gap.
   */
  pendingQuiz: {
    topic: string;
    targetStudentIds: string[];
    origin: 'teacher' | 'gap-detector';
    requestedAt: number;
  } | null;

  /**
   * A running multi-question quiz. One "Start Quiz" asks a set of questions on
   * a topic, auto-advancing to the next once each closes. Cancelled by a mute,
   * a lesson end, or a fresh Start Quiz.
   */
  activeQuizSet: {
    topic: string;
    targetStudentIds: string[];
    origin: 'teacher' | 'gap-detector';
    total: number;
    /** How many have been asked so far (1-based). */
    asked: number;
    /** quizIds already issued in this set. */
    quizIds: string[];
    /** Question text already asked, so the agent varies the next one. */
    askedQuestions: string[];
  } | null;

  transcript: TranscriptSegment[];
  quizzes: Map<string, QuizQuestion>;
  answers: QuizAnswer[];
  gaps: Map<string, LearningGap>;

  lesson: LessonStore;
  suppressedInterventions: Array<{ timestamp: number; text: string; reason: string; score: number }>;
  restraintMeterState: 'listening' | 'ready' | 'held-back' | 'speaking';
  interventionHistory: InterventionRecord[];

  /**
   * Shared local Excalidraw board state.
   */
  whiteboard: {
    open: boolean;
    cards: WhiteboardPublicState['cards'];
    /**
     * Presence and scene, mirroring how screen share is modelled: one presenter
     * at a time, and the orchestrator holds the authoritative drawing so a late
     * joiner or a reload gets the board as it stands.
     */
    presenting: WhiteboardPublicState['presenting'];
    scene: WhiteboardPublicState['scene'];
    /**
     * Athena only annotates while the teacher has this on. Without a gate she
     * would write on every turn that happened to contain a definition, which
     * floods a board nobody asked her to touch. Explicit teacher intent is the
     * whole point of the feature.
     */
    annotating: boolean;
  };

  workspace?: import('@echosphere/shared-types').MiroWorkspaceState;
  targetedReadings?: import('@echosphere/shared-types').TargetedReadingItem[];
  catchupSlots?: import('@echosphere/shared-types').CatchupAvailabilitySlot[];
  raisedHands: Set<string>;

  /** participantIds the teacher has granted screen-share permission to. */
  screenShareAllowed: Set<string>;
  /** Who is currently sharing, if anyone — only one screen at a time. */
  activeScreenShare: { participantId: string; displayName: string } | null;

  /** Primary classroom language (e.g. 'en', 'fr', 'es', 'hi', 'de', 'ta', 'te'). */
  language: import('@echosphere/shared-types').LanguageCode;

  /** Private catch-up threads, keyed by student participantId. */
  catchupByParticipant: Map<string, CatchupMessage[]>;
}

const sessions = new Map<string, ClassroomSession>();

function generate4DigitShareCode(): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = String(Math.floor(1000 + Math.random() * 9000));
    const existing = sessions.get(candidate);
    if (!existing || existing.endedAt !== null) {
      return candidate;
    }
  }
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function createSession(
  title: string,
  owner: SessionOwner | null = null,
): ClassroomSession {
  const sessionId = generate4DigitShareCode();
  const now = Date.now();
  const session: ClassroomSession = {
    sessionId,
    channel: `echosphere-${sessionId}`,
    title,
    language: 'en',
    createdAt: now,
    endedAt: null,
    owner,
    agentId: null,
    participants: new Map(),
    uidToParticipantId: new Map(),
    floor: initialFloor(now),
    policy: { ...DEFAULT_AGENT_POLICY },
    activeQuestionerId: null,
    speakPermit: null,
    authorizedTurnInProgress: false,
    lastAuthorisedTurnAt: null,
    agentControlAppliedTurns: new Set(),
    pendingQuiz: null,
    activeQuizSet: null,
    transcript: [],
    quizzes: new Map(),
    answers: [],
    gaps: new Map(),
    lesson: createLessonStore(sessionId),
    suppressedInterventions: [],
    restraintMeterState: 'listening',
    interventionHistory: [],
    whiteboard: {
      open: false,
      cards: [],
      annotating: false,
      presenting: null,
      scene: [],
    },
    raisedHands: new Set(),
    screenShareAllowed: new Set(),
    activeScreenShare: null,
    catchupByParticipant: new Map(),
  };
  sessions.set(sessionId, session);
  return session;
}

export function getSession(sessionId: string): ClassroomSession | undefined {
  return sessions.get(sessionId);
}

export function listSessions(): ClassroomSession[] {
  return [...sessions.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function endSession(sessionId: string): ClassroomSession | undefined {
  const session = sessions.get(sessionId);
  if (session) session.endedAt = Date.now();
  return session;
}

// ─── Participants (§3.2, §3.8) ─────────────────────────────────────────────

/**
 * RTC uids must be positive 32-bit ints and unique within the channel. The
 * agent holds AGENT_UID, so human uids are drawn from a disjoint range.
 */
function allocateUid(session: ClassroomSession): string {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = String(Math.floor(Math.random() * 9_000_000) + 1000);
    if (candidate !== AGENT_UID && !session.uidToParticipantId.has(candidate)) {
      return candidate;
    }
  }
  throw new Error('Could not allocate a free RTC uid for this channel');
}

export function addParticipant(
  session: ClassroomSession,
  request: Pick<JoinClassroomRequest, 'displayName' | 'role' | 'preferredLanguage'>,
): Participant {
  const participantId = randomUUID();
  const uid = allocateUid(session);
  const base = {
    participantId,
    uid,
    displayName: request.displayName,
    role: request.role,
    joinedAt: Date.now(),
  };

  let participant: Participant;
  if (request.role === 'student') {
    const student: StudentProfile = {
      ...base,
      role: 'student',
      proficiency: 'intermediate',
      preferredLanguage: request.preferredLanguage,
      stats: emptyStudentStats(),
    };
    participant = student;
  } else {
    participant = base;
  }

  session.participants.set(participantId, participant);
  session.uidToParticipantId.set(uid, participantId);
  return participant;
}

export function removeParticipant(
  session: ClassroomSession,
  participantId: string,
): void {
  const participant = session.participants.get(participantId);
  if (!participant) return;
  // Kept in the map with `leftAt` set: the post-class report (§3.9) still needs
  // their transcript attribution and quiz history after they disconnect.
  participant.leftAt = Date.now();
}

/**
 * Undoes a `removeParticipant` that should not have stuck.
 *
 * The browser cannot reliably tell a tab closing for good from a page
 * refresh — both fire the same `pagehide` event — so the client sends a
 * leave beacon on either. A refresh is deliberately NOT a real departure
 * (see `storeIdentity`'s comment: the same participantId reconnects rather
 * than re-joining), so on every mount the client also calls this to clear
 * whatever a stray beacon from a moment ago may have set. Safe to call on a
 * participant who was never marked left at all — it is a no-op then, which
 * is what makes it fine to call unconditionally on every mount rather than
 * only ones the client can prove followed a refresh.
 */
export function resumeParticipant(
  session: ClassroomSession,
  participantId: string,
): boolean {
  const participant = session.participants.get(participantId);
  if (!participant) return false;
  participant.leftAt = undefined;
  return true;
}

export function participantByUid(
  session: ClassroomSession,
  uid: string,
): Participant | undefined {
  const id = session.uidToParticipantId.get(uid);
  return id ? session.participants.get(id) : undefined;
}

export function activeParticipants(session: ClassroomSession): Participant[] {
  return [...session.participants.values()].filter((p) => p.leftAt === undefined);
}

export function students(session: ClassroomSession): StudentProfile[] {
  return [...session.participants.values()].filter(
    (p): p is StudentProfile => p.role === 'student',
  );
}

export function activeStudents(session: ClassroomSession): StudentProfile[] {
  return students(session).filter((p) => p.leftAt === undefined);
}

export function teacherOf(session: ClassroomSession): Participant | undefined {
  return [...session.participants.values()].find((p) => p.role === 'teacher');
}

export function toPublicParticipant(p: Participant): PublicParticipant {
  return {
    participantId: p.participantId,
    uid: p.uid,
    displayName: p.displayName,
    role: p.role,
    proficiency: p.role === 'student' ? (p as StudentProfile).proficiency : undefined,
    language: p.language,
    handRaised: p.handRaised,
  };
}

export function setProficiency(
  session: ClassroomSession,
  participantId: string,
  proficiency: ProficiencyTag,
): StudentProfile | undefined {
  const p = session.participants.get(participantId);
  if (!p || p.role !== 'student') return undefined;
  const student = p as StudentProfile;
  student.proficiency = proficiency;
  return student;
}

// ─── Transcript (§3.4 rolling context, §3.9 full log) ──────────────────────

export function appendTranscript(
  session: ClassroomSession,
  segment: Omit<TranscriptSegment, 'segmentId' | 'sessionId'>,
): TranscriptSegment {
  const full: TranscriptSegment = {
    ...segment,
    segmentId: randomUUID(),
    sessionId: session.sessionId,
  };
  session.transcript.push(full);
  return full;
}

/** The short-term context window handed to the LLM on each turn. */
export function rollingTranscript(
  session: ClassroomSession,
  limit = ROLLING_TRANSCRIPT_WINDOW,
): TranscriptSegment[] {
  return session.transcript.slice(-limit);
}

/** Roles allowed to issue teacher commands (§3.10). */
export function isTeacher(session: ClassroomSession, participantId: string): boolean {
  return session.participants.get(participantId)?.role === 'teacher';
}

export function roleOf(
  session: ClassroomSession,
  participantId: string,
): Role | undefined {
  return session.participants.get(participantId)?.role;
}
