/**
 * NeuraOS AI Provider — provider-agnostic LLM abstraction.
 *
 * Primary:   Ollama         (local, offline, no key, OLLAMA_BASE_URL / OLLAMA_MODEL)
 * Secondary: Groq           (optional cloud, GROQ_API_KEY / GROQ_MODEL, 429 fallback to Ollama)
 * Legacy:    Google Gemini  (GEMINI_API_KEY + @google/genai SDK)
 *
 * Active provider: AI_PROVIDER env var → "ollama" (default) | "groq" | "gemini"
 *
 * API keys are read from environment variables only; they are never
 * hard-coded and are never sent to the React renderer.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadDotEnv() {
  const candidates = [
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '..', '..', '.env'),
    path.join(__dirname, '..', '.env')
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      try {
        const text = fs.readFileSync(file, 'utf8');
        for (const line of text.split(/\r?\n/)) {
          const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
          if (m && process.env[m[1]] === undefined) {
            process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
          }
        }
        break;
      } catch {}
    }
  }
}
loadDotEnv();

// ─── Configuration ─────────────────────────────────────────────────────────

export const AI_PROVIDER     = (process.env.AI_PROVIDER     || 'ollama').toLowerCase().trim();
export const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '');
export const OLLAMA_MODEL    = process.env.OLLAMA_MODEL    || 'llama3.2:latest';
export const GROQ_API_KEY    = process.env.GROQ_API_KEY    || '';
export const GROQ_MODEL      = process.env.GROQ_MODEL      || 'llama-3.3-70b-versatile';
export const GROQ_BASE_URL   = (process.env.GROQ_BASE_URL  || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
export const GEMINI_API_KEY  = process.env.GEMINI_API_KEY  || '';
export const GEMINI_MODEL    = process.env.GEMINI_MODEL    || 'gemini-3.5-flash-lite';

// ─── Error classes ──────────────────────────────────────────────────────────

export class AIProviderError extends Error {
  /** @param {'quota'|'auth'|'unavailable'|'empty'|'config'} code */
  constructor(message, code = 'unavailable') {
    super(message);
    this.name  = 'AIProviderError';
    this.code  = code;
  }
}

/** Turn an HTTP / SDK error into a user-friendly message. */
function friendlyError(err, provider) {
  const msg = String(err?.message || err || '');
  if (/quota|rate.?limit|429|resource.?exhausted|too many requests/i.test(msg)) {
    throw new AIProviderError(
      `${provider.toUpperCase()} rate limit reached (429).`,
      'quota'
    );
  }
  if (/api.?key|invalid.?key|auth|401|403|unauthorized/i.test(msg)) {
    throw new AIProviderError(
      `${provider.toUpperCase()} API key is invalid or missing. Check your .env configuration.`,
      'auth'
    );
  }
  if (/econnrefused|fetch failed|network|socket|ENOTFOUND|connect/i.test(msg)) {
    throw new AIProviderError(
      provider === 'ollama'
        ? `Ollama server is not reachable at ${process.env.OLLAMA_BASE_URL || OLLAMA_BASE_URL}. Ensure Ollama is running and model "${process.env.OLLAMA_MODEL || OLLAMA_MODEL}" is installed.`
        : `Could not reach ${provider.toUpperCase()} AI service. Check your internet connection.`,
      'unavailable'
    );
  }
  throw new AIProviderError(`AI service error (${provider}): ${msg}`, 'unavailable');
}

// ─── Ollama provider (Primary) ──────────────────────────────────────────────

/**
 * Call Ollama /api/chat.
 * @param {string} system
 * @param {string} user
 * @param {number} maxTokens  Passed as num_predict option
 * @returns {Promise<{text:string, model:string}>}
 */
export async function ollamaLLM(system, user, maxTokens = 1200) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: user });

  const activeBaseUrl = (process.env.OLLAMA_BASE_URL || OLLAMA_BASE_URL).replace(/\/$/, '');
  const activeModel = process.env.OLLAMA_MODEL || OLLAMA_MODEL;

  let r;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    r = await fetch(`${activeBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: activeModel,
        messages,
        stream: false,
        options: { num_predict: maxTokens },
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
  } catch (e) {
    friendlyError(e, 'ollama');
  }

  if (!r.ok) {
    const body = await r.text().catch(() => '');
    friendlyError(new Error(`${r.status} ${r.statusText}: ${body}`), 'ollama');
  }

  const d = await r.json().catch(() => ({}));
  const text = d?.message?.content ?? '';
  if (!text.trim()) {
    throw new AIProviderError('Ollama returned an empty response.', 'empty');
  }
  return { text: text.trim(), model: `ollama:${activeModel}` };
}

// ─── Groq provider (Optional Cloud with Ollama Fallback) ────────────────────

/**
 * Call Groq chat completions API.
 * Falls back to Ollama if rate-limited (429) or if configured.
 * @param {string} system
 * @param {string} user
 * @param {number} maxTokens
 * @param {boolean} fallbackOnQuota
 * @returns {Promise<{text:string, model:string}>}
 */
export async function groqLLM(system, user, maxTokens = 1200, fallbackOnQuota = true) {
  const apiKey = process.env.GROQ_API_KEY || GROQ_API_KEY;
  if (!apiKey) {
    if (fallbackOnQuota) {
      console.warn('[AI] GROQ_API_KEY not configured, falling back to Ollama.');
      return ollamaLLM(system, user, maxTokens);
    }
    throw new AIProviderError('GROQ_API_KEY is not configured in .env', 'config');
  }

  const baseUrl = (process.env.GROQ_BASE_URL || GROQ_BASE_URL).replace(/\/$/, '');
  const model = process.env.GROQ_MODEL || GROQ_MODEL;
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: user });

  let r;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    r = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.2
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
  } catch (e) {
    if (fallbackOnQuota) {
      console.warn('[AI] Groq connection failed, falling back to Ollama:', e.message);
      return ollamaLLM(system, user, maxTokens);
    }
    friendlyError(e, 'groq');
  }

  if (r.status === 429) {
    if (fallbackOnQuota) {
      console.warn('[AI] Groq 429 rate limit reached, falling back to local Ollama.');
      return ollamaLLM(system, user, maxTokens);
    }
    friendlyError(new Error('429 Too Many Requests'), 'groq');
  }

  if (!r.ok) {
    const body = await r.text().catch(() => '');
    if (fallbackOnQuota) {
      console.warn(`[AI] Groq failed (${r.status}), falling back to Ollama.`);
      return ollamaLLM(system, user, maxTokens);
    }
    friendlyError(new Error(`${r.status} ${r.statusText}: ${body}`), 'groq');
  }

  const d = await r.json().catch(() => ({}));
  const text = d?.choices?.[0]?.message?.content ?? '';
  if (!text.trim()) {
    if (fallbackOnQuota) return ollamaLLM(system, user, maxTokens);
    throw new AIProviderError('Groq returned an empty response.', 'empty');
  }
  return { text: text.trim(), model: `groq:${model}` };
}

// ─── Gemini provider (Legacy / Optional) ───────────────────────────────────

let _genaiModule = null;
async function getGenAI() {
  if (!process.env.GEMINI_API_KEY) {
    throw new AIProviderError(
      'GEMINI_API_KEY is not configured. Add it to .env to use Gemini.',
      'config'
    );
  }
  if (!_genaiModule) {
    try {
      _genaiModule = await import('@google/genai');
    } catch {
      throw new AIProviderError(
        'The @google/genai package is not installed. Run: npm install @google/genai',
        'config'
      );
    }
  }
  const { GoogleGenAI } = _genaiModule;
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

/**
 * Call Gemini generateContent using official Google Gen AI SDK.
 * @param {string} system
 * @param {string} user
 * @param {number} maxTokens
 * @returns {Promise<{text:string, model:string}>}
 */
export async function geminiLLM(system, user, maxTokens = 1200) {
  let aiClient;
  try {
    aiClient = await getGenAI();
  } catch (e) {
    if (e instanceof AIProviderError) throw e;
    friendlyError(e, 'gemini');
  }

  try {
    const config = { maxOutputTokens: maxTokens };
    if (system) config.systemInstruction = system;

    const response = await aiClient.models.generateContent({
      model: process.env.GEMINI_MODEL || GEMINI_MODEL,
      contents: user,
      config,
    });

    const text = response?.text || '';
    if (!text.trim()) {
      throw new AIProviderError('Gemini returned an empty response.', 'empty');
    }
    return { text: text.trim(), model: process.env.GEMINI_MODEL || GEMINI_MODEL };
  } catch (e) {
    const msg = String(e?.message || '');
    if (/429|quota|resource.?exhausted/i.test(msg)) {
      console.warn('[AI] Gemini 429 quota exhausted! Seamlessly falling back to local Ollama.');
      return ollamaLLM(system, user, maxTokens);
    }
    if (e instanceof AIProviderError) throw e;
    friendlyError(e, 'gemini');
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Generic LLM call. Routes to Ollama (primary), Groq (cloud), or Gemini based on AI_PROVIDER.
 * Automatically falls back to Ollama if cloud providers hit 429 quota limits.
 *
 * @param {{system?:string, user:string, maxTokens?:number, provider?:string}} opts
 * @returns {Promise<{text:string, model:string}>}
 */
export async function llm({ system = '', user, maxTokens = 1200, provider }) {
  if (!user || !String(user).trim()) {
    throw new AIProviderError('AI user prompt is empty.', 'config');
  }
  const activeProvider = (provider || process.env.AI_PROVIDER || AI_PROVIDER).toLowerCase().trim();

  if (activeProvider === 'groq') {
    return groqLLM(String(system), String(user), maxTokens, true);
  }
  if (activeProvider === 'gemini') {
    return geminiLLM(String(system), String(user), maxTokens);
  }
  // Default: Ollama (Primary)
  return ollamaLLM(String(system), String(user), maxTokens);
}

/**
 * Single-turn AI call with a plain prompt.
 * @param {string} prompt
 * @returns {Promise<{text:string, model:string}>}
 */
export async function ai(prompt) {
  return llm({ system: '', user: String(prompt || ''), maxTokens: 700 });
}

/**
 * Test a specific provider connection.
 * @param {'ollama'|'groq'|'gemini'} targetProvider
 * @returns {Promise<{ok:boolean, provider:string, model:string, error?:string}>}
 */
export async function testProvider(targetProvider) {
  const p = (targetProvider || process.env.AI_PROVIDER || AI_PROVIDER).toLowerCase().trim();
  if (p === 'groq') {
    const model = process.env.GROQ_MODEL || GROQ_MODEL;
    try {
      const res = await groqLLM('', 'Respond with OK', 10, false);
      return { ok: true, provider: 'groq', model: res.model };
    } catch (e) {
      return { ok: false, provider: 'groq', model: `groq:${model}`, error: e?.message || String(e) };
    }
  }
  if (p === 'gemini') {
    const model = process.env.GEMINI_MODEL || GEMINI_MODEL;
    try {
      const res = await geminiLLM('', 'Respond with OK', 10);
      return { ok: true, provider: 'gemini', model: res.model };
    } catch (e) {
      return { ok: false, provider: 'gemini', model, error: e?.message || String(e) };
    }
  }
  // Default: ollama
  const model = process.env.OLLAMA_MODEL || OLLAMA_MODEL;
  try {
    const res = await ollamaLLM('', 'Respond with OK', 10);
    return { ok: true, provider: 'ollama', model: res.model };
  } catch (e) {
    return { ok: false, provider: 'ollama', model: `ollama:${model}`, error: e?.message || String(e) };
  }
}

/**
 * Test the active provider connection.
 * @returns {Promise<{ok:boolean, provider:string, model:string, error?:string}>}
 */
export async function testConnection() {
  const provider = (process.env.AI_PROVIDER || AI_PROVIDER).toLowerCase().trim();
  return testProvider(provider);
}

/**
 * List available Ollama models (returns empty array when Ollama is unreachable).
 * @returns {Promise<string[]>}
 */
export async function listOllamaModels() {
  const activeBaseUrl = (process.env.OLLAMA_BASE_URL || OLLAMA_BASE_URL).replace(/\/$/, '');
  try {
    const r = await fetch(`${activeBaseUrl}/api/tags`);
    if (!r.ok) return [];
    const d = await r.json();
    return (d?.models || []).map(m => m.name || m.model || '').filter(Boolean);
  } catch {
    return [];
  }
}

