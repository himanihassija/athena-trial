/**
 * The shared board: Athena's written lines over a paper ground.
 *
 * **Why there is no collaborative canvas here.** Agora Interactive Whiteboard's
 * client SDK cannot run on this app. `white-web-sdk` — which every Fastboard
 * package sits on — declares `react-dom: ^16.8.0` as a direct dependency and
 * calls `ReactDOM.render` and `unmountComponentAtNode`, both removed in React
 * 18. This app is on React 19. pnpm does nest a React 16 copy for it, but Next
 * dedupes react-dom to one version at build time, so the nesting is defeated
 * and those calls fail at runtime. There is no fixed release: 2.16.58 is the
 * latest and still asks for React 16.
 *
 * Dropping it costs nothing today. Athena's annotation is orchestrator state
 * broadcast over SSE and rendered below, which is the actual feature; the
 * canvas would only add human freehand drawing, and that needs the Fastboard
 * toolbar, which is React 16 as well. The server-side Netless room code is
 * intact, so this can come back if Netless ships React 18 support.
 */

'use client';

import type { WhiteboardPublicState } from '@echosphere/shared-types';

export interface ClassroomBoardProps {
  board: WhiteboardPublicState | null;
  joinError: string | null;
}

export function ClassroomBoard({ board, joinError }: ClassroomBoardProps) {
  if (!board?.open) return null;

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
          Athena writes here · or say “write … on the board”
        </p>
      </header>

      <div className="relative min-h-[16rem] flex-1 bg-[#f6f1e4]">
        <PaperGrid />

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

