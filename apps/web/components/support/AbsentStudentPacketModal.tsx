'use client';

import { useState, useEffect } from 'react';
import type { AbsentStudentPacket } from '@echosphere/shared-types';
import { orchestratorClient } from '@/lib/orchestrator';

interface AbsentStudentPacketModalProps {
  sessionId: string;
  isOpen: boolean;
  onClose: () => void;
  onOpenCatchupBooking?: () => void;
}

export function AbsentStudentPacketModal({
  sessionId,
  isOpen,
  onClose,
  onOpenCatchupBooking,
}: AbsentStudentPacketModalProps) {
  const [packet, setPacket] = useState<AbsentStudentPacket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    orchestratorClient
      .getAbsentPacket(sessionId)
      .then((data: AbsentStudentPacket) => {
        setPacket(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to generate packet');
        setLoading(false);
      });
  }, [sessionId, isOpen]);

  if (!isOpen) return null;

  const handleSelectAnswer = (quizId: string, option: string) => {
    if (quizSubmitted) return;
    setQuizAnswers((prev) => ({ ...prev, [quizId]: option }));
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in duration-200">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-[var(--eco-rule)] bg-[var(--eco-bg)] shadow-2xl overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-[var(--eco-rule)] bg-black/40 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-amber-400 to-amber-600 font-serif text-lg font-bold text-black shadow-md">
              📦
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-serif text-lg font-semibold text-[var(--eco-cream)]">
                  The Absent-Student Packet
                </h2>
                <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-semibold text-amber-300 ring-1 ring-amber-400/40">
                  Comprehensive Lesson Catch-Up
                </span>
              </div>
              <p className="text-xs text-[var(--eco-cream-faint)]">
                {packet?.lessonTitle ? `${packet.lessonTitle} · ` : ''}Everything you missed, structured with AI co-teacher notes
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="rounded-lg bg-[var(--eco-panel)] px-3 py-1.5 text-xs font-medium text-[var(--eco-cream)] ring-1 ring-[var(--eco-rule)] hover:bg-white/5"
            >
              🖨️ Print / PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-lg text-[var(--eco-cream-faint)] hover:bg-white/10 hover:text-[var(--eco-cream)]"
            >
              ✕
            </button>
          </div>
        </header>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-[var(--eco-cream-faint)]">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
              <p className="text-sm">Synthesizing lesson notes, audio timeline & diagnostic quiz...</p>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-6 text-center text-rose-300">
              <p className="font-medium">Could not generate absent packet</p>
              <p className="mt-1 text-xs">{error}</p>
            </div>
          ) : packet ? (
            <>
              {/* Section 1: Executive Summary */}
              <section className="rounded-xl border border-[var(--eco-rule)] bg-[var(--eco-panel)] p-5 shadow-sm">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-400">
                  <span>📖</span> Section 1: Executive Summary
                </div>
                <h3 className="mt-1 font-serif text-base font-medium text-[var(--eco-cream)]">
                  {packet.lessonTitle} ({packet.durationMinutes} minutes class)
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-[var(--eco-cream)]/90 whitespace-pre-line">
                  {packet.executiveSummary}
                </p>

                {/* Key Takeaways */}
                <div className="mt-4 border-t border-[var(--eco-rule)]/40 pt-3">
                  <h4 className="text-xs font-semibold text-[var(--eco-cream)]">Key Learning Takeaways:</h4>
                  <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {packet.keyTakeaways.map((takeaway, idx) => (
                      <li
                        key={idx}
                        className="flex items-start gap-2 rounded-lg bg-black/20 p-2.5 text-xs text-[var(--eco-cream)]/90 border border-[var(--eco-rule)]/30"
                      >
                        <span className="font-bold text-amber-400">✓</span>
                        <span>{takeaway}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>

              {/* Section 2: Flagged Misconceptions */}
              {packet.flaggedConcepts.length > 0 && (
                <section className="rounded-xl border border-purple-500/30 bg-purple-950/20 p-5 shadow-sm">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-purple-400">
                    <span>💡</span> Section 2: Core Concepts & Pitfalls Addressed
                  </div>
                  <div className="mt-3 space-y-3">
                    {packet.flaggedConcepts.map((item, idx) => (
                      <div key={idx} className="rounded-lg bg-black/30 p-3 border border-purple-500/20">
                        <h4 className="text-xs font-semibold text-purple-200">{item.concept}</h4>
                        <p className="mt-1 text-xs text-[var(--eco-cream)]/80 leading-relaxed">
                          {item.explanation}
                        </p>
                        <p className="mt-1.5 text-[11px] text-amber-300/90 italic">
                          Common Pitfall: {item.commonMisconception}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Section 3: Audio Timeline Highlights */}
              <section className="rounded-xl border border-[var(--eco-rule)] bg-[var(--eco-panel)] p-5 shadow-sm">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-cyan-400">
                  <span>🎙️</span> Section 3: Key Audio Highlights
                </div>
                <div className="mt-3 space-y-2 max-h-56 overflow-y-auto">
                  {packet.timelineHighlights.length === 0 ? (
                    <p className="text-xs text-[var(--eco-cream-faint)]">No recorded moments.</p>
                  ) : (
                    packet.timelineHighlights.map((hl, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-3 rounded-lg bg-black/30 p-2.5 text-xs border border-[var(--eco-rule)]/30"
                      >
                        <span className="rounded bg-cyan-500/20 px-2 py-0.5 text-[10px] font-mono font-semibold text-cyan-300">
                          {hl.speaker}
                        </span>
                        <div className="flex-1">
                          <p className="text-[var(--eco-cream)]/90">"{hl.text}"</p>
                          <span className="mt-0.5 block text-[10px] text-[var(--eco-cream-faint)]">
                            {hl.significance}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              {/* Section 4: Shared Workspace Sticky Notes Snapshot */}
              {packet.stickyNotesSnapshot.length > 0 && (
                <section className="rounded-xl border border-[var(--eco-rule)] bg-[var(--eco-panel)] p-5 shadow-sm">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-400">
                    <span>📌</span> Section 4: Shared Workspace & Held-Back Doubts
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {packet.stickyNotesSnapshot.slice(0, 6).map((note) => (
                      <div
                        key={note.id}
                        className="rounded-lg border border-amber-400/30 bg-amber-950/20 p-3 text-xs"
                      >
                        <div className="flex items-center justify-between text-[10px] text-amber-300">
                          <span className="font-semibold">{note.topic}</span>
                          <span>by {note.authorName}</span>
                        </div>
                        <p className="mt-1 text-[var(--eco-cream)]/90 leading-relaxed">{note.content}</p>
                        {note.suggestedAnswer && (
                          <p className="mt-1.5 text-[11px] text-amber-200/80 bg-black/30 p-1.5 rounded">
                            Athena: {note.suggestedAnswer}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Section 5: Diagnostic Quick-Check Quiz */}
              <section className="rounded-xl border border-[var(--eco-rule)] bg-[var(--eco-panel)] p-5 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">
                    <span>✅</span> Section 5: Diagnostic Quick-Check
                  </div>
                  {quizSubmitted && (
                    <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
                      Graded
                    </span>
                  )}
                </div>

                <div className="mt-3 space-y-4">
                  {packet.diagnosticQuiz.map((q, idx) => {
                    const selected = quizAnswers[q.quizId];
                    const isCorrect = selected === q.correctAnswer;

                    return (
                      <div key={q.quizId} className="rounded-lg bg-black/30 p-4 border border-[var(--eco-rule)]/30">
                        <p className="text-xs font-semibold text-[var(--eco-cream)]">
                          {idx + 1}. {q.question}
                        </p>

                        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {q.options?.map((opt, optIdx) => {
                            let btnStyle = 'border-[var(--eco-rule)] bg-black/40 text-[var(--eco-cream)]/80 hover:bg-white/5';
                            if (quizSubmitted) {
                              if (opt === q.correctAnswer) {
                                btnStyle = 'border-emerald-500 bg-emerald-500/20 text-emerald-200 font-semibold';
                              } else if (selected === opt) {
                                btnStyle = 'border-rose-500 bg-rose-500/20 text-rose-200';
                              }
                            } else if (selected === opt) {
                              btnStyle = 'border-amber-400 bg-amber-500/20 text-amber-200 font-semibold';
                            }

                            return (
                              <button
                                key={optIdx}
                                type="button"
                                onClick={() => handleSelectAnswer(q.quizId, opt)}
                                className={`rounded-lg border px-3 py-2 text-left text-xs transition ${btnStyle}`}
                              >
                                {opt}
                              </button>
                            );
                          })}
                        </div>

                        {quizSubmitted && (
                          <div className="mt-2 text-xs">
                            {isCorrect ? (
                              <span className="font-semibold text-emerald-400">✓ Correct!</span>
                            ) : (
                              <span className="text-rose-400">
                                ✗ Incorrect. Correct answer is: <strong>{q.correctAnswer}</strong>
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {!quizSubmitted && packet.diagnosticQuiz.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setQuizSubmitted(true)}
                    className="mt-4 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-black hover:bg-emerald-400"
                  >
                    Submit & Check Understanding
                  </button>
                )}
              </section>

              {/* Section 6: Next Steps & Catch-up CTA */}
              <section className="rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-950/30 to-yellow-950/30 p-5 shadow-lg flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h4 className="font-serif text-sm font-semibold text-amber-300">
                    Still have questions or need 1:1 guidance?
                  </h4>
                  <p className="mt-1 text-xs text-[var(--eco-cream)]/80">
                    Book a live 1:1 catch-up tutoring session or start an interactive chat with Athena.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenCatchupBooking?.();
                    }}
                    className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-black hover:bg-amber-400 shadow-md transition"
                  >
                    📅 Schedule 1:1 Catch-up
                  </button>
                </div>
              </section>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
