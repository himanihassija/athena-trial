'use client';

import { useEffect } from 'react';
import {
  useLocalScreenTrack,
  usePublish,
  useRemoteUsers,
  useRemoteVideoTracks,
  RemoteVideoTrack,
  LocalVideoTrack,
} from 'agora-rtc-react';

export function ScreenShareStage({
  isSharing,
  onSharingEnded,
  activeScreenShare,
  selfUid,
}: {
  /** Whether THIS client is the one currently sharing. */
  isSharing: boolean;
  /** Fires when the browser's own "Stop sharing" UI ends the capture. */
  onSharingEnded: () => void;
  activeScreenShare: { participantId: string; displayName: string } | null;
  selfUid: string;
}) {
  const { screenTrack, error } = useLocalScreenTrack(isSharing, {}, 'auto');
  const videoTrack = Array.isArray(screenTrack) ? screenTrack[0] : screenTrack;
  const tracksToPublish = Array.isArray(screenTrack) ? screenTrack : screenTrack ? [screenTrack] : [];
  usePublish(tracksToPublish);

  // The browser's native "Stop sharing" bar ends the capture without going
  // through our own button; without this listener the room would keep
  // believing the share is live until someone notices.
  useEffect(() => {
    if (!videoTrack) return;
    const mediaTrack = videoTrack.getMediaStreamTrack();
    mediaTrack.addEventListener('ended', onSharingEnded);
    return () => mediaTrack.removeEventListener('ended', onSharingEnded);
  }, [videoTrack, onSharingEnded]);

  useEffect(() => {
    if (error) onSharingEnded();
  }, [error, onSharingEnded]);

  const remoteUsers = useRemoteUsers();
  const { videoTracks } = useRemoteVideoTracks(remoteUsers);

  if (!activeScreenShare) return null;

  const isSelf = activeScreenShare.participantId && selfUid;
  const remoteSharerTrack = videoTracks.find(
    (track) => String(track.getUserId()) !== selfUid,
  );

  return (
    <div className="eco-panel relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        className="flex items-center gap-2 border-b px-4 py-2"
        style={{ borderColor: 'var(--eco-rule)' }}
      >
        <span className="eco-lamp eco-lamp-glow eco-pulse" style={{ width: 8, height: 8 }} />
        <span className="text-sm font-medium text-[var(--eco-cream)]">
          {activeScreenShare.displayName} is sharing their screen
        </span>
      </div>
      <div className="relative min-h-0 flex-1 bg-black">
        {isSharing && videoTrack ? (
          <LocalVideoTrack track={videoTrack} play className="h-full w-full object-contain" />
        ) : remoteSharerTrack ? (
          <RemoteVideoTrack
            track={remoteSharerTrack}
            play
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-[var(--eco-cream-faint)]">
            Connecting to the shared screen…
          </div>
        )}
      </div>
    </div>
  );
}