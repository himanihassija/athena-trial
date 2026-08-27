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
  | { kind: 'echosphere:session-ended'; sessionId: string }
  | { kind: 'echosphere:command'; command: TeacherCommand; issuedBy: string };

export type ClassroomEventKind = ClassroomEvent['kind'];

/** Participant view safe to broadcast to every client in the room. */
export interface PublicParticipant {
  participantId: string;
  uid: string;
  displayName: string;
  role: Role;
  proficiency?: ProficiencyTag;
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
}

export function isClassroomEvent(value: unknown): value is ClassroomEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { kind?: unknown }).kind === 'string' &&
    (value as { kind: string }).kind.startsWith(ECHOSPHERE_EVENT_PREFIX)
  );
}
