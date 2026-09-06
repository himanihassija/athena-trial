/**
 * ConvoAI agent lifecycle — PS31 §3.1 (agent joins the live classroom),
 * §3.3 (barge-in), §3.6 (spoken quizzes), §3.10 (teacher override actions).
 *
 * Wraps the `agora-agents` SDK. The live `AgentSession` object must be held in
 * memory to call `interrupt()` / `say()` / `think()` / `update()` on it — which
 * is the concrete reason the orchestrator is a long-lived process rather than
 * serverless functions.
 *
 * Configuration follows the official Next.js quickstart's `invite-agent` route.
 * The classroom-specific changes are:
 *   - `remoteUids: ['*']` so the agent hears every participant, not just one
 *     requester (§3.1 multi-party).
 *   - `skipPatterns: [5]` on TTS, opening the brace control channel (§3.6, §3.9).
 *   - `idleTimeout: 0` so the agent does not drop out of a quiet classroom.
 *   - longer end-of-speech silence, so a teacher pausing mid-explanation is not
 *     read as end-of-turn.
 *
 * The LLM is Agora's resold gpt-4o-mini. No OpenAI key is involved anywhere in
 * this project: speech recognition, the model and the voice are all billed
 * through the Agora project.
 */

import {
  Agent,
  AgoraClient,
  Area,
  ExpiresIn,
  OpenAI,
  type AgentSession,
  SarvamSTT,
  SarvamTTS,
  DeepgramSTT,
  MiniMaxTTS,
} from 'agora-agents';
import { GREETING, buildClassroomInstructions, getGreetingForLanguage } from './prompt.js';
import { AGENT_UID, type ClassroomSession } from '../state/sessionRegistry.js';
import { config } from '../config.js';

/**
 * Models Agora resells under its own billing presets. The SDK types the
 * reseller path as this literal union rather than `string`, so a configured
 * value has to be checked against it before use. Mirrored here rather than
 * imported because the package exports the type only from a deep path.
 */
const RESELLER_MODELS = [
  'gpt-4o-mini',
  'gpt-4.1-mini',
  'gpt-5-nano',
  'gpt-5-mini',
] as const;

type ResellerModel = (typeof RESELLER_MODELS)[number];

/** Falls back to the smallest supported preset if LLM_MODEL is not resold. */
function resellerModel(): ResellerModel {
  const configured = config.llmModel;
  return RESELLER_MODELS.includes(configured as ResellerModel)
    ? (configured as ResellerModel)
    : 'gpt-4o-mini';
}

/** Live sessions, keyed by classroom sessionId. */
const liveAgents = new Map<string, AgentSession>();

export function getAgentSession(sessionId: string): AgentSession | undefined {
  return liveAgents.get(sessionId);
}

export function isAgentRunning(sessionId: string): boolean {
  return liveAgents.get(sessionId)?.status === 'running';
}

export async function startAgent(session: ClassroomSession): Promise<string> {
  const existing = liveAgents.get(session.sessionId);
  if (existing && existing.status === 'running') {
    return existing.id as string;
  }

  const client = new AgoraClient({
    area: Area.US,
    appId: config.agoraAppId,
    appCertificate: config.agoraAppCertificate,
  });

  const greeting = getGreetingForLanguage(session.language);
  const sttLang = session.language || config.sttLanguage || 'en';

  let agent = new Agent({
    client,
    instructions: buildClassroomInstructions(session),
    greeting,
    failureMessage: 'One moment.',
    maxHistory: 50,
    turnDetection: {
      config: {
        speech_threshold: 0.5,
        start_of_speech: {
          mode: 'vad',
          vad_config: {
            interrupt_duration_ms: 600,
            prefix_padding_ms: 300,
          },
        },
        end_of_speech: {
          mode: 'vad',
          vad_config: {
            // Tuned for natural classroom conversation: 800ms silence allows natural
            // sentence pauses while ensuring rapid ~1s response time from Athena.
            silence_duration_ms: 800,
          },
        },
      },
    },
    advancedFeatures: { enable_rtm: true, enable_tools: true },
    parameters: {
      audio_scenario: 'chorus',
      data_channel: 'rtm',
      enable_error_message: true,
      enable_metrics: true,
    },
  });

  const hasSarvam =
    Boolean(config.sarvamApiKey) &&
    config.sarvamApiKey !== 'mock_sarvam_api_key' &&
    config.sarvamApiKey !== 'mock_key';

  if (hasSarvam) {
    const sarvamLang =
      sttLang === 'hi' || (sttLang as string) === 'multi'
        ? 'hi-IN'
        : sttLang === 'ta'
          ? 'ta-IN'
          : sttLang === 'te'
            ? 'te-IN'
            : sttLang;
    agent = agent
      .withStt(
        new SarvamSTT({
          apiKey: config.sarvamApiKey,
          language: sarvamLang as any,
        }),
      )
      .withTts(
        new SarvamTTS({
          key: config.sarvamApiKey,
          speaker: config.sarvamSpeaker,
          targetLanguageCode: (sttLang === 'en' ? 'en-IN' : sarvamLang) as any,
          skipPatterns: [5],
        }),
      );
  } else {
    // Deepgram nova-3 supports en, fr, es, de, hi, ta, te natively.
    agent = agent
      .withStt(
        new DeepgramSTT({
          model: 'nova-3',
          language: sttLang,
        }),
      )
      .withTts(
        new MiniMaxTTS({
          model: 'speech_2_6_turbo',
          voiceId: config.ttsVoiceId || 'English_captivating_female1',
          skipPatterns: [5],
        }),
      );
  }

  agent = agent.withLlm(
    new OpenAI({
      model: resellerModel(),
      greetingMessage: greeting,
      failureMessage: 'One moment.',
      maxHistory: 15,
      params: {
        max_tokens: 700,
        temperature: 0.4,
        top_p: 0.9,
      },
    }),
  );

  const agentSession = agent.createSession({
    channel: session.channel,
    agentUid: AGENT_UID,
    // '*' subscribes the agent to every participant in the channel. The
    // quickstart restricts this to a single requester; a classroom needs all of
    // them, and per-speaker attribution is recovered from the RTM transcript's
    // uid rather than from this filter.
    remoteUids: ['*'],
    // 0 disables the idle auto-exit. A class can sit silent through a written
    // exercise; the agent must still be there afterwards.
    idleTimeout: 0,
    expiresIn: ExpiresIn.hours(4),
    debug: config.debugAgora,
  });

  const agentId = await agentSession.start();
  liveAgents.set(session.sessionId, agentSession);
  return agentId;
}

/**
 * Rebuilds the system prompt from current classroom state and pushes it to the
 * running agent.
 *
 * This is the mechanism that replaces a custom LLM endpoint. Without one the
 * orchestrator cannot inject context per turn, so it re-states the whole
 * classroom whenever something the agent needs to know changes — a student
 * joins, the teacher retags someone's level, lesson material is uploaded, or
 * the verbosity/topic policy moves.
 *
 * Failures are swallowed deliberately: a stale prompt degrades the agent's
 * grounding, whereas a thrown error here would break the teacher action that
 * triggered it.
 */
export async function pushInstructions(
  session: ClassroomSession,
): Promise<boolean> {
  const agentSession = liveAgents.get(session.sessionId);
  if (!agentSession || agentSession.status !== 'running') return false;

  try {
    await agentSession.update({
      llm: {
        system_messages: [
          { role: 'system', content: buildClassroomInstructions(session) },
        ],
        // `update` overwrites `params` wholesale rather than merging, so every
        // field has to be repeated — `model` above all. Omitting it wiped the
        // model from a running agent, and since this runs whenever the roster
        // changes, the LLM broke the moment a second person joined the room.
        // The engine then answered every turn with the failure message.
        params: {
          model: resellerModel(),
          max_tokens: 700,
          temperature: 0.4,
          top_p: 0.9,
        },
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function stopAgent(sessionId: string): Promise<void> {
  const agentSession = liveAgents.get(sessionId);
  if (!agentSession) return;
  try {
    await agentSession.stop();
  } finally {
    liveAgents.delete(sessionId);
  }
}

/**
 * Barge-in and END_AGENT_TURN (§3.3, §3.10). Safe to call when the agent is not
 * speaking — the engine treats it as a no-op, so callers need not race-check
 * the floor state first.
 */
/**
 * Interrupts already in flight, keyed by session.
 *
 * `interrupt()` is a remote Agora call that has been measured at over three
 * seconds. Enforcement can fire several times for one turn (the engine emits
 * `thinking` and `speaking` separately, and transcripts arrive alongside), and
 * without this each one opened its own request. They piled up, every one of
 * them logged a separate "held back" entry, and the teacher saw the same
 * interrupt reported five times for a single utterance.
 */
const interruptsInFlight = new Map<string, Promise<boolean>>();

/**
 * Interrupt the agent's current turn. Concurrent callers for the same session
 * share one remote call rather than issuing several.
 */
export async function interruptAgent(sessionId: string): Promise<boolean> {
  const inFlight = interruptsInFlight.get(sessionId);
  if (inFlight) return inFlight;

  const agentSession = liveAgents.get(sessionId);
  if (!agentSession || agentSession.status !== 'running') return false;

  const call = agentSession
    .interrupt()
    .then(() => true)
    .finally(() => {
      interruptsInFlight.delete(sessionId);
    });
  interruptsInFlight.set(sessionId, call);
  return call;
}

export interface SpeakOptions {
  /** INTERRUPT cuts off current speech; APPEND queues behind it. */
  priority?: 'INTERRUPT' | 'APPEND' | 'IGNORE';
  /** false prevents students talking over it. */
  interruptable?: boolean;
}

/**
 * Broadcast exact text through TTS without an LLM round-trip. Used for
 * teacher-authored announcements, where the wording must be deterministic.
 *
 * Deliberately not used for quiz questions: those go through `think`, so the
 * agent phrases the question itself and reports it on the control channel in
 * the same turn. That is what keeps the spoken question and the on-screen card
 * identical without a second model call.
 */
export async function speak(
  sessionId: string,
  text: string,
  options: SpeakOptions = {},
): Promise<boolean> {
  const agentSession = liveAgents.get(sessionId);
  if (!agentSession || agentSession.status !== 'running') return false;
  await agentSession.say(text, {
    priority: options.priority ?? 'INTERRUPT',
    interruptable: options.interruptable ?? true,
  });
  return true;
}

/**
 * Inject an instruction into the running pipeline and let the LLM answer it in
 * its own words. This carries FORCE_AGENT_SPEAK (§3.10), the gap interjection
 * (§3.3b), and quiz delivery (§3.6).
 *
 * Unlike `speak`, the wording is generated — which is what allows the agent to
 * emit a control payload alongside it.
 */
export interface ThinkOptions {
  /**
   * Whether a human speaking may cut this turn short. Defaults to true — the
   * orchestrator has cleared the utterance, but a person talking still wins.
   * Set false for turns that must be delivered whole even over a stray "okay":
   * a quiz question truncated before its trailing control payload leaves no
   * quiz record at all, so nothing can be scored (see startQuiz).
   */
  interruptable?: boolean;
}

export async function think(
  sessionId: string,
  instruction: string,
  options: ThinkOptions = {},
): Promise<boolean> {
  const agentSession = liveAgents.get(sessionId);
  if (!agentSession || agentSession.status !== 'running') return false;
  await agentSession.think(instruction, {
    // `on_listening_action` is the one that actually matters, and omitting it
    // was why forced speech silently did nothing: listening is the agent's
    // resting state, so a teacher pressing "explain this now" almost always
    // arrives while it is listening, and the server default there is not to
    // start a turn. 'interrupt' means begin a new round of dialogue now.
    on_listening_action: 'interrupt',
    on_thinking_action: 'interrupt',
    on_speaking_action: 'interrupt',
    interruptable: options.interruptable ?? true,
  });
  return true;
}

type HistoryItem = { role?: string; content?: unknown };

async function assistantTurns(
  agentSession: AgentSession,
): Promise<string[]> {
  const history = (await agentSession.getHistory()) as { contents?: HistoryItem[] };
  return (history.contents ?? [])
    .filter((c) => c.role === 'assistant' && typeof c.content === 'string')
    .map((c) => c.content as string)
    .filter((t) => t.trim().length > 0);
}

/** Snapshot of the assistant turns already in history — pass to pollForPayloadTurn. */
export async function assistantTurnSnapshot(sessionId: string): Promise<Set<string>> {
  const agentSession = liveAgents.get(sessionId);
  if (!agentSession || agentSession.status !== 'running') return new Set();
  try {
    return new Set(await assistantTurns(agentSession));
  } catch {
    return new Set();
  }
}

/** True once the text holds at least one balanced `{ … }` object. */
function hasCompletePayload(text: string): boolean {
  let depth = 0;
  let opened = false;
  for (const ch of text) {
    if (ch === '{') {
      depth += 1;
      opened = true;
    } else if (ch === '}') {
      depth -= 1;
      if (opened && depth === 0) return true;
    }
  }
  return false;
}

/**
 * Polls the agent's history for a NEW assistant turn (not in `before`) that
 * carries a finished `{ … }` control payload, and returns its text.
 *
 * Why: `skipPatterns` strips the payload from the TTS *and* from the RTM
 * transcript the browser relays, so the orchestrator never sees a quiz question
 * that way. `getHistory()` keeps the raw LLM output, braces intact. Matching on
 * "a new turn with a balanced brace object" rather than a turn *count* makes
 * this robust to a flaky history endpoint and to the turn still streaming — a
 * half-written payload has no closing brace yet, so we keep waiting.
 */
export async function pollForPayloadTurn(
  sessionId: string,
  before: Set<string>,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<string | null> {
  const agentSession = liveAgents.get(sessionId);
  if (!agentSession || agentSession.status !== 'running') return null;

  const { timeoutMs = 25_000, intervalMs = 1_500 } = options;
  const deadline = Date.now() + timeoutMs;
  let newestSeen: string | null = null;

  while (Date.now() < deadline) {
    try {
      const turns = await assistantTurns(agentSession);
      // Walk newest-first; stop at the first turn that already existed.
      for (let i = turns.length - 1; i >= 0; i -= 1) {
        const t = turns[i] ?? '';
        if (before.has(t)) break;
        newestSeen = newestSeen ?? t;
        if (hasCompletePayload(t)) return t;
      }
    } catch {
      // The history endpoint 404s briefly right after start / between turns.
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  // Timed out — hand back the newest new turn we saw, if any, so the caller can
  // at least log what the agent said.
  return newestSeen;
}

export async function agentStatus(
  sessionId: string,
): Promise<{ agentId: string | null; status: string } | null> {
  const agentSession = liveAgents.get(sessionId);
  if (!agentSession) return null;
  return { agentId: agentSession.id, status: agentSession.status };
}

/** Stops every live agent — used on shutdown so none are orphaned in Agora. */
export async function stopAllAgents(): Promise<void> {
  await Promise.allSettled(
    [...liveAgents.keys()].map((sessionId) => stopAgent(sessionId)),
  );
}
