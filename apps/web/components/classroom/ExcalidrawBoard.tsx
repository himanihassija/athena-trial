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
   * The canvas API itself, held as state rather than only in the ref.
   *
   * The effect that paints a remote scene has to run again whenever the canvas
   * changes, and there are two ways it can. Excalidraw is loaded lazily and
   * hands its API over after mount, so a board that already had content when
   * this first rendered ran that effect against a null API and bailed. And the
   * component can mount more than once — StrictMode does it in development,
   * and the lazy chunk resolving does it in any build — each time producing a
   * brand new, empty canvas.
   *
   * Tracking a boolean "ready" flag covered only the first case: on a remount
   * the flag was already true, so nothing re-ran and the fresh canvas was
   * never given the scene. Anyone joining a lesson in progress sat looking at
   * a blank board while the teacher, holding the elements locally, saw the
   * drawing. Keying on the API object means a new canvas is a new value, and
   * the scene is painted onto it.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see apiRef.
  const [api, setApi] = useState<any>(null);

  /**
   * Whatever the board already held when this mounted, captured once. Read
   * through a state initialiser rather than a ref, because reading a ref
   * during render is impure.
   */
  const [initialElements] = useState(() => scene);
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
    if (!api) return;
    if (drawing.current) {
      missedRemote.current = true;
      return;
    }
    applyingRemote.current = true;
    try {
      api.updateScene({ elements: scene });
      for (const el of scene) lastSentVersions.current.set(el.id, el.version);

      // A scene that lands while Excalidraw is still initialising is applied
      // and then overwritten by the empty default it finishes loading. Content
      // present at mount is handed over as `initialData`; this covers the
      // remaining sliver where it arrives just after. Only for viewers, whose
      // canvas should always be exactly the shared scene — re-asserting it for
      // someone who can draw would undo their own deletions.
      if (!canDraw && scene.length > 0) {
        requestAnimationFrame(() => {
          const live = api.getSceneElements?.() ?? [];
          if (live.length >= scene.length) return;
          applyingRemote.current = true;
          api.updateScene({ elements: sceneRef.current });
          requestAnimationFrame(() => {
            applyingRemote.current = false;
          });
        });
      }
    } finally {
      // Cleared after paint, since updateScene's onChange is not synchronous.
      requestAnimationFrame(() => {
        applyingRemote.current = false;
      });
    }
  }, [scene, api, canDraw]);

  return (
    <div className="absolute inset-0">
      <ExcalidrawCanvas
        apiRef={apiRef}
        onReady={setApi}
        initialElements={initialElements}
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
  initialElements,
  canDraw,
  onChange,
  onPointerDown,
  onPointerUp,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above.
  apiRef: React.MutableRefObject<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see apiRef.
  onReady: (api: any) => void;
  initialElements: BoardElement[];
  canDraw: boolean;
  onChange: (elements: readonly unknown[]) => void;
  onPointerDown: () => void;
  onPointerUp: () => void;
}) {
  return (
    <Excalidraw
      /**
       * The scene the board already had, handed over at construction.
       *
       * Excalidraw gives out its API before it has finished loading its own
       * initial scene, so a scene pushed in through `updateScene` during that
       * window was applied and then overwritten by the empty default it
       * finishes initialising with — the element was accepted, the canvas
       * ended up blank, and nothing re-ran because neither the scene nor the
       * API had changed. Anything arriving later still goes through
       * `updateScene`; this covers content that was already there.
       */
      initialData={{
        elements: initialElements as never,
        // A late joiner's viewport is wherever Excalidraw starts, which need
        // not be where the writing is.
        scrollToContent: true,
      }}
      excalidrawAPI={(api: unknown) => {
        apiRef.current = api;
        onReady(api);
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
