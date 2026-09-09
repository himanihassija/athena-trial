/**
 * Orchestrator configuration, resolved once at boot.
 *
 * Agora credentials are the only required values, and they are the only
 * credentials this project has: speech recognition, the model and the voice are
 * all resold through the Agora project, so there is no second vendor key to
 * manage, rotate, or leak. `agora project env write` produces everything below.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Run \`agora project env write .env\` in apps/orchestrator to populate Agora credentials.`,
    );
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '0.0.0.0',

  agoraAppId: required('NEXT_PUBLIC_AGORA_APP_ID'),
  agoraAppCertificate: required('NEXT_AGORA_APP_CERTIFICATE'),

  /**
   * Must be one of the models Agora resells under its own billing presets:
   * gpt-4o-mini, gpt-4.1-mini, gpt-5-nano, gpt-5-mini. Anything else needs a
   * bring-your-own-key path this project deliberately does not have.
   */
  llmModel: process.env.LLM_MODEL ?? 'gpt-4o-mini',

  /**
   * Deepgram language for ASR.
   *
   * Defaults to 'en' because that is what both the official quickstart and the
   * sibling Athena project run, and it is verified working. 'multi' — Deepgram's
   * code-switching mode, which §3.7 wants — is accepted by the join call but
   * produces no transcription at all through Agora's resold Deepgram: the agent
   * starts, reports RUNNING, and silently hears nothing. Change this only with
   * `pnpm --filter @echosphere/web test:speech` to prove words still come back.
   */
  sttLanguage: process.env.STT_LANGUAGE ?? 'en',
  ttsVoiceId: process.env.TTS_VOICE_ID ?? 'English_captivating_female1',

  /**
   * Selective Attention Locking (SAL) — Agora's own speaker-focus feature,
   * which runs inside the engine's audio path rather than anywhere in this
   * codebase.
   *
   *   'recognition' — the engine separates the voices it hears and suppresses
   *     background voices and room noise. This is the multi-speaker mode, and
   *     the only one appropriate to a classroom.
   *   'locking' — the engine latches onto ONE speaker and blocks ~95% of other
   *     human voices. Correct for a 1:1 assistant, actively wrong here: it
   *     would mute the students.
   *   'off' — send no SAL config at all, the behaviour before this was added.
   *
   * Exposed as an env var because SAL's effect can only be judged in a real
   * room with real cross-talk; this allows A/B-ing it during a live lesson
   * without a code change and the dev-server restart that comes with one.
   */
  salMode: (process.env.SAL_MODE ?? 'recognition') as
    | 'recognition'
    | 'locking'
    | 'off',

  /** Comma-separated browser origins allowed to call this service. */
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  debugAgora: process.env.DEBUG_AGORA === '1',

  /* Sarvam AI configuration */
  sarvamApiKey: process.env.SARVAM_API_KEY ?? 'mock_sarvam_api_key',
  sarvamSpeaker: process.env.SARVAM_SPEAKER ?? 'anushka',
  sarvamTargetLanguageCode: process.env.SARVAM_TARGET_LANGUAGE_CODE ?? 'hi-IN',

  /* Direct LLM Provider Keys */
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-3.6-flash',
  openaiApiKey: process.env.OPENAI_API_KEY,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY,

  /**
   * Postgres connection string for durable session/report storage (see
   * db/schema.ts). Optional: unset means persistence is a no-op, same
   * graceful-fallback posture as every other integration here. A session
   * still works end-to-end without it — it just isn't flushed anywhere once
   * it ends.
   */
  databaseUrl: process.env.DATABASE_URL,
  resendApiKey: process.env.RESEND_API_KEY,

  /**
   * Excalidraw+ MCP, which backs Athena's "draw me a diagram" path.
   *
   * The orchestrator is the MCP client here: it calls `create_diagram` and
   * `get_scene_content` on Excalidraw's server directly, and the model's only
   * job is deciding what the diagram should say — which goes through
   * `tryComplete` on whatever provider is already configured. So this needs no
   * second model vendor; the Excalidraw key is the only new credential.
   *
   * Optional, and dormant if unset: `illustrationConfigured()` gates the
   * feature, so a deployment without a key still runs a full lesson, just
   * without diagrams.
   *
   * The scratch scene is where diagrams are laid out before their elements are
   * copied onto the classroom board. Left blank, one is created per classroom
   * session on first use and remembered for the rest of it (see
   * board/boardAgent.ts); setting it pins every session to one shared scene.
   */
  excalidrawMcpApiKey: process.env.EXCALIDRAW_MCP_API_KEY ?? '',
  excalidrawMcpUrl:
    process.env.EXCALIDRAW_MCP_URL ?? 'https://api.excalidraw.com/api/v1/mcp',
  excalidrawScratchSceneId: process.env.EXCALIDRAW_SCRATCH_SCENE_ID ?? '',

  /**
   * Collection the scratch scene is created in. `create_scene` requires one.
   * A personal API key can use the literal 'private' (the default); a
   * workspace key cannot reach private collections and needs a real id.
   */
  excalidrawCollectionId: process.env.EXCALIDRAW_COLLECTION_ID ?? '',

  /** Ceiling on one end-to-end illustrate request, tool round trips included. */
  illustrationTimeoutMs: Number(process.env.ILLUSTRATION_TIMEOUT_MS ?? 20_000),
} as const;
