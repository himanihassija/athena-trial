'use client';

import { useEffect, useRef } from 'react';
import type { WhiteboardJoin } from '@echosphere/shared-types';

/**
 * Agora Fastboard (Interactive Whiteboard UIKit). Joins with the room token
 * minted by the orchestrator — never the SDK token.
 */
export function FastboardPane({ join }: { join: WhiteboardJoin }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (
      !el ||
      !join.appIdentifier ||
      !join.uuid ||
      !join.roomToken
    ) {
      return;
    }

    let disposed = false;
    let ui: { destroy?: () => void } | undefined;
    let room: { destroy?: () => void } | undefined;

    void (async () => {
      const fastboard = await import('@netless/fastboard');
      if (disposed) return;
      const app = await fastboard.createFastboard({
        sdkConfig: {
          appIdentifier: join.appIdentifier as string,
          region: join.region,
        },
        joinRoom: {
          uid: join.uid,
          uuid: join.uuid as string,
          roomToken: join.roomToken as string,
        },
      });
      if (disposed) {
        app.destroy();
        return;
      }
      room = app;
      ui = fastboard.createUI
        ? fastboard.createUI(app, el)
        : fastboard.mount(app, el);
    })().catch((err) => {
      console.error('Fastboard join failed', err);
    });

    return () => {
      disposed = true;
      ui?.destroy?.();
      room?.destroy?.();
    };
  }, [join.appIdentifier, join.region, join.uuid, join.roomToken, join.uid]);

  return <div ref={hostRef} className="h-full min-h-[16rem] w-full overflow-hidden rounded-lg bg-white" />;
}
