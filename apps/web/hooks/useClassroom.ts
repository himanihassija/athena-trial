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
  WhiteboardJoin,
  WhiteboardPublicState,
  MiroWorkspaceState,
  TargetedReadingItem,
  CatchupAvailabilitySlot,
  LanguageCode,
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

export interface SuppressedIntervention {
  timestamp: number;
  text: string;
  reason: string;
  score: number;
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
  suppressedInterventions: SuppressedIntervention[];
  restraintMeterState: 'listening' | 'ready' | 'held-back' | 'speaking';
  restraintScore?: number;
  whiteboard: WhiteboardPublicState | null;
  whiteboardJoin: WhiteboardJoin | null;
  whiteboardJoinError: string | null;
  workspace: MiroWorkspaceState | null;
  targetedReadings: TargetedReadingItem[];
  catchupSlots: CatchupAvailabilitySlot[];
  raisedHands: string[];
  myLanguage: LanguageCode;
  toggleHandRaise: () => Promise<void>;
  changeLanguage: (lang: LanguageCode) => void;
  refreshWorkspace: () => Promise<void>;
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
  const [suppressedInterventions, setSuppressedInterventions] = useState<SuppressedIntervention[]>([]);
  const [restraintMeterState, setRestraintMeterState] = useState<'listening' | 'ready' | 'held-back' | 'speaking'>('listening');
  const [restraintScore, setRestraintScore] = useState<number | undefined>(undefined);
  const [whiteboard, setWhiteboard] = useState<WhiteboardPublicState | null>(null);
  const [whiteboardJoin, setWhiteboardJoin] = useState<WhiteboardJoin | null>(null);
  const [whiteboardJoinError, setWhiteboardJoinError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<MiroWorkspaceState | null>(null);
  const [targetedReadings, setTargetedReadings] = useState<TargetedReadingItem[]>([]);
  const [catchupSlots, setCatchupSlots] = useState<CatchupAvailabilitySlot[]>([]);
  const [raisedHands, setRaisedHands] = useState<string[]>([]);
  const [myLanguage, setMyLanguage] = useState<LanguageCode>('en');

  const sourceRef = useRef<EventSource | null>(null);

  const apply = useCallback((event: ClassroomEvent) => {
    switch (event.kind) {
      case 'echosphere:room-state':
        setRoom(event.state);
        setParticipants(event.state.participants);
        setFloor(event.state.floor);
        setPolicy(event.state.policy);
        setEnded(event.state.endedAt !== null);
        setSuppressedInterventions(event.state.suppressedInterventions ?? []);
        setRestraintMeterState(event.state.restraintMeterState ?? 'listening');
        if (event.state.whiteboard) setWhiteboard(event.state.whiteboard);
        if (event.state.workspace) setWorkspace(event.state.workspace);
        if (event.state.targetedReadings) setTargetedReadings(event.state.targetedReadings);
        if (event.state.catchupSlots) setCatchupSlots(event.state.catchupSlots);
        if (event.state.raisedHands) setRaisedHands(event.state.raisedHands);
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

      case 'echosphere:restraint-meter-changed':
        setRestraintMeterState(event.state);
        setRestraintScore(event.score);
        break;

      case 'echosphere:intervention-suppressed':
        setSuppressedInterventions((prev) =>
          [
            ...prev,
            {
              timestamp: event.timestamp,
              text: event.text,
              reason: event.reason,
              score: event.score,
            },
          ].slice(-50),
        );
        break;

      case 'echosphere:command':
        // Commands are applied server-side; the resulting policy/floor events
        // carry the effect. Nothing to mirror here.
        break;

      case 'echosphere:whiteboard':
        setWhiteboard(event.board);
        break;

      case 'echosphere:whiteboard-command':
        break;

      case 'echosphere:workspace-changed':
        setWorkspace(event.workspace);
        break;

      case 'echosphere:sticky-note-added':
        setWorkspace((prev) =>
          prev
            ? { ...prev, notes: [event.note, ...prev.notes.filter((n) => n.id !== event.note.id)] }
            : null,
        );
        break;

      case 'echosphere:sticky-note-updated':
        setWorkspace((prev) =>
          prev
            ? { ...prev, notes: prev.notes.map((n) => (n.id === event.note.id ? event.note : n)) }
            : null,
        );
        break;

      case 'echosphere:targeted-reading-updated':
        setTargetedReadings(event.items);
        break;

      case 'echosphere:catchup-slots-updated':
        setCatchupSlots(event.slots);
        break;

      case 'echosphere:hand-raised':
        setRaisedHands((prev) => [...new Set([...prev, event.participantId])]);
        break;

      case 'echosphere:hand-lowered':
        setRaisedHands((prev) => prev.filter((id) => id !== event.participantId));
        break;

      case 'echosphere:language-changed':
        setParticipants((prev) =>
          prev.map((p) =>
            p.participantId === event.participantId ? { ...p, language: event.language } : p,
          ),
        );
        break;
    }
  }, [participantId]);

  useEffect(() => {
    if (!participantId) return;

    let cancelled = false;
    void orchestrator
      .getTranscript(sessionId)
      .then((history) => {
        if (cancelled || history.length === 0) return;
        setTranscript((prev) => {
          if (prev.length > 0) return prev;
          return history.slice(-MAX_TRANSCRIPT);
        });
      })
      .catch(() => undefined);

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
      cancelled = true;
      source.close();
      sourceRef.current = null;
      setConnected(false);
    };
  }, [sessionId, participantId, apply]);

  useEffect(() => {
    if (!participantId || !whiteboard?.open) {
      setWhiteboardJoin(null);
      return;
    }
    let cancelled = false;
    void orchestrator
      .getWhiteboard(sessionId, participantId)
      .then((payload) => {
        if (!cancelled) {
          setWhiteboardJoin(payload);
          setWhiteboardJoinError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setWhiteboardJoinError(err instanceof Error ? err.message : 'Could not join whiteboard');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, participantId, whiteboard?.open, whiteboard?.uuid]);

  const toggleHandRaise = useCallback(async () => {
    if (!participantId) return;
    const isCurrentlyRaised = raisedHands.includes(participantId);
    try {
      await orchestrator.raiseHand(sessionId, participantId, !isCurrentlyRaised);
    } catch (err) {
      console.error('Hand raise failed', err);
    }
  }, [sessionId, participantId, raisedHands]);

  const changeLanguage = useCallback((lang: LanguageCode) => {
    setMyLanguage(lang);
  }, []);

  const refreshWorkspace = useCallback(async () => {
    try {
      const ws = await orchestrator.getWorkspace(sessionId);
      setWorkspace(ws);
    } catch {
      // Ignored
    }
  }, [sessionId]);

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
    suppressedInterventions,
    restraintMeterState,
    restraintScore,
    whiteboard,
    whiteboardJoin,
    whiteboardJoinError,
    workspace,
    targetedReadings,
    catchupSlots,
    raisedHands,
    myLanguage,
    toggleHandRaise,
    changeLanguage,
    refreshWorkspace,
  };
}
