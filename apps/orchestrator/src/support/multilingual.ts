/**
 * Multilingual Support & Real-Time Translation Service.
 *
 * Enables Athena to operate across languages (Hindi, Spanish, French, German, Tamil, Telugu, etc.),
 * translating doubts, sticky notes, and audio transcripts.
 */

import type { LanguageCode, LanguageOption } from '@echosphere/shared-types';
import { tryComplete } from '../llm/complete.js';

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'en', label: 'English', nativeName: 'English', flag: '🇺🇸' },
  { code: 'hi', label: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳' },
  { code: 'es', label: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
  { code: 'fr', label: 'French', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'de', label: 'German', nativeName: 'Deutsch', flag: '🇩🇪' },
  { code: 'ta', label: 'Tamil', nativeName: 'தமிழ்', flag: '🇮🇳' },
  { code: 'te', label: 'Telugu', nativeName: 'తెలుగు', flag: '🇮🇳' },
];

export async function translateText(
  text: string,
  targetLang: LanguageCode,
  sourceLang: LanguageCode = 'en',
): Promise<string> {
  if (targetLang === sourceLang || !text.trim()) {
    return text;
  }

  const targetOption = SUPPORTED_LANGUAGES.find((l) => l.code === targetLang);
  const targetName = targetOption?.label ?? targetLang;

  const prompt = `Translate the following educational text or classroom explanation into ${targetName}. Maintain mathematical clarity and natural pedagogical tone:

"${text}"

Return ONLY the translated text without surrounding quotes or conversational framing.`;

  try {
    const translated = await tryComplete([{ role: 'user', content: prompt }], {
      temperature: 0.2,
      maxTokens: 300,
    });
    if (translated?.trim()) {
      return translated.trim().replace(/^"|"$/g, '');
    }
  } catch {
    // Fall back to original
  }

  return text;
}
