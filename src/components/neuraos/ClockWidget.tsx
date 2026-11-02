'use client';

import { useClock } from './hooks/useClock';

/** Large HUD clock with an animated seconds-progress ring — a dedicated Home dashboard widget. */
export function ClockWidget() {
  const { time, date } = useClock();
  const seconds = time !== '--:--:--' ? Number(time.split(':')[2]) : 0;
  const circumference = 2 * Math.PI * 42;
  const offset = circumference - (seconds / 60) * circumference;

  return (
    <div className="flex items-center gap-4">
      <div className="relative w-[76px] h-[76px] shrink-0">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="4" />
          <circle
            cx="50" cy="50" r="42" fill="none" stroke="#4be3ff" strokeWidth="4"
            strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 1s linear', filter: 'drop-shadow(0 0 4px #4be3ff)' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center font-display text-[10px] text-cyan-300">
          {String(seconds).padStart(2, '0')}
        </div>
      </div>
      <div>
        <div className="font-display font-hud-mono text-[26px] tracking-[2px] text-cyan-200">{time}</div>
        <div className="text-[11px] text-slate-500 tracking-wider mt-1">{date}</div>
      </div>
    </div>
  );
}
