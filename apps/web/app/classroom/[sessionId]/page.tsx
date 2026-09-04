/**
 * Student view of a live classroom — PS31 §3.1, §3.6, §3.7.
 *
 * Audio-only by design except for screen sharing: there is no video of
 * people, only a Meet-style grid of participant avatar tiles (speaking
 * indicator, mic state, raised-hand badge). Everything else — transcript,
 * quiz cards, workspace, targeted reading — lives behind a slide-out menu.
 */

'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ClassroomShell } from '@/components/classroom/ClassroomShell';
import { ClassroomAudio } from '@/components/classroom/ClassroomAudioLazy';
import { CatchupChatbot } from '@/components/classroom/CatchupChatbot';
import { QuizOverlay } from '@/components/classroom/QuizOverlay';
import { QuizCelebration } from '@/components/classroom/QuizCelebration';
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  AgentAbsentNotice,
  FloorIndicator,
  QuizCards,
  TranscriptFeed,
} from '@/components/classroom/panels';
import { ParticipantGrid } from '@/components/classroom/ParticipantGrid';
import { ScreenShareStage } from '@/components/classroom/ScreenShareStageLazy';
import { ClassroomDrawer, type DrawerTab } from '@/components/classroom/ClassroomDrawer';
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

function AppMenuIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 18 18" fill="currentColor" aria-hidden>
      <circle cx="3" cy="3" r="2" />
      <circle cx="9" cy="3" r="2" />
      <circle cx="15" cy="3" r="2" />
      <circle cx="3" cy="9" r="2" />
      <circle cx="9" cy="9" r="2" />
      <circle cx="15" cy="9" r="2" />
      <circle cx="3" cy="15" r="2" />
      <circle cx="9" cy="15" r="2" />
      <circle cx="15" cy="15" r="2" />
    </svg>
  );
}

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
  const [copiedCode, setCopiedCode] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('workspace');
  const [isScreenSharing, setIsScreenSharing] = useState(false);

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

  const toggleScreenShare = useCallback(async () => {
    if (!identity) return;
    const next = !isScreenSharing;
    try {
      await view.toggleScreenShare(next);
      setIsScreenSharing(next);
    } catch {
      // The orchestrator already logged the reason (e.g. someone else is sharing).
    }
  }, [identity, isScreenSharing, view]);

  const stopScreenShareFromBrowser = useCallback(() => {
    setIsScreenSharing(false);
    if (identity) void view.toggleScreenShare(false).catch(() => undefined);
  }, [identity, view]);

  if (!identity) {
    return (
      <main className="eco-room flex min-h-screen items-center justify-center p-6 text-sm text-[var(--eco-cream-dim)]">
        Loading…
      </main>
    );
  }

  const isHandRaised = view.raisedHands.includes(identity.participantId);
  const canShareScreen = view.screenShareAllowed.includes(identity.participantId);
  const someoneElseIsSharing =
    view.activeScreenShare !== null &&
    view.activeScreenShare.participantId !== identity.participantId;

  const tabs: DrawerTab[] = [
    {
      id: 'workspace',
      label: 'Workspace',
      content: (
        <MiroWorkspacePane
          sessionId={sessionId}
          participantId={identity.participantId}
          role="student"
          workspace={view.workspace}
          onRefresh={view.refreshWorkspace}
        />
      ),
    },
    {
      id: 'transcript',
      label: 'Transcript',
      content: (
        <TranscriptFeed
          transcript={view.transcript}
          participants={view.participants}
          agentPresent={Boolean(view.room?.agentId)}
        />
      ),
    },
    {
      id: 'reading',
      label: 'Reading',
      content: (
        <TargetedReadingPanel
          sessionId={sessionId}
          participantId={identity.participantId}
          role="student"
          readings={view.targetedReadings}
        />
      ),
    },
    {
      id: 'quizzes',
      label: 'Quizzes',
      content: (
        <QuizCards
          quizzes={view.quizzes}
          canAnswer={!view.ended}
          onAnswer={answer}
        />
      ),
    },
  ];

  return (
    <main className="eco-room mx-auto flex min-h-screen max-w-6xl flex-col gap-3 p-4 md:h-screen md:overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--eco-rule)] pb-4">
        <div className="flex flex-col gap-1">
          <h1 className="eco-display text-2xl text-[var(--eco-cream)]">
            {view.room?.title ?? 'Classroom'}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-[var(--eco-cream-faint)]">
              Student: {identity.displayName} · {view.connected ? 'connected' : 'reconnecting…'}
            </span>
            <span className="text-[var(--eco-rule)]">|</span>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-[var(--eco-cream-dim)]">Class Code:</span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(sessionId);
                  setCopiedCode(true);
                  setTimeout(() => setCopiedCode(false), 2000);
                }}
                className="flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-xs font-bold tracking-widest transition shadow-sm hover:scale-105"
                style={{
                  background: 'color-mix(in srgb, var(--eco-athena) 20%, transparent)',
                  color: 'var(--eco-athena)',
                  border: '1px solid color-mix(in srgb, var(--eco-athena) 50%, transparent)',
                }}
                title="Click to copy 4-digit class code"
              >
                <span>{sessionId}</span>
                <span className="text-[10px] font-sans font-normal opacity-80" aria-hidden>
                  {copiedCode ? (
                    '✓'
                  ) : (
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                      <rect x="5" y="5" width="8" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-5A1.5 1.5 0 0 0 3 3.5v7A1.5 1.5 0 0 0 4.5 12H5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  )}
                </span>
              </button>
            </div>
            {view.policy?.studentsMayInvoke ? (
              <>
                <span className="text-[var(--eco-rule)]">|</span>
                <span className="text-[var(--eco-cream-faint)]">
                  say <strong className="font-semibold" style={{ color: 'var(--eco-glow)' }}>&ldquo;{view.policy.wakePhrase}&rdquo;</strong> to ask Athena
                </span>
              </>
            ) : (
              <>
                <span className="text-[var(--eco-rule)]">|</span>
                <span className="text-[var(--eco-cream-faint)]">
                  Athena is listening only
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ThemeToggle />
          <LanguageSelector
            currentLanguage={view.myLanguage}
            onLanguageChange={view.changeLanguage}
          />

          <button
            type="button"
            onClick={() => setShow1on1Tutor(true)}
            className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm transition hover:scale-105"
            style={{
              borderColor: 'color-mix(in srgb, var(--eco-amber) 60%, transparent)',
              background: 'color-mix(in srgb, var(--eco-amber) 15%, transparent)',
              color: 'var(--eco-amber)',
            }}
            title="Open dedicated Socratic AI Teaching Assistant for step-by-step help"
          >
            <span>AI Assistant</span>
          </button>

          <button
            type="button"
            onClick={() => setShowCatchupBooking(true)}
            className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm transition hover:scale-105"
            style={{
              borderColor: 'color-mix(in srgb, var(--eco-blue) 60%, transparent)',
              background: 'color-mix(in srgb, var(--eco-blue) 15%, transparent)',
              color: 'var(--eco-blue)',
            }}
            title="Schedule a 1:1 tutoring connect with the teacher"
          >
            <span>1:1 Connect</span>
          </button>

          <button
            type="button"
            onClick={() => setShowAbsentPacket(true)}
            className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm transition hover:scale-105"
            style={{
              borderColor: 'var(--eco-rule)',
              background: 'var(--eco-ink-sunken)',
              color: 'var(--eco-cream-dim)',
            }}
            title="View absent catch-up packet & share via WhatsApp/Email"
          >
            <span>Absent Packet</span>
          </button>

          <button
            type="button"
            onClick={() => void view.toggleHandRaise()}
            data-active={isHandRaised}
            className={`eco-action-chip ${isHandRaised ? 'eco-pulse' : ''}`}
            style={{ '--chip-accent': 'var(--eco-amber)' } as CSSProperties}
            title="Raise or lower your hand"
          >
            <span>{isHandRaised ? 'Hand Raised' : 'Raise Hand'}</span>
          </button>

          {canShareScreen && (
            <button
              type="button"
              onClick={() => void toggleScreenShare()}
              disabled={!isScreenSharing && someoneElseIsSharing}
              className="eco-action-chip disabled:cursor-not-allowed disabled:opacity-40"
              style={{ '--chip-accent': 'var(--eco-blue)' } as CSSProperties}
              title="Share your screen"
            >
              {isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
            </button>
          )}

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
            onClick={() => setMenuOpen(true)}
            className="flex h-11 items-center gap-2 rounded-full border-2 px-4 py-2 text-sm font-semibold transition-colors"
            style={
              menuOpen
                ? { borderColor: 'var(--eco-glow)', background: 'var(--eco-glow)', color: 'var(--eco-ink)' }
                : { borderColor: 'var(--eco-glow)', background: 'var(--eco-glow-dim)', color: 'var(--eco-glow-bright)' }
            }
            aria-label="Open menu"
            title="Workspace, transcript, reading, quizzes"
          >
            <AppMenuIcon />
            <span>Menu</span>
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

      <div className="flex min-h-0 flex-1 flex-col">
        {view.activeScreenShare ? (
          <ScreenShareStage
            isSharing={isScreenSharing}
            onSharingEnded={stopScreenShareFromBrowser}
            activeScreenShare={view.activeScreenShare}
            selfUid={identity.uid}
          />
        ) : (
          <ParticipantGrid
            participants={view.participants}
            agentPresent={Boolean(view.room?.agentId)}
            agentUid={identity.agentUid}
            speakingUid={speakingUid}
            selfUid={identity.uid}
            selfMicEnabled={micEnabled}
            raisedHands={view.raisedHands}
          />
        )}
      </div>

      <ClassroomDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {!view.ended && (
        <QuizOverlay quizzes={view.quizzes} onAnswer={answer} />
      )}
      <QuizCelebration celebration={view.celebration} />

      {!view.ended && (
        <CatchupChatbot
          sessionId={sessionId}
          participantId={identity.participantId}
          displayName={identity.displayName}
        />
      )}

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