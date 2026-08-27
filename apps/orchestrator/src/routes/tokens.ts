/**
 * Agora token minting — PS31 §3.2, §3.8.
 *
 * The plan's rule: "Every join request goes through your own auth/session
 * endpoint first, which assigns role and studentId before minting the Agora
 * token." Tokens are only ever issued here, after the participant has been
 * recorded in the session registry, so an RTC uid can never exist in a channel
 * without a known role behind it.
 *
 * A combined RTC+RTM token is minted because the browser needs both: RTC for
 * audio, RTM to receive the agent's transcripts from Agora's engine.
 */

import { createRequire } from 'node:module';
import type * as AgoraToken from 'agora-token';
import { config } from '../config.js';

// `agora-token` is CommonJS and builds its exports with `require(...).X` inside
// an object literal, which Node's ESM named-export detection cannot see — a
// plain `import { RtcTokenBuilder }` throws at load time. Next.js bundles around
// this; a native-ESM Node process does not, so the module is required explicitly
// and typed from its own declarations.
const requireCjs = createRequire(import.meta.url);
const { RtcRole, RtcTokenBuilder } = requireCjs('agora-token') as typeof AgoraToken;

const TOKEN_TTL_SECONDS = 4 * 60 * 60;

export interface MintedTokens {
  rtcToken: string;
  rtmToken: string;
  expiresAt: number;
}

export function mintTokens(channel: string, uid: string): MintedTokens {
  const expireAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;

  // buildTokenWithRtm issues one token carrying both RTC and RTM privileges.
  // The RTM identity is the uid string, so the browser must log in to RTM with
  // exactly this value — mismatching the two surfaces as an opaque
  // "failed to start conversation" error.
  const token = RtcTokenBuilder.buildTokenWithRtm(
    config.agoraAppId,
    config.agoraAppCertificate,
    channel,
    uid,
    RtcRole.PUBLISHER,
    expireAt,
    expireAt,
  );

  return { rtcToken: token, rtmToken: token, expiresAt: expireAt };
}
