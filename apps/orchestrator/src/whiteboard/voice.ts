import type { WhiteboardAction } from '@echosphere/shared-types';

export interface ParsedBoardSpeech {
  action: WhiteboardAction;
  text?: string;
}

/**
 * Maps a finished human utterance onto a board command.
 *
 * Conservative: only fires when the speaker clearly mentioned the board, or
 * used an explicit "write/put/show … on the board" pattern. Ordinary lesson
 * talk must not flood the board.
 */
export function parseVoiceBoardCommand(text: string): ParsedBoardSpeech | null {
  const raw = text.trim();
  if (raw.length === 0) return null;
  const lower = raw.toLowerCase();

  if (
    /\b(clear|erase|wipe|reset)\b.{0,24}\b(board|whiteboard)\b/.test(lower) ||
    /\b(board|whiteboard)\b.{0,16}\b(clear|erase|wipe)\b/.test(lower)
  ) {
    return { action: 'clear' };
  }

  if (
    /\b(hide|close|put away)\b.{0,16}\b(board|whiteboard)\b/.test(lower)
  ) {
    return { action: 'hide' };
  }

  if (
    /\b(show|open|bring up|display)\b.{0,20}\b(the )?(white)?board\b/.test(lower) &&
    !/\bon (the )?(white)?board\b/.test(lower)
  ) {
    return { action: 'show' };
  }

  const write = raw.match(
    /(?:write|put|show|display|pin)\s+(.+?)\s+on (?:the )?(?:white)?board\b/i,
  );
  if (write?.[1]) {
    return { action: 'write', text: cleanBoardText(write[1]) };
  }

  const put = raw.match(
    /(?:on (?:the )?(?:white)?board[,:]?\s*)(write|put|show|display)\s+(.+)/i,
  );
  if (put?.[2]) {
    return { action: 'write', text: cleanBoardText(put[2]) };
  }

  return null;
}

function cleanBoardText(text: string): string {
  return text
    .replace(/\b(please|athena|adena|athina)\b/gi, ' ')
    .replace(/[.?!,;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
