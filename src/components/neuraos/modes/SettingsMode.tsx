'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Panel } from '../Panel';
import { getAIStatus, testAIProvider, setAIProvider, type AIProviderStatus } from '../../../services/api';

export function SettingsMode() {
  const [status, setStatus] = useState<AIProviderStatus | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<'gemini' | 'ollama'>('gemini');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      const data = await getAIStatus();
      setStatus(data);
      setSelectedProvider(data.provider === 'ollama' ? 'ollama' : 'gemini');
      setSelectedModel(data.model || '');
    } catch (e: any) {
      setStatus({ ok: false, provider: 'gemini', model: 'gemini-2.0-flash', error: e?.message || 'Could not reach server' });
    }
  };

  const handleTest = async (provider: 'gemini' | 'ollama') => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testAIProvider(provider);
      if (res.ok) {
        setTestResult({ ok: true, message: `Connected successfully to ${provider.toUpperCase()} (${res.model})` });
      } else {
        setTestResult({ ok: false, message: `Failed: ${res.error || 'Connection error'}` });
      }
    } catch (e: any) {
      setTestResult({ ok: false, message: `Error: ${e?.message || 'Request failed'}` });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMessage(null);
    try {
      await setAIProvider(selectedProvider, selectedModel);
      setSaveMessage(`Active provider switched to ${selectedProvider.toUpperCase()}`);
      await loadStatus();
    } catch (e: any) {
      setSaveMessage(`Failed to switch: ${e?.message || 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-4 h-full overflow-y-auto neura-scrollbar">
      <Panel title="AI Providers & Configuration" subtitle="Free & Local AI Fleet">
        <div className="space-y-6 text-slate-200">
          <div>
            <label className="block text-xs uppercase font-hud-mono tracking-wider text-cyan-300 mb-2">
              Primary AI Provider (Online Free Tier)
            </label>
            <div
              onClick={() => setSelectedProvider('gemini')}
              className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                selectedProvider === 'gemini'
                  ? 'border-cyan-400/50 bg-cyan-950/20 shadow-[0_0_12px_rgba(75,227,255,0.15)]'
                  : 'border-cyan-400/10 bg-white/[0.02] hover:border-cyan-400/30'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">✨</span>
                  <div>
                    <div className="font-display text-sm tracking-wide text-cyan-100">Google Gemini Developer API</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">Model: gemini-2.0-flash (Official Google Gen AI SDK)</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[9.5px] font-hud-mono px-2 py-0.5 rounded-full border text-emerald-400 bg-emerald-400/10 border-emerald-400/30">
                    FREE TIER
                  </span>
                  <input
                    type="radio"
                    name="provider"
                    checked={selectedProvider === 'gemini'}
                    onChange={() => setSelectedProvider('gemini')}
                    className="accent-cyan-400"
                  />
                </div>
              </div>
              <div className="mt-3 text-[11px] text-slate-400 border-t border-cyan-400/10 pt-2 flex justify-between items-center">
                <span>Configured via GEMINI_API_KEY in .env (never exposed to frontend)</span>
                <button
                  type="button"
                  disabled={testing}
                  onClick={(e) => { e.stopPropagation(); handleTest('gemini'); }}
                  className="px-2.5 py-1 text-[10px] font-hud-mono uppercase tracking-wider rounded border border-cyan-400/30 hover:bg-cyan-400/10 text-cyan-300 disabled:opacity-50"
                >
                  Test Connection
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs uppercase font-hud-mono tracking-wider text-cyan-300 mb-2">
              Secondary AI Provider (Local Offline)
            </label>
            <div
              onClick={() => setSelectedProvider('ollama')}
              className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                selectedProvider === 'ollama'
                  ? 'border-cyan-400/50 bg-cyan-950/20 shadow-[0_0_12px_rgba(75,227,255,0.15)]'
                  : 'border-cyan-400/10 bg-white/[0.02] hover:border-cyan-400/30'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">🦙</span>
                  <div>
                    <div className="font-display text-sm tracking-wide text-cyan-100">Ollama Local AI</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">100% Local · No API Key Required · Private</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[9.5px] font-hud-mono px-2 py-0.5 rounded-full border text-cyan-400 bg-cyan-400/10 border-cyan-400/30">
                    OFFLINE
                  </span>
                  <input
                    type="radio"
                    name="provider"
                    checked={selectedProvider === 'ollama'}
                    onChange={() => setSelectedProvider('ollama')}
                    className="accent-cyan-400"
                  />
                </div>
              </div>

              {status?.ollamaModels && status.ollamaModels.length > 0 ? (
                <div className="mt-3 border-t border-cyan-400/10 pt-2">
                  <label className="block text-[10px] font-hud-mono text-slate-400 mb-1">SELECT INSTALLED MODEL</label>
                  <select
                    value={selectedModel || status.ollamaModels[0]}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="w-full bg-black/40 border border-cyan-400/20 rounded px-2.5 py-1.5 text-xs text-cyan-200 outline-none"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {status.ollamaModels.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="mt-3 text-[11px] text-slate-500 border-t border-cyan-400/10 pt-2">
                  No local models detected on Ollama (or Ollama service is stopped).
                </div>
              )}

              <div className="mt-3 text-[11px] text-slate-400 border-t border-cyan-400/10 pt-2 flex justify-between items-center">
                <span>Endpoint: http://localhost:11434</span>
                <button
                  type="button"
                  disabled={testing}
                  onClick={(e) => { e.stopPropagation(); handleTest('ollama'); }}
                  className="px-2.5 py-1 text-[10px] font-hud-mono uppercase tracking-wider rounded border border-cyan-400/30 hover:bg-cyan-400/10 text-cyan-300 disabled:opacity-50"
                >
                  Test Connection
                </button>
              </div>
            </div>
          </div>

          <div className="pt-2 flex items-center justify-between">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-900 font-display text-xs font-bold tracking-wider uppercase transition-all shadow-[0_0_12px_rgba(75,227,255,0.4)] disabled:opacity-50"
            >
              {saving ? 'Applying...' : 'Apply AI Provider'}
            </button>
            {saveMessage && (
              <span className="text-xs font-hud-mono text-cyan-300">{saveMessage}</span>
            )}
          </div>
        </div>
      </Panel>

      <Panel title="Connection Test & Status" subtitle="Provider Health">
        <div className="space-y-4">
          <div className="p-3 rounded-lg border border-cyan-400/15 bg-black/30">
            <div className="text-[11px] font-hud-mono uppercase text-slate-400 mb-1">Active Runtime Provider</div>
            <div className="text-sm font-display text-cyan-200 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              {status?.provider?.toUpperCase() || 'GEMINI'}
              <span className="text-xs text-slate-500 font-hud-mono">({status?.model || 'gemini-2.0-flash'})</span>
            </div>
          </div>

          {testing && (
            <div className="p-3 rounded-lg border border-cyan-400/30 bg-cyan-950/20 text-xs font-hud-mono text-cyan-300 animate-pulse">
              Testing provider connection...
            </div>
          )}

          {testResult && (
            <div
              className={`p-3.5 rounded-lg border text-xs font-hud-mono leading-relaxed ${
                testResult.ok
                  ? 'border-emerald-400/30 bg-emerald-950/20 text-emerald-300'
                  : 'border-rose-400/30 bg-rose-950/20 text-rose-300'
              }`}
            >
              <div className="font-bold mb-1">{testResult.ok ? '✓ CONNECTION SUCCESSFUL' : '✕ CONNECTION FAILED'}</div>
              <div>{testResult.message}</div>
            </div>
          )}

          <div className="border border-cyan-400/10 rounded-lg p-3 bg-white/[0.01] text-xs text-slate-400 space-y-2">
            <div className="font-display text-cyan-300 uppercase tracking-wider text-[11px]">Security & Privacy Guarantees</div>
            <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-400">
              <li>API keys are stored exclusively in the local environment and never sent to the renderer.</li>
              <li>Ollama executes entirely offline on your local machine with zero external network traffic.</li>
              <li>Sensitive email processing defaults to local private parsing.</li>
              <li>No OpenAI packages or endpoints are loaded anywhere in NeuraOS.</li>
            </ul>
          </div>
        </div>
      </Panel>
    </div>
  );
}
