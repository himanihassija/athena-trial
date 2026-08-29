/**
 * Join screen — PS31 §3.2 (role awareness) and §3.8 (student identification).
 *
 * The plan's rule is that identity and role are resolved before an Agora token
 * is minted. That ordering is enforced by the orchestrator; this page is simply
 * the form in front of it. Nothing here talks to Agora directly.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Role } from '@echosphere/shared-types';
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
    <main className="eco-room flex min-h-screen justify-center px-6 py-14">
      <div className="flex w-full max-w-lg flex-col gap-8">
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5">
            <span className="eco-lamp eco-lamp-glow eco-pulse" />
            <span className="eco-label">On air</span>
          </div>
          <h1 className="eco-display text-5xl leading-none text-[var(--eco-cream)]">
            Echosphere
          </h1>
          <p className="text-sm text-[var(--eco-cream-dim)]">
            Audio-only live classroom with an AI co-teacher, tuned in and
            listening.
          </p>
        </header>

        {reachable === false && (
          <p
            className="rounded-[0.625rem] border px-4 py-3 text-sm"
            style={{
              borderColor: 'var(--eco-amber)',
              background: 'var(--eco-amber-dim)',
              color: 'var(--eco-cream)',
            }}
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

        <section className="eco-panel flex flex-col gap-5 p-5">
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
              {(['student', 'teacher'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setRole(option)}
                  className="flex-1 rounded-lg border px-3 py-2 text-sm capitalize transition-colors"
                  style={
                    role === option
                      ? {
                          borderColor: 'var(--eco-glow)',
                          background: 'var(--eco-glow-dim)',
                          color: 'var(--eco-glow-bright)',
                        }
                      : { borderColor: 'var(--eco-rule)', color: 'var(--eco-cream-dim)' }
                  }
                >
                  {option}
                </button>
              ))}
            </div>
            <p className="text-xs text-[var(--eco-cream-faint)]">
              {role === 'teacher'
                ? 'Teachers get the control panel, gap dashboard, and post-class report. One teacher per classroom.'
                : 'Students get the transcript, quiz cards, and can ask the AI by name.'}
            </p>
          </fieldset>

          {role === 'student' && (
            <label className="flex flex-col gap-1.5">
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
        </section>

        {role === 'teacher' && (
          <section className="eco-panel flex flex-col gap-2 p-4">
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
                style={{ background: 'var(--eco-glow)', color: 'var(--eco-ink)' }}
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
          </section>
        )}

        <section className="flex flex-col gap-2">
          <h2 className="eco-label">
            {sessions.length > 0 ? 'Live classrooms' : 'No live classrooms yet'}
          </h2>

          {/* An empty list is the first thing most people see, so it has to say
              what to do next rather than just reporting nothing. A student cannot
              create a lesson, so point them at the role toggle instead of leaving
              them on a dead end. */}
          {sessions.length === 0 && reachable !== false && (
            <div className="eco-panel-sunken flex flex-col items-start gap-2 border-dashed p-4">
              {role === 'teacher' ? (
                <p className="text-sm text-[var(--eco-cream-dim)]">
                  Give your lesson a title above and press{' '}
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
                    style={{ borderColor: 'var(--eco-glow)' }}
                  >
                    I&rsquo;m the teacher — start a lesson
                  </button>
                </>
              )}
            </div>
          )}

          <ul className="flex flex-col gap-2">
            {sessions.map((session) => (
              <li
                key={session.sessionId}
                className="eco-panel flex items-center justify-between p-3.5"
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
                  style={{ borderColor: 'var(--eco-glow)' }}
                >
                  {busy && selectedSessionId === session.sessionId
                    ? 'Joining…'
                    : 'Join'}
                </button>
              </li>
            ))}
          </ul>
        </section>

        {error && (
          <p
            className="rounded-[0.625rem] border px-4 py-3 text-sm"
            style={{
              borderColor: 'var(--eco-red)',
              background: 'var(--eco-red-dim)',
              color: 'var(--eco-cream)',
            }}
          >
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
