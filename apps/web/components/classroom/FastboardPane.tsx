/**
 * The collaborative canvas behind the board.
 *
 * Uses `@netless/fastboard-core` rather than `@netless/fastboard`. The latter
 * bundles the prebuilt toolbar, which pulls `@netless/appliance-plugin` —
 * that package declares `react-dom: ^16.8.0` and calls `ReactDOM.render`,
 * removed in React 18. On React 19 it fails with
 * "(0 , yl.render) is not a function" while binding the container. Core has no
 * such dependency, and the toolbar is not wanted here anyway: Athena writes
 * programmatically and the readable lines are rendered by ClassroomBoard.
 *
 * Failure is reported upward rather than thrown, so a canvas problem downgrades
 * the board to its paper fallback instead of taking the panel down.
 */

'use client';

import { useEffect, useRef } from 'react';
import type { WhiteboardJoin } from '@echosphere/shared-types';

export interface FastboardPaneProps {
  join: WhiteboardJoin;
  /** Called when the canvas cannot be shown, so the board can fall back. */
  onUnavailable?: (reason: string) => void;
}

export function FastboardPane({ join, onUnavailable }: FastboardPaneProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Held in a ref rather than listed as a dependency. Callers naturally pass an
  // inline arrow, which is a new function every render; as a dependency that
  // re-ran this effect constantly and built a second board each time, which
  // WindowManager rejects with "mount duplicate check failed: isCreated=true".
  const onUnavailableRef = useRef(onUnavailable);
  // Written in an effect, not during render: assigning to a ref while
  // rendering is impure and the compiler rejects it.
  useEffect(() => {
    onUnavailableRef.current = onUnavailable;
  }, [onUnavailable]);

  // Primitive fields rather than the `join` object: a re-render that rebuilds
  // that object would otherwise tear down a working board and remount it.
  const { appIdentifier, region, uid, uuid, roomToken } = join;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let disposed = false;
    let app: { destroy?: () => void } | undefined;

    void (async () => {
      try {
        const core = await import('@netless/fastboard-core');
        if (disposed) return;

        const created = await core.createFastboard({
          sdkConfig: {
            appIdentifier: appIdentifier as string,
            region: region as never,
          },
          joinRoom: {
            uid,
            uuid: uuid as string,
            roomToken: roomToken as string,
          },
        });
        if (disposed) {
          created.destroy();
          return;
        }
        app = created;
        created.bindContainer(el);
      } catch (error) {
        if (disposed) return;
        const reason = error instanceof Error ? error.message : 'Canvas unavailable';
        console.warn('[board] canvas unavailable, falling back:', reason);
        onUnavailableRef.current?.(reason);
      }
    })();

    return () => {
      disposed = true;
      app?.destroy?.();
    };
  }, [appIdentifier, region, uid, uuid, roomToken]);

  return <div ref={ref} className="absolute inset-0" />;
}
