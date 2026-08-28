'use client';

import { useEffect, useState } from 'react';

export type RestraintState = 'listening' | 'ready' | 'held-back' | 'speaking';

export interface RestraintMeterProps {
  state: RestraintState;
  score?: number;
}

export function RestraintMeter({ state, score }: RestraintMeterProps) {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(media.matches);
    const listener = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);

  // State-specific styles mapping
  // Ink background (slate-chalkboard style)
  // Slate: #2E3D50, Marigold: #E8A317, Teal: #0F766E, Clay: #B85C38
  const CONFIG = {
    listening: {
      bg: 'bg-transparent',
      border: 'border-2 border-slate-500/30',
      shadow: 'shadow-[0_0_15px_rgba(71,85,105,0.1)]',
      scale: 'scale-90',
      label: 'Listening',
      textColor: 'text-slate-400',
      pulseClass: reducedMotion ? '' : 'animate-[pulse_3s_infinite]',
    },
    ready: {
      bg: 'bg-[#E8A317]',
      border: 'border-2 border-[#E8A317]',
      shadow: 'shadow-[0_0_25px_rgba(232,163,23,0.5)]',
      scale: 'scale-110',
      label: 'Evaluating...',
      textColor: 'text-[#E8A317] font-semibold',
      pulseClass: reducedMotion ? '' : 'animate-bounce',
    },
    'held-back': {
      bg: 'bg-transparent',
      border: 'border-2 border-[#B85C38]',
      shadow: 'shadow-[0_0_15px_rgba(184,92,56,0.2)]',
      scale: 'scale-90',
      label: 'Quietly Observant',
      textColor: 'text-[#B85C38]',
      pulseClass: '',
    },
    speaking: {
      bg: 'bg-[#0F766E]',
      border: 'border-2 border-[#0F766E]',
      shadow: 'shadow-[0_0_30px_rgba(15,118,110,0.6)]',
      scale: 'scale-100',
      label: 'Speaking',
      textColor: 'text-[#0F766E] font-semibold',
      pulseClass: '',
    },
  };

  const current = CONFIG[state] || CONFIG.listening;

  return (
    <div className="flex flex-col items-center justify-center gap-6 p-6 select-none">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Restraint Status
      </span>

      {/* Circular breathing meter element */}
      <div className="relative flex items-center justify-center h-48 w-48">
        {/* Glow backdrop circle */}
        <div
          className={`absolute inset-0 rounded-full transition-all duration-700 ease-out opacity-20 ${
            state === 'listening' ? 'bg-slate-500' :
            state === 'ready' ? 'bg-[#E8A317]' :
            state === 'held-back' ? 'bg-[#B85C38]' : 'bg-[#0F766E]'
          } ${reducedMotion ? '' : 'animate-[ping_4s_infinite]'}`}
        />

        {/* Core Meter Circle */}
        <div
          className={`relative flex flex-col items-center justify-center h-40 w-40 rounded-full transition-all duration-500 ease-in-out ${current.bg} ${current.border} ${current.shadow} ${current.scale} ${current.pulseClass}`}
        >
          {/* Internal animations based on state */}
          {state === 'speaking' && !reducedMotion && (
            <div className="flex items-center gap-1 h-6">
              <span className="w-1 bg-[#EEF1F4] rounded-full animate-[bounce_1s_infinite_100ms]" style={{ height: '70%' }} />
              <span className="w-1 bg-[#EEF1F4] rounded-full animate-[bounce_1s_infinite_300ms]" style={{ height: '100%' }} />
              <span className="w-1 bg-[#EEF1F4] rounded-full animate-[bounce_1s_infinite_200ms]" style={{ height: '50%' }} />
              <span className="w-1 bg-[#EEF1F4] rounded-full animate-[bounce_1s_infinite_400ms]" style={{ height: '80%' }} />
            </div>
          )}

          {state === 'ready' && (
            <span className="text-xs font-mono font-bold text-[#16202E] animate-pulse">
              {score ? `Score: ${score.toFixed(2)}` : 'DRAFTING'}
            </span>
          )}

          {state === 'held-back' && (
            <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[#B85C38] text-center px-2">
              {score ? `Held (${score.toFixed(2)})` : 'Held back'}
            </span>
          )}

          {state === 'listening' && (
            <div className="flex items-center justify-center">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-500/50" />
            </div>
          )}
        </div>
      </div>

      {/* Readout label */}
      <div className="flex flex-col items-center gap-1.5 text-center">
        <span className={`text-base font-medium tracking-wide ${current.textColor} transition-colors duration-500`}>
          {current.label}
        </span>
        {state === 'held-back' && (
          <span className="text-xs text-[#B85C38]/80 font-mono">
            Suppressed: score below threshold (0.60)
          </span>
        )}
        {state === 'listening' && (
          <span className="text-xs text-slate-500 font-mono">
            Meraki is listening to the room...
          </span>
        )}
      </div>
    </div>
  );
}
