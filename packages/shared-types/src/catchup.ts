/**
 * Private student catch-up chat — grounded in this lesson's transcript,
 * notes, and board. Answers go only to the student who asked; the live
 * voice Athena on the Agora channel is not interrupted.
 */

export type CatchupSpeaker = 'student' | 'athena';

export interface CatchupMessage {
  role: CatchupSpeaker;
  text: string;
  at: number;
}

export type CatchupSourceKind = 'transcript' | 'lesson' | 'board';

export interface CatchupSource {
  kind: CatchupSourceKind;
  snippet: string;
}

export interface CatchupReply {
  reply: string;
  sources: CatchupSource[];
  history: CatchupMessage[];
}
