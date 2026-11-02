'use client';

import { motion } from 'framer-motion';
import { Panel } from '../Panel';
import { AgentCard } from '../AgentCard';
import { useCommandFeed } from '../hooks/useCommandFeed';

const FLEET = [
  { name: 'Coding Agent', task: 'Ready for coding tasks', status: 'ok' as const, badge: 'READY', icon: '💻' },
  { name: 'Browser Agent', task: 'Ready for web tasks', status: 'ok' as const, badge: 'READY', icon: '🌐' },
  { name: 'Email Agent', task: 'Ready to open and read your recent email', status: 'ok' as const, badge: 'READY', icon: '✉️' },
  { name: 'YouTube Analysis Agent', task: 'Ready to open YouTube Studio and read analytics', status: 'ok' as const, badge: 'READY', icon: '▶️' },
  { name: 'System Agent', task: 'Ready for apps and system control', status: 'ok' as const, badge: 'READY', icon: '⚙️' },
];

export function AgentDashboardMode() {
  const commands = useCommandFeed();

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_1.2fr_1fr] gap-4 h-full xl:overflow-hidden overflow-y-auto neura-scrollbar">
      <div className="flex flex-col gap-4 min-h-0">
        <Panel title="Agent Fleet" subtitle="5 registered" className="min-h-[520px] xl:min-h-0 xl:flex-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-2.5 overflow-y-auto neura-scrollbar h-full pr-0.5">
            {FLEET.map((a) => (
              <AgentCard key={a.name} {...a} load={0} />
            ))}
          </div>
        </Panel>
      </div>

      <div className="flex flex-col gap-4 min-h-0">
        <Panel title="Recent Commands" subtitle="live feed" className="min-h-[320px] xl:flex-1 xl:min-h-0">
          <div className="flex flex-col gap-2 overflow-y-auto neura-scrollbar h-full">
            {commands.map((c) => (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-cyan-400/10 bg-white/[0.015] text-[12.5px]"
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-cyan-300" style={{ boxShadow: '0 0 6px #4be3ff' }} />
                <div className="flex-1 text-slate-100">
                  “{c.text}”
                  <div className="text-[10px] text-slate-600 font-hud-mono">EXEC {c.time}</div>
                </div>
                <span className="text-[9.5px] font-hud-mono tracking-wide px-2 py-1 rounded-full border text-emerald-400 bg-emerald-400/10 border-emerald-400/30">
                  DONE
                </span>
              </motion.div>
            ))}
          </div>
        </Panel>

        <Panel title="Command Status" subtitle="live session">
          <div className="h-full flex items-center justify-center text-center px-4">
            <div>
              <div className="text-emerald-400 text-sm font-hud-mono">LIVE COMMAND FEED</div>
              <div className="text-slate-500 text-[11px] mt-2">Only commands spoken to Neura appear in Recent Commands.</div>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

