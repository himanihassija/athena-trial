/**
 * Join screen — PS31 §3.2 (role awareness) and §3.8 (student identification).
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Role } from '@echosphere/shared-types';
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
  const [role, setRole] = useState<Role>('student');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [language, setLanguage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);

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

  return (
    <div
      className="flex h-screen flex-col overflow-hidden bg-cover bg-center bg-fixed bg-no-repeat"
      style={{
        backgroundImage: 'var(--eco-join-tint), url(/classroom-bg.png)',
      }}
    >
      {/* ── Top nav ─────────────────────────────────────────────────── */}
      <header className="mx-auto flex w-full max-w-6xl shrink-0 items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2.5">
          <span className="eco-lamp eco-lamp-glow eco-pulse" />
          <span className="eco-wordmark text-lg text-[var(--eco-cream)]">
            Athena
          </span>
        </div>
        <ThemeToggle />
      </header>

      {/* ── Body ────────────────────────────────────────────────────── */}
      <main className="mx-auto flex w-full min-h-0 max-w-6xl flex-1 flex-col gap-4 px-6 pb-4">
        <div className="eco-glass flex shrink-0 flex-col items-center gap-1.5 px-8 py-5 text-center animate-fade-up">
          <span
            className="eco-lamp eco-lamp-amber eco-pulse mb-1"
            style={{ width: '0.625rem', height: '0.625rem' }}
          />
          <h1 className="eco-display text-2xl leading-tight text-[var(--eco-cream)] sm:text-3xl">
            Welcome to the{' '}
            <span style={{ color: 'var(--eco-athena)' }}>classroom</span>
          </h1>
          <p className="max-w-md text-sm text-[var(--eco-cream-dim)]">
            Your AI co-teacher is tuned in and listening. Enter your name to
            join a live lesson.
          </p>
        </div>

        {reachable === false && (
          <p
            className="eco-glass w-full shrink-0 px-4 py-3 text-sm animate-fade-up animate-fade-up-d1"
            style={{ color: 'var(--eco-cream)' }}
          >
            Cannot reach the orchestrator at{' '}
            <code className="eco-numerals">{orchestrator.baseUrl}</code>. Start
            it with{' '}
            <code className="eco-numerals">
              pnpm --filter @echosphere/orchestrator dev
            </code>
            .
          </p>
        )}

        {error && (
          <p
            className="eco-glass w-full shrink-0 px-4 py-3 text-sm animate-fade-up"
            style={{ color: 'var(--eco-cream)' }}
          >
            {error}
          </p>
        )}

        {/* Two cards side by side from `lg` up; stacked (and page-scrolling)
            below that. Each card owns its own internal scroll so the page
            itself never needs to. */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto lg:grid-cols-2 lg:overflow-visible">
          {/* Left: identity + role (+ create lesson for teachers) */}
          <section className="eco-glass flex min-h-0 flex-col gap-5 overflow-y-auto p-6 animate-fade-up animate-fade-up-d1">
            <label className="flex flex-col gap-1.5">
              <span className="eco-label-dim">Your name</span>
              <input
                className="rounded-lg border px-3 py-2 text-sm text-[var(--eco-cream)] outline-none transition-colors focus:border-[var(--eco-glow)]"
                style={{ borderColor: 'var(--eco-rule)', background: 'var(--eco-ink-sunken)' }}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Ana"
                autoFocus
              />
            </label>

            <fieldset className="flex flex-col gap-1.5">
              <legend className="eco-label-dim">Join as</legend>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setRole('student')}
                  className="flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors"
                  style={
                    role === 'student'
                      ? { borderColor: 'var(--eco-athena)', background: 'var(--eco-athena)', color: 'var(--eco-ink)' }
                      : { borderColor: 'var(--eco-rule)', color: 'var(--eco-cream-dim)' }
                  }
                >
                  Join as student
                </button>
                <button
                  type="button"
                  onClick={() => setRole('teacher')}
                  className="flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors"
                  style={
                    role === 'teacher'
                      ? { borderColor: 'var(--eco-athena)', color: 'var(--eco-athena)' }
                      : { borderColor: 'var(--eco-rule)', color: 'var(--eco-cream-dim)' }
                  }
                >
                  Join as teacher
                </button>
              </div>
              <p className="text-xs text-[var(--eco-cream-faint)]">
                {role === 'teacher'
                  ? 'Teachers get the control panel, gap dashboard, and post-class report. One teacher per classroom.'
                  : 'Students get the transcript, quiz cards, and can ask the AI by name.'}
              </p>
            </fieldset>

            {role === 'teacher' && (
              <div className="flex flex-col gap-2 border-t pt-5" style={{ borderColor: 'var(--eco-rule)' }}>
                <h2 className="eco-label-dim">Start a new lesson</h2>
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-lg border px-3 py-2 text-sm text-[var(--eco-cream)] outline-none transition-colors focus:border-[var(--eco-glow)]"
                    style={{ borderColor: 'var(--eco-rule)', background: 'var(--eco-ink-sunken)' }}
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Lesson title, e.g. Adding unlike fractions"
                  />
                  <button
                    type="button"
                    disabled={!nameValid || busy}
                    onClick={() => void createAndJoin()}
                    className="rounded-lg px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-40"
                    style={{ background: 'var(--eco-athena)', color: 'var(--eco-ink)' }}
                  >
                    {busy ? 'Creating…' : 'Create'}
                  </button>
                </div>
                <button
                  type="button"
                  disabled={!nameValid || busy}
                  onClick={() => void createAndJoin('unlike-fractions')}
                  className="self-start rounded-lg border px-3 py-1.5 text-sm text-[var(--eco-cream)] disabled:opacity-40"
                  style={{ borderColor: 'var(--eco-rule)' }}
                >
                  Start fractions demo (LCD)
                </button>
                {!nameValid && (
                  <p className="text-xs text-[var(--eco-cream-faint)]">
                    Enter your name above first.
                  </p>
                )}
              </div>
            )}
          </section>

          {/* Right: language (students) + live sessions list */}
          <section className="eco-glass flex min-h-0 flex-col gap-4 overflow-y-auto p-6 animate-fade-up animate-fade-up-d2">
            {role === 'student' && (
              <label className="flex flex-col gap-1.5 border-b pb-4" style={{ borderColor: 'var(--eco-rule)' }}>
                <span className="eco-label-dim">
                  Preferred language{' '}
                  <span className="normal-case tracking-normal text-[var(--eco-cream-faint)]">
                    (optional)
                  </span>
                </span>
                <input
                  className="rounded-lg border px-3 py-2 text-sm text-[var(--eco-cream)] outline-none transition-colors focus:border-[var(--eco-glow)]"
                  style={{ borderColor: 'var(--eco-rule)', background: 'var(--eco-ink-sunken)' }}
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  placeholder="e.g. hi-IN — the AI mirrors whatever you actually speak"
                />
              </label>
            )}

            <h2 className="eco-label">
              {sessions.length > 0 ? 'Live classrooms' : 'No live classrooms yet'}
            </h2>

            {sessions.length === 0 && reachable !== false && (
              <div className="flex flex-col items-start gap-2">
                {role === 'teacher' ? (
                  <p className="text-sm text-[var(--eco-cream-dim)]">
                    Give your lesson a title on the left and press{' '}
                    <strong className="text-[var(--eco-cream)]">Create</strong> to
                    open the first classroom.
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-[var(--eco-cream-dim)]">
                      A teacher needs to start one before you can join.
                    </p>
                    <button
                      type="button"
                      onClick={() => setRole('teacher')}
                      className="rounded-lg border px-3 py-1.5 text-sm text-[var(--eco-cream)]"
                      style={{ borderColor: 'var(--eco-athena)' }}
                    >
                      I&rsquo;m the teacher — start a lesson
                    </button>
                  </>
                )}
              </div>
            )}

            <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
              {sessions.map((session) => (
                <li
                  key={session.sessionId}
                  className="flex items-center justify-between rounded-[0.625rem] border p-3.5"
                  style={{ borderColor: 'var(--eco-rule)', background: 'var(--eco-ink-sunken)' }}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`eco-lamp ${session.agentId ? 'eco-lamp-glow' : 'eco-lamp-off'}`}
                    />
                    <div>
                      <p className="text-sm font-medium text-[var(--eco-cream)]">
                        {session.title}
                      </p>
                      <p className="eco-numerals text-xs text-[var(--eco-cream-faint)]">
                        {session.participantCount} in room ·{' '}
                        {session.agentId ? 'AI co-teacher present' : 'AI not started'}
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
                    className="rounded-lg border px-3 py-1.5 text-sm text-[var(--eco-cream)] disabled:opacity-40"
                    style={{ borderColor: 'var(--eco-athena)' }}
                  >
                    {busy && selectedSessionId === session.sessionId
                      ? 'Joining…'
                      : 'Join'}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>

            <footer className="shrink-0 px-6 pb-3">
        <p
          className="mx-auto w-full max-w-6xl rounded-lg px-4 py-2 text-center text-xs"
          style={{
            background: 'color-mix(in srgb, var(--eco-ink) 55%, transparent)',
            backdropFilter: 'blur(4px)',
            color: 'var(--eco-cream)',
            textShadow: '0 1px 2px rgba(0,0,0,0.4)',
          }}
        >
          Powered by Agora, built with love ❤️
        </p>
      </footer>
    </div>
  );
}