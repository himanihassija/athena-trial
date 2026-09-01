/**
 * Student view of a live classroom — PS31 §3.1, §3.6, §3.7.
 *
 * Audio-only by design: there are no video tiles anywhere in this app. What a
 * student sees is the transcript, the quiz cards, and who has the floor.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ClassroomShell } from '@/components/classroom/ClassroomShell';
import { ClassroomAudio } from '@/components/classroom/ClassroomAudioLazy';
import { ClassroomBoard } from '@/components/classroom/ClassroomBoard';
import { CatchupChatbot } from '@/components/classroom/CatchupChatbot';
import { QuizOverlay } from '@/components/classroom/QuizOverlay';
import {
  AgentAbsentNotice,
  FloorIndicator,
  QuizCards,
  RosterPanel,
  TranscriptFeed,
} from '@/components/classroom/panels';
import { useClassroom } from '@/hooks/useClassroom';
import {
  clearIdentity,
  loadIdentity,
  orchestrator,
  type StoredIdentity,
} from '@/lib/orchestrator';

export default function ClassroomPage() {
  const params = useParams<{ sessionId: string }>();
  const router = useRouter();
  const sessionId = params.sessionId;

  const [identity, setIdentity] = useState<StoredIdentity | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [speakingUid, setSpeakingUid] = useState<string | null>(null);
  // Whether the transcript pipeline is actually alive. Distinguishing this from
  // "nobody has spoken" is the difference between a quiet room and a broken one.
  const [transcriptionLive, setTranscriptionLive] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(
    null,
  );
  const [micError, setMicError] = useState<string | null>(null);

  useEffect(() => {
    const stored = loadIdentity(sessionId);
    if (!stored) {
      router.replace('/join');
      return;
    }
    setIdentity(stored);
  }, [sessionId, router]);

  const view = useClassroom(sessionId, identity?.participantId ?? null);

  const answer = useCallback(
    (quizId: string, option: string) => {
      if (!identity) return;
      view.recordAnswer(quizId, option);
      void orchestrator
        .answerQuiz(sessionId, quizId, identity.participantId, option, 'ui')
        .catch(() => undefined);
    },
    [identity, sessionId, view],
  );

  const leave = useCallback(async () => {
    if (identity) {
      await orchestrator
        .leave(sessionId, identity.participantId)
        .catch(() => undefined);
    }
    clearIdentity();
    router.push('/join');
  }, [identity, sessionId, router]);

  if (!identity) {
    return (
      <main className="eco-room flex min-h-screen items-center justify-center p-6 text-sm text-[var(--eco-cream-dim)]">
        Loading…
      </main>
    );
  }

  return (
    <main className="eco-room mx-auto flex h-screen max-w-5xl flex-col gap-3 overflow-hidden p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="eco-display text-2xl text-[var(--eco-cream)]">
            {view.room?.title ?? 'Classroom'}
          </h1>
          <p className="text-xs text-[var(--eco-cream-faint)]">
            Joined as {identity.displayName} ·{' '}
            {view.connected ? 'connected' : 'reconnecting…'}
            {view.policy?.studentsMayInvoke ? (
              <>
                {' '}· say{' '}
                <strong
                  className="font-semibold"
                  style={{ color: 'var(--eco-glow)' }}
                >
                  &ldquo;{view.policy.wakePhrase}&rdquo;
                </strong>{' '}
                to ask Athena
              </>
            ) : (
              <> · Athena is listening only</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <FloorIndicator floor={view.floor} policy={view.policy} />
          <button
            type="button"
            onClick={() => setMicEnabled((on) => !on)}
            className="eco-mic-button flex h-9 w-9 items-center justify-center border text-xs font-medium transition-colors"
            style={
              micEnabled
                ? { borderColor: 'var(--eco-glow)', background: 'var(--eco-glow-dim)', color: 'var(--eco-glow-bright)' }
                : { borderColor: 'var(--eco-rule)', color: 'var(--eco-cream-faint)' }
            }
            aria-label={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
            title={micEnabled ? 'Mic on' : 'Mic off'}
          >
            {micEnabled ? '●' : '○'}
          </button>
          <button
            type="button"
            onClick={() => void leave()}
            className="rounded-lg border px-3 py-1.5 text-sm text-[var(--eco-cream-dim)]"
            style={{ borderColor: 'var(--eco-rule)' }}
          >
            Leave
          </button>
        </div>
      </header>

      {view.ended && (
        <p className="eco-panel-sunken px-4 py-3 text-sm text-[var(--eco-cream-dim)]">
          This lesson has ended. Your teacher has the summary.
        </p>
      )}

      {!view.room?.agentId && <AgentAbsentNotice isTeacher={false} />}

      {transcriptionError && (
        <p
          className="rounded-[0.625rem] border px-4 py-3 text-sm"
          style={{ borderColor: 'var(--eco-red)', background: 'var(--eco-red-dim)', color: 'var(--eco-cream)' }}
        >
          Transcription could not start: {transcriptionError}. Athena cannot hear
          you. Try reloading the page.
        </p>
      )}

      {view.room?.agentId && !transcriptionLive && !transcriptionError && (
        <p className="eco-panel-sunken px-4 py-3 text-sm text-[var(--eco-cream-dim)]">
          Connecting the transcript pipeline…
        </p>
      )}

      {micError && (
        <p
          className="rounded-[0.625rem] border px-4 py-3 text-sm"
          style={{ borderColor: 'var(--eco-amber)', background: 'var(--eco-amber-dim)', color: 'var(--eco-cream)' }}
        >
          {micError} You can still listen, but Athena will not hear you until
          a microphone is available.
        </p>
      )}


      <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {/* ClassroomShell wraps only the audio. Transcript, roster and quiz
              cards all render from the orchestrator's SSE stream, so an RTM
              problem should cost the room its audio — not its entire UI. */}
          <ClassroomShell identity={identity}>
            {(rtm) => (
              <ClassroomAudio
                sessionId={sessionId}
                channel={identity.channel}
                appId={identity.appId}
                uid={identity.uid}
                rtcToken={identity.rtcToken}
                rtmClient={rtm}
                agentUid={identity.agentUid}
                // Students never relay. Human turns arrive without a speaker
                // id, so the relaying browser has to infer one from its own
                // volume indicator — and two browsers inferring separately
                // logged the same sentence twice, under two different names.
                // The teacher's tab is the single authority.
                isRelay={false}
                micEnabled={micEnabled}
                onToolkitReady={setTranscriptionLive}
                onToolkitError={setTranscriptionError}
                onMicError={setMicError}
                onSpeakingChange={setSpeakingUid}
              />
            )}
          </ClassroomShell>

          <ClassroomBoard
            board={view.whiteboard}
            join={view.whiteboardJoin}
            joinError={view.whiteboardJoinError}
          />

          <TranscriptFeed
            transcript={view.transcript}
            participants={view.participants}
            agentPresent={Boolean(view.room?.agentId)}
          />
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-5 overflow-y-auto md:w-72">
          <RosterPanel
            participants={view.participants}
            agentPresent={Boolean(view.room?.agentId)}
            agentUid={identity.agentUid}
            speakingUid={speakingUid}
          />
          <QuizCards
            quizzes={view.quizzes}
            canAnswer={!view.ended}
            onAnswer={answer}
          />
        </aside>
      </div>

      {!view.ended && (
        <QuizOverlay quizzes={view.quizzes} onAnswer={answer} />
      )}
      {!view.ended && (
        <CatchupChatbot
          sessionId={sessionId}
          participantId={identity.participantId}
          displayName={identity.displayName}
        />
      )}
    </main>
  );
}
