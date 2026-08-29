/**
 * One-off chat-completion calls the orchestrator makes directly to a real
 * LLM provider — as opposed to the live agent's own turn-by-turn LLM, which
 * runs through Agora's managed model (see agent/agentLifecycle.ts) and isn't
 * reachable from here at all.
 *
 * This is a plain server-to-server HTTP call the orchestrator itself makes,
 * so — unlike the dormant custom-endpoint path in routes/completions.ts —
 * there is no reachability problem: it works the moment a real key is
 * configured, tunnel or not. Used for the post-class narrative
 * (report/summary.ts); the same "call the real API if a key is configured,
 * else return null" logic `routes/completions.ts` already has for the live
 * agent path, factored out so both share it instead of drifting apart.
 */

import { config } from '../config.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompleteOptions {
  temperature?: number;
  maxTokens?: number;
}

interface Provider {
  url: string;
  model: string;
  headers: Record<string, string>;
}

/** Which real provider (if any) is configured, mirroring routes/completions.ts's check. */
function resolveProvider(): Provider | null {
  const sarvamKey = config.sarvamApiKey;
  if (sarvamKey && sarvamKey !== 'mock_sarvam_api_key') {
    return {
      url: 'https://api.sarvam.ai/v1/chat/completions',
      model: 'sarvam-105b',
      // Sarvam requires both: the bearer token AND this subscription-key
      // header — a bearer token alone gets a 403, not a 401, which is easy
      // to misread as a bad key rather than a missing header.
      headers: { Authorization: `Bearer ${sarvamKey}`, 'api-subscription-key': sarvamKey },
    };
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return {
      url: 'https://api.openai.com/v1/chat/completions',
      model: config.llmModel,
      headers: { Authorization: `Bearer ${openaiKey}` },
    };
  }

  return null;
}

/**
 * Returns the model's reply text, or `null` if no real provider is
 * configured or the call failed — callers fall back to their own
 * deterministic behavior in either case, never throwing.
 */
export async function tryComplete(
  messages: ChatMessage[],
  options: CompleteOptions = {},
): Promise<string | null> {
  const provider = resolveProvider();
  if (!provider) return null;

  try {
    const response = await fetch(provider.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...provider.headers,
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature: options.temperature ?? 0.4,
        max_tokens: options.maxTokens ?? 700,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error(`[llm] completion request failed: ${response.status} ${body.slice(0, 500)}`);
      return null;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    return text && text.length > 0 ? text : null;
  } catch (err) {
    console.error('[llm] completion request errored:', err);
    return null;
  }
}
