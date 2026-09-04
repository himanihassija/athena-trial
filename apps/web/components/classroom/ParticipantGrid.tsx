'use client';

import { useMemo } from 'react';
import type { PublicParticipant } from '@echosphere/shared-types';
import { seatColorVar } from '@/lib/seatColor';
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
            <span
              className={`relative flex h-16 w-16 items-center justify-center rounded-full text-lg font-semibold ${
                tile.agentPresent && tile.speaking
                  ? 'eco-orb-speaking'
                  : tile.agentPresent
                    ? 'eco-orb-idle'
                    : ''
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