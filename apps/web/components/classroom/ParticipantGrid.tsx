'use client';

import { useMemo } from 'react';
import type { PublicParticipant } from '@echosphere/shared-types';
import { seatColorVar } from '@/lib/seatColor';
import { initialsOf } from '@/components/classroom/panels';
import { useAnamAvatar } from '@/hooks/useAnamAvatar';

interface Tile {
  key: string;
  participantId: string | null;
  name: string;
  role: 'Teacher' | 'Student' | 'Athena';
  color: string;
  speaking: boolean;
  isSelf: boolean;
  handRaised: boolean;
  isAgent?: boolean;
  agentPresent?: boolean;
}

export function ParticipantGrid({
  sessionId,
  participants,
  agentPresent,
  agentUid,
  speakingUid,
  selfUid,
  selfMicEnabled,
  raisedHands = [],
}: {
  /** Needed to mint Anam session tokens — see hooks/useAnamAvatar.ts. */
  sessionId: string;
  participants: PublicParticipant[];
  agentPresent: boolean;
  agentUid?: string;
  speakingUid?: string | null;
  selfUid: string;
  selfMicEnabled: boolean;
  /** participantIds with a raised hand, from useClassroom's `raisedHands`. */
  raisedHands?: string[];
}) {
  const teacher = participants.find((p) => p.role === 'teacher');
  const students = participants.filter((p) => p.role === 'student');

  const tiles: Tile[] = [];

  if (teacher) {
    tiles.push({
      key: teacher.participantId,
      participantId: teacher.participantId,
      name: teacher.displayName,
      role: 'Teacher',
      color: seatColorVar(teacher.participantId),
      speaking: speakingUid != null && speakingUid === teacher.uid,
      isSelf: teacher.uid === selfUid,
      handRaised: raisedHands.includes(teacher.participantId),
    });
  }

  tiles.push({
    key: '__athena__',
    participantId: null,
    name: 'Athena',
    role: 'Athena',
    color: 'var(--eco-athena)',
    speaking: agentPresent && speakingUid != null && speakingUid === agentUid,
    isSelf: false,
    handRaised: false,
    isAgent: true,
    agentPresent,
  });

  for (const student of students) {
    tiles.push({
      key: student.participantId,
      participantId: student.participantId,
      name: student.displayName,
      role: 'Student',
      color: seatColorVar(student.participantId),
      speaking: speakingUid != null && speakingUid === student.uid,
      isSelf: student.uid === selfUid,
      handRaised: raisedHands.includes(student.participantId),
    });
  }

  // Meet-style reflow: near-square grid that grows/shrinks with headcount
  // rather than a fixed column count, so 3 tiles fill the stage as fully as
  // 9 tiles do.
  const columns = useMemo(() => {
    const n = tiles.length;
    if (n <= 1) return 1;
    if (n <= 4) return 2;
    if (n <= 9) return 3;
    return 4;
  }, [tiles.length]);

  const rows = Math.max(1, Math.ceil(tiles.length / columns));

  // Anam's silent, muted video overlay for Athena. Voice stays entirely on
  // Agora ConvoAI (see ClassroomAudio.tsx) — Anam only ever supplies a
  // lip-flapping loop, nudged by Agora's real speaking state, not a
  // word-accurate lip sync. See hooks/useAnamAvatar.ts / lib/anam.ts.
  const { status: anamStatus, videoElementId } = useAnamAvatar(
    sessionId,
    agentPresent,
    tiles.find((t) => t.isAgent)?.speaking ?? false,
  );

  return (
    <div
      className="grid flex-1 gap-3"
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
      }}
    >
      {tiles.map((tile) => {
        // Athena, once her video is actually live, gets a completely
        // different tile treatment: full-bleed video filling the whole
        // card (like a real video-call tile), with her name as a small
        // overlay label — not the small circle-avatar + name-below layout
        // every other tile uses. Only this one case changes the outer
        // card's padding/layout; everything else below is untouched.
        const isLiveVideoTile = tile.isAgent && anamStatus === 'connected';

        return (
          <div
            key={tile.key}
              className={
              isLiveVideoTile
                ? 'eco-panel relative flex flex-col overflow-hidden p-0'
                : 'eco-panel relative flex flex-col items-center justify-center gap-3 p-4 transition-shadow'
            }
            style={
              !isLiveVideoTile && !tile.isAgent && tile.speaking
                ? { boxShadow: `0 0 0 3px ${tile.color}` }
                : undefined
            }
          >
            {tile.handRaised && (
              <span
                className="eco-pulse absolute left-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full border"
                style={{
                  borderColor: 'var(--eco-amber)',
                  background: 'var(--eco-amber-dim)',
                  color: 'var(--eco-amber)',
                }}
                aria-label={`${tile.name} raised their hand`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0 0V4.5a1.5 1.5 0 0 1 3 0V11m0 0V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6v-2a1.5 1.5 0 0 1 3 0"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            )}

            {tile.isAgent ? (
              isLiveVideoTile ? (
                // Full-bleed: video fills the entire card. The name label
                // moves to an overlay pill at the bottom, video-call style.
                <>
                  <video
                    id={videoElementId}
                    autoPlay
                    playsInline
                    muted
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                  <div
                    className="absolute bottom-3 left-3 z-10 rounded-full px-3 py-1 text-xs font-medium backdrop-blur-sm"
                    style={{
                      background: 'color-mix(in srgb, var(--eco-ink) 55%, transparent)',
                      color: 'var(--eco-cream)',
                    }}
                  >
                    Athena · AI teacher
                  </div>
                </>
              ) : (
                <>
                  {/* Always mounted the moment Athena is present — Anam's
                      SDK needs this element to exist in the DOM *before* it
                      can attach the stream to it, even while it's still
                      invisible during 'connecting'. */}
                  {tile.agentPresent && (
                    <video
                      id={videoElementId}
                      autoPlay
                      playsInline
                      muted
                      className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-0"
                    />
                  )}

                  {tile.agentPresent && anamStatus === 'connecting' ? (
                    <span
                      className="eco-avatar-speaking relative flex h-16 w-16 items-center justify-center rounded-full text-lg font-semibold"
                      style={{ background: 'var(--eco-ink-sunken)', color: 'var(--eco-athena)' }}
                    >
                      A
                    </span>
                  ) : (
                    // Fallback: Anam not configured on this deployment, or
                    // its connection errored out. Always the calm idle orb
                    // — no speaking-glow state, since the live video (once
                    // connected) is what conveys that instead.
                    <span
                      className={`relative flex h-16 w-16 items-center justify-center rounded-full text-lg font-semibold ${
                        tile.agentPresent ? 'eco-orb-idle' : ''
                      }`}
                      style={{
                        background: tile.agentPresent
                          ? 'radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--eco-athena) 55%, transparent), transparent 70%), var(--eco-ink-sunken)'
                          : 'var(--eco-ink-sunken)',
                        color: 'var(--eco-athena)',
                        boxShadow: tile.agentPresent
                          ? '0 0 14px 1px color-mix(in srgb, var(--eco-athena) 35%, transparent)'
                          : 'none',
                      }}
                    >
                      A
                    </span>
                  )}
                </>
              )
            ) : (
              <span
                className={`relative flex h-16 w-16 items-center justify-center rounded-full ${
                  tile.speaking ? 'eco-avatar-speaking' : ''
                }`}
                style={{ background: tile.color, color: tile.color }}
              >
                <span className="text-lg font-semibold" style={{ color: 'var(--eco-ink)' }}>
                  {initialsOf(tile.name)}
                </span>
              </span>
            )}

            {!isLiveVideoTile && (
              <div className="flex flex-col items-center gap-0.5 text-center">
                <span className="max-w-[8rem] truncate text-sm text-[var(--eco-cream)]">
                  {tile.name}
                  {tile.isSelf ? ' (you)' : ''}
                </span>
                <span className="text-xs text-[var(--eco-cream-faint)]">
                  {tile.isAgent
                    ? tile.agentPresent
                      ? 'AI teacher'
                      : 'Not started'
                    : tile.role}
                </span>
              </div>
            )}

            {tile.isSelf && (
              <span
                className="absolute right-3 top-3 z-10 flex h-6 w-6 items-center justify-center rounded-full border text-[0.65rem]"
                style={
                  selfMicEnabled
                    ? {
                        borderColor: 'var(--eco-glow)',
                        background: 'var(--eco-glow-dim)',
                        color: 'var(--eco-glow-bright)',
                      }
                    : {
                        borderColor: 'var(--eco-rule)',
                        color: 'var(--eco-cream-faint)',
                      }
                }
                aria-label={selfMicEnabled ? 'Your mic is on' : 'Your mic is off'}
                title={selfMicEnabled ? 'Mic on' : 'Mic off'}
              >
                {selfMicEnabled ? '●' : '○'}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
