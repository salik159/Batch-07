'use client';

import { motion } from 'framer-motion';

interface ProgressBarProps {
  value: number; // 0..100
  label?: string;
  color?: string;
}

/** Segmented cyberpunk progress indicator with a glowing animated fill. */
export function ProgressBar({ value, label, color = '#4be3ff' }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const segments = 28;
  const filledSegments = Math.round((clamped / 100) * segments);

  return (
    <div className="w-full">
      {label && (
        <div className="flex justify-between items-baseline mb-1.5 font-hud-mono text-[10.5px] tracking-wide text-slate-400">
          <span>{label}</span>
          <motion.span
            key={Math.floor(clamped)}
            initial={{ opacity: 0.4 }}
            animate={{ opacity: 1 }}
            className="text-cyan-200"
          >
            {clamped.toFixed(0)}%
          </motion.span>
        </div>
      )}
      <div className="flex gap-[3px] h-2.5">
        {Array.from({ length: segments }).map((_, i) => (
          <motion.div
            key={i}
            className="flex-1 rounded-[1px]"
            animate={{
              backgroundColor: i < filledSegments ? color : 'rgba(255,255,255,0.06)',
              boxShadow: i < filledSegments ? `0 0 6px ${color}` : 'none',
            }}
            transition={{ duration: 0.25 }}
          />
        ))}
      </div>
    </div>
  );
}
