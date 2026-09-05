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
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardElement } from '@echosphere/shared-types';

// Excalidraw ships its stylesheet separately and renders unstyled without it —
// icons at natural SVG size, toolbar labels as loose text, no layout. Imported
// here rather than in globals.css so it loads with the lazy chunk instead of on
// every page.
import '@excalidraw/excalidraw/index.css';

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

  /**
   * Whether Excalidraw has handed us its API yet.
   *
   * Held as state, not only in the ref, because the effect that applies a
   * remote scene has to run again once the API exists. Excalidraw is loaded
   * lazily and hands the API over after mount, so a board that already had
   * content when the component first rendered — anyone joining a lesson in
   * progress — ran that effect against a null API, bailed, and then never had
   * cause to run again, because the scene it was waiting for had already
   * arrived. Students saw a permanently blank board while the teacher, who
   * held the elements locally, saw the drawing.
   */
  const [apiReady, setApiReady] = useState(false);
  const applyingRemote = useRef(false);
  /**
   * True between pointer-down and pointer-up. Applying a remote scene mid-drag
   * replaces the element currently under the pointer with an older copy, which
   * truncates the stroke. Remote work is not lost: the scene prop is applied on
   * the next change once the pointer is up.
   */
  const drawing = useRef(false);
  const missedRemote = useRef(false);
  const lastSentVersions = useRef(new Map<string, number>());
  /**
   * Keyed by element id so a second change to the same element within one
   * window replaces it rather than the batch being overwritten wholesale.
   * Overwriting lost edits silently: the version was already recorded as sent,
   * so the dropped element was never retried.
   */
  const pending = useRef(new Map<string, BoardElement>());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Latest scene, readable from callbacks without making them depend on it.
  const sceneRef = useRef(scene);
  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

  const onSceneChangeRef = useRef(onSceneChange);
  useEffect(() => {
    onSceneChangeRef.current = onSceneChange;
  }, [onSceneChange]);

  // Flush on an interval rather than per change: a single stroke is hundreds of
  // change events, and only the latest state of each element matters.
  useEffect(() => {
    timer.current = setInterval(() => {
      if (pending.current.size === 0) return;
      const batch = [...pending.current.values()];
      pending.current = new Map();
      // Recorded as sent only once it actually goes out.
      for (const el of batch) lastSentVersions.current.set(el.id, el.version);
      onSceneChangeRef.current(batch);
    }, SYNC_INTERVAL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const handlePointerDown = useCallback(() => {
    drawing.current = true;
  }, []);

  const handlePointerUp = useCallback(() => {
    drawing.current = false;
    // Apply whatever arrived while the pointer was down.
    if (missedRemote.current && apiRef.current) {
      missedRemote.current = false;
      applyingRemote.current = true;
      apiRef.current.updateScene({ elements: sceneRef.current });
      requestAnimationFrame(() => {
        applyingRemote.current = false;
      });
    }
  }, []);

  const handleChange = useCallback((elements: readonly unknown[]) => {
    if (applyingRemote.current || !canDraw) return;
    const changed: BoardElement[] = [];
    for (const raw of elements) {
      const el = raw as BoardElement;
      const sent = lastSentVersions.current.get(el.id);
      const queued = pending.current.get(el.id)?.version;
      if (sent !== el.version && queued !== el.version) changed.push(el);
    }
    for (const el of changed) pending.current.set(el.id, el);
  }, [canDraw]);

  // Remote scene in. Guarded so the resulting onChange is not echoed back.
  // Re-runs when the API arrives, so a scene that predates the canvas is not
  // stranded.
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    if (drawing.current) {
      missedRemote.current = true;
      return;
    }
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
  }, [scene, apiReady]);

  return (
    <div className="absolute inset-0">
      <ExcalidrawCanvas
        apiRef={apiRef}
        onReady={setApiReady}
        canDraw={canDraw}
        onChange={handleChange}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
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
  onReady,
  canDraw,
  onChange,
  onPointerDown,
  onPointerUp,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above.
  apiRef: React.MutableRefObject<any>;
  onReady: (ready: boolean) => void;
  canDraw: boolean;
  onChange: (elements: readonly unknown[]) => void;
  onPointerDown: () => void;
  onPointerUp: () => void;
}) {
  return (
    <Excalidraw
      excalidrawAPI={(api: unknown) => {
        apiRef.current = api;
        onReady(Boolean(api));
      }}
      onChange={onChange}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
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
