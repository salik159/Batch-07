'use client';

import { motion } from 'framer-motion';
import { Panel } from '../Panel';
import { Gauge } from '../Gauge';
import { Waveform } from '../Waveform';
import { AICore3D } from '../AICore3D';
import { WeatherWidget } from '../WeatherWidget';
import { ClockWidget } from '../ClockWidget';
import { useSystemMetrics } from "../hooks/useSystemMetrics";
import { useWeather } from "../hooks/useWeather";
import { useEffect, useRef, useState } from 'react';
import { runTask, transcribeAudio, answerNews } from "../../../services/api";
import type { AgentInfo } from '../types';

const AGENTS: AgentInfo[] = [
  { name: 'Coding Agent', task: 'Ready for coding tasks', status: 'ok', badge: 'READY' },
  { name: 'Browser Agent', task: 'Ready for web tasks', status: 'ok', badge: 'READY' },
  { name: 'Email Agent', task: 'Ready to read recent email', status: 'ok', badge: 'READY' },
  { name: 'YouTube Analysis Agent', task: 'Ready for channel analytics', status: 'ok', badge: 'READY' },
  { name: 'System Agent', task: 'Ready for apps & system control', status: 'ok', badge: 'READY' },
];

const DOT_COLOR: Record<string, string> = { ok: '#3cff9a', busy: '#4be3ff', warn: '#ffb84d' };
const BADGE_CLASS: Record<string, string> = {
  ok: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  busy: 'text-cyan-300 bg-cyan-400/10 border-cyan-400/30',
  warn: 'text-amber-300 bg-amber-400/10 border-amber-400/30',
};

const STATUS_MESSAGES = [
  'Listening for input…', 'Indexing session context…', 'Idle — awaiting command…',
  'Monitoring agent fleet…', 'Synced with knowledge graph…', 'Standing by…',
];

function useCoreHud() {
  const [hud, setHud] = useState({ sync: '99.8%', nodes: '128M', load: '42%', latency: '18ms', status: STATUS_MESSAGES[0] });
  useEffect(() => {
    const id = setInterval(() => {
      setHud({
        sync: `${(99 + Math.random() * 0.9).toFixed(1)}%`,
        nodes: `${(120 + Math.random() * 16).toFixed(0)}M`,
        load: `${Math.round(18 + Math.random() * 46)}%`,
        latency: `${Math.round(8 + Math.random() * 26)}ms`,
        status: STATUS_MESSAGES[Math.floor(Math.random() * STATUS_MESSAGES.length)],
      });
    }, 2600);
    return () => clearInterval(id);
  }, []);
  return hud;
}

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35 } },
};

export function HomeMode() {
  const metrics = useSystemMetrics();
  const weather = useWeather();
  const [taskResult, setTaskResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [command, setCommand] = useState("");
  const [agentStatus, setAgentStatus] = useState<'idle'|'activated'|'listening'|'thinking'|'processing'|'executing'|'speaking'|'stopping'|'completed'|'error'>('idle');
  const [steps, setSteps] = useState<string[]>([]);
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const speakQueueRef = useRef<Promise<void>>(Promise.resolve());
  const busyRef = useRef(false);
  const wakeStreamRef = useRef<MediaStream | null>(null);
  const wakeRecorderRef = useRef<MediaRecorder | null>(null);
  const wakeRunningRef = useRef(false);
  const conversationActiveRef = useRef(false);
  const conversationTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!window.neura?.isDesktop || !window.neura.onAgentEvent) return;
    const off = window.neura.onAgentEvent(async (event:any) => {
      if (event?.type === 'announcement' && event.text) {
        setTaskResult(event.text);
        setAgentStatus('executing');
        if (event.speak !== false && event.agent !== 'browser') {
          await speakResponse(event.text);
        }
      }
      if (event?.type === 'action' && event.action) {
        setSteps((prev) => [...prev, String(event.action).split('_').join(' ')]);
      }
      if (event?.type === 'completed') {
        setAgentStatus('completed');
        if (event.text && event.text !== 'Task completed.') {
          // Show the full decoded text (email body / code) on screen; speak the concise version.
          setTaskResult(event.display || event.text);
          await speakResponse(event.text);
        }
      }
      if (event?.type === 'error' && event.text) {
        setAgentStatus('error');
        setTaskResult(event.text);
        await speakResponse(event.text);
      }
    });
    return off;
  }, []);


  const executeCommand = async (input?: string) => {
    const text = (input ?? command).trim();
    if (!text) return;

    // Global voice interruption command handling
    if (/^(neura,?\s*stop|stop|stop\s+speaking|stop\s+listening|cancel|that's\s+enough)\.?$/i.test(text)) {
      await cancel();
      return;
    }

    const isSpecialistRequest = /\b(e-?mails?|gmail|inbox)\b/i.test(text)
      || (/\b(java|python|javascript|node(?:\.js)?)\b/i.test(text) && /\b(write|create|make|build|generate|implement|code|develop|solve|demonstrate|program|debug|fix)\b/i.test(text))
      || (/\b(write|create|make|build|generate|implement|develop)\b/i.test(text) && /\b(program|code|algorithm|function|class|script)\b/i.test(text));
    const isNewsQuestion = !isSpecialistRequest && /\b(news|headlines|latest|current events|world events|what happened|happening|international news|global news)\b/i.test(text);

    if (busyRef.current) return;
    setBusy(true); busyRef.current = true; setAgentStatus('thinking'); setTaskResult(''); setSteps([]);
    window.dispatchEvent(new CustomEvent('neura:command-log', { detail: { text } }));
    try {
      if (window.neura?.isDesktop) {
        setAgentStatus('executing');
        await window.neura.setVoiceState?.('executing');
        const result = await window.neura.runAgent(text);
        setSteps((result.actions || []).map((a:any) => a.type.replaceAll('_',' ')));
        const agentName = result.agent === 'browser' ? 'Browser Agent' : result.agent === 'coding' ? 'Coding Agent' : result.agent === 'email' ? 'Email Agent' : result.agent === 'youtube' ? 'YouTube Analysis Agent' : result.agent === 'phone' ? 'Phone Link Agent' : result.agent === 'system' ? 'System Agent' : 'Neura Agent';
        const completion = result.resultText || `${agentName} completed the task.`;
        setTaskResult(result.displayText || completion);
        if (!result.resultText) await speakResponse(completion);
      } else {
        setAgentStatus('thinking');
        const result = await runTask(`Act as NeuraOS command planner. The browser cannot control Windows. Explain the exact desktop actions needed for: ${text}`);
        setTaskResult(result.text);
        await speakResponse(result.text);
      }
      setAgentStatus('idle');
      await window.neura?.setVoiceState?.('idle');
    } catch (e) {
      setAgentStatus('error');
      setTaskResult(e instanceof Error ? e.message : 'Task failed');
      await window.neura?.setVoiceState?.('idle');
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  };

  const run = () => executeCommand();

  const speakResponse = async (text: string) => {
    const clean = String(text || '').trim();
    if (!clean) return;
    setAgentStatus('speaking');
    await window.neura?.setVoiceState?.('speaking');
    if (window.neura?.isDesktop) {
      try {
        await window.neura.speakLocal(clean);
        return;
      } catch { /* browser fallback below */ }
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      await new Promise<void>((resolve) => {
        const u = new SpeechSynthesisUtterance(clean);
        u.rate = 1; u.pitch = 1; u.onend = () => resolve(); u.onerror = () => resolve();
        window.speechSynthesis.speak(u);
      });
    }
  };

  const cancel = async () => {
    if (conversationTimerRef.current) clearTimeout(conversationTimerRef.current);
    conversationActiveRef.current = false;
    setAgentStatus('stopping');
    if (window.neura?.isDesktop) {
      try { await window.neura.stopSpeaking(); } catch {}
      try { await window.neura.cancelAgent(); } catch {}
      try { await window.neura.setVoiceState?.('idle'); } catch {}
    }
    try { mediaRecorderRef.current?.stop(); } catch {}
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    window.speechSynthesis?.cancel();
    setBusy(false);
    busyRef.current = false;
    setAgentStatus('idle');
    setTaskResult('Stopped.');
  };

  useEffect(() => {
    if (!window.neura?.isDesktop) return;

    // Listen to live background voice state from Electron
    const offVoiceState = window.neura.onVoiceState?.((event) => {
      const state = event.state as any;
      setAgentStatus(state);
      if (state === 'idle') {
        setTaskResult('Standby · Say "Hey Neura" to wake');
      } else if (state === 'activated') {
        setTaskResult('Yes boss?');
      } else if (state === 'listening') {
        setTaskResult("Yes boss, I'm listening for your command...");
      } else if (state === 'stopping') {
        setTaskResult('Stopped.');
      } else if (state === 'error') {
        setTaskResult(event.message || 'Microphone or recognition error.');
      }
    });

    // Listen to commands transcribed hands-free by the voice service
    const offVoiceCommand = window.neura.onVoiceCommand?.((event) => {
      if (event?.text) {
        setCommand(event.text);
        executeCommand(event.text);
      }
    });

    return () => {
      offVoiceState?.();
      offVoiceCommand?.();
    };
  }, []);

  const voice = async () => {
    if (!window.neura?.isDesktop) return;
    if (agentStatus === 'listening') {
      await window.neura.setVoiceState('idle');
    } else if (agentStatus === 'speaking' || agentStatus === 'executing' || busyRef.current) {
      await cancel();
    } else {
      await window.neura.setVoiceState('listening');
    }
  };

  const files = () => {
    const input = document.createElement('input'); input.type = 'file'; input.multiple = true;
    input.onchange = () => setTaskResult(`${input.files?.length || 0} file(s) selected.`); input.click();
  };

  const scan = () => { const query = window.prompt('Search the web for:'); if (query) { if (window.neura?.isDesktop) window.neura.openUrl(`https://www.google.com/search?q=${encodeURIComponent(query)}`); else window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank', 'noopener,noreferrer'); } };

  const hud = useCoreHud();
  const voiceActivity = Math.min(1, metrics.net / 100);

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="grid grid-cols-1 lg:grid-cols-[300px_1fr_300px] gap-4 h-full lg:overflow-hidden overflow-y-auto neura-scrollbar"
    >
      <motion.div variants={item} className="flex flex-col gap-4 min-h-0">
        <Panel title="System Vitals" subtitle="live" className="min-h-[300px] lg:min-h-0">
          <MetricBar name="CPU" value={metrics.cpu} />
          <MetricBar name="RAM" value={metrics.ram} />
          <MetricBar name="GPU" value={metrics.gpu} />
          <div className="flex gap-3 justify-between mt-2">
            <Gauge value={metrics.temp} max={90} color="#4be3ff" label="CORE TEMP" valueLabel={`${metrics.temp}°`} />
            <Gauge value={metrics.net} max={100} color="#3e8fff" label="NETWORK" valueLabel={`${metrics.net}%`} />
          </div>
        </Panel>

        <Panel title="Clock & Weather" subtitle="synced" className="flex-1 min-h-[220px] lg:min-h-0">
          <div className="mb-4">
            <ClockWidget />
          </div>
          <div className="h-px bg-cyan-400/10 mb-4" />
          <WeatherWidget {...weather} compact />
        </Panel>
      </motion.div>

      <motion.div variants={item}>
        <Panel title="AI Core" subtitle="NEURA-7 · ACTIVE" tilt={2.2} className="min-h-[520px] lg:min-h-0">
          <div className="flex flex-col items-center justify-center gap-4 h-full">
            <div className="relative w-[340px] h-[340px] sm:w-[380px] sm:h-[380px] max-w-full">
              <div
                className="absolute inset-0 rounded-full neura-core-glow"
                style={{ background: 'radial-gradient(circle, rgba(75,227,255,.25), transparent 70%)', filter: 'blur(10px)' }}
              />
              <div
                className="absolute left-1/2 bottom-[6%] w-[70%] h-[34px] -translate-x-1/2 rounded-full blur-md neura-core-floor"
                style={{ background: 'radial-gradient(ellipse at center, rgba(75,227,255,.35), transparent 70%)' }}
              />
              <AICore3D className="relative z-[2]" activity={voiceActivity} />
              <div className="absolute inset-0 z-[3] pointer-events-none font-hud-mono text-[9.5px] tracking-wide text-slate-500">
                <div className="absolute top-[2%] left-0 text-left"><span className="block opacity-70">SYNC</span><b className="text-cyan-200 text-[11px]">{hud.sync}</b></div>
                <div className="absolute top-[2%] right-0 text-right"><span className="block opacity-70">NODES</span><b className="text-cyan-200 text-[11px]">{hud.nodes}</b></div>
                <div className="absolute bottom-[14%] left-0 text-left"><span className="block opacity-70">LOAD</span><b className="text-cyan-200 text-[11px]">{hud.load}</b></div>
                <div className="absolute bottom-[14%] right-0 text-right"><span className="block opacity-70">LATENCY</span><b className="text-cyan-200 text-[11px]">{hud.latency}</b></div>
              </div>
            </div>
            <div className="text-center">
              <div className="font-display text-[12px] tracking-[4px] text-cyan-200 uppercase drop-shadow-[0_0_10px_rgba(75,227,255,.6)]">
                NEURA CORE ONLINE
              </div>
              <div className="text-[13px] text-slate-400 tracking-wide mt-1">{hud.status}</div>
            </div>
            <Waveform className="max-w-[500px]" active={voiceActivity > 0.2} />
          </div>
        </Panel>
      </motion.div>

      <motion.div variants={item} className="flex flex-col gap-4 min-h-0">
        <Panel title="Agent Status" subtitle="5 agents" className="flex-1 min-h-[260px] lg:min-h-0">
          <div className="flex flex-col gap-2 overflow-y-auto neura-scrollbar h-full">
            {AGENTS.map((a) => (
              <div key={a.name} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-cyan-400/10 bg-white/[0.015] text-[12.5px]">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: DOT_COLOR[a.status], boxShadow: `0 0 6px ${DOT_COLOR[a.status]}` }} />
                <div className="flex-1 text-slate-100">
                  {a.name}
                  <div className="text-[10px] text-slate-600 font-hud-mono">{a.task}</div>
                </div>
                <span className={`text-[9.5px] font-hud-mono tracking-wide px-2 py-1 rounded-full border ${BADGE_CLASS[a.status]}`}>{a.badge}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Neura Agent" subtitle={window.neura?.isDesktop ? "WINDOWS DESKTOP · ONLINE" : "BROWSER MODE"} className="min-h-[250px] lg:min-h-0">
          <div className="flex flex-col gap-2.5">
            <div className="flex gap-2">
              <input value={command} onChange={(e) => setCommand(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') executeCommand(); }} placeholder="Tell NeuraOS what to do…" className="flex-1 min-w-0 rounded-lg border border-cyan-400/15 bg-black/30 px-3 py-2 text-[12px] text-slate-100 outline-none focus:border-cyan-300/50" />
              <motion.button
                onClick={voice}
                whileTap={{ scale: 0.94 }}
                title={agentStatus === 'listening' ? 'Active listening. Click to pause.' : 'Always-on wake word active. Say "Hey Neura" or click to speak.'}
                className={`w-11 rounded-lg border transition-all ${
                  agentStatus === 'listening'
                    ? 'border-rose-400/80 bg-rose-500/20 text-rose-300 shadow-[0_0_12px_rgba(244,63,94,0.5)] animate-pulse'
                    : agentStatus === 'activated'
                    ? 'border-emerald-400/80 bg-emerald-500/20 text-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.5)]'
                    : 'border-cyan-400/30 bg-cyan-400/[0.06] text-cyan-200 hover:border-cyan-300/60'
                } text-lg`}
              >
                🎙
              </motion.button>
            </div>
            <div className="flex items-center justify-between text-[9px] font-hud-mono uppercase tracking-widest text-slate-500">
              <span className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${
                  agentStatus === 'listening' ? 'bg-rose-400 animate-ping shadow-[0_0_8px_#fb7185]' :
                  agentStatus === 'speaking' ? 'bg-cyan-300 animate-pulse shadow-[0_0_8px_#67e8f9]' :
                  agentStatus === 'executing' ? 'bg-amber-400 animate-spin shadow-[0_0_8px_#fbbf24]' :
                  agentStatus === 'thinking' ? 'bg-purple-400 animate-pulse shadow-[0_0_8px_#c084fc]' :
                  agentStatus === 'activated' ? 'bg-emerald-400 animate-bounce shadow-[0_0_8px_#34d399]' :
                  agentStatus === 'stopping' ? 'bg-rose-500 shadow-[0_0_8px_#f43f5e]' :
                  agentStatus === 'error' ? 'bg-red-500 shadow-[0_0_8px_#ef4444]' :
                  'bg-emerald-400 shadow-[0_0_6px_#34d399]'
                }`} />
                <span className={
                  agentStatus === 'listening' ? 'text-rose-300 font-semibold' :
                  agentStatus === 'activated' ? 'text-emerald-300 font-semibold' :
                  agentStatus === 'speaking' ? 'text-cyan-300 font-semibold' :
                  agentStatus === 'executing' ? 'text-amber-300 font-semibold' :
                  'text-slate-400'
                }>
                  {agentStatus === 'idle' ? 'STANDBY · SAY "HEY NEURA"' :
                   agentStatus === 'activated' ? 'WAKE DETECTED · "YES BOSS?"' :
                   agentStatus === 'listening' ? 'LISTENING FOR COMMAND...' :
                   agentStatus === 'thinking' ? 'THINKING...' :
                   agentStatus === 'executing' ? 'EXECUTING TASK...' :
                   agentStatus === 'speaking' ? 'SPEAKING RESPONSE...' :
                   agentStatus === 'stopping' ? 'STOPPING...' :
                   agentStatus === 'error' ? 'MIC / SYSTEM ERROR' :
                   agentStatus.toUpperCase()}
                </span>
              </span>
              {(busy || agentStatus === 'listening' || agentStatus === 'speaking' || agentStatus === 'executing') && (
                <button onClick={cancel} className="text-rose-300 hover:text-rose-200">CANCEL</button>
              )}
            </div>
            {steps.length > 0 && <div className="space-y-1 max-h-20 overflow-auto neura-scrollbar">{steps.map((step, i) => <div key={i} className="text-[10px] text-emerald-300 font-hud-mono">✓ {step}</div>)}</div>}
            {taskResult && <div className="text-[10px] leading-relaxed whitespace-pre-wrap text-cyan-100 font-hud-mono border border-cyan-400/10 rounded-lg p-2 max-h-24 overflow-auto">{taskResult}</div>}
          </div>
        </Panel>


      </motion.div>
    </motion.div>
  );
}

function MetricBar({ name, value }: { name: string; value: number }) {
  return (
    <div className="mb-3.5">
      <div className="flex justify-between items-baseline mb-1.5">
        <span className="text-[11px] tracking-wide text-slate-400 uppercase">{name}</span>
        <span className="font-hud-mono text-[13px] text-cyan-200">{value}%</span>
      </div>
      <div className="h-1.5 rounded bg-white/[0.06] overflow-hidden">
        <motion.div
          className="h-full rounded bg-gradient-to-r from-blue-500 to-cyan-300 shadow-[0_0_10px_rgba(75,227,255,.6)]"
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}
