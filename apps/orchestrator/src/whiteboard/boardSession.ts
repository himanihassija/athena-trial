import { randomUUID } from 'node:crypto';
import type {
  WhiteboardCard,
  WhiteboardCommand,
  WhiteboardJoin,
  WhiteboardPublicState,
} from '@echosphere/shared-types';
import { publish } from '../state/eventBus.js';
import type { ClassroomSession } from '../state/sessionRegistry.js';
import { config } from '../config.js';
import {
  createWhiteboardRoom,
  mintRoomToken,
  whiteboardConfigured,
} from './netless.js';

export function publicWhiteboard(session: ClassroomSession): WhiteboardPublicState {
  const board = session.whiteboard;
  return {
    open: board.open,
    region: board.region,
    uuid: board.uuid,
    agoraReady: whiteboardConfigured() && Boolean(board.uuid),
    annotating: board.annotating,
    cards: board.cards,
  };
}

export function broadcastWhiteboard(session: ClassroomSession): void {
  publish(session.sessionId, {
    kind: 'echosphere:whiteboard',
    board: publicWhiteboard(session),
  });
}

/**
 * Opens the board when Athena is brought in. Creates an Agora Interactive
 * Whiteboard room when credentials exist; otherwise the voice overlay still
 * works so the classroom is not blocked on Console setup.
 */
/**
 * Opens the board for the room.
 *
 * No Netless room is created. Nothing joins one: the client canvas was removed
 * because white-web-sdk requires React 16 and this app is on React 19 (see
 * ClassroomBoard for the full reasoning). Creating a room per session would be
 * an API call and a failure surface for a canvas nobody renders, so the call is
 * left out rather than made and ignored.
 *
 * `createWhiteboardRoom` and `joinPayload` are kept intact directly below, so
 * restoring the canvas is a one-line change here if Netless ships React 18
 * support.
 */
export async function openWhiteboard(session: ClassroomSession): Promise<void> {
  session.whiteboard.open = true;
  session.whiteboard.region = config.whiteboardRegion;
  broadcastWhiteboard(session);
}

export function applyBoardCommand(
  session: ClassroomSession,
  command: Omit<WhiteboardCommand, 'at'> & { at?: number },
): void {
  const at = command.at ?? Date.now();
  const full: WhiteboardCommand = { ...command, at };

  if (full.action === 'show') {
    session.whiteboard.open = true;
  } else if (full.action === 'hide') {
    session.whiteboard.open = false;
  } else if (full.action === 'clear') {
    session.whiteboard.cards = [];
    session.whiteboard.open = true;
  } else if (full.action === 'write') {
    const text = full.text?.trim();
    if (!text) return;
    session.whiteboard.open = true;
    const card: WhiteboardCard = {
      id: randomUUID(),
      text,
      at,
      source: full.source,
    };
    session.whiteboard.cards = [...session.whiteboard.cards, card].slice(-12);
  }

  publish(session.sessionId, { kind: 'echosphere:whiteboard-command', command: full });
  broadcastWhiteboard(session);
}

export async function joinPayload(
  session: ClassroomSession,
  uid: string,
  writable: boolean,
): Promise<WhiteboardJoin> {
  const publicState = publicWhiteboard(session);
  let roomToken: string | null = null;
  if (session.whiteboard.uuid && whiteboardConfigured()) {
    roomToken = await mintRoomToken(
      session.whiteboard.uuid,
      writable ? 'writer' : 'reader',
    );
  }
  return {
    ...publicState,
    appIdentifier: config.whiteboardAppIdentifier || null,
    roomToken,
    uid,
    writable,
  };
}
