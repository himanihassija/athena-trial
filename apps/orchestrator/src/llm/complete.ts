/**
 * Multi-provider LLM completion engine.
 * Supports Google Gemini (Gemini 3.6/3.7 Flash), Anthropic Claude, OpenAI (GPT-4o/mini),
 * Groq, DeepSeek, and Sarvam.
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

interface OpenAiCompatibleProvider {
  type: 'openai-compatible';
  url: string;
  model: string;
  headers: Record<string, string>;
}

interface AnthropicProvider {
  type: 'anthropic';
  url: string;
  model: string;
  headers: Record<string, string>;
}

interface GeminiProvider {
  type: 'gemini';
  key: string;
  model: string;
}

type Provider = OpenAiCompatibleProvider | AnthropicProvider | GeminiProvider;

/** Determines active provider based on environment variables. */
function resolveProvider(): Provider | null {
  // 1. Google Gemini (Native API)
  const geminiKey = config.geminiApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (geminiKey && geminiKey.trim().length > 0) {
    return {
      type: 'gemini',
      key: geminiKey.trim(),
      model: config.geminiModel || process.env.GEMINI_MODEL || 'gemini-3.6-flash',
    };
  }

  // 2. Anthropic Claude
  const anthropicKey = config.anthropicApiKey || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (anthropicKey && anthropicKey.trim().length > 0) {
    return {
      type: 'anthropic',
      url: 'https://api.anthropic.com/v1/messages',
      model: process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022',
      headers: {
        'x-api-key': anthropicKey.trim(),
        'anthropic-version': '2023-06-01',
      },
    };
  }

  // 3. OpenAI
  const openaiKey = config.openaiApiKey || process.env.OPENAI_API_KEY;
  if (openaiKey && openaiKey.trim().length > 0) {
    const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    return {
      type: 'openai-compatible',
      url: `${baseUrl}/chat/completions`,
      model: process.env.OPENAI_MODEL || config.llmModel || 'gpt-4o-mini',
      headers: { Authorization: `Bearer ${openaiKey.trim()}` },
    };
  }

  // 4. Groq
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey && groqKey.trim().length > 0) {
    return {
      type: 'openai-compatible',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      headers: { Authorization: `Bearer ${groqKey.trim()}` },
    };
  }

  // 5. DeepSeek
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (deepseekKey && deepseekKey.trim().length > 0) {
    return {
      type: 'openai-compatible',
      url: 'https://api.deepseek.com/chat/completions',
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      headers: { Authorization: `Bearer ${deepseekKey.trim()}` },
    };
  }

  // 6. Sarvam
  const sarvamKey = config.sarvamApiKey;
  if (sarvamKey && sarvamKey !== 'mock_sarvam_api_key') {
    return {
      type: 'openai-compatible',
      url: 'https://api.sarvam.ai/v1/chat/completions',
      model: 'sarvam-105b',
      headers: { Authorization: `Bearer ${sarvamKey}`, 'api-subscription-key': sarvamKey },
    };
  }

  return null;
}

/**
 * Executes chat completion with the active LLM provider.
 * Returns the model's reply text, or `null` if no provider key is configured or call failed.
 */
export async function tryComplete(
  messages: ChatMessage[],
  options: CompleteOptions = {},
): Promise<string | null> {
  const provider = resolveProvider();
  if (!provider) return null;

  try {
    // 1. Google Gemini Native Handler
    if (provider.type === 'gemini') {
      const systemMsg = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
      const chatContents = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));
      const contents = chatContents.length > 0 ? chatContents : [{ role: 'user', parts: [{ text: 'Hello' }] }];

      // Gemini 3.x models use internal reasoning/thought tokens that count against maxOutputTokens.
      // We set maxOutputTokens comfortably (2500+) so thoughts do not starve the visible response.
      const requested = options.maxTokens ?? 1000;
      const maxOutputTokens = Math.max(requested + 1500, 2500);

      const bodyPayload: Record<string, unknown> = {
        contents,
        generationConfig: {
          temperature: options.temperature ?? 0.4,
          maxOutputTokens,
        },
      };

      if (systemMsg && systemMsg.trim().length > 0) {
        bodyPayload.system_instruction = {
          parts: [{ text: systemMsg.trim() }],
        };
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:generateContent?key=${provider.key}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        console.error(`[llm:gemini] request failed: ${response.status} ${errText.slice(0, 500)}`);
        return null;
      }

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
      };

      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim();
      return text && text.length > 0 ? text : null;
    }

    // 2. Anthropic Claude Handler
    if (provider.type === 'anthropic') {
      const systemMsg = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
      const nonSystemMsgs = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
          content: m.content,
        }));

      const formattedMsgs = nonSystemMsgs.length > 0 ? nonSystemMsgs : [{ role: 'user' as const, content: 'Hello' }];

      const response = await fetch(provider.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...provider.headers,
        },
        body: JSON.stringify({
          model: provider.model,
          system: systemMsg || undefined,
          messages: formattedMsgs,
          temperature: options.temperature ?? 0.4,
          max_tokens: options.maxTokens ?? 700,
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.error(`[llm:claude] completion request failed: ${response.status} ${body.slice(0, 500)}`);
        return null;
      }

      const data = (await response.json()) as {
        content?: Array<{ type: string; text: string }>;
      };
      const text = data.content?.find((c) => c.type === 'text')?.text?.trim();
      return text && text.length > 0 ? text : null;
    }

    // 3. OpenAI & OpenAI-compatible providers
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
