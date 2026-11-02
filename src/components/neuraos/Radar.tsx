'use client';

import { motion } from 'framer-motion';
import { useMemo } from 'react';

/** SVG radar with a rotating sweep gradient and randomly-blinking contact blips. */
export function Radar() {
  const blips = useMemo(
    () =>
      Array.from({ length: 6 }, () => ({
        angle: Math.random() * Math.PI * 2,
        r: 20 + Math.random() * 65,
        delay: Math.random() * 3,
        dur: 2 + Math.random() * 2,
      })),
    []
  );
  const cx = 100, cy = 100;

  return (
    <svg viewBox="0 0 200 200" className="w-full h-full max-w-[260px] mx-auto">
      <defs>
        <linearGradient id="radarSweep" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#4be3ff" stopOpacity="0" />
          <stop offset="100%" stopColor="#4be3ff" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      {[90, 65, 40, 15].map((r) => (
        <circle key={r} cx={cx} cy={cy} r={r} fill="none" stroke="#4be3ff" strokeWidth={0.6} opacity={0.35} />
      ))}
      <line x1={10} y1={cy} x2={190} y2={cy} stroke="#4be3ff" strokeWidth={0.4} opacity={0.25} />
      <line x1={cx} y1={10} x2={cx} y2={190} stroke="#4be3ff" strokeWidth={0.4} opacity={0.25} />
      <motion.path
        d={`M ${cx} ${cy} L ${cx} 10 A 90 90 0 0 1 ${cx + 90} ${cy} Z`}
        fill="url(#radarSweep)"
        style={{ transformOrigin: `${cx}px ${cy}px` }}
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, ease: 'linear', duration: 4 }}
      />
      {blips.map((b, i) => {
        const bx = cx + b.r * Math.cos(b.angle);
        const by = cy + b.r * Math.sin(b.angle);
        return (
          <motion.circle
            key={i}
            cx={bx}
            cy={by}
            r={2.4}
            fill="#ffb84d"
            animate={{ opacity: [0, 1, 0] }}
            transition={{ repeat: Infinity, duration: b.dur, delay: b.delay }}
          />
        );
      })}
    </svg>
  );
}
