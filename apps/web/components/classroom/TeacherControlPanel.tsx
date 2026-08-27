/**
 * Teacher control panel — PS31 §3.10.
 *
 * Every button issues a command to the orchestrator; none of them change local
 * state directly. The mute button in particular must reflect what the
 * orchestrator believes, not what was last clicked, because mute is the veto
 * the whole turn-taking design rests on.
 */

'use client';

import { useState } from 'react';
import type { AgentPolicy, VerbosityLevel } from '@echosphere/shared-types';

export interface TeacherControlPanelProps {
  policy: AgentPolicy | null;
  agentRunning: boolean;
  busy: boolean;
  onMute: () => void;
  onResume: () => void;
  onEndTurn: () => void;
  onForceSpeak: (topic: string) => void;
  onVerbosity: (level: VerbosityLevel) => void;
  onSetStudentInvocation: (enabled: boolean) => void;
  onDisableTopic: (topic: string) => void;
  onEnableTopic: (topic: string) => void;
  onStartQuiz: (topic: string) => void;
  onStartAgent: () => void;
  onStopAgent: () => void;
  onEndSession: () => void;
}

export function TeacherControlPanel({
  policy,
  agentRunning,
  busy,
  onMute,
  onResume,
  onEndTurn,
  onForceSpeak,
  onVerbosity,
  onSetStudentInvocation,
  onDisableTopic,
  onEnableTopic,
  onStartQuiz,
  onStartAgent,
  onStopAgent,
  onEndSession,
}: TeacherControlPanelProps) {
  const [topic, setTopic] = useState('');
  const [banned, setBanned] = useState('');

  const muted = policy?.muted ?? false;
  const studentsMayInvoke = policy?.studentsMayInvoke ?? false;

  return (
    <section className="flex flex-col gap-4 rounded-md border border-neutral-200 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">AI controls</h2>
        <span className="text-xs text-neutral-500">
          {agentRunning ? 'Athena is in the room' : 'Athena not started'}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {!agentRunning ? (
          <button
            type="button"
            disabled={busy}
            onClick={onStartAgent}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            Bring Athena in
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={onStopAgent}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Send Athena out
          </button>
        )}

        {/* The demo moment from the plan: mute mid-explanation, speech stops. */}
        <button
          type="button"
          disabled={busy}
          onClick={muted ? onResume : onMute}
          className={`rounded-md px-3 py-1.5 text-sm disabled:opacity-40 ${
            muted
              ? 'border border-red-500 bg-red-500 text-white'
              : 'border border-neutral-300'
          }`}
        >
          {muted ? 'Unmute Athena' : 'Mute Athena'}
        </button>

        <button
          type="button"
          disabled={busy || !agentRunning}
          onClick={onEndTurn}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-40"
        >
          Cut off current turn
        </button>
      </div>

      {/*
        The floor gate. While this is off Athena still hears everything and
        keeps building context, but has no route to the floor except the
        buttons below — a student saying her name will not summon her.
      */}
      <div className="flex flex-col gap-1 rounded-md border border-neutral-200 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">
              {studentsMayInvoke
                ? 'Students can call on Athena'
                : 'Athena is listening only'}
            </p>
            <p className="text-xs text-neutral-500">
              {studentsMayInvoke
                ? 'Saying “hey Athena” will get an answer.'
                : 'She hears the lesson and builds context, but will not speak unless you ask her to.'}
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            aria-pressed={studentsMayInvoke}
            onClick={() => onSetStudentInvocation(!studentsMayInvoke)}
            className={`shrink-0 rounded-md px-3 py-1.5 text-sm disabled:opacity-40 ${
              studentsMayInvoke
                ? 'border border-green-600 bg-green-600 text-white'
                : 'border border-neutral-900'
            }`}
          >
            {studentsMayInvoke ? 'Close the floor' : 'Let students ask'}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-neutral-600">
          Explanation length
        </label>
        <div className="flex gap-1">
          {(['terse', 'normal', 'detailed'] as const).map((level) => (
            <button
              key={level}
              type="button"
              disabled={busy}
              onClick={() => onVerbosity(level)}
              className={`flex-1 rounded border px-2 py-1 text-xs capitalize disabled:opacity-40 ${
                policy?.verbosity === level
                  ? 'border-neutral-900 bg-neutral-900 text-white'
                  : 'border-neutral-300'
              }`}
            >
              {level}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-neutral-600">
          Ask Athena to cover a topic now
        </label>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded border border-neutral-300 px-2 py-1 text-sm"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. least common denominator"
          />
          <button
            type="button"
            disabled={busy || topic.trim().length === 0}
            onClick={() => onForceSpeak(topic.trim())}
            className="rounded border border-neutral-900 px-2 py-1 text-sm disabled:opacity-40"
          >
            Explain
          </button>
          <button
            type="button"
            disabled={busy || topic.trim().length === 0}
            onClick={() => onStartQuiz(topic.trim())}
            className="rounded border border-neutral-900 px-2 py-1 text-sm disabled:opacity-40"
          >
            Quiz
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-neutral-600">
          Topics Athena must not discuss
        </label>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded border border-neutral-300 px-2 py-1 text-sm"
            value={banned}
            onChange={(e) => setBanned(e.target.value)}
            placeholder="e.g. next week's exam"
          />
          <button
            type="button"
            disabled={busy || banned.trim().length === 0}
            onClick={() => {
              onDisableTopic(banned.trim());
              setBanned('');
            }}
            className="rounded border border-neutral-300 px-2 py-1 text-sm disabled:opacity-40"
          >
            Block
          </button>
        </div>
        {policy && policy.disabledTopics.length > 0 && (
          <ul className="flex flex-wrap gap-1 pt-1">
            {policy.disabledTopics.map((t) => (
              <li key={t}>
                <button
                  type="button"
                  onClick={() => onEnableTopic(t)}
                  className="rounded-full border border-neutral-300 px-2 py-0.5 text-xs"
                  title="Click to unblock"
                >
                  {t} ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={onEndSession}
        className="self-start rounded-md border border-neutral-400 px-3 py-1.5 text-sm disabled:opacity-40"
      >
        End lesson &amp; generate report
      </button>
    </section>
  );
}
