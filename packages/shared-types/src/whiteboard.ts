/**
 * One Excalidraw scene element. Deliberately opaque: Excalidraw owns this
 * shape, it changes between versions, and the orchestrator only ever stores
 * and rebroadcasts it. `id` and `version` are the two fields we rely on —
 * `version` is how Excalidraw itself orders edits to the same element.
 */
export interface BoardElement {
  id: string;
  version: number;
  [key: string]: unknown;
}

/** Who, if anyone, is currently presenting the board to the room. */
export interface ActiveWhiteboard {
  participantId: string;
  displayName: string;
}

/** A spoken note pinned on the classroom board (teacher or Athena). */
export interface WhiteboardCard {
  id: string;
  text: string;
  at: number;
  source: 'teacher' | 'athena';
}

export type WhiteboardAction = 'show' | 'hide' | 'write' | 'clear';

export interface WhiteboardCommand {
  action: WhiteboardAction;
  text?: string;
  source: WhiteboardCard['source'];
  at: number;
}

/** Public board state (no room tokens). */
export interface WhiteboardPublicState {
  open: boolean;
  region: string;
  uuid: string | null;
  /** True when Agora Interactive Whiteboard credentials are configured. */
  agoraReady: boolean;
  /** Teacher has asked Athena to annotate what she hears. */
  annotating: boolean;
  /** Set while the board is being presented to the room, like a screen share. */
  presenting: ActiveWhiteboard | null;
  /** The shared drawing. Authoritative copy lives in the orchestrator. */
  scene: BoardElement[];
  cards: WhiteboardCard[];
}

/** Per-participant join payload for Fastboard (room token is role-scoped). */
export interface WhiteboardJoin {
  open: boolean;
  agoraReady: boolean;
  appIdentifier: string | null;
  region: string;
  uuid: string | null;
  roomToken: string | null;
  uid: string;
  writable: boolean;
  cards: WhiteboardCard[];
}
