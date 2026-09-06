'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PublicParticipant } from '@echosphere/shared-types';
import { seatColorVar } from '@/lib/seatColor';
import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import { initialsOf } from '@/components/classroom/panels';

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

/**
 * Athena's avatar visual: a one-time intro clip plays each time she's freshly
 * brought into the room, then this swaps over to the looping Lottie idle
 * animation for the rest of the session. `agentPresent` flipping false→true
 * (not just being true) is what re-triggers the intro — leaving/rejoining
 * plays it again, but a re-render while she's already present does not.
 *
 * `muted` is required here: the intro clip's own audio track must never play,
 * only Athena's real TTS voice should be heard. Missing this was the exact
 * cause of "two voices at once."
 */
function AthenaAvatarVisual({ agentPresent }: { agentPresent: boolean }) {
  const [introFinished, setIntroFinished] = useState(false);
  const wasPresentRef = useRef(false);

  useEffect(() => {
    if (agentPresent && !wasPresentRef.current) {
      // A fresh entrance — reset so the intro plays again.
      setIntroFinished(false);
    }
    wasPresentRef.current = agentPresent;
  }, [agentPresent]);

  if (!introFinished) {
    return (
      <video
        key="intro"
        autoPlay
        playsInline
        onEnded={() => setIntroFinished(true)}
        onError={() => setIntroFinished(true)}
        className="h-full w-full object-cover"
      >
        <source src="/athena-intro.mp4" type="video/mp4" />
      </video>
    );
  }

  return (
    <DotLottieReact
      key="loop"
      src="/athena-avatar.lottie"
      loop
      autoplay
      className="h-full w-full"
    />
  );
}

export function ParticipantGrid({
  participants,
  agentPresent,
  agentUid,
  speakingUid,
  selfUid,
  selfMicEnabled,
  raisedHands = [],
}: {
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

  return (
    <div
      className="grid flex-1 gap-3"
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
      }}
    >
      {tiles.map((tile) => (
        <div
          key={tile.key}
          className="eco-panel relative flex flex-col items-center justify-center gap-3 p-4"
        >
          {tile.handRaised && (
            <span
              className="eco-pulse absolute left-3 top-3 flex h-7 w-7 items-center justify-center rounded-full border"
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
            tile.agentPresent ? (
              <span className="relative h-72 w-72 overflow-hidden rounded-full">
                <AthenaAvatarVisual agentPresent={Boolean(tile.agentPresent)} />
              </span>
            ) : (
              <span
                className="relative flex h-16 w-16 items-center justify-center rounded-full text-lg font-semibold"
                style={{
                  background: 'var(--eco-ink-sunken)',
                  color: 'var(--eco-athena)',
                }}
              >
                A
              </span>
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

          {tile.isSelf && (
            <span
              className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full border text-[0.65rem]"
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
      ))}
    </div>
  );
}
