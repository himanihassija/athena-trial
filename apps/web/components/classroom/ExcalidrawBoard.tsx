/**
 * The shared drawing surface.
 *
 * Excalidraw's open-source package is a *local* canvas — its docs are explicit
 * that multiplayer is not included and the host owns the transport. So sync
 * runs over the same SSE bus everything else uses: local edits are throttled
 * and POSTed, the orchestrator merges them into the authoritative scene and
 * rebroadcasts, and remote edits arrive back through `updateScene`.
 *
 * Two things that are easy to get wrong and are handled deliberately:
 *
 *  - `onChange` fires on every pointer move. Posting each one would saturate
 *    the bus, so edits are throttled and only genuinely changed elements are
 *    sent, compared by Excalidraw's own `version` counter.
 *  - Applying a remote scene re-triggers `onChange`. Without a guard that would
 *    echo straight back to the server as a fresh local edit, so writes are
 *    suppressed while a remote update is being applied.
 */

'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef } from 'react';
import type { BoardElement } from '@echosphere/shared-types';

/** Roughly ten posts a second: smooth to watch, ~40x less traffic than raw. */
const SYNC_INTERVAL_MS = 100;

export interface ExcalidrawBoardProps {
  /** The scene as the orchestrator currently holds it. */
  scene: BoardElement[];
  /** False for students, who watch rather than draw. */
  canDraw: boolean;
  onSceneChange: (elements: BoardElement[]) => void;
}

export function ExcalidrawBoard({ scene, canDraw, onSceneChange }: ExcalidrawBoardProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Excalidraw's API type is not exported in a usable form.
  const apiRef = useRef<any>(null);
  const applyingRemote = useRef(false);
  const lastSentVersions = useRef(new Map<string, number>());
  const pending = useRef<BoardElement[] | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const onSceneChangeRef = useRef(onSceneChange);
  useEffect(() => {
    onSceneChangeRef.current = onSceneChange;
  }, [onSceneChange]);

  // Flush on an interval rather than per change: a single stroke is hundreds of
  // change events, and only the latest state of each element matters.
  useEffect(() => {
    timer.current = setInterval(() => {
      const batch = pending.current;
      pending.current = null;
      if (batch && batch.length > 0) onSceneChangeRef.current(batch);
    }, SYNC_INTERVAL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const handleChange = useCallback((elements: readonly unknown[]) => {
    if (applyingRemote.current || !canDraw) return;
    const changed: BoardElement[] = [];
    for (const raw of elements) {
      const el = raw as BoardElement;
      if (lastSentVersions.current.get(el.id) !== el.version) {
        lastSentVersions.current.set(el.id, el.version);
        changed.push(el);
      }
    }
    if (changed.length > 0) pending.current = changed;
  }, [canDraw]);

  // Remote scene in. Guarded so the resulting onChange is not echoed back.
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    applyingRemote.current = true;
    try {
      api.updateScene({ elements: scene });
      for (const el of scene) lastSentVersions.current.set(el.id, el.version);
    } finally {
      // Cleared after paint, since updateScene's onChange is not synchronous.
      requestAnimationFrame(() => {
        applyingRemote.current = false;
      });
    }
  }, [scene]);

  return (
    <div className="absolute inset-0">
      <ExcalidrawCanvas
        apiRef={apiRef}
        canDraw={canDraw}
        onChange={handleChange}
      />
    </div>
  );
}

/**
 * Loaded lazily: Excalidraw touches `window` at module scope, so importing it
 * into a page would break server rendering — the same reason ClassroomAudio is
 * lazy.
 */
const Excalidraw = dynamic(
  () => import('@excalidraw/excalidraw').then((m) => m.Excalidraw),
  { ssr: false, loading: () => <BoardLoading /> },
);

function ExcalidrawCanvas({
  apiRef,
  canDraw,
  onChange,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above.
  apiRef: React.MutableRefObject<any>;
  canDraw: boolean;
  onChange: (elements: readonly unknown[]) => void;
}) {
  return (
    <Excalidraw
      excalidrawAPI={(api: unknown) => {
        apiRef.current = api;
      }}
      onChange={onChange}
      viewModeEnabled={!canDraw}
      UIOptions={{
        canvasActions: {
          // The room is the sharing mechanism; per-user export and live
          // collaboration would be a second, competing sync.
          saveToActiveFile: false,
          loadScene: false,
          export: false,
          saveAsImage: canDraw,
        },
      }}
    />
  );
}

function BoardLoading() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-[var(--eco-cream-faint)]">
      Loading the board…
    </div>
  );
}
