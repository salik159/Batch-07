'use client';

import { motion } from 'framer-motion';
import type { AgentInfo } from './types';

const STATUS_STYLES: Record<AgentInfo['status'], { dot: string; badge: string; glow: string }> = {
  ok: { dot: '#3cff9a', glow: 'rgba(60,255,154,.25)', badge: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30' },
  busy: { dot: '#4be3ff', glow: 'rgba(75,227,255,.25)', badge: 'text-cyan-300 bg-cyan-400/10 border-cyan-400/30' },
  warn: { dot: '#ffb84d', glow: 'rgba(255,184,77,.25)', badge: 'text-amber-300 bg-amber-400/10 border-amber-400/30' },
};

interface AgentCardProps extends AgentInfo {
  icon: string;
  load: number; // 0..100, current utilization
}

/** Reusable per-agent widget: icon, live status glow, current task, and a mini load bar. */
export function AgentCard({ name, task, status, badge, icon, load }: AgentCardProps) {
  const s = STATUS_STYLES[status];

  return (
    <motion.div
      layout
      whileHover={{ y: -3, boxShadow: `0 8px 28px ${s.glow}` }}
      className="relative rounded-xl border border-cyan-400/15 bg-white/[0.02] p-3.5 overflow-hidden"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2.5">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center text-lg border"
            style={{ borderColor: s.dot + '55', background: s.dot + '14', boxShadow: `0 0 14px ${s.glow}` }}
          >
            {icon}
          </div>
          <div>
            <div className="text-[13px] font-medium text-slate-100">{name}</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <motion.span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: s.dot, boxShadow: `0 0 6px ${s.dot}` }}
                animate={{ opacity: [1, 0.35, 1] }}
                transition={{ repeat: Infinity, duration: 1.6 }}
              />
              <span className={`text-[9px] font-hud-mono tracking-wide px-1.5 py-[1px] rounded-full border ${s.badge}`}>
                {badge}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="text-[11px] text-slate-500 font-hud-mono leading-snug mb-2.5 min-h-[28px]">{task}</div>

      <div className="h-1 rounded bg-white/[0.06] overflow-hidden">
        <motion.div
          className="h-full rounded"
          style={{ background: `linear-gradient(90deg, ${s.dot}88, ${s.dot})`, boxShadow: `0 0 8px ${s.dot}` }}
          animate={{ width: `${load}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
    </motion.div>
  );
}
