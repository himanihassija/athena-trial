  /**
   * Anam AI real-time avatar — a silent, muted video overlay for Athena.
   *
   * Voice stays entirely on Agora ConvoAI (STT/LLM/TTS, as above); Anam only
   * renders a lip-flapping loop, nudged by `talk()` when Agora reports Athena
   * is actually speaking (see agent/anam.ts). It never owns audio: the
   * client mutes Anam's video element and passes `disableInputAudio: true`
   * so it never opens the mic either.
   *
   * Optional, and dormant if unset: `anamConfigured()` gates the feature, so
   * a deployment without it still runs — Athena just stays on the existing
   * Lottie loop. Same graceful-fallback posture as WHITEBOARD_* above.
   */
  anamApiKey: process.env.ANAM_API_KEY ?? '',
  anamPersonaId: process.env.ANAM_PERSONA_ID ?? '',

  /**
   * Model used for the "what should this diagram say" step, if it should differ
   * from the deployment's ordinary completion model.
   *
   * That step is the only thing that decides diagram quality — Excalidraw+ does
   * the layout and cannot improve the content it is handed — so it is worth
   * being able to point somewhere better without moving every other completion
   * in the orchestrator at the same time.
   *
   * Left blank, the board step uses exactly the provider chain everything else
   * uses, which is the current behaviour. Set, it overrides the model on the
   * PRIMARY provider only (see `CompleteOptions.model`), so a name that
   * provider rejects falls through to the normal chain rather than taking
   * diagrams down.
   *
   * Note that a name here must belong to whichever vendor is first in
   * `resolveProviders`. On this deployment that is Groq, whose key exposes
   * `openai/gpt-oss-120b` (the default and the strongest available),
   * `openai/gpt-oss-20b`, `qwen/qwen3.6-27b` and `qwen/qwen3.8-27b`.
   */
  boardLlmModel: process.env.BOARD_LLM_MODEL ?? '',
} as const;