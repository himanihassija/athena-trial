/**
 * Agora Interactive Whiteboard REST (Netless).
 *
 * Workflow from the Fastboard quickstart:
 * POST https://api.netless.link/v5/rooms with the SDK token
 * POST https://api.netless.link/v5/tokens/rooms/{uuid} for a room token
 * Client joins with app identifier + uuid + room token.
 */

import { config } from '../config.js';

const BASE = 'https://api.netless.link/v5';

export function whiteboardConfigured(): boolean {
  return Boolean(config.whiteboardAppIdentifier && config.whiteboardSdkToken);
}

export async function createWhiteboardRoom(): Promise<string> {
  const response = await fetch(`${BASE}/rooms`, {
    method: 'POST',
    headers: {
      token: config.whiteboardSdkToken,
      'Content-Type': 'application/json',
      region: config.whiteboardRegion,
    },
    body: JSON.stringify({ isRecord: false }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Whiteboard create room failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  const body = (await response.json()) as { uuid?: string };
  if (!body.uuid) throw new Error('Whiteboard create room returned no uuid');
  return body.uuid;
}

export async function mintRoomToken(
  uuid: string,
  role: 'admin' | 'writer' | 'reader',
): Promise<string> {
  const response = await fetch(`${BASE}/tokens/rooms/${uuid}`, {
    method: 'POST',
    headers: {
      token: config.whiteboardSdkToken,
      'Content-Type': 'application/json',
      region: config.whiteboardRegion,
    },
    body: JSON.stringify({ lifespan: 4 * 60 * 60 * 1000, role }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Whiteboard room token failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  const body = await response.json();
  const token = typeof body === 'string' ? body : String(body);
  return token.replace(/^"|"$/g, '');
}
