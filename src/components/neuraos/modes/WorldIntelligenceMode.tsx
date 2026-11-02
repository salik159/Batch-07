'use client';

import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Panel } from '../Panel';
import { Globe3D } from '../Globe3D';
import { WeatherWidget } from '../WeatherWidget';
import { useNewsFeed } from '../hooks/useNewsFeed';
import { useWeather } from '../hooks/useWeather';
const SEVERITY_DOT: Record<string, string> = { info: '#4be3ff', watch: '#ffb84d', alert: '#ff5470' };

export function WorldIntelligenceMode() {
  const liveNews = useNewsFeed();
  const [focusedNews, setFocusedNews] = useState<typeof liveNews | null>(null);
  const [newsContext, setNewsContext] = useState('Global News Feed');

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { question?: string; items?: typeof liveNews };
      if (detail?.items?.length) {
        setFocusedNews(detail.items);
        setNewsContext(detail.question || 'Focused News');
      }
    };
    window.addEventListener('neura:world-news', handler);
    return () => window.removeEventListener('neura:world-news', handler);
  }, []);

  const news = focusedNews || liveNews;
  const weather = useWeather();

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_1fr] gap-4 h-full xl:overflow-hidden overflow-y-auto neura-scrollbar">
      <Panel title="Global Grid" subtitle="14 nodes tracked" bodyClassName="min-h-[340px]" className="min-h-[420px] xl:min-h-0">
        <Globe3D />
      </Panel>

      <div className="flex flex-col gap-4 min-h-0 xl:overflow-y-auto neura-scrollbar">
        <Panel title="Live Global Events" subtitle="latest live headlines" className="min-h-[210px]">
          <div className="flex flex-col gap-2 overflow-y-auto neura-scrollbar h-full">
            {news.slice(0, 6).map((n, i) => (
              <motion.div
                key={`event-${n.tag}-${i}`}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-start gap-2 text-[12px] px-2.5 py-2 rounded-lg border border-cyan-400/10 bg-white/[0.015]"
              >
                <span className="w-1.5 h-1.5 rounded-full mt-1 shrink-0 bg-cyan-300" style={{ boxShadow: '0 0 6px #4be3ff' }} />
                <div className="min-w-0">
                  <span className="font-hud-mono text-[9.5px] text-slate-500 tracking-wide mr-1.5">[{n.tag}]</span>
                  <span className="text-slate-200">{n.title}</span>
                </div>
              </motion.div>
            ))}
          </div>
        </Panel>

        <Panel title="Weather" subtitle="synced" className="min-h-[150px]">
          <WeatherWidget {...weather} compact />
        </Panel>

        <Panel title={focusedNews ? newsContext : "Global News Feed"} subtitle={focusedNews ? "latest topic news" : "live auto-refresh"} className="flex-1 min-h-[200px]">
          <div className="flex flex-col gap-2 overflow-y-auto neura-scrollbar h-full">
            {news.map((n, i) => (
              <div key={n.tag + i} className="border-l-2 border-cyan-300 pl-3 pr-3 py-2 rounded-r-lg bg-cyan-400/[0.03]">
                <div className="text-[9px] tracking-wide text-amber-300 uppercase font-hud-mono">{n.tag}</div>
                <div className="text-[12.5px] text-slate-100 mt-0.5 leading-snug">{n.url ? <a href={n.url} target="_blank" rel="noreferrer" className="hover:text-cyan-200">{n.title}</a> : n.title}</div>
                <div className="text-[10px] text-slate-600 mt-1 font-hud-mono">{n.source || "GLOBAL WIRE"}{n.publishedAt ? ` · ${new Date(n.publishedAt).toLocaleString()}` : ""}</div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
