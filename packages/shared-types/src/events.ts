/**
 * Control/data-path event envelope carried over Agora RTM.
 *
 * PS31 §2: two channels of communication matter — the audio path (Agora RTC,
 * driven by the ConvoAI engine) and the control path. This file defines the
 * control path's wire format.
 *
 * The agent's own transcript and state events already arrive on the RTM channel
 * from Agora's engine; these classroom events share that channel under a
 * distinct `kind` namespace so a single RTM subscription serves both.
 */

import type { Role, ProficiencyTag } from './identity.js';
import type {
  AgentPolicy,
  FloorSnapshot,
  TeacherCommand,
  SpeakDenialReason,
} from './floor.js';
import type { LearningGap, QuizQuestion, TranscriptSegment } from './lesson.js';
import type { WhiteboardCommand, WhiteboardPublicState } from './whiteboard.js';
import type { MiroWorkspaceState, MiroStickyNote, MiroCommand } from './workspace.js';
import type { TargetedReadingItem, CatchupAvailabilitySlot, LanguageCode } from './support.js';

/** Discriminator prefix so classroom events are never confused with Agora's own. */
export const ECHOSPHERE_EVENT_PREFIX = 'echosphere:' as const;

export type ClassroomEvent =
  /** Full room state, sent to a client right after it joins. */
  | { kind: 'echosphere:room-state'; state: RoomState }
  | { kind: 'echosphere:participant-joined'; participant: PublicParticipant }
  | { kind: 'echosphere:participant-left'; participantId: string }
  | { kind: 'echosphere:floor-changed'; floor: FloorSnapshot }
  | { kind: 'echosphere:policy-changed'; policy: AgentPolicy }
  /** Agent was denied the floor — shown in the teacher panel as an audit trail. */
  | { kind: 'echosphere:agent-blocked'; reason: SpeakDenialReason; at: number }
  | { kind: 'echosphere:transcript'; segment: TranscriptSegment }
  /** Quiz card to render. `correctAnswer` is stripped before broadcast. */
  | { kind: 'echosphere:quiz-issued'; quiz: PublicQuiz }
  | { kind: 'echosphere:quiz-closed'; quizId: string; correctAnswer: string }
  | {
      kind: 'echosphere:quiz-result';
      quizId: string;
      participantId: string;
      correct: boolean;
    }
  /** Teacher-only: a new or updated learning gap. */
  | { kind: 'echosphere:gap-detected'; gap: LearningGap }
  | { kind: 'echosphere:proficiency-changed'; participantId: string; proficiency: ProficiencyTag }
    | {
      kind: 'echosphere:screen-share-permission-changed';
      participantId: string;
      allowed: boolean;
    }
  | {
      kind: 'echosphere:screen-share-started';
      participantId: string;
      displayName: string;
    }
  | { kind: 'echosphere:screen-share-stopped'; participantId: string }
  | { kind: 'echosphere:session-ended'; sessionId: string }
  | { kind: 'echosphere:command'; command: TeacherCommand; issuedBy: string }
  | { kind: 'echosphere:restraint-meter-changed'; state: 'listening' | 'ready' | 'held-back' | 'speaking'; score?: number }
  | { kind: 'echosphere:intervention-suppressed'; timestamp: number; text: string; reason: string; score: number }
  /** A student answered every question in a quiz set correctly. Sent only to that student. */
  | { kind: 'echosphere:quiz-set-perfect'; topic: string }
  | { kind: 'echosphere:whiteboard'; board: WhiteboardPublicState }
  | { kind: 'echosphere:whiteboard-command'; command: WhiteboardCommand }
  | { kind: 'echosphere:workspace-changed'; workspace: MiroWorkspaceState }
  | { kind: 'echosphere:sticky-note-added'; note: MiroStickyNote }
  | { kind: 'echosphere:sticky-note-updated'; note: MiroStickyNote }
  | { kind: 'echosphere:targeted-reading-updated'; items: TargetedReadingItem[] }
  | { kind: 'echosphere:catchup-slots-updated'; slots: CatchupAvailabilitySlot[] }
  | { kind: 'echosphere:hand-raised'; participantId: string; displayName: string; at: number }
  | { kind: 'echosphere:hand-lowered'; participantId: string }
  | { kind: 'echosphere:language-changed'; participantId: string; language: LanguageCode };

export type ClassroomEventKind = ClassroomEvent['kind'];

/** Participant view safe to broadcast to every client in the room. */
export interface PublicParticipant {
  participantId: string;
  uid: string;
  displayName: string;
  role: Role;
  proficiency?: ProficiencyTag;
  language?: LanguageCode;
  handRaised?: boolean;
}

/**
 * A quiz as students see it: the answer key is removed. Keeping this a distinct
 * type (rather than an optional field) makes it impossible to broadcast the
 * answer by forgetting to delete it.
 */
export interface PublicQuiz {
  quizId: string;
  topic: string;
  question: string;
  options?: string[];
  difficulty: QuizQuestion['difficulty'];
  targetStudentIds: string[];
  createdAt: number;
  /** Epoch ms when the question stops accepting answers — drives the countdown. */
  deadline: number;
  /** "Question 2 of 3" — present only for a multi-question set. */
  setIndex?: number;
  setTotal?: number;
}

export function toPublicQuiz(quiz: QuizQuestion): PublicQuiz {
  return {
    quizId: quiz.quizId,
    topic: quiz.topic,
    question: quiz.question,
    options: quiz.options,
    difficulty: quiz.difficulty,
    targetStudentIds: quiz.targetStudentIds,
    createdAt: quiz.createdAt,
    deadline: quiz.deadline,
    setIndex: quiz.setIndex,
    setTotal: quiz.setTotal,
  };
}

export interface RoomState {
  sessionId: string;
  channel: string;
  title: string;
  participants: PublicParticipant[];
  floor: FloorSnapshot;
  policy: AgentPolicy;
  agentId: string | null;
  agentUid: string;
  startedAt: number;
  endedAt: number | null;
  suppressedInterventions?: Array<{ timestamp: number; text: string; reason: string; score: number }>;
  restraintMeterState?: 'listening' | 'ready' | 'held-back' | 'speaking';
  workspace?: MiroWorkspaceState;
  targetedReadings?: TargetedReadingItem[];
  catchupSlots?: CatchupAvailabilitySlot[];
  raisedHands?: string[];
  /**
   * Screen-share state at join time. The live `screen-share-*` events keep an
   * open client current, but a late joiner or a reload has no event to replay —
   * without these two the client starts with empty permissions and no idea
   * anyone is already sharing.
   */
  whiteboard?: WhiteboardPublicState;
  screenShareAllowed?: string[];
  activeScreenShare?: { participantId: string; displayName: string } | null;
}

export function isClassroomEvent(value: unknown): value is ClassroomEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { kind?: unknown }).kind === 'string' &&
    (value as { kind: string }).kind.startsWith(ECHOSPHERE_EVENT_PREFIX)
  );
}