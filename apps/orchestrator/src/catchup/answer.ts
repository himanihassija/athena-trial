/**
 * Student catch-up answers. Private text — does not start a second Agora
 * ConvoAI agent on the classroom channel (that would speak over the lesson).
 * Grounds replies in transcript + lesson retrieval + board notes, then
 * `tryComplete` when a provider key exists.
 */

import type { CatchupMessage, CatchupReply, CatchupSource } from '@echosphere/shared-types';
import { tryComplete } from '../llm/complete.js';
import type { ClassroomSession } from '../state/sessionRegistry.js';
import { rollingTranscript } from '../state/sessionRegistry.js';

const MAX_THREAD = 24;
const MAX_SNIPPET = 280;

export async function answerCatchup(
  session: ClassroomSession,
  participantId: string,
  question: string,
): Promise<CatchupReply> {
  const text = question.trim();
  if (text.length === 0) {
    throw new Error('Ask a question about what you missed.');
  }

  const participant = session.participants.get(participantId);
  if (!participant || participant.leftAt !== undefined) {
    throw new Error('Unknown participant');
  }
  if (participant.role !== 'student') {
    throw new Error('Catch-up chat is for students');
  }

  const now = Date.now();
  const thread = session.catchupByParticipant.get(participantId) ?? [];
  const userTurn: CatchupMessage = { role: 'student', text, at: now };
  const sources = gatherSources(session, text);

  const generated = await tryComplete(
    [
      {
        role: 'system',
        content: catchupSystemPrompt(session, participant.displayName, sources),
      },
      ...thread.slice(-8).map((m) => ({
        role: (m.role === 'student' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.text,
      })),
      { role: 'user', content: text },
    ],
    { temperature: 0.3, maxTokens: 420 },
  );

  const replyText = (generated ?? fallbackReply(text, sources)).trim();
  const athenaTurn: CatchupMessage = { role: 'athena', text: replyText, at: Date.now() };
  const history = [...thread, userTurn, athenaTurn].slice(-MAX_THREAD);
  session.catchupByParticipant.set(participantId, history);

  return { reply: replyText, sources, history };
}

export function catchupHistory(
  session: ClassroomSession,
  participantId: string,
): CatchupMessage[] {
  return session.catchupByParticipant.get(participantId) ?? [];
}

function gatherSources(session: ClassroomSession, query: string): CatchupSource[] {
  const sources: CatchupSource[] = [];

  const retrieved = session.lesson.retrieveSync(query, 3);
  for (const hit of retrieved) {
    sources.push({ kind: 'lesson', snippet: clip(hit.chunk.text) });
  }

  const recent = rollingTranscript(session, 30);
  const q = query.toLowerCase();
  const fromTranscript = recent
    .filter((seg) => {
      const hay = seg.text.toLowerCase();
      return q.split(/\s+/).some((w) => w.length > 3 && hay.includes(w));
    })
    .slice(-4);
  const transcriptPick = fromTranscript.length > 0 ? fromTranscript : recent.slice(-3);
  for (const seg of transcriptPick) {
    const who =
      seg.speaker === 'agent' ? 'Athena' : seg.speaker === 'teacher' ? 'Teacher' : 'Student';
    sources.push({ kind: 'transcript', snippet: clip(`${who}: ${seg.text}`) });
  }

  for (const card of session.whiteboard.cards.slice(-3)) {
    sources.push({ kind: 'board', snippet: clip(card.text) });
  }

  return sources.slice(0, 8);
}

function catchupSystemPrompt(
  session: ClassroomSession,
  studentName: string,
  sources: CatchupSource[],
): string {
  const sourceBlock =
    sources.length > 0
      ? sources.map((s) => `- [${s.kind}] ${s.snippet}`).join('\n')
      : '- (nothing spoken or indexed yet — say so, then offer the lesson notes if any exist)';

  return `You are Athena's private catch-up chat for ${studentName} in "${session.title}".
The live voice co-teacher is already in the Agora classroom. You are text-only and silent to the room.

Rules:
- Answer only from the class record below. If it is missing, say what has not been covered yet — do not invent a different lesson.
- Help a student who missed, zoned out, or joined late. Recap clearly. Short paragraphs.
- Do not wait for teacher approval. This thread is private.
- Do not speak as if you are interrupting the live class.

Class record:
${sourceBlock}`;
}

function fallbackReply(question: string, sources: CatchupSource[]): string {
  const lower = question.toLowerCase();
  const recap = sources.find((s) => s.kind === 'transcript')?.snippet;
  const notes = sources.find((s) => s.kind === 'lesson')?.snippet;
  const board = sources.find((s) => s.kind === 'board')?.snippet;

  if (/\b(miss|missed|catch up|recap|what happened|so far)\b/.test(lower)) {
    const parts = [
      recap ? `From the room: ${recap}` : null,
      notes ? `From the lesson notes: ${notes}` : null,
      board ? `On the board: ${board}` : null,
    ].filter(Boolean);
    if (parts.length > 0) {
      return `Here is what you can catch up on:\n\n${parts.join('\n\n')}`;
    }
    return 'Nothing has been said in this classroom yet. Stay on this page — I will recap as soon as the teacher or Athena speaks, or when notes are indexed.';
  }

  if (notes) {
    return `From this lesson: ${notes}`;
  }
  if (recap) {
    return `The class just covered this: ${recap}`;
  }
  if (board) {
    return `That is on the board: ${board}`;
  }
  return 'I do not have that in this lesson yet. Ask after the teacher explains it, or after notes are indexed.';
}

function clip(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= MAX_SNIPPET) return t;
  return `${t.slice(0, MAX_SNIPPET - 1)}…`;
}
