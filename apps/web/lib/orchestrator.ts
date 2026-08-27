/**
 * Typed client for the orchestration backend.
 *
 * Everything the classroom UI knows about roles, the floor, quizzes, and gaps
 * comes through here. Agora's own SDKs stay responsible for audio and for the
 * agent's transcript stream; this module covers the control path (PS31 §2).
 */

import type {
  ClassroomEvent,
  LearningGap,
  Role,
  RoomState,
  SessionReport,
  TeacherCommand,
  TranscriptSegment,
} from '@echosphere/shared-types';

const BASE =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:8787';

export interface SessionSummary {
  sessionId: string;
  channel: string;
  title: string;
  createdAt: number;
  endedAt: number | null;
  participantCount: number;
  agentId: string | null;
}

/** What a participant needs to connect to Agora, issued only after joining. */
export interface JoinResult {
  participantId: string;
  uid: string;
  channel: string;
  rtcToken: string;
  rtmToken: string;
  appId: string;
  agentUid: string;
  role: Role;
  sessionId: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(
      (detail as { error?: string }).error ??
        `${init?.method ?? 'GET'} ${path} failed with ${response.status}`,
    );
  }

  return (await response.json()) as T;
}

export const orchestrator = {
  baseUrl: BASE,

  health: () =>
    request<{ ok: boolean; sessions: number; model: string; stt: string }>(
      '/health',
    ),

  listSessions: () => request<SessionSummary[]>('/api/sessions'),

  createSession: (title: string) =>
    request<SessionSummary>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),

  getRoom: (sessionId: string) =>
    request<RoomState>(`/api/sessions/${sessionId}`),

  join: (
    sessionId: string,
    body: { displayName: string; role: Role; preferredLanguage?: string },
  ) =>
    request<JoinResult>(`/api/sessions/${sessionId}/join`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  leave: (sessionId: string, participantId: string) =>
    request<{ ok: boolean }>(`/api/sessions/${sessionId}/leave`, {
      method: 'POST',
      body: JSON.stringify({ participantId }),
    }),

  startAgent: (sessionId: string, participantId: string) =>
    request<{ agentId: string; state: string }>(
      `/api/sessions/${sessionId}/agent/start`,
      { method: 'POST', body: JSON.stringify({ participantId }) },
    ),

  stopAgent: (sessionId: string) =>
    request<{ ok: boolean }>(`/api/sessions/${sessionId}/agent/stop`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  /**
   * Relays one transcript segment from the browser's RTM stream to the
   * orchestrator. Agora's RTM has no server SDK, so the browser is the only
   * place these events can be observed — see the relay note in ClassroomRoom.
   */
  postTranscript: (
    sessionId: string,
    body: {
      uid: string;
      text: string;
      isFinal: boolean;
      turnId?: number;
      language?: string;
      /** How sure the relay was of `uid` — see TranscriptSegment. */
      attributionConfidence?: number;
    },
  ) =>
    request<{ ok: boolean }>(`/api/sessions/${sessionId}/transcript`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /**
   * Relays the engine's agent state so the orchestrator can enforce §3.3.
   *
   * ConvoAI never asks permission before replying, so this is the orchestrator's
   * only chance to stop a turn it did not authorise.
   */
  postAgentState: (sessionId: string, state: string) =>
    request<{ interrupted: boolean }>(`/api/sessions/${sessionId}/agent-state`, {
      method: 'POST',
      body: JSON.stringify({ state }),
    }),

  getTranscript: (sessionId: string) =>
    request<TranscriptSegment[]>(`/api/sessions/${sessionId}/transcript`),

  sendCommand: (
    sessionId: string,
    participantId: string,
    command: TeacherCommand,
  ) =>
    request<{ ok: boolean; detail?: string }>(
      `/api/sessions/${sessionId}/command`,
      { method: 'POST', body: JSON.stringify({ participantId, command }) },
    ),

  uploadLesson: (
    sessionId: string,
    participantId: string,
    source: string,
    text: string,
  ) =>
    request<{
      source: string;
      chunks: number;
      appliedToAgent: boolean;
      topics: string[];
    }>(
      `/api/sessions/${sessionId}/lesson`,
      {
        method: 'POST',
        body: JSON.stringify({ participantId, source, text }),
      },
    ),

  getLesson: (sessionId: string) =>
    request<{ chunks: number; topics: string[]; sources: string[] }>(
      `/api/sessions/${sessionId}/lesson`,
    ),

  startQuiz: (
    sessionId: string,
    participantId: string,
    topic: string,
    targetStudentIds?: string[],
  ) =>
    request<{ ok: boolean; detail?: string }>(`/api/sessions/${sessionId}/quiz`, {
      method: 'POST',
      body: JSON.stringify({ participantId, topic, targetStudentIds }),
    }),

  answerQuiz: (
    sessionId: string,
    quizId: string,
    participantId: string,
    answer: string,
    via: 'ui' | 'voice' = 'ui',
  ) =>
    request<{ ok: boolean; detail?: string }>(
      `/api/sessions/${sessionId}/quiz/${quizId}/answer`,
      { method: 'POST', body: JSON.stringify({ participantId, answer, via }) },
    ),

  getGaps: (sessionId: string, participantId: string) =>
    request<Array<LearningGap & { severity: 'low' | 'medium' | 'high' }>>(
      `/api/sessions/${sessionId}/gaps?participantId=${encodeURIComponent(participantId)}`,
    ),

  getReport: (sessionId: string, participantId: string) =>
    request<SessionReport>(
      `/api/sessions/${sessionId}/report?participantId=${encodeURIComponent(participantId)}`,
    ),

  /**
   * The exact system prompt the agent is running with. Useful for showing that
   * a proficiency change or a lesson upload actually reached the agent, since
   * with no custom LLM endpoint the prompt is where all of that lives.
   */
  getPrompt: (sessionId: string) =>
    request<{
      prompt: string;
      characters: number;
      lessonChunks: number;
      students: number;
    }>(`/api/sessions/${sessionId}/prompt`),

  /**
   * Opens the control-path event stream. Returns the EventSource so the caller
   * owns closing it — an un-closed stream keeps a server-side subscriber alive.
   */
  openEventStream(
    sessionId: string,
    participantId: string,
    onEvent: (event: ClassroomEvent) => void,
    onError?: (error: Event) => void,
  ): EventSource {
    const source = new EventSource(
      `${BASE}/api/sessions/${sessionId}/events?participantId=${encodeURIComponent(participantId)}`,
    );
    source.onmessage = (message) => {
      try {
        onEvent(JSON.parse(message.data) as ClassroomEvent);
      } catch {
        // A malformed frame must not kill the stream.
      }
    };
    if (onError) source.onerror = onError;
    return source;
  },
};

// ─── Browser-local session identity ──────────────────────────────────────────

const STORAGE_KEY = 'echosphere.participant';

export interface StoredIdentity extends JoinResult {
  displayName: string;
}

/**
 * Persisted so a page refresh mid-lesson does not force a re-join with a new
 * uid, which would orphan the old participant in the roster.
 */
export function storeIdentity(identity: StoredIdentity): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // Private-mode browsers reject storage; the app still works for this tab.
  }
}

export function loadIdentity(sessionId: string): StoredIdentity | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredIdentity;
    return parsed.sessionId === sessionId ? parsed : null;
  } catch {
    return null;
  }
}

export function clearIdentity(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clean up.
  }
}
