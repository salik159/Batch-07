'use client';

import { useState, ComponentType, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { TopBar } from './TopBar';
import { ParticleField } from './ParticleField';
import { HomeMode } from './modes/HomeMode';
import { AgentDashboardMode } from './modes/AgentDashboardMode';
import { WorldIntelligenceMode } from './modes/WorldIntelligenceMode';
import { SettingsMode } from './modes/SettingsMode';
import type { ModeId } from './types';
import './neuraos.css';

const MODE_COMPONENTS: Record<ModeId, ComponentType> = {
  home: HomeMode,
  agent: AgentDashboardMode,
  world: WorldIntelligenceMode,
  settings: SettingsMode,
};

/**
 * NeuraOS — top-level AI operating-system dashboard shell.
 * Drop <NeuraOS /> into any full-height route/page. Requires Tailwind CSS
 * in the host project; see README.md for the full dependency list.
 */
export default function NeuraOS() {
  const [mode, setMode] = useState<ModeId>('home');
  const ActiveMode = MODE_COMPONENTS[mode];

  useEffect(() => {
    const handler = (event: Event) => {
      const next = (event as CustomEvent).detail as ModeId;
      if (next && MODE_COMPONENTS[next]) setMode(next);
    };
    window.addEventListener('neura:navigate', handler);
    return () => window.removeEventListener('neura:navigate', handler);
  }, []);

  return (
    <div className="neuraos-root relative w-full h-screen flex flex-col overflow-hidden">
      {/* background layers */}
      <div className="absolute inset-0 neura-grid-bg pointer-events-none" />
      <div className="absolute inset-0 pointer-events-none">
        <ParticleField />
      </div>
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_120%_90%_at_50%_45%,transparent_55%,rgba(0,3,8,0.75)_100%)]" />
      <div className="absolute left-0 right-0 h-[120px] pointer-events-none bg-gradient-to-b from-transparent via-cyan-300/5 to-transparent neura-scanline" />

      {/* app shell */}
      <div className="relative z-10 flex flex-col h-full min-h-0">
        <TopBar mode={mode} onModeChange={setMode} />

        <div className="relative flex-1 min-h-0 overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={mode}
              initial={{ opacity: 0, y: 14, scale: 0.985, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -14, scale: 0.985, filter: 'blur(6px)' }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-0 p-4 md:p-6"
            >
              <ActiveMode />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
