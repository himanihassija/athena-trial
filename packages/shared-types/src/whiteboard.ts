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
