'use client';

import { useEffect, useState } from 'react';

export interface CommandLogEntry {
  id: string;
  text: string;
  time: string;
  agent?: string;
}

/** Real command history from the Neura agent bus. No simulated commands. */
export function useCommandFeed(max = 10) {
  const [log, setLog] = useState<CommandLogEntry[]>([]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      const text = String(detail.text || '').trim();
      if (!text) return;
      const entry: CommandLogEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        text,
        time: new Date().toLocaleTimeString('en-GB'),
        agent: detail.agent,
      };
      setLog((prev) => [entry, ...prev].slice(0, max));
    };
    window.addEventListener('neura:command-log', handler);
    return () => window.removeEventListener('neura:command-log', handler);
  }, [max]);

  return log;
}
