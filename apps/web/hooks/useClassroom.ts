/**
 * Subscribes to the orchestrator's control path and keeps a local mirror of the
 * classroom (PS31 §2).
 *
 * The orchestrator is authoritative for everything here — roster, floor state,
 * agent policy, quizzes, gaps. This hook never derives those locally; it only
 * applies the events it is sent. That way the teacher's mute and the students'
 * view of the room can never disagree.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgentPolicy,
  ClassroomEvent,
  FloorSnapshot,
  LearningGap,
  ProficiencyTag,
  PublicParticipant,
  PublicQuiz,
  RoomState,
  SpeakDenialReason,
  TranscriptSegment,
} from '@echosphere/shared-types';
import { orchestrator } from '@/lib/orchestrator';

export interface QuizCardState {
  quiz: PublicQuiz;
  /** Revealed to the teacher immediately, to students once they answer. */
  correctAnswer?: string;
  myAnswer?: string;
  myResult?: 'correct' | 'incorrect';
  /** participantId -> correct, teacher view only. */
  results: Record<string, boolean>;
}

export interface BlockedAttempt {
  reason: SpeakDenialReason;
  at: number;
}

export interface ClassroomView {
  room: RoomState | null;
  participants: PublicParticipant[];
  floor: FloorSnapshot | null;
  policy: AgentPolicy | null;
  transcript: TranscriptSegment[];
  quizzes: QuizCardState[];
  gaps: LearningGap[];
  blockedAttempts: BlockedAttempt[];
  ended: boolean;
  connected: boolean;
  recordAnswer: (quizId: string, answer: string) => void;
}

/** Keeps the rendered transcript bounded; the full log lives on the server. */
const MAX_TRANSCRIPT = 200;

export function useClassroom(
  sessionId: string,
  participantId: string | null,
): ClassroomView {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [participants, setParticipants] = useState<PublicParticipant[]>([]);
  const [floor, setFloor] = useState<FloorSnapshot | null>(null);
  const [policy, setPolicy] = useState<AgentPolicy | null>(null);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [quizzes, setQuizzes] = useState<QuizCardState[]>([]);
  const [gaps, setGaps] = useState<LearningGap[]>([]);
  const [blockedAttempts, setBlockedAttempts] = useState<BlockedAttempt[]>([]);
  const [ended, setEnded] = useState(false);
  const [connected, setConnected] = useState(false);

  const sourceRef = useRef<EventSource | null>(null);

  const apply = useCallback((event: ClassroomEvent) => {
    switch (event.kind) {
      case 'echosphere:room-state':
        setRoom(event.state);
        setParticipants(event.state.participants);
        setFloor(event.state.floor);
        setPolicy(event.state.policy);
        setEnded(event.state.endedAt !== null);
        break;

      case 'echosphere:participant-joined':
        setParticipants((prev) =>
          prev.some((p) => p.participantId === event.participant.participantId)
            ? prev.map((p) =>
                p.participantId === event.participant.participantId
                  ? event.participant
                  : p,
              )
            : [...prev, event.participant],
        );
        break;

      case 'echosphere:participant-left':
        setParticipants((prev) =>
          prev.filter((p) => p.participantId !== event.participantId),
        );
        break;

      case 'echosphere:floor-changed':
        setFloor(event.floor);
        break;

      case 'echosphere:policy-changed':
        setPolicy(event.policy);
        break;

      case 'echosphere:agent-blocked':
        setBlockedAttempts((prev) =>
          [...prev, { reason: event.reason, at: event.at }].slice(-12),
        );
        break;

      case 'echosphere:transcript':
        setTranscript((prev) => {
          // The server already de-duplicates, but a reconnect can replay a
          // segment the client still holds.
          if (prev.some((s) => s.segmentId === event.segment.segmentId)) {
            return prev;
          }
          return [...prev, event.segment].slice(-MAX_TRANSCRIPT);
        });
        break;

      case 'echosphere:quiz-issued':
        setQuizzes((prev) =>
          prev.some((q) => q.quiz.quizId === event.quiz.quizId)
            ? prev
            : [...prev, { quiz: event.quiz, results: {} }],
        );
        break;

      case 'echosphere:quiz-closed':
        setQuizzes((prev) =>
          prev.map((q) =>
            q.quiz.quizId === event.quizId
              ? { ...q, correctAnswer: event.correctAnswer }
              : q,
          ),
        );
        break;

      case 'echosphere:quiz-result':
        setQuizzes((prev) =>
          prev.map((q) => {
            if (q.quiz.quizId !== event.quizId) return q;
            return {
              ...q,
              results: { ...q.results, [event.participantId]: event.correct },
              myResult:
                event.participantId === participantId
                  ? event.correct
                    ? 'correct'
                    : 'incorrect'
                  : q.myResult,
            };
          }),
        );
        break;

      case 'echosphere:gap-detected':
        setGaps((prev) => {
          const next = prev.filter((g) => g.gapId !== event.gap.gapId);
          return [...next, event.gap].sort(
            (a, b) =>
              b.affectedStudentIds.length - a.affectedStudentIds.length ||
              b.lastSeenAt - a.lastSeenAt,
          );
        });
        break;

      case 'echosphere:proficiency-changed':
        setParticipants((prev) =>
          prev.map((p) =>
            p.participantId === event.participantId
              ? { ...p, proficiency: event.proficiency as ProficiencyTag }
              : p,
          ),
        );
        break;

      case 'echosphere:session-ended':
        setEnded(true);
        break;

      case 'echosphere:command':
        // Commands are applied server-side; the resulting policy/floor events
        // carry the effect. Nothing to mirror here.
        break;
    }
  }, [participantId]);

  useEffect(() => {
    if (!participantId) return;

    const source = orchestrator.openEventStream(
      sessionId,
      participantId,
      (event) => {
        setConnected(true);
        apply(event);
      },
      () => setConnected(false),
    );
    sourceRef.current = source;
    source.onopen = () => setConnected(true);

    return () => {
      source.close();
      sourceRef.current = null;
      setConnected(false);
    };
  }, [sessionId, participantId, apply]);

  /** Optimistic local echo so the tapped option shows immediately. */
  const recordAnswer = useCallback((quizId: string, answer: string) => {
    setQuizzes((prev) =>
      prev.map((q) =>
        q.quiz.quizId === quizId ? { ...q, myAnswer: answer } : q,
      ),
    );
  }, []);

  return {
    room,
    participants,
    floor,
    policy,
    transcript,
    quizzes,
    gaps,
    blockedAttempts,
    ended,
    connected,
    recordAnswer,
  };
}
