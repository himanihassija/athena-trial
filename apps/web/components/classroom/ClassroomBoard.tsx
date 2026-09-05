'use client';

import { useState } from 'react';

import dynamic from 'next/dynamic';
import type { WhiteboardJoin, WhiteboardPublicState } from '@echosphere/shared-types';

const FastboardPane = dynamic(
  () => import('./FastboardPane').then((m) => m.FastboardPane),
  { ssr: false, loading: () => <BoardSkeleton /> },
);

export interface ClassroomBoardProps {
  board: WhiteboardPublicState | null;
  join: WhiteboardJoin | null;
  joinError: string | null;
}

export function ClassroomBoard({ board, join, joinError }: ClassroomBoardProps) {
  // A canvas failure (e.g. an SDK/React incompatibility) must not blank the
  // board: Athena's lines are rendered by this component, not by the canvas.
  // Declared before the early return — hooks must run in the same order every
  // render, and `board.open` flips at runtime.
  const [canvasFailed, setCanvasFailed] = useState(false);

  if (!board?.open) return null;

  const agoraLive =
    !canvasFailed &&
    Boolean(join?.agoraReady && join.uuid && join.roomToken && join.appIdentifier);

  return (
    <section
      className="eco-panel relative flex min-h-[18rem] flex-col overflow-hidden"
      aria-label="Classroom whiteboard"
    >
      <header className="flex items-center justify-between gap-2 border-b px-3 py-2" style={{ borderColor: 'var(--eco-rule)' }}>
        <div className="flex items-center gap-2">
          <span className="eco-lamp eco-lamp-glow" />
          <h2 className="eco-label">Whiteboard</h2>
        </div>
        <p className="text-xs text-[var(--eco-cream-faint)]">
          {agoraLive
            ? 'Agora Interactive Whiteboard · say “write … on the board”'
            : 'Voice board · say “write LCD on the board”'}
        </p>
      </header>

      <div className="relative min-h-[16rem] flex-1 bg-[#f6f1e4]">
        {agoraLive && join ? (
          <FastboardPane join={join} onUnavailable={() => setCanvasFailed(true)} />
        ) : (
          <PaperGrid />
        )}

        {board.cards.length > 0 && (
          <ul className="pointer-events-none absolute inset-x-3 top-3 z-10 flex max-h-[70%] flex-col gap-2 overflow-y-auto">
            {board.cards.map((card) => (
              <li
                key={card.id}
                className="pointer-events-auto rounded-md border bg-white/90 px-3 py-2 text-sm shadow-sm"
                style={{ borderColor: 'var(--eco-rule)', color: '#1c1917' }}
              >
                <span className="mr-2 text-[10px] uppercase tracking-wide text-stone-500">
                  {card.source === 'athena' ? 'Athena' : 'Teacher'}
                </span>
                {card.text}
              </li>
            ))}
          </ul>
        )}
      </div>

      {joinError && (
        <p className="px-3 py-2 text-xs text-[var(--eco-amber)]">{joinError}</p>
      )}
      {!agoraLive && !joinError && (
        <p className="px-3 py-1.5 text-[11px] text-[var(--eco-cream-faint)]">
          Drawing sync uses Agora Interactive Whiteboard. Add
          WHITEBOARD_APP_IDENTIFIER and WHITEBOARD_SDK_TOKEN on the orchestrator
          to enable Fastboard. Voice notes still appear for everyone.
        </p>
      )}
    </section>
  );
}

function PaperGrid() {
  return (
    <div
      className="h-full min-h-[16rem] w-full"
      style={{
        backgroundImage:
          'linear-gradient(to right, rgba(28,25,23,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(28,25,23,0.06) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
    />
  );
}

function BoardSkeleton() {
  return (
    <div className="flex h-full min-h-[16rem] items-center justify-center text-sm text-stone-400">
      Connecting board…
    </div>
  );
}
