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
} from '@echosphere/shared-types';
import { initialFloor } from '../floor/floorMachine.js';
import type { LessonStore } from '../lesson/lessonStore.js';
import { createLessonStore } from '../lesson/lessonStore.js';

/** How many transcript segments the rolling context window keeps (§3.4). */
const ROLLING_TRANSCRIPT_WINDOW = 40;

/** Agora RTC uid reserved for the AI co-teacher. Matches the web client's constant. */
export const AGENT_UID = '123456';

export interface ClassroomSession {
  sessionId: string;
  /** Agora RTC/RTM channel name. Derived from sessionId so both are guessable from either. */
  channel: string;
  title: string;
  createdAt: number;
  endedAt: number | null;

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

  transcript: TranscriptSegment[];
  quizzes: Map<string, QuizQuestion>;
  answers: QuizAnswer[];
  gaps: Map<string, LearningGap>;

  lesson: LessonStore;
}

const sessions = new Map<string, ClassroomSession>();

export function createSession(title: string): ClassroomSession {
  const sessionId = randomUUID().slice(0, 8);
  const now = Date.now();
  const session: ClassroomSession = {
    sessionId,
    channel: `echosphere-${sessionId}`,
    title,
    createdAt: now,
    endedAt: null,
    agentId: null,
    participants: new Map(),
    uidToParticipantId: new Map(),
    floor: initialFloor(now),
    policy: { ...DEFAULT_AGENT_POLICY },
    activeQuestionerId: null,
    speakPermit: null,
    authorizedTurnInProgress: false,
    pendingQuiz: null,
    transcript: [],
    quizzes: new Map(),
    answers: [],
    gaps: new Map(),
    lesson: createLessonStore(sessionId),
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

// ─── Participants (§3.2, §3.8) ───────────────────────────────────────────────

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

// ─── Transcript (§3.4 rolling context, §3.9 full log) ────────────────────────

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
