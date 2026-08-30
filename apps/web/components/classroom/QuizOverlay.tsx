/**
 * The student's live quiz card — PS31 §3.6.
 *
 * When Athena asks a question, the orchestrator broadcasts it with a `deadline`
 * (15s from when the card appears, which is *after* she has finished asking, so
 * the window is not eaten by her speaking). This renders it as a centered
 * takeover with a countdown, students tap an answer, and it reveals the correct
 * option once everyone answers or the timer runs out. Athena still reads the
 * question and options aloud in parallel — this is the visual half of the same
 * moment, not a replacement for it.
 *
 * The teacher keeps the sidebar `QuizCards` (live results, history); only
 * students get this overlay, and only while a question is actually open.
 */

'use client';

import { useEffect, useState } from 'react';
import type { QuizCardState } from '@/hooks/useClassroom';

const LETTERS = ['A', 'B', 'C', 'D'];

/** How long the revealed answer stays on screen before the overlay dismisses. */
const REVEAL_LINGER_MS = 4500;

/** Display window for the ring; the server `deadline` is the real authority. */
const WINDOW_MS = 15_000;

export interface QuizOverlayProps {
  quizzes: QuizCardState[];
  onAnswer: (quizId: string, option: string) => void;
}

export function QuizOverlay({ quizzes, onAnswer }: QuizOverlayProps) {
  const card = quizzes[quizzes.length - 1];
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  const pending = card !== undefined && card.quiz.quizId !== dismissedId;
  const activeId = pending && card ? card.quiz.quizId : null;

  // Keep `now` live. Re-seeded whenever a new card becomes active, so the next
  // question's countdown never renders off a stale timestamp from the gap
  // between questions.
  useEffect(() => {
    if (!activeId) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [activeId]);

  // Once the answer is revealed, linger briefly then dismiss.
  useEffect(() => {
    if (!card?.correctAnswer) return;
    const quizId = card.quiz.quizId;
    const t = window.setTimeout(() => setDismissedId(quizId), REVEAL_LINGER_MS);
    return () => window.clearTimeout(t);
  }, [card?.correctAnswer, card?.quiz.quizId]);

  if (!pending || !card) return null;

  const { quiz, myAnswer, myResult, correctAnswer } = card;
  const revealed = Boolean(correctAnswer);
  const remainingMs = Math.max(0, quiz.deadline - now);
  const secs = Math.ceil(remainingMs / 1000);
  const expired = remainingMs <= 0;

  // A quiz whose window (plus the reveal linger) is long gone — e.g. the page
  // was reloaded after it finished — should not reappear.
  if (expired && !revealed && now > quiz.deadline + WINDOW_MS) return null;

  const locked = myAnswer !== undefined || expired || revealed;
  const frac = Math.max(0, Math.min(1, remainingMs / WINDOW_MS));
  const RADIUS = 22;
  const CIRCUM = 2 * Math.PI * RADIUS;
  const myLetter =
    myAnswer !== undefined
      ? LETTERS[(quiz.options ?? []).indexOf(myAnswer)] ?? ''
      : '';

  const status = revealed
    ? myResult === 'correct'
      ? 'Correct.'
      : myResult === 'incorrect'
        ? 'Not quite.'
        : 'Answer revealed.'
    : myAnswer !== undefined
      ? `Locked in: ${myLetter}`
      : expired
        ? 'Time’s up.'
        : 'Tap an answer — or say it out loud.';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pop quiz"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        background: 'color-mix(in srgb, var(--eco-ink) 80%, transparent)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        className="eco-panel"
        style={{
          width: '100%',
          maxWidth: '40rem',
          padding: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <span className="eco-label" style={{ color: 'var(--eco-amber)' }}>
              {quiz.setIndex && quiz.setTotal
                ? `Pop quiz · Question ${quiz.setIndex} of ${quiz.setTotal}`
                : 'Pop quiz'}
            </span>
            <p style={{ margin: 0, fontSize: '1.05rem', color: 'var(--eco-cream)' }}>
              {quiz.question}
            </p>
          </div>
          <div
            style={{ position: 'relative', width: '3.5rem', height: '3.5rem', flexShrink: 0 }}
            aria-label={expired ? 'Time is up' : `${secs} seconds left`}
          >
            <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden>
              <circle cx="28" cy="28" r={RADIUS} fill="none" stroke="var(--eco-rule)" strokeWidth="3" />
              {!expired && (
                <circle
                  cx="28"
                  cy="28"
                  r={RADIUS}
                  fill="none"
                  stroke={secs <= 5 ? 'var(--eco-red)' : 'var(--eco-amber)'}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={CIRCUM}
                  strokeDashoffset={CIRCUM * (1 - frac)}
                  transform="rotate(-90 28 28)"
                  style={{
                    transition: reducedMotion ? 'none' : 'stroke-dashoffset 0.25s linear',
                  }}
                />
              )}
            </svg>
            <span
              className="eco-numerals"
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.8rem',
                color: expired ? 'var(--eco-red)' : 'var(--eco-cream)',
              }}
            >
              {expired ? '0s' : `${secs}s`}
            </span>
          </div>
        </div>

        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}
        >
          {(quiz.options ?? []).map((option, i) => {
            const chosen = myAnswer === option;
            const isCorrect = correctAnswer === option;
            const showCorrect = revealed && isCorrect;
            const showWrong = revealed && chosen && !isCorrect;
            return (
              <li key={option}>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => onAnswer(quiz.quizId, option)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    textAlign: 'left',
                    borderRadius: '0.6rem',
                    border: '1px solid',
                    padding: '0.7rem 0.85rem',
                    fontSize: '0.9rem',
                    cursor: locked ? 'default' : 'pointer',
                    transition: 'border-color 0.15s, background 0.15s',
                    borderColor: showCorrect
                      ? 'var(--eco-green)'
                      : showWrong
                        ? 'var(--eco-red)'
                        : chosen
                          ? 'var(--eco-glow)'
                          : 'var(--eco-rule)',
                    background: showCorrect
                      ? 'var(--eco-green-dim)'
                      : showWrong
                        ? 'var(--eco-red-dim)'
                        : chosen
                          ? 'var(--eco-glow-dim)'
                          : 'var(--eco-ink-sunken)',
                    color: 'var(--eco-cream)',
                  }}
                >
                  <span
                    aria-hidden
                    className="eco-numerals"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '1.6rem',
                      height: '1.6rem',
                      borderRadius: '999px',
                      flexShrink: 0,
                      fontSize: '0.8rem',
                      border: '1px solid var(--eco-rule)',
                      color: 'var(--eco-cream-dim)',
                    }}
                  >
                    {LETTERS[i] ?? '?'}
                  </span>
                  <span>{option}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '1rem',
            borderTop: '1px solid var(--eco-rule)',
            paddingTop: '0.75rem',
            fontSize: '0.8rem',
            color: revealed && myResult
              ? myResult === 'correct'
                ? 'var(--eco-green)'
                : 'var(--eco-red)'
              : 'var(--eco-cream-faint)',
          }}
        >
          <span>{status}</span>
          {!revealed && !expired && myAnswer === undefined && (
            <span className="eco-numerals">{secs}s left</span>
          )}
        </div>
      </div>
    </div>
  );
}
