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
import { MiroWorkspacePane } from '@/components/workspace/MiroWorkspacePane';
import { AbsentStudentPacketModal } from '@/components/support/AbsentStudentPacketModal';
import { OneOnOneTutorModal } from '@/components/support/OneOnOneTutorModal';
import { TargetedReadingPanel } from '@/components/support/TargetedReadingPanel';
import { CatchupBookingModal } from '@/components/support/CatchupBookingModal';
import { LanguageSelector } from '@/components/support/LanguageSelector';
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
  const [transcriptionLive, setTranscriptionLive] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);

  const [showAbsentPacket, setShowAbsentPacket] = useState(false);
  const [show1on1Tutor, setShow1on1Tutor] = useState(false);
  const [showCatchupBooking, setShowCatchupBooking] = useState(false);

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

  const isHandRaised = view.raisedHands.includes(identity.participantId);

  return (
    <main className="eco-room mx-auto flex min-h-screen max-w-6xl flex-col gap-4 p-4">
      {/* Header Bar */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--eco-rule)] pb-4">
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

        <div className="flex flex-wrap items-center gap-2">
          <LanguageSelector
            currentLanguage={view.myLanguage}
            onLanguageChange={view.changeLanguage}
          />

          {/* Raise Hand Control Plane Button */}
          <button
            type="button"
            onClick={() => void view.toggleHandRaise()}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              isHandRaised
                ? 'border-amber-400 bg-amber-500 text-black shadow-lg animate-pulse'
                : 'border-[var(--eco-rule)] bg-black/40 text-[var(--eco-cream)] hover:bg-white/5'
            }`}
            title="Raise/Lower hand via real-time signaling bus"
          >
            <span>✋</span>
            <span>{isHandRaised ? 'Hand Raised' : 'Raise Hand'}</span>
          </button>

          {/* Absent Student Packet */}
          <button
            type="button"
            onClick={() => setShowAbsentPacket(true)}
            className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 transition"
            title="Open comprehensive lesson catch-up packet"
          >
            <span>📦</span> Absent Packet
          </button>

          {/* 1:1 Tutor Button */}
          <button
            type="button"
            onClick={() => setShow1on1Tutor(true)}
            className="flex items-center gap-1.5 rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 text-xs font-semibold text-purple-300 hover:bg-purple-500/20 transition"
            title="Start private 1:1 tutoring session with Athena"
          >
            <span>👩‍🏫</span> 1:1 Tutor
          </button>

          {/* Schedule Catch-up */}
          <button
            type="button"
            onClick={() => setShowCatchupBooking(true)}
            className="flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-semibold text-blue-300 hover:bg-blue-500/20 transition"
            title="Book a live 1:1 catchup session with teacher & Athena"
          >
            <span>📅</span> Catch-up
          </button>

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

      {/* Main Classroom Layout */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <div className="flex min-h-0 flex-1 flex-col gap-4">
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

          {/* Shared Live Miro Workspace & Held-Back Doubts */}
          <MiroWorkspacePane
            sessionId={sessionId}
            participantId={identity.participantId}
            role="student"
            workspace={view.workspace}
            onRefresh={view.refreshWorkspace}
          />

          <TranscriptFeed
            transcript={view.transcript}
            participants={view.participants}
            agentPresent={Boolean(view.room?.agentId)}
          />
        </div>

        {/* Sidebar */}
        <aside className="flex w-full flex-col gap-5 lg:w-80">
          <TargetedReadingPanel
            sessionId={sessionId}
            participantId={identity.participantId}
            role="student"
            readings={view.targetedReadings}
          />
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

      {/* Modals */}
      <AbsentStudentPacketModal
        sessionId={sessionId}
        isOpen={showAbsentPacket}
        onClose={() => setShowAbsentPacket(false)}
        onOpenCatchupBooking={() => setShowCatchupBooking(true)}
      />

      <OneOnOneTutorModal
        sessionId={sessionId}
        studentId={identity.participantId}
        studentName={identity.displayName}
        isOpen={show1on1Tutor}
        onClose={() => setShow1on1Tutor(false)}
        gaps={view.gaps}
        language={view.myLanguage}
      />

      <CatchupBookingModal
        sessionId={sessionId}
        studentId={identity.participantId}
        studentName={identity.displayName}
        isOpen={showCatchupBooking}
        onClose={() => setShowCatchupBooking(false)}
      />
    </main>
  );
}
