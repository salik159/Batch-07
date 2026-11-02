'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useClock } from './hooks/useClock';
import type { ModeId } from './types';

const NAV_ITEMS: { id: ModeId; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'agent', label: 'Agent Dashboard' },
  { id: 'world', label: 'World Intelligence' },
  { id: 'settings', label: 'AI Settings' },
];

interface TopBarProps {
  mode: ModeId;
  onModeChange: (m: ModeId) => void;
}

export function TopBar({ mode, onModeChange }: TopBarProps) {
  const { time, date } = useClock();
  const [voiceState, setVoiceState] = useState<'idle'|'activated'|'listening'|'thinking'|'executing'|'speaking'|'stopping'|'error'>('idle');

  useEffect(() => {
    if (!window.neura?.isDesktop) return;
    const off = window.neura.onVoiceState?.((event) => {
      setVoiceState(event.state as any);
    });
    return () => off?.();
  }, []);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 md:px-7 py-3.5 border-b border-cyan-400/15 bg-gradient-to-b from-[#060e1ab3] to-[#060e1a26] backdrop-blur-md shrink-0">
      <div className="flex items-center gap-3">
        <div className="relative w-8 h-8 rounded-full border-2 border-cyan-300 shadow-[0_0_14px_rgba(75,227,255,.6)] animate-[spin_6s_linear_infinite]">
          <span className="absolute inset-1.5 rounded-full border border-cyan-300/50 border-t-transparent" />
          <span className="absolute top-1/2 left-1/2 w-1.5 h-1.5 -mt-[3px] -ml-[3px] bg-cyan-300 rounded-full shadow-[0_0_8px_#4be3ff]" />
        </div>
        <div className="leading-none">
          <div className="font-display font-black text-[18px] md:text-[19px] tracking-[3px] text-slate-100">
            NEURA<span className="text-cyan-300">OS</span>
          </div>
          <div className="text-[9px] md:text-[10px] tracking-[4px] text-slate-500 mt-1">AUTONOMOUS INTELLIGENCE SYSTEM</div>
        </div>
      </div>

      <div className="flex gap-1.5 bg-white/[0.02] border border-cyan-400/15 rounded-xl p-1 overflow-x-auto max-w-full">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => onModeChange(item.id)}
            className={`relative font-display text-[9.5px] md:text-[10.5px] tracking-[1.5px] uppercase px-3 md:px-4 py-2 rounded-lg transition-colors whitespace-nowrap ${
              mode === item.id ? 'text-[#00131a]' : 'text-slate-500 hover:text-cyan-200'
            }`}
          >
            {mode === item.id && (
              <motion.span
                layoutId="nav-pill"
                className="absolute inset-0 rounded-lg bg-gradient-to-br from-cyan-300 to-blue-500 shadow-[0_0_18px_rgba(75,227,255,.5)]"
                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              />
            )}
            <span className="relative z-10">{item.label}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-4 md:gap-5">
        <div className="hidden sm:flex items-center gap-2 text-[11px] tracking-wide text-slate-400 border border-cyan-400/15 px-3 py-1.5 rounded-full bg-black/20">
          <motion.span
            className={`w-1.5 h-1.5 rounded-full ${
              voiceState === 'listening' ? 'bg-rose-400 shadow-[0_0_8px_#fb7185]' :
              voiceState === 'activated' ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' :
              voiceState === 'speaking' ? 'bg-cyan-300 shadow-[0_0_8px_#67e8f9]' :
              'bg-emerald-400 shadow-[0_0_8px_#3cff9a]'
            }`}
            animate={{ opacity: voiceState === 'listening' ? [1, 0.2, 1] : [1, 0.4, 1] }}
            transition={{ repeat: Infinity, duration: voiceState === 'listening' ? 0.8 : 1.6 }}
          />
          {voiceState === 'idle' ? 'WAKE: "HEY NEURA"' :
           voiceState === 'listening' ? '🎙 LISTENING...' :
           voiceState === 'activated' ? 'WAKE DETECTED' :
           voiceState.toUpperCase()}
        </div>
        <div className="text-right leading-none">
          <div className="font-display font-hud-mono text-[17px] md:text-[20px] tracking-[2px] text-cyan-200">{time}</div>
          <div className="text-[10px] md:text-[11px] text-slate-500 tracking-wider mt-1">{date}</div>
        </div>
      </div>
    </div>
  );
}
