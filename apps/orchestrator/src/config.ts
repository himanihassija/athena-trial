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

  /** Comma-separated browser origins allowed to call this service. */
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  debugAgora: process.env.DEBUG_AGORA === '1',

  /* Sarvam AI configuration */
  sarvamApiKey: process.env.SARVAM_API_KEY ?? 'mock_sarvam_api_key',
  sarvamSpeaker: process.env.SARVAM_SPEAKER ?? 'meera',
  sarvamTargetLanguageCode: process.env.SARVAM_TARGET_LANGUAGE_CODE ?? 'hi-IN',
} as const;
