/**
 * Lesson material store — PS31 §3.4 (contextual answers based on the lesson).
 *
 * Chunks teacher-uploaded material and ranks chunks by relevance so the most
 * useful parts can be placed in the agent's system prompt.
 *
 * Retrieval is keyword overlap, not embeddings. There is no OpenAI key in this
 * project — the model is Agora's resold gpt-4o-mini — so there is nothing to
 * call for a vector. At demo scale that is not the compromise it sounds like:
 * material for one lesson usually fits in the prompt whole, and retrieval only
 * has to choose which parts survive when it does not.
 */

import { randomUUID } from 'node:crypto';
import type { LessonChunk, RetrievedChunk } from '@echosphere/shared-types';

/** Target chunk size in characters. Roughly a paragraph — small enough that a
 *  retrieved chunk is quotable in a spoken answer without truncation. */
const CHUNK_TARGET_CHARS = 700;
const CHUNK_OVERLAP_CHARS = 120;

export interface LessonStore {
  sessionId: string;
  chunks: LessonChunk[];
  addDocument(source: string, text: string, topics?: string[]): LessonChunk[];
  /** Ranked chunks for a query. Synchronous — there is no network call. */
  retrieveSync(query: string, k?: number): RetrievedChunk[];
  topics(): string[];
  isEmpty(): boolean;
}

export function createLessonStore(sessionId: string): LessonStore {
  const chunks: LessonChunk[] = [];

  return {
    sessionId,
    chunks,

    addDocument(source, text, topics = []) {
      const pieces = chunkText(text);
      const created: LessonChunk[] = pieces.map((piece, i) => ({
        chunkId: randomUUID(),
        sessionId,
        source,
        text: piece,
        ordinal: i,
        topics: topics.length > 0 ? topics : inferTopics(piece),
      }));

      chunks.push(...created);
      return created;
    },

    retrieveSync(query, k = 4) {
      if (chunks.length === 0) return [];
      const terms = tokenise(query);
      const scored = chunks
        .map((chunk) => ({
          chunk,
          score: keywordOverlap(terms, tokenise(chunk.text)),
        }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, k);

      // A query with no overlap at all (an empty classroom, or a lesson that has
      // not been discussed yet) should still contribute material rather than
      // nothing, so fall back to document order.
      return scored.length > 0
        ? scored
        : chunks.slice(0, k).map((chunk) => ({ chunk, score: 0 }));
    },

    topics() {
      return [...new Set(chunks.flatMap((c) => c.topics))].sort();
    },

    isEmpty() {
      return chunks.length === 0;
    },
  };
}

/**
 * Splits on paragraph boundaries and re-packs into ~CHUNK_TARGET_CHARS windows
 * with overlap, so a sentence spanning a boundary still appears whole in one
 * chunk. Paragraph-first (rather than fixed-width) keeps slide bullets intact.
 */
export function chunkText(text: string): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);

  const out: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if (current.length > 0 && current.length + paragraph.length + 1 > CHUNK_TARGET_CHARS) {
      out.push(current);
      const tail = current.slice(-CHUNK_OVERLAP_CHARS);
      current = `${tail} ${paragraph}`.trim();
    } else {
      current = current.length > 0 ? `${current} ${paragraph}` : paragraph;
    }
  }
  if (current.trim().length > 0) out.push(current.trim());

  // A single oversized paragraph still needs splitting.
  return out.flatMap((c) =>
    c.length <= CHUNK_TARGET_CHARS * 2 ? [c] : hardSplit(c, CHUNK_TARGET_CHARS),
  );
}

function hardSplit(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'to', 'of', 'in', 'on', 'for', 'with', 'that', 'this', 'it', 'as', 'at', 'by',
  'from', 'we', 'you', 'i', 'do', 'does', 'did', 'so', 'if', 'then', 'than',
  'what', 'how', 'why', 'when', 'can', 'could', 'would', 'should', 'about',
]);

export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function keywordOverlap(queryTerms: string[], docTerms: string[]): number {
  if (queryTerms.length === 0) return 0;
  const docSet = new Set(docTerms);
  const hits = queryTerms.filter((t) => docSet.has(t)).length;
  return hits / queryTerms.length;
}

/**
 * Cheap topic tagging: the most frequent content words in a chunk. The gap
 * detector clusters on these, so they only need to be stable, not clever.
 */
function inferTopics(text: string, limit = 3): string[] {
  const counts = new Map<string, number>();
  for (const token of tokenise(text)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term]) => term);
}
