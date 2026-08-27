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

  const createAndJoin = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const session = await orchestrator.createSession(
        newTitle.trim() || 'Untitled lesson',
      );
      await join(session.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create lesson');
      setBusy(false);
    }
  }, [newTitle, join]);

  const nameValid = displayName.trim().length > 0;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 p-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Echosphere</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Audio-only live classroom with an AI co-teacher.
        </p>
      </header>

      {reachable === false && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Cannot reach the orchestrator at{' '}
          <code className="font-mono">{orchestrator.baseUrl}</code>. Start it
          with <code className="font-mono">pnpm --filter @echosphere/orchestrator dev</code>.
        </p>
      )}

      <section className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Your name</span>
          <input
            className="rounded-md border border-neutral-300 px-3 py-2"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Ana"
            autoFocus
          />
        </label>

        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium">Join as</legend>
          <div className="flex gap-2">
            {(['student', 'teacher'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setRole(option)}
                className={`flex-1 rounded-md border px-3 py-2 text-sm capitalize ${
                  role === option
                    ? 'border-neutral-900 bg-neutral-900 text-white'
                    : 'border-neutral-300'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          <p className="text-xs text-neutral-500">
            {role === 'teacher'
              ? 'Teachers get the control panel, gap dashboard, and post-class report. One teacher per classroom.'
              : 'Students get the transcript, quiz cards, and can ask the AI by name.'}
          </p>
        </fieldset>

        {role === 'student' && (
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">
              Preferred language{' '}
              <span className="font-normal text-neutral-500">(optional)</span>
            </span>
            <input
              className="rounded-md border border-neutral-300 px-3 py-2"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              placeholder="e.g. hi-IN — the AI mirrors whatever you actually speak"
            />
          </label>
        )}
      </section>

      {role === 'teacher' && (
        <section className="flex flex-col gap-2 rounded-md border border-neutral-200 p-4">
          <h2 className="text-sm font-medium">Start a new lesson</h2>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-md border border-neutral-300 px-3 py-2"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Lesson title, e.g. Adding unlike fractions"
            />
            <button
              type="button"
              disabled={!nameValid || busy}
              onClick={() => void createAndJoin()}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              {busy ? 'Creating…' : 'Create'}
            </button>
          </div>
          {!nameValid && (
            <p className="text-xs text-neutral-500">
              Enter your name above first.
            </p>
          )}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">
          {sessions.length > 0 ? 'Live classrooms' : 'No live classrooms yet'}
        </h2>

        {/* An empty list is the first thing most people see, so it has to say
            what to do next rather than just reporting nothing. A student cannot
            create a lesson, so point them at the role toggle instead of leaving
            them on a dead end. */}
        {sessions.length === 0 && reachable !== false && (
          <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-neutral-300 p-4">
            {role === 'teacher' ? (
              <p className="text-sm text-neutral-500">
                Give your lesson a title above and press{' '}
                <strong>Create</strong> to open the first classroom.
              </p>
            ) : (
              <>
                <p className="text-sm text-neutral-500">
                  A teacher needs to start one before you can join.
                </p>
                <button
                  type="button"
                  onClick={() => setRole('teacher')}
                  className="rounded-md border border-neutral-900 px-3 py-1.5 text-sm"
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
              className="flex items-center justify-between rounded-md border border-neutral-200 p-3"
            >
              <div>
                <p className="font-medium">{session.title}</p>
                <p className="text-xs text-neutral-500">
                  {session.participantCount} in room ·{' '}
                  {session.agentId ? 'AI co-teacher present' : 'AI not started'}
                </p>
              </div>
              <button
                type="button"
                disabled={!nameValid || busy}
                onClick={() => {
                  setSelectedSessionId(session.sessionId);
                  void join(session.sessionId);
                }}
                className="rounded-md border border-neutral-900 px-3 py-1.5 text-sm disabled:opacity-40"
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
        <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
    </main>
  );
}
