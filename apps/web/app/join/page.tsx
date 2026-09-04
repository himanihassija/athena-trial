/**
 * ATHENA — Your AI Co-teacher
 * Exact reproduction of landing screen with dynamic Light/Dark theme support.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import type { Role } from '@echosphere/shared-types';
import {
  HelpCircle,
  Zap,
  BarChart3,
  FileText,
  Users,
  User,
  GraduationCap,
  UserSquare2,
  CheckCircle2,
  FilePlus,
  BookOpen,
  Sparkles,
  Play,
  Radio,
  Lightbulb,
  Heart,
  X,
  ArrowRight,
} from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  orchestrator,
  storeIdentity,
  type SessionSummary,
} from '@/lib/orchestrator';

export default function JoinPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<Role>('teacher');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [shareCodeInput, setShareCodeInput] = useState('');
  const [language, setLanguage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await orchestrator.listSessions();
      setSessions(list.filter((s) => s.endedAt === null));
      setReachable(true);
    } catch {
      setReachable(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const join = useCallback(
    async (sessionId: string) => {
      setBusy(true);
      setError(null);
      try {
        const result = await orchestrator.join(sessionId, {
          displayName: displayName.trim(),
          role,
          preferredLanguage: language.trim() || undefined,
        });
        storeIdentity({ ...result, displayName: displayName.trim() });
        router.push(
          role === 'teacher'
            ? `/teacher/${sessionId}`
            : `/classroom/${sessionId}`,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not join');
        setBusy(false);
      }
    },
    [displayName, role, language, router],
  );

  const createAndJoin = useCallback(
    async (seed?: 'unlike-fractions') => {
      setBusy(true);
      setError(null);
      try {
        const session = await orchestrator.createSession(
          seed
            ? 'Adding unlike fractions'
            : newTitle.trim() || 'Untitled lesson',
          seed,
        );
        await join(session.sessionId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not create lesson');
        setBusy(false);
      }
    },
    [newTitle, join],
  );

  const nameValid = displayName.trim().length > 0;
  const canCreate = nameValid && newTitle.trim().length > 0 && !busy;

  return (
    <div className="relative min-h-screen w-full font-sans text-[#1A1A1A] selection:bg-[#F59E0B]/20 overflow-x-hidden">
      {/* Background Image with Light Blur */}
      <div
        className="fixed inset-0 z-0 bg-cover bg-center bg-no-repeat pointer-events-none filter blur-[2px] scale-[1.03] transition-all duration-300"
        style={{
          backgroundImage: 'url(/classroom-bg.png)',
        }}
      />

      {/* Dynamic Tint Overlay: Light theme has low transparency overlay (~35%) so classroom photo is vivid; Dark theme has deep slate overlay */}
      <div className="fixed inset-0 z-0 pointer-events-none bg-[#FDF6EE]/35 dark:bg-[#0B0F17]/85 transition-colors duration-300 backdrop-blur-[1px]" />

      {/* Main Container */}
      <div className="relative z-10 mx-auto flex min-h-screen max-w-[1440px] flex-col justify-between px-6 py-6 sm:px-10 lg:px-12">
        {/* ── 1. HEADER ROW ────────────────────────────────────────────── */}
        <header className="flex w-full items-center justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-2.5 h-3.5 w-3.5 rounded-full bg-[#14B8A6] shadow-[0_0_12px_#14B8A6]" />
            <div>
              <h1 className="text-[34px] sm:text-[38px] font-black uppercase leading-none tracking-[0.14em] text-[#111111] dark:text-white">
                ATHENA
              </h1>
              <p className="mt-1 text-[15px] sm:text-[16px] font-semibold text-[#4B5563] dark:text-[#94A3B8]">
                Your AI Co-teacher
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Theme Toggle (Light / Dark) */}
            <ThemeToggle />

            {/* Help Button */}
            <button
              type="button"
              onClick={() => setShowHelp(true)}
              className="flex items-center gap-1.5 rounded-full border border-[#E5E7EB] bg-white px-4 py-2 text-[14px] font-medium text-[#374151] shadow-sm transition hover:bg-gray-50 hover:shadow dark:border-white/10 dark:bg-[#1E293B] dark:text-[#E2E8F0] dark:hover:bg-[#334155]"
            >
              <HelpCircle className="h-4 w-4 text-[#6B7280] dark:text-[#94A3B8]" />
              <span>Help</span>
            </button>
          </div>
        </header>

        {/* ── 2. HERO + HERO ART ───────────────────────────────────────── */}
        <section className="relative my-6 flex flex-col gap-6 lg:my-8 lg:flex-row lg:items-end lg:justify-between">
          {/* Left Hero Text (~62% width) */}
          <div className="flex flex-col gap-3 lg:max-w-[62%]">
            <div className="text-[14px] sm:text-[15.5px] font-black uppercase tracking-[0.2em] text-[#4B5563] dark:text-[#CBD5E1]">
              LEARN • TEACH • GROW TOGETHER
            </div>
            <h2 className="text-[38px] font-extrabold leading-[1.15] sm:text-[46px]">
              <span className="text-[#111111] dark:text-white">Welcome to the </span>
              <span className="text-[#F59E0B]">classroom</span>
            </h2>
            <p className="text-[17px] font-medium text-[#374151] dark:text-[#E2E8F0] sm:text-[19px]">
              Your AI co-teacher is tuned in and listening.
            </p>
            <p className="text-[15px] text-[#6B7280] dark:text-[#94A3B8] sm:text-[17px]">
              Enter your name to join a live lesson or create a new one.
            </p>

            {/* Feature Badges Row */}
            <div className="mt-2 flex flex-wrap items-center gap-6 sm:gap-8">
              {/* Feature A: Live AI guidance */}
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-[#FEF3E2] dark:bg-[#F59E0B]/20">
                  <Zap className="h-5 w-5 text-[#F59E0B]" />
                </div>
                <div>
                  <div className="text-[14px] font-semibold text-[#1F2937] dark:text-[#F8FAFC]">
                    Live AI guidance
                  </div>
                  <div className="text-[12.5px] text-[#6B7280] dark:text-[#94A3B8]">
                    Support in real time
                  </div>
                </div>
              </div>

              {/* Feature B: Real-time insights */}
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-[#E6F7F5] dark:bg-[#14B8A6]/20">
                  <BarChart3 className="h-5 w-5 text-[#14B8A6]" />
                </div>
                <div>
                  <div className="text-[14px] font-semibold text-[#1F2937] dark:text-[#F8FAFC]">
                    Real-time insights
                  </div>
                  <div className="text-[12.5px] text-[#6B7280] dark:text-[#94A3B8]">
                    Understand student progress
                  </div>
                </div>
              </div>

              {/* Feature C: Post-class report */}
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-[#EEF2FF] dark:bg-[#6366F1]/20">
                  <FileText className="h-5 w-5 text-[#6366F1]" />
                </div>
                <div>
                  <div className="text-[14px] font-semibold text-[#1F2937] dark:text-[#F8FAFC]">
                    Post-class report
                  </div>
                  <div className="text-[12.5px] text-[#6B7280] dark:text-[#94A3B8]">
                    Get a detailed summary
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Hero Art (Robot Mascot sitting on the edge of the Live Classrooms card) */}
          <div className="relative hidden shrink-0 items-end justify-end lg:flex lg:w-[36%]">
            {/* 3D Transparent Robot Mascot sitting on the bottom boundary (top edge of Live Classrooms card) */}
            <div className="relative z-10 w-[300px] -mb-7">
              <Image
                src="/robot.png"
                alt="Athena Robot Co-teacher"
                width={360}
                height={360}
                priority
                className="h-auto w-full object-contain drop-shadow-[0_16px_32px_rgba(0,0,0,0.18)]"
              />
            </div>
          </div>
        </section>

        {/* ── ERROR & STATUS NOTICES ──────────────────────────────────── */}
        {reachable === false && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            Cannot reach backend orchestrator at {orchestrator.baseUrl}.
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        {/* ── 4. MAIN GRID (Two Columns: 56% Left / 44% Right, gap 28px) ── */}
        <div className="grid grid-cols-1 gap-7 lg:grid-cols-12">
          {/* ── LEFT COLUMN (7 of 12 cols ≈ 56%) ───────────────────────── */}
          <div className="flex flex-col gap-6 lg:col-span-7">
            {/* CARD A — "Join a classroom" */}
            <div
              className="flex flex-col rounded-[20px] border border-[#F0EAE2] bg-white p-7 transition-colors dark:border-white/10 dark:bg-[#1E293B]/95"
              style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}
            >
              {/* Header */}
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[16px] bg-[#E6F7F5] dark:bg-[#14B8A6]/20">
                  <Users className="h-7 w-7 text-[#14B8A6]" />
                </div>
                <div>
                  <h3 className="text-[22px] font-bold text-[#1A1A1A] dark:text-white">
                    Join a classroom
                  </h3>
                  <p className="text-[14.5px] text-[#6B7280] dark:text-[#94A3B8]">
                    Enter your name and choose how you want to join.
                  </p>
                </div>
              </div>

              {/* Form Content */}
              <div className="mt-6 flex flex-col gap-5">
                {/* YOUR NAME */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-[#9CA3AF] dark:text-[#94A3B8]">
                    YOUR NAME
                  </label>
                  <div className="relative flex items-center">
                    <User className="absolute left-4 h-5 w-5 text-[#9CA3AF]" />
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Enter your name"
                      className="h-[54px] w-full rounded-[12px] border border-[#E5E7EB] bg-[#FAFAFA] pl-12 pr-4 text-[15px] font-medium text-[#1A1A1A] placeholder-[#9CA3AF] outline-none transition-all focus:border-[#F5A623] focus:bg-white focus:ring-2 focus:ring-[#F5A623]/35 dark:border-white/10 dark:bg-[#0F172A] dark:text-white dark:focus:bg-[#0F172A]"
                    />
                  </div>
                </div>

                {/* JOIN AS */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-[#9CA3AF] dark:text-[#94A3B8]">
                    JOIN AS
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    {/* Join as student */}
                    <button
                      type="button"
                      onClick={() => setRole('student')}
                      className={`flex h-[56px] items-center justify-between rounded-[12px] px-4 text-left transition-all ${
                        role === 'student'
                          ? 'border-[1.5px] border-[#F5A623] bg-[#FEF6E7] text-[#B45309] dark:bg-[#F59E0B]/15 dark:text-[#FBBF24]'
                          : 'border border-[#E5E7EB] bg-white text-[#4B5563] hover:bg-gray-50 dark:border-white/10 dark:bg-[#0F172A] dark:text-[#94A3B8] dark:hover:bg-[#334155]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <GraduationCap
                          className={`h-5 w-5 ${
                            role === 'student'
                              ? 'text-[#B45309] dark:text-[#FBBF24]'
                              : 'text-[#6B7280] dark:text-[#94A3B8]'
                          }`}
                        />
                        <span className="text-[14.5px] font-medium">
                          Join as student
                        </span>
                      </div>
                      {role === 'student' && (
                        <CheckCircle2 className="h-5 w-5 fill-[#F5A623] text-white dark:text-[#0F172A]" />
                      )}
                    </button>

                    {/* Join as teacher */}
                    <button
                      type="button"
                      onClick={() => setRole('teacher')}
                      className={`flex h-[56px] items-center justify-between rounded-[12px] px-4 text-left transition-all ${
                        role === 'teacher'
                          ? 'border-[1.5px] border-[#F5A623] bg-[#FEF6E7] text-[#B45309] dark:bg-[#F59E0B]/15 dark:text-[#FBBF24]'
                          : 'border border-[#E5E7EB] bg-white text-[#4B5563] hover:bg-gray-50 dark:border-white/10 dark:bg-[#0F172A] dark:text-[#94A3B8] dark:hover:bg-[#334155]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <UserSquare2
                          className={`h-5 w-5 ${
                            role === 'teacher'
                              ? 'text-[#B45309] dark:text-[#FBBF24]'
                              : 'text-[#6B7280] dark:text-[#94A3B8]'
                          }`}
                        />
                        <span className="text-[14.5px] font-medium">
                          Join as teacher
                        </span>
                      </div>
                      {role === 'teacher' && (
                        <CheckCircle2 className="h-5 w-5 fill-[#F5A623] text-white dark:text-[#0F172A]" />
                      )}
                    </button>
                  </div>

                  <p className="mt-1 text-[12.5px] text-[#6B7280] dark:text-[#94A3B8]">
                    {role === 'teacher'
                      ? 'Teachers get the control panel, gap dashboard, and post-class report. One teacher per classroom.'
                      : 'Students get the transcript, live whiteboard, quiz cards, and can ask Athena by voice.'}
                  </p>
                </div>

                {/* 4-Digit Share Code (Quick join for students) */}
                {role === 'student' && (
                  <div className="flex flex-col gap-1.5 rounded-xl border border-[#F0EAE2] bg-[#FAFAFA] p-3.5 dark:border-white/10 dark:bg-[#0F172A]">
                    <div className="flex items-center justify-between">
                      <span className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-[#9CA3AF] dark:text-[#94A3B8]">
                        HAVE A 4-DIGIT CLASS CODE?
                      </span>
                      <span className="text-[11px] text-[#9CA3AF] dark:text-[#64748B]">
                        e.g. 4829
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        maxLength={6}
                        value={shareCodeInput}
                        onChange={(e) => setShareCodeInput(e.target.value.trim())}
                        placeholder="Enter 4-digit code"
                        className="h-[46px] flex-1 rounded-[10px] border border-[#E5E7EB] bg-white px-3 text-center font-mono text-[16px] font-bold tracking-widest text-[#1A1A1A] outline-none focus:border-[#F5A623] focus:ring-2 focus:ring-[#F5A623]/35 dark:border-white/10 dark:bg-[#1E293B] dark:text-white"
                      />
                      <button
                        type="button"
                        disabled={!nameValid || busy || shareCodeInput.length === 0}
                        onClick={() => void join(shareCodeInput)}
                        className="flex h-[46px] items-center gap-1.5 rounded-[10px] bg-[#14B8A6] px-4 text-[14px] font-semibold text-white shadow-sm transition hover:bg-[#0D9488] disabled:opacity-40"
                      >
                        <span>Join</span>
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* CARD B — "Create a new lesson" */}
            <div
              className="flex flex-col rounded-[20px] border border-[#F0EAE2] bg-white p-7 transition-colors dark:border-white/10 dark:bg-[#1E293B]/95"
              style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}
            >
              {/* Header */}
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[16px] bg-[#FEF3E2] dark:bg-[#F59E0B]/20">
                  <FilePlus className="h-7 w-7 text-[#F59E0B]" />
                </div>
                <div>
                  <h3 className="text-[22px] font-bold text-[#1A1A1A] dark:text-white">
                    Create a new lesson
                  </h3>
                  <p className="text-[14.5px] text-[#6B7280] dark:text-[#94A3B8]">
                    Set a topic and start teaching with your AI co-teacher.
                  </p>
                </div>
              </div>

              {/* Form Content */}
              <div className="mt-6 flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-[#9CA3AF] dark:text-[#94A3B8]">
                    LESSON TITLE
                  </label>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="relative flex flex-1 items-center">
                      <BookOpen className="absolute left-4 h-5 w-5 text-[#9CA3AF]" />
                      <input
                        type="text"
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        placeholder="Lesson title, e.g. Adding unlike fractions"
                        className="h-[54px] w-full rounded-[12px] border border-[#E5E7EB] bg-[#FAFAFA] pl-12 pr-4 text-[15px] font-medium text-[#1A1A1A] placeholder-[#9CA3AF] outline-none transition-all focus:border-[#F5A623] focus:bg-white focus:ring-2 focus:ring-[#F5A623]/35 dark:border-white/10 dark:bg-[#0F172A] dark:text-white dark:focus:bg-[#0F172A]"
                      />
                    </div>

                    <button
                      type="button"
                      disabled={!canCreate}
                      onClick={() => void createAndJoin()}
                      className="flex h-[54px] items-center justify-center gap-2 rounded-[12px] bg-gradient-to-r from-[#F5A623] to-[#E8860B] px-7 text-[15px] font-semibold text-white shadow-[0_4px_12px_rgba(240,150,20,0.35)] transition-all hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(240,150,20,0.45)] disabled:pointer-events-none disabled:opacity-60"
                    >
                      <Sparkles className="h-4 w-4" />
                      <span>{busy ? 'Creating…' : 'Create'}</span>
                    </button>
                  </div>
                </div>

                {/* Start fractions demo pill button */}
                <div className="pt-1">
                  <button
                    type="button"
                    disabled={!nameValid || busy}
                    onClick={() => void createAndJoin('unlike-fractions')}
                    className="flex h-[44px] items-center gap-2 rounded-full border border-[#E5E7EB] bg-white px-5 text-[14px] font-medium text-[#374151] shadow-sm transition-all hover:-translate-y-0.5 hover:bg-gray-50 hover:shadow disabled:opacity-40 dark:border-white/10 dark:bg-[#0F172A] dark:text-[#E2E8F0] dark:hover:bg-[#334155]"
                  >
                    <Play className="h-4 w-4 fill-[#0D9488] text-[#0D9488]" />
                    <span>Start fractions demo (LCD)</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ── RIGHT COLUMN (5 of 12 cols ≈ 44%) ──────────────────────── */}
          <div className="flex flex-col lg:col-span-5">
            {/* CARD C — "Live classrooms" (Full Height) */}
            <div
              className="flex h-full flex-col justify-between rounded-[20px] border border-[#F0EAE2] bg-white p-7 transition-colors dark:border-white/10 dark:bg-[#1E293B]/95"
              style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}
            >
              <div>
                {/* Header */}
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[16px] bg-[#E6F7F5] dark:bg-[#14B8A6]/20">
                    <Radio className="h-7 w-7 text-[#14B8A6]" />
                  </div>
                  <div>
                    <h3 className="text-[22px] font-bold text-[#1A1A1A] dark:text-white">
                      Live classrooms
                    </h3>
                    <p className="text-[14.5px] text-[#6B7280] dark:text-[#94A3B8]">
                      Your active classrooms will appear here.
                    </p>
                  </div>
                </div>

                {/* Content Area */}
                {sessions.length === 0 ? (
                  /* Centered Empty State */
                  <div className="my-8 flex flex-col items-center justify-center px-4 text-center">
                    <div className="relative mb-4 flex w-full max-w-[320px] items-center justify-center">
                      <Image
                        src="/empty-classroom.svg"
                        alt="No live classrooms illustration"
                        width={320}
                        height={240}
                        className="h-auto w-full object-contain"
                      />
                    </div>

                    <h4 className="text-[17px] font-bold text-[#1A1A1A] dark:text-white">
                      No live classrooms yet
                    </h4>
                    <p className="mt-1.5 max-w-[290px] text-[14px] text-[#6B7280] dark:text-[#94A3B8]">
                      Give your lesson a title on the left and press{' '}
                      <strong className="font-bold text-[#1F2937] dark:text-white">
                        Create
                      </strong>{' '}
                      to open the first classroom.
                    </p>
                  </div>
                ) : (
                  /* Active Classrooms List */
                  <div className="my-6 flex max-h-[380px] flex-col gap-3 overflow-y-auto pr-1">
                    {sessions.map((session) => (
                      <div
                        key={session.sessionId}
                        className="flex items-center justify-between rounded-[14px] border border-[#F0EAE2] bg-[#FAFAFA] p-3.5 transition hover:border-[#F5A623]/40 dark:border-white/10 dark:bg-[#0F172A]"
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${
                              session.agentId
                                ? 'bg-[#10B981] shadow-[0_0_8px_#10B981]'
                                : 'bg-gray-400'
                            }`}
                          />
                          <div>
                            <p className="text-[14.5px] font-semibold text-[#1A1A1A] dark:text-white">
                              {session.title}
                            </p>
                            <p className="text-[12px] text-[#6B7280] dark:text-[#94A3B8]">
                              {session.participantCount} in room ·{' '}
                              {session.agentId
                                ? 'AI co-teacher present'
                                : 'AI ready'}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={!nameValid || busy}
                          onClick={() => {
                            setSelectedSessionId(session.sessionId);
                            void join(session.sessionId);
                          }}
                          className="rounded-[10px] border border-[#14B8A6] bg-white px-3.5 py-1.5 text-[13.5px] font-semibold text-[#0D9488] shadow-sm transition hover:bg-[#E6F7F5] disabled:opacity-40 dark:border-[#14B8A6] dark:bg-[#1E293B] dark:text-[#2DD4BF] dark:hover:bg-[#14B8A6]/20"
                        >
                          {busy && selectedSessionId === session.sessionId
                            ? 'Joining…'
                            : 'Join'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Tip Box at bottom of Card C */}
              <div className="mt-6 flex items-start gap-3 rounded-[12px] bg-[#E6F7F5] p-4 dark:bg-[#14B8A6]/15">
                <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-[#0D9488] dark:text-[#2DD4BF]" />
                <p className="text-[13.5px] leading-relaxed text-[#115E59] dark:text-[#99F6E4]">
                  <strong className="font-bold">Tip:</strong> As a teacher,
                  you&rsquo;ll get live AI support, real-time insights, and a
                  post-class report.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── 5. FOOTER BAR ────────────────────────────────────────────── */}
        <footer className="mt-7 flex h-16 w-full flex-col items-center justify-between gap-2 rounded-[16px] border border-[#F0EAE2] bg-white/75 px-6 shadow-sm backdrop-blur-md sm:flex-row dark:border-white/10 dark:bg-[#1E293B]/80">
          <div className="flex items-center gap-3 text-[14px]">
            <span className="font-semibold text-[#374151] dark:text-[#E2E8F0]">
              Empowering educators with AI
            </span>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <span className="text-[#6B7280] dark:text-[#94A3B8]">
              Smarter classrooms. Brighter futures.
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-[14px] text-[#6B7280] dark:text-[#94A3B8]">
            <span>Powered by Agora, built with love</span>
            <Heart className="h-4 w-4 fill-[#EF4444] text-[#EF4444]" />
          </div>
        </footer>
      </div>

      {/* ── HELP MODAL ─────────────────────────────────────────────────── */}
      {showHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-[20px] border border-[#F0EAE2] bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-[#1E293B]">
            <div className="flex items-center justify-between border-b border-[#F0EAE2] pb-4 dark:border-white/10">
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full bg-[#14B8A6]" />
                <h3 className="text-[18px] font-bold text-[#111111] dark:text-white">
                  About ATHENA AI Co-teacher
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowHelp(false)}
                className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-[#334155] dark:hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-3 text-[14px] text-[#4B5563] dark:text-[#CBD5E1]">
              <p>
                <strong>Athena</strong> is an intelligent AI co-teacher that
                assists classroom instructors with real-time audio guidance,
                comprehension tracking, interactive quizzes, and instant
                clarifications.
              </p>
              <ul className="list-disc space-y-1.5 pl-5">
                <li>
                  <strong>Teachers:</strong> Create a classroom, guide the
                  lesson, trigger AI prompts, and receive post-class learning
                  analytics.
                </li>
                <li>
                  <strong>Students:</strong> Join with your name and 4-digit
                  share code, speak directly with Athena, and view live
                  whiteboard notes.
                </li>
              </ul>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setShowHelp(false)}
                className="rounded-xl bg-[#14B8A6] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#0D9488]"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}