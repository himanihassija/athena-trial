/**
 * Subscribes to the orchestrator's control path and keeps a local mirror of the
 * classroom (PS31 §2).
 *
 * The orchestrator is authoritative for everything here — roster, floor state,
 * agent policy, quizzes, gaps, screen sharing. This hook never derives those
 * locally; it only applies the events it is sent. That way the teacher's mute
 * and the students' view of the room can never disagree.
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
  MiroWorkspaceState,
  TargetedReadingItem,
  CatchupAvailabilitySlot,
  LanguageCode,
  ActiveWhiteboard,
  ActiveModel,
  BoardElement,
  WhiteboardJoin,
  WhiteboardPublicState,
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
  /**
   * Unique per entry, for React's list key. The timestamp and reason are not
   * enough on their own: one turn can be held back several times inside the
   * same millisecond, which produced two children with the same key.
   */
  id: string;
  reason: SpeakDenialReason;
  at: number;
}

export interface SuppressedIntervention {
  timestamp: number;
  text: string;
  reason: string;
  score: number;
}

/** Fires once when this student answers every question in a quiz set correctly. */
export interface CelebrationTrigger {
  topic: string;
  at: number;
}

export interface ActiveScreenShare {
  participantId: string;
  displayName: string;
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
  celebration: CelebrationTrigger | null;
  whiteboard: WhiteboardPublicState | null;
  whiteboardJoin: WhiteboardJoin | null;
  whiteboardJoinError: string | null;
  setAnnotating: (on: boolean) => Promise<void>;
  /** Non-null while someone is presenting the board, mirroring activeScreenShare. */
  activeWhiteboard: ActiveWhiteboard | null;
  boardScene: BoardElement[];
  presentWhiteboard: (on: boolean) => Promise<void>;
  pushBoardScene: (elements: BoardElement[]) => void;
  workspace: MiroWorkspaceState | null;
  targetedReadings: TargetedReadingItem[];
  catchupSlots: CatchupAvailabilitySlot[];
  raisedHands: string[];
  myLanguage: LanguageCode;
  toggleHandRaise: () => Promise<void>;
  changeLanguage: (lang: LanguageCode) => void;
  refreshWorkspace: () => Promise<void>;
  refreshCatchupSlots: () => Promise<void>;
  screenShareAllowed: string[];
  activeScreenShare: ActiveScreenShare | null;
  toggleScreenShare: (sharing: boolean) => Promise<void>;
  setScreenSharePermission: (targetParticipantId: string, allowed: boolean) => Promise<void>;
  /** Non-null while someone is presenting a 3D model, mirroring activeWhiteboard. */
  activeModel: ActiveModel | null;
  presentModel: (modelId: string | null) => Promise<void>;
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
  // Distinguishes entries that share a timestamp and a reason.
  const blockedSeq = useRef(0);
  const [ended, setEnded] = useState(false);
  const [connected, setConnected] = useState(false);
  const [suppressedInterventions, setSuppressedInterventions] = useState<SuppressedIntervention[]>([]);
  const [restraintMeterState, setRestraintMeterState] = useState<'listening' | 'ready' | 'held-back' | 'speaking'>('listening');
  const [restraintScore, setRestraintScore] = useState<number | undefined>(undefined);
  const [celebration, setCelebration] = useState<CelebrationTrigger | null>(null);
  const [whiteboard, setWhiteboard] = useState<WhiteboardPublicState | null>(null);
  const [activeWhiteboard, setActiveWhiteboard] = useState<ActiveWhiteboard | null>(null);
  const [boardScene, setBoardScene] = useState<BoardElement[]>([]);
  const [whiteboardJoin, setWhiteboardJoin] = useState<WhiteboardJoin | null>(null);
  const [whiteboardJoinError, setWhiteboardJoinError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<MiroWorkspaceState | null>(null);
  const [targetedReadings, setTargetedReadings] = useState<TargetedReadingItem[]>([]);
  const [catchupSlots, setCatchupSlots] = useState<CatchupAvailabilitySlot[]>([]);
  const [raisedHands, setRaisedHands] = useState<string[]>([]);
  const [myLanguage, setMyLanguage] = useState<LanguageCode>('en');
  const [screenShareAllowed, setScreenShareAllowed] = useState<string[]>([]);
  const [activeScreenShare, setActiveScreenShare] = useState<ActiveScreenShare | null>(null);
  const [activeModel, setActiveModel] = useState<ActiveModel | null>(null);

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
        if (event.state.whiteboard) {
          setWhiteboard(event.state.whiteboard);
          setActiveWhiteboard(event.state.whiteboard.presenting ?? null);
          setBoardScene(event.state.whiteboard.scene ?? []);
        }
        if (event.state.workspace) setWorkspace(event.state.workspace);
        if (event.state.targetedReadings) setTargetedReadings(event.state.targetedReadings);
        // Restored: the screen-share merge dropped these two, which is what
        // hydrates a late joiner or a reload. Without them a reloading student
        // loses their raised hand and the room's booked catch-up slots.
        if (event.state.catchupSlots) setCatchupSlots(event.state.catchupSlots);
        if (event.state.raisedHands) setRaisedHands(event.state.raisedHands);
        if (event.state.language) setMyLanguage(event.state.language);
        // No cast needed: RoomState declares both fields.
        setScreenShareAllowed(event.state.screenShareAllowed ?? []);
        setActiveScreenShare(event.state.activeScreenShare ?? null);
        setActiveModel(event.state.activeModel ?? null);
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

      case 'echosphere:agent-blocked': {
        // Numbered outside the updater, which must stay pure.
        blockedSeq.current += 1;
        const id = `${event.at}-${event.reason}-${blockedSeq.current}`;
        setBlockedAttempts((prev) =>
          [...prev, { id, reason: event.reason, at: event.at }].slice(-12),
        );
        break;
      }

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

      case 'echosphere:quiz-set-perfect':
        // publishTo already scoped this to just this student on the server,
        // so no participantId check is needed here.
        setCelebration({ topic: event.topic, at: Date.now() });
        break;

      case 'echosphere:command':
        // Commands are applied server-side; the resulting policy/floor events
        // carry the effect. Nothing to mirror here.
        break;

      case 'echosphere:whiteboard':
        setWhiteboard(event.board);
        break;

      case 'echosphere:whiteboard-started':
        setActiveWhiteboard(event.presenter);
        break;

      case 'echosphere:whiteboard-stopped':
        setActiveWhiteboard(null);
        break;

      case 'echosphere:whiteboard-scene':
        // Never apply your own edits coming back. A freehand stroke is one
        // element whose points grow as you drag, so the copy the server echoes
        // is always older than what is under the pointer — feeding it back
        // rewound the stroke to its first point every tick, which is why a drag
        // rendered as a single dot. The author already has these elements.
        if (event.by === participantId) break;
        // Merged the same way the orchestrator does, by element version, so a
        // client that missed a message cannot drop strokes it never saw.
        setBoardScene((prev) => {
          const byId = new Map(prev.map((el) => [el.id, el]));
          for (const el of event.elements) {
            const existing = byId.get(el.id);
            if (!existing || el.version >= existing.version) byId.set(el.id, el);
          }
          return [...byId.values()];
        });
        break;

      case 'echosphere:whiteboard-command':
        // The board's own state event carries the result; this exists so the
        // teacher's tab can act as the writer without re-deriving intent.
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
        setMyLanguage(event.language);
        break;

      case 'echosphere:screen-share-permission-changed':
        setScreenShareAllowed((prev) =>
          event.allowed
            ? [...new Set([...prev, event.participantId])]
            : prev.filter((id) => id !== event.participantId),
        );
        break;

      case 'echosphere:screen-share-started':
        setActiveScreenShare({
          participantId: event.participantId,
          displayName: event.displayName,
        });
        break;

      case 'echosphere:screen-share-stopped':
        setActiveScreenShare((prev) =>
          prev?.participantId === event.participantId ? null : prev,
        );
        break;

      case 'echosphere:model-started':
        setActiveModel(event.presenter);
        break;

      case 'echosphere:model-stopped':
        setActiveModel((prev) =>
          prev?.participantId === event.participantId ? null : prev,
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

  const toggleHandRaise = useCallback(async () => {
    if (!participantId) return;
    const isCurrentlyRaised = raisedHands.includes(participantId);
    try {
      await orchestrator.raiseHand(sessionId, participantId, !isCurrentlyRaised);
    } catch (err) {
      console.error('Hand raise failed', err);
    }
  }, [sessionId, participantId, raisedHands]);

  const changeLanguage = useCallback(
    (lang: LanguageCode) => {
      setMyLanguage(lang);
      if (!participantId) return;
      orchestrator.setLanguage(sessionId, participantId, lang).catch((err) => {
        console.error('Failed to set language on server', err);
      });
    },
    [sessionId, participantId],
  );

  const setAnnotating = useCallback(
    async (on: boolean) => {
      if (!participantId) return;
      await orchestrator.setAnnotating(sessionId, participantId, on).catch(() => undefined);
    },
    [sessionId, participantId],
  );

  // The room token is role-scoped, so it is fetched per participant rather than
  // broadcast with room state. Re-fetched when the board reopens or its room
  // changes, since a token is bound to one room.
  useEffect(() => {
    if (!participantId || !whiteboard?.open) {
      setWhiteboardJoin(null);
      return;
    }
    let cancelled = false;
    void orchestrator
      .getWhiteboard(sessionId, participantId)
      .then((payload) => {
        if (cancelled) return;
        setWhiteboardJoin(payload);
        setWhiteboardJoinError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setWhiteboardJoinError(
          err instanceof Error ? err.message : 'Could not join the board',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, participantId, whiteboard?.open, whiteboard?.uuid]);

  const presentWhiteboard = useCallback(
    async (on: boolean) => {
      if (!participantId) return;
      await orchestrator.presentWhiteboard(sessionId, participantId, on).catch(() => undefined);
    },
    [sessionId, participantId],
  );

  const pushBoardScene = useCallback(
    (elements: BoardElement[]) => {
      if (!participantId) return;
      void orchestrator.pushBoardScene(sessionId, participantId, elements).catch(() => undefined);
    },
    [sessionId, participantId],
  );

  const refreshWorkspace = useCallback(async () => {
    try {
      const ws = await orchestrator.getWorkspace(sessionId);
      setWorkspace(ws);
    } catch {
      // Ignored
    }
  }, [sessionId]);

  const refreshCatchupSlots = useCallback(async () => {
    try {
      const slots = await orchestrator.getCatchupSlots(sessionId);
      setCatchupSlots(slots);
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

  const toggleScreenShare = useCallback(
    async (sharing: boolean) => {
      if (!participantId) return;
      try {
        await orchestrator.setScreenSharing(sessionId, participantId, sharing);
      } catch (err) {
        console.error('Screen share toggle failed', err);
        throw err;
      }
    },
    [sessionId, participantId],
  );

  const setScreenSharePermission = useCallback(
    async (targetParticipantId: string, allowed: boolean) => {
      if (!participantId) return;
      try {
        await orchestrator.setScreenSharePermission(
          sessionId,
          participantId,
          targetParticipantId,
          allowed,
        );
      } catch (err) {
        console.error('Screen share permission update failed', err);
      }
    },
    [sessionId, participantId],
  );

  const presentModel = useCallback(
    async (modelId: string | null) => {
      if (!participantId) return;
      await orchestrator.presentModel(sessionId, participantId, modelId).catch((err) => {
        console.error('Failed to present 3D model', err);
      });
    },
    [sessionId, participantId],
  );

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
    celebration,
    whiteboard,
    whiteboardJoin,
    whiteboardJoinError,
    setAnnotating,
    activeWhiteboard,
    boardScene,
    presentWhiteboard,
    pushBoardScene,
    workspace,
    targetedReadings,
    catchupSlots,
    raisedHands,
    myLanguage,
    toggleHandRaise,
    changeLanguage,
    refreshWorkspace,
    refreshCatchupSlots,
    screenShareAllowed,
    activeScreenShare,
    toggleScreenShare,
    setScreenSharePermission,
    activeModel,
    presentModel,
  };
}