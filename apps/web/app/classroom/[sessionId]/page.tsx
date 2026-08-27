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
  // Whether the transcript pipeline is actually alive. Distinguishing this from
  // "nobody has spoken" is the difference between a quiet room and a broken one.
  const [transcriptionLive, setTranscriptionLive] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(
    null,
  );

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
    return <main className="p-6 text-sm text-neutral-500">Loading…</main>;
  }

  return (
    <main className="mx-auto flex h-screen max-w-5xl flex-col gap-3 overflow-hidden p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {view.room?.title ?? 'Classroom'}
          </h1>
          <p className="text-xs text-neutral-500">
            Joined as {identity.displayName} ·{' '}
            {view.connected ? 'connected' : 'reconnecting…'}
            {view.policy?.studentsMayInvoke ? (
              <>
                {' '}· say{' '}
                <strong className="font-semibold text-violet-700">
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
            className={`rounded-md border px-3 py-1.5 text-sm ${
              micEnabled
                ? 'border-neutral-900 bg-neutral-900 text-white'
                : 'border-neutral-300'
            }`}
          >
            {micEnabled ? 'Mic on' : 'Mic off'}
          </button>
          <button
            type="button"
            onClick={() => void leave()}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          >
            Leave
          </button>
        </div>
      </header>

      {view.ended && (
        <p className="rounded-md border border-neutral-300 bg-neutral-50 p-3 text-sm">
          This lesson has ended. Your teacher has the summary.
        </p>
      )}

      {!view.room?.agentId && <AgentAbsentNotice isTeacher={false} />}

      {transcriptionError && (
        <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          Transcription could not start: {transcriptionError}. Athena cannot hear
          you. Try reloading the page.
        </p>
      )}

      {view.room?.agentId && !transcriptionLive && !transcriptionError && (
        <p className="rounded-md border border-neutral-300 bg-neutral-50 p-3 text-sm text-neutral-700">
          Connecting the transcript pipeline…
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
              />
            )}
          </ClassroomShell>

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
          />
          <QuizCards
            quizzes={view.quizzes}
            canAnswer={!view.ended}
            onAnswer={answer}
          />
        </aside>
      </div>
    </main>
  );
}
