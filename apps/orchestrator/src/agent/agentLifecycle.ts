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
import { GREETING, buildClassroomInstructions } from './prompt.js';
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

  let agent = new Agent({
    client,
    instructions: buildClassroomInstructions(session),
    greeting: GREETING,
    failureMessage: 'One moment.',
    maxHistory: 50,
    // Turn detection tuned for a classroom rather than a 1:1 call. The
    // quickstart's 480ms end-of-speech is too eager here: a teacher pausing
    // mid-explanation would repeatedly read as end-of-turn. This is the first
    // line of defence against the agent talking over the teacher; the floor
    // state machine is the second.
    // Agora's turn-detection VAD is channel-wide: it has no concept of "only
    // the teacher can interrupt", and interrupt_duration_ms applies to every
    // uid in remoteUids, which is '*' by necessity for a multi-party room.
    // Verified against the live REST docs (docs-md.agora.io/…/agent/join.md),
    // not assumed. There is no participant-scoped alternative in the API — a
    // student saying "okay" while Athena is mid-answer WILL be treated the
    // same as a teacher barging in. Both numbers below are pushed to the
    // documented maximum to make that misfire as rare as it can be made,
    // which is a mitigation, not a fix: the platform does not offer one.
    turnDetection: {
      config: {
        speech_threshold: 0.5,
        start_of_speech: {
          mode: 'vad',
          vad_config: {
            // Documented range [120, 1200], Agora's own default 160. Raised to
            // the ceiling so a one-word backchannel ("okay", "yes", "hmm") is
            // less likely to silence her mid-sentence. A teacher actually
            // talking will still cross 1200ms almost immediately and interrupt
            // as expected — and separately, the orchestrator's own explicit
            // interruptAgent() call (onTeacherBargeIn) is the real, teacher-only
            // barge-in mechanism this project relies on; this setting is a
            // backstop for when that path is slower than the raw VAD signal.
            interrupt_duration_ms: 1200,
            prefix_padding_ms: 300,
          },
        },
        end_of_speech: {
          mode: 'vad',
          vad_config: {
            // Documented range [120, 2000]. 900 was short enough that an
            // ordinary thinking-pause mid-sentence closed the turn early,
            // fragmenting one utterance into many turn_ids before the relay
            // ever saw it — no amount of client-side debouncing can undo a
            // segmentation decision Agora's own engine already made. Raised to
            // the ceiling; the cost is the agent waits up to 2s of silence
            // before treating a turn as finished.
            silence_duration_ms: 2000,
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
    agent = agent
      .withStt(
        new SarvamSTT({
          apiKey: config.sarvamApiKey,
          language: config.sttLanguage === 'multi' ? 'hi-IN' : config.sttLanguage,
        }),
      )
      .withTts(
        new SarvamTTS({
          key: config.sarvamApiKey,
          speaker: config.sarvamSpeaker,
          targetLanguageCode: config.sarvamTargetLanguageCode as any,
          skipPatterns: [5],
        }),
      );
  } else {
    // No Sarvam key configured: fall back to Agora's own resold, no-key-
    // required presets (Deepgram nova-2/nova-3 ASR, MiniMax TTS) rather than
    // a vendor that needs a subscription key this project has never asked
    // for. 'multi' is Deepgram's own code-switching mode, passed through
    // as-is rather than remapped.
    agent = agent
      .withStt(
        new DeepgramSTT({
          model: 'nova-3',
          language: config.sttLanguage,
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

  // No apiKey/url: Agora resolves this to its own managed, resold model —
  // the same no-key path DeepgramSTT/MiniMaxTTS use above. A custom LLM URL
  // would need to be reachable from Agora's cloud, not this machine, which
  // is what the Restraint Meter's /api/chat/completions proxy required and
  // why it's currently dormant (see routes/completions.ts's header comment).
  agent = agent.withLlm(
    new OpenAI({
      model: resellerModel(),
      greetingMessage: GREETING,
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
export async function interruptAgent(sessionId: string): Promise<boolean> {
  const agentSession = liveAgents.get(sessionId);
  if (!agentSession || agentSession.status !== 'running') return false;
  await agentSession.interrupt();
  return true;
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
export async function think(
  sessionId: string,
  instruction: string,
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
    // The orchestrator has already cleared this utterance through the floor
    // machine, so it may also cut into a turn already under way — but a human
    // speaking still wins, hence interruptable stays true.
    on_thinking_action: 'interrupt',
    on_speaking_action: 'interrupt',
    interruptable: true,
  });
  return true;
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
