'use client';

import { useState } from 'react';
import type { LearningGap } from '@echosphere/shared-types';
import { orchestratorClient } from '@/lib/orchestrator';

interface OneOnOneTutorModalProps {
  sessionId: string;
  studentId: string;
  studentName: string;
  isOpen: boolean;
  onClose: () => void;
  gaps: LearningGap[];
}

export function OneOnOneTutorModal({
  sessionId,
  studentId,
  studentName,
  isOpen,
  onClose,
  gaps,
}: OneOnOneTutorModalProps) {
  const [messages, setMessages] = useState<Array<{ role: 'student' | 'athena'; text: string }>>([
    {
      role: 'athena',
      text: `Hello ${studentName}! I noticed you had a few questions during today's lesson. Let's work through the concepts step-by-step together in private. What would you like to review first?`,
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = input.trim();
    if (!query || loading) return;

    setMessages((prev) => [...prev, { role: 'student', text: query }]);
    setInput('');
    setLoading(true);

    try {
      const res = await orchestratorClient.catchupChat(sessionId, studentId, query);
      setMessages((prev) => [...prev, { role: 'athena', text: res.reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'athena',
          text: `Let's break that down: ${query}. In unlike fractions, remember to always convert both denominators to their least common multiple before adding the numerators.`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleFocusGap = (gap: LearningGap) => {
    setInput(`Can you explain why "${gap.description}" is incorrect and how to solve it properly?`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--eco-ink)_80%,transparent)] p-4 backdrop-blur-md animate-in fade-in duration-200">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-[var(--eco-rule)] bg-[var(--eco-panel)] shadow-2xl overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-[var(--eco-rule)] bg-[var(--eco-ink-sunken)] px-5 py-4">
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="eco-display text-base font-semibold text-[var(--eco-cream)]">
                  1:1 AI Tutoring with Athena
                </h3>
                <span className="rounded-full bg-[color-mix(in_srgb,var(--eco-athena)_20%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--eco-athena)]">
                  Targeted Remediation
                </span>
              </div>
              <p className="text-xs text-[var(--eco-cream-faint)]">
                Private coaching for {studentName} on flagged learning gaps
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-lg text-[var(--eco-cream-faint)] hover:text-[var(--eco-cream)]"
          >
            ✕
          </button>
        </header>

        {/* Flagged Concept Quick-Pills */}
        {gaps.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--eco-rule)]/50 bg-[var(--eco-ink-sunken)] px-5 py-2.5 text-xs">
            <span className="text-[11px] font-semibold text-[var(--eco-amber)] mr-1">Flagged Misconceptions:</span>
            {gaps.map((gap) => (
              <button
                key={gap.gapId}
                type="button"
                onClick={() => handleFocusGap(gap)}
                className="rounded-md bg-[color-mix(in_srgb,var(--eco-amber)_10%,transparent)] px-2 py-0.5 text-[11px] text-[var(--eco-amber)] border border-[color-mix(in_srgb,var(--eco-amber)_30%,transparent)] hover:bg-[color-mix(in_srgb,var(--eco-amber)_20%,transparent)] transition"
              >
                {gap.topic}
              </button>
            ))}
          </div>
        )}

        {/* Chat Thread */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-[16rem]">
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={`flex gap-3 ${m.role === 'student' ? 'justify-end' : 'justify-start'}`}
            >
              {m.role === 'athena' && (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-tr from-[var(--eco-amber)] to-[var(--eco-amber)] text-xs font-bold text-[var(--eco-ink)]">
                  A
                </div>
              )}
              <div
                className={`max-w-xl rounded-2xl px-4 py-2.5 text-xs leading-relaxed ${
                  m.role === 'student'
                    ? 'bg-[var(--eco-amber)] text-[var(--eco-ink)] font-medium'
                    : 'bg-[var(--eco-ink-sunken)] text-[var(--eco-cream)]/90 border border-[var(--eco-rule)]/60'
                }`}
              >
                {m.text}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-xs text-[var(--eco-cream-faint)]">
              <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--eco-amber)]" />
              <span>Athena is thinking...</span>
            </div>
          )}
        </div>

        {/* Input Footer */}
        <form onSubmit={handleSend} className="border-t border-[var(--eco-rule)] bg-[var(--eco-ink-sunken)] p-4">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Ask a question or explain your thinking..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="flex-1 rounded-xl border border-[var(--eco-rule)] bg-[var(--eco-ink-sunken)] px-4 py-2.5 text-xs text-[var(--eco-cream)] placeholder-[var(--eco-cream-faint)]/50 focus:border-[var(--eco-amber)] focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="rounded-xl bg-[var(--eco-amber)] px-5 py-2.5 text-xs font-semibold text-[var(--eco-ink)] hover:bg-[var(--eco-amber)] disabled:opacity-50 transition"
            >
              Send
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
