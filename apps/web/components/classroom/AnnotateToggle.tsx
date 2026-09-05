/**
 * Teacher control for Athena's board annotation.
 *
 * Two things it has to communicate, because both are invisible otherwise:
 *
 * 1. Whether annotation is ON. Athena judges what is board-worthy on every
 *    turn, but only writes while this is on — without the gate she would write
 *    whenever a definition happened to come up, on a board nobody asked her to
 *    touch.
 * 2. Whether anything can actually execute a write. The Whiteboard REST API has
 *    no content-insertion endpoint, so board writes run in the teacher's own
 *    browser. If that tab is closed or backgrounded the board silently stops
 *    updating — the same failure that made transcripts look dead. Better to say
 *    so than to look like Athena has nothing to add.
 */

'use client';

import type { CSSProperties } from 'react';
import type { WhiteboardPublicState } from '@echosphere/shared-types';

export interface AnnotateToggleProps {
  board: WhiteboardPublicState | null;
  /** True when this tab holds a live board connection and can perform writes. */
  writerReady: boolean;
  onToggle: (on: boolean) => void;
  busy?: boolean;
}

export function AnnotateToggle({ board, writerReady, onToggle, busy }: AnnotateToggleProps) {
  const annotating = board?.annotating ?? false;

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={busy}
        aria-pressed={annotating}
        onClick={() => onToggle(!annotating)}
        data-active={annotating}
        className="eco-action-chip disabled:opacity-40"
        style={{ '--chip-accent': 'var(--eco-athena)' } as CSSProperties}
        title={
          annotating
            ? 'Athena is writing key points on the board'
            : 'Let Athena write key points on the board as you teach'
        }
      >
        {annotating ? 'Annotating' : 'Annotate'}
      </button>

      {annotating && !writerReady && (
        <p className="text-[10px] leading-tight text-[var(--eco-amber)]" role="status">
          Board writer offline — keep this tab open and in front for Athena to write.
        </p>
      )}
    </div>
  );
}
