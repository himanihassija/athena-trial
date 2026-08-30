'use client';

import { useEffect, useState } from 'react';

export type RestraintState = 'listening' | 'ready' | 'held-back' | 'speaking';

export interface RestraintMeterProps {
  state: RestraintState;
  score?: number;
}

/**
 * Athena's presence orb. One circular element, three real states driven by the
 * floor machine (see classroomController's setRestraintMeter):
 *   - listening : low steady ember glow — her resting state
 *   - speaking  : brighter, audio-reactive pulse
 *   - held-back : the floor machine denied a turn — dim, cooled ring
 * `ready` is treated as a brief "evaluating" beat. There is no separate
 * "thinking" signal from the engine, so none is faked.
 */
export function RestraintMeter({ state, score }: RestraintMeterProps) {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  const heldBack = state === 'held-back';
  const speaking = state === 'speaking';
  const evaluating = state === 'ready';

  const hue = heldBack ? 'var(--eco-red)' : 'var(--eco-athena)';
  const label = speaking
    ? 'Speaking'
    : heldBack
      ? 'Held back'
      : evaluating
        ? 'Evaluating'
        : 'Listening';
  const sub = speaking
    ? 'Athena has the floor.'
    : heldBack
      ? 'A turn was blocked by your controls.'
      : 'Tuned in, waiting for a reason to speak.';

  const orbAnim = reducedMotion
    ? ''
    : speaking
      ? 'eco-orb-speaking'
      : heldBack
        ? ''
        : 'eco-orb-idle';

  return (
    <div className="eco-panel flex flex-col items-center gap-4 p-6 text-center">
      <span className="eco-label" style={{ color: 'var(--eco-athena)' }}>
        Athena
      </span>

      <div className="relative flex h-32 w-32 items-center justify-center">
        {/* Outer bloom — soft glow, not a drop shadow (per the spec's own example). */}
        <div
          className={`absolute inset-0 rounded-full ${orbAnim}`}
          style={{
            background: `radial-gradient(circle at 50% 45%, color-mix(in srgb, ${hue} ${
              speaking ? 55 : heldBack ? 18 : 32
            }%, transparent), transparent 70%)`,
          }}
        />
        {/* Core disc + ring */}
        <div
          className="relative flex h-24 w-24 items-center justify-center rounded-full"
          style={{
            background: 'var(--eco-ink-sunken)',
            border: `1px solid color-mix(in srgb, ${hue} ${heldBack ? 40 : 60}%, transparent)`,
            boxShadow: `inset 0 0 22px 2px color-mix(in srgb, ${hue} ${
              speaking ? 38 : heldBack ? 8 : 20
            }%, transparent)`,
          }}
        >
          {speaking && !reducedMotion ? (
            <span className="flex items-end gap-1" style={{ height: '1.4rem' }}>
              {[0.7, 1, 0.5, 0.85].map((h, i) => (
                <span
                  key={i}
                  className="w-1 rounded-full"
                  style={{
                    height: `${h * 100}%`,
                    background: hue,
                    animation: `eco-pulse ${0.7 + i * 0.15}s ease-in-out infinite`,
                  }}
                />
              ))}
            </span>
          ) : (
            <span
              className="eco-numerals text-[0.7rem] font-semibold uppercase tracking-wider"
              style={{ color: hue }}
            >
              {heldBack && score !== undefined ? score.toFixed(2) : ''}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span
          className="text-sm font-medium tracking-wide"
          style={{ color: hue }}
        >
          {label}
        </span>
        <span className="text-xs text-[var(--eco-cream-faint)]">{sub}</span>
      </div>
    </div>
  );
}
