import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isCodingRequest, generateProgram, buildCodingPlan } from "./lib/coding-agent.mjs";
import { isEmailRequest, isGmailConnectRequest, isGmailDisconnectRequest, parseEmailRequest, gmailQuery, composeBriefLocal, EMAIL_BRIEF_SYSTEM } from "./lib/email-intent.mjs";
import { isWebResearchRequest, isFollowUpRequest, synthesizeResearch, synthesizeGoogleSearchAnswer } from "./lib/web-research-agent.mjs";
import { isYouTubeRequest, analyzeYouTubeVideo } from "./lib/youtube-agent.mjs";
import { isPhoneCallRequest, planPhoneCall, getPhoneLinkStatus, searchPhoneContacts, dialPhoneCall } from "./lib/phone-link-agent.mjs";
import { fetchCleanWebpage } from "./lib/web-extractor.mjs";
import { llm, ai, testConnection, testProvider, listOllamaModels, AI_PROVIDER, GEMINI_MODEL, OLLAMA_MODEL, GROQ_MODEL, AIProviderError } from "./lib/ai-provider.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const PORT   = Number(process.env.PORT || 8080);
const HOST   = process.env.HOST || "0.0.0.0";
const NEWS_API_KEY = process.env.NEWS_API_KEY || "";
const LAT    = Number(process.env.WEATHER_LAT  || 17.385);
const LON    = Number(process.env.WEATHER_LON  || 78.4867);
const CITY   = process.env.WEATHER_CITY || "HYDERABAD, IN";

let lastCpu  = process.cpuUsage();
let lastTime = process.hrtime.bigint();
let apiCalls = 0;

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
function cpuPercent() {
  const now = process.hrtime.bigint();
  const elapsed = Number(now - lastTime) / 1000;
  const u = process.cpuUsage(lastCpu);
  lastCpu  = process.cpuUsage();
  lastTime = now;
  return clamp(Math.round(((u.user + u.system) / Math.max(1, elapsed) / Math.max(1, os.cpus().length)) * 100), 0, 100);
}
function memoryPercent() { return Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100); }
function readTemp() {
  for (const f of ["/sys/class/thermal/thermal_zone0/temp", "/sys/class/hwmon/hwmon0/temp1_input"]) {
    try { const n = Number(fs.readFileSync(f, "utf8").trim()); if (Number.isFinite(n)) return Math.round(n > 1000 ? n / 1000 : n); } catch {}
  }
  return 0;
}
async function jsonFetch(url, options = {}) {
  const r = await fetch(url, options);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}
function send(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": process.env.CORS_ORIGIN || "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

async function weather() {
  const d = await jsonFetch(`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&wind_speed_unit=kmh`);
  const c = d.current;
  const codes = { 0:"Clear Skies",1:"Mainly Clear",2:"Partly Cloudy",3:"Overcast",45:"Fog",48:"Rime Fog",51:"Light Drizzle",53:"Drizzle",55:"Heavy Drizzle",61:"Light Rain",63:"Rain",65:"Heavy Rain",71:"Light Snow",73:"Snow",75:"Heavy Snow",80:"Rain Showers",81:"Rain Showers",82:"Heavy Rain Showers",95:"Thunderstorm",96:"Thunderstorm",99:"Thunderstorm" };
  return { temp: Math.round(c.temperature_2m), desc: codes[c.weather_code] || "Current Conditions", city: CITY, wind: Math.round(c.wind_speed_10m), humidity: Math.round(c.relative_humidity_2m) };
}
function mapNewsArticles(articles = []) { return articles.map(a => ({ tag: (a.source?.name || "NEWS").toUpperCase().slice(0, 14), title: a.title, source: a.source?.name, url: a.url, publishedAt: a.publishedAt })); }
async function news() {
  if (!NEWS_API_KEY) return [{ tag: "SYSTEM", title: "Live news is not configured. Add NEWS_API_KEY to .env.", source: "NEURAOS" }];
  const d = await jsonFetch(`https://gnews.io/api/v4/top-headlines?lang=en&max=10&apikey=${encodeURIComponent(NEWS_API_KEY)}`);
  return mapNewsArticles(d.articles || []);
}
async function topicNews(question) {
  if (!NEWS_API_KEY) return news();
  const q = String(question || "").toLowerCase();
  let search = "";
  if (/\biran\b/.test(q) && /\bisrael\b/.test(q)) search = "Iran Israel";
  else if (/\bindia\b/.test(q)) search = "India";
  if (!search) return news();
  const d = await jsonFetch(`https://gnews.io/api/v4/search?q=${encodeURIComponent(search)}&lang=en&max=10&sortby=publishedAt&apikey=${encodeURIComponent(NEWS_API_KEY)}`);
  return mapNewsArticles(d.articles || []);
}

// ── Voice: transcription (local Whisper, unchanged) ──────────────────────────
async function transcribeAudio(base64, mimeType = "audio/webm", requestedModel = "") {
  const bytes = Buffer.from(String(base64 || ""), "base64");
  if (!bytes.length) throw new Error("No audio was received.");
  if (process.platform !== "win32") throw new Error("Local Whisper is currently configured for Windows.");
  const pythonCandidates = [
    process.env.VOICE_PYTHON,
    path.join(root, ".voice-venv", "Scripts", "python.exe"),
    "python",
  ].filter(Boolean);
  const scriptPath = path.join(root, "voice", "transcribe.py");
  const tempPath   = path.join(os.tmpdir(), `neuraos-${Date.now()}-${Math.random().toString(16).slice(2)}.webm`);
  fs.writeFileSync(tempPath, bytes);
  const allowedModels = new Set(["tiny.en", "base.en", "small.en", "medium.en"]);
  const model = allowedModels.has(String(requestedModel || "")) ? String(requestedModel) : (process.env.LOCAL_WHISPER_MODEL || "base.en");
  let lastError = "Local Whisper is not installed. Run voice\\setup.ps1 first.";
  try {
    for (const python of pythonCandidates) {
      try {
        const result = await new Promise((resolve, reject) => {
          const child = spawn(python, [scriptPath, tempPath, model], { windowsHide: true, env: { ...process.env, PYTHONUTF8: "1" } });
          let stdout = "", stderr = "";
          child.stdout.on("data", d => stdout += d.toString());
          child.stderr.on("data", d => stderr += d.toString());
          child.on("error", reject);
          child.on("close", code => {
            if (code !== 0) return reject(new Error(stderr.trim() || stdout.trim() || `Whisper process exited with code ${code}`));
            try { resolve(JSON.parse(stdout.trim())); } catch { reject(new Error(stdout.trim() || "Invalid Whisper response.")); }
          });
        });
        return { text: result?.text || "" };
      } catch (e) { lastError = e?.message || String(e); }
    }
    throw new Error(`${lastError}. Run voice\\setup.ps1 and restart NeuraOS.`);
  } finally {
    try { fs.unlinkSync(tempPath); } catch {}
  }
}

// ── Voice: TTS (local Windows SAPI via Electron; server-side is no-op) ───────
// Electron's voice:speak IPC calls localWindowsSpeak() directly and only falls
// back to /api/voice/speak when that fails. Since OpenAI TTS is removed and no
// free server-side TTS alternative is bundled here, the endpoint returns a clear
// error so Electron can fall through to its local Windows speech synth.
async function speak(_text) {
  throw new Error("Server-side TTS is not configured. NeuraOS uses Windows speech synthesis locally.");
}

// ── News answer via AI ────────────────────────────────────────────────────────
async function newsAnswer(question) {
  const items = await topicNews(question);
  const context = items.map((n, i) => `${i + 1}. ${n.title} | ${n.source || "Unknown source"} | ${n.publishedAt || ""} | ${n.url || ""}`).join("\n");
  const prompt  = `You are NeuraOS World Intelligence. Answer the user's news question using ONLY the current headlines supplied below. Be concise and factual. If the feed does not contain enough information, say so instead of inventing details. Mention the source names when useful.\n\nUSER QUESTION: ${question}\n\nCURRENT WORLD INTELLIGENCE FEED:\n${context}`;
  try {
    const result = await ai(prompt);
    return { text: result.text, items };
  } catch (e) {
    // Degrade gracefully: return headline list without AI synthesis
    const text = items.slice(0, 5).map((n, i) => `${i + 1}. ${n.title}`).join(" ");
    return { text: text || "No news available.", items, warning: e?.message };
  }
}

// ── Agent planner ─────────────────────────────────────────────────────────────
const APP_NAMES = { camera:'camera', calculator:'calculator', calc:'calculator', notepad:'notepad', 'file explorer':'file explorer', files:'file explorer', explorer:'file explorer', settings:'settings', chrome:'chrome', 'google chrome':'chrome', edge:'edge', 'microsoft edge':'edge', 'vs code':'visual studio code', 'visual studio code':'visual studio code', visual_studio_code:'visual studio code', code:'visual studio code', spotify:'spotify', discord:'discord', whatsapp:'whatsapp' };
const PLAN_SYSTEM = `You are the NeuraOS orchestration planner for a Windows desktop AI assistant. Return ONLY valid JSON with this shape: {"agent":"browser|coding|email|youtube|system","announcement":"one short sentence Neura can speak before execution","intent":"computer_task","summary":"...","actions":[...]}. Choose the specialist agent that should execute the request.

Allowed actions:
- open_application {application,args?}
- open_url {url}
- open_file {path}
- create_file {path,content}
- write_file {path,content}
- type_text {text}
- press_key {key}
- hotkey {keys}
- copy {text}
- paste {}
- wait {ms}
- search_web {query}
- browser_search {query,engine?}
- browser_open {url}
- browser_click_text {text}
- browser_read {}
- run_program {program,args?,cwd?,timeoutMs?}

BROWSER AGENT RULES: For browser tasks, use browser_search/browser_open rather than merely telling the user how to search. For "search X", use browser_search with the exact query. For a multi-step browser request, use browser_open/browser_search followed by browser_click_text when a specific visible link/button should be clicked. The browser agent operates a real Chrome instance using Chrome DevTools Protocol.

EMAIL AGENT RULES: If the user asks about email, Gmail, latest email, recent email, inbox, or asks you to read an email, NEVER use a generic browser search. Use the email_recent action. It must open Gmail, open the newest inbox message, and read its subject/body preview. Announce: "Email Agent is opening your recent email."

YOUTUBE ANALYSIS AGENT RULES: If the user asks for YouTube Studio, channel views, channel analytics, subscribers, or overall channel performance, NEVER use a generic web search. Use youtube_channel_analytics. It must open YouTube Studio and read the visible analytics. Announce: "YouTube Analysis Agent is opening YouTube Studio."

CODING AGENT RULES: Code generation is handled by a dedicated Coding Agent before this planner is called. Do not write programs here.

SYSTEM/FILE RULES: Prefer safe direct actions. Do not emit delete_file or system_command. Never request destructive actions. For normal app launching use open_application. Use a concise announcement such as "Browser Agent is opening the browser." or "Coding Agent is opening VS Code."`;

function fallbackPlan(command) {
  const c = String(command).trim(), l = c.toLowerCase(), actions = [];
  const isBrowser = /\b(browser|chrome|google|search|youtube|website|web page|webpage|internet)\b/i.test(c);
  const appMatch  = Object.keys(APP_NAMES).sort((a, b) => b.length - a.length).find(a => new RegExp(`\\bopen\\s+${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(l));
  const isYouTube = /\b(youtube studio|channel views|youtube analytics|channel analytics|overall views|subscribers on youtube|youtube channel)\b/i.test(c);
  if (isYouTube) { actions.push({ type: 'youtube_channel_analytics' }); return { agent:'youtube', intent:'computer_task', summary:c, announcement:'YouTube Analysis Agent is opening YouTube Studio.', actions }; }
  if (isBrowser) {
    const search = c.match(/\b(?:search(?:\s+(?:for|on\s+google|on\s+youtube))?|google\s+for|look\s+up)\s+(.+)/i);
    if (search) { const q = search[1].replace(/\s+(?:in|on)\s+(?:chrome|google|the browser)\s*$/i, '').trim(); actions.push({ type:'browser_search', query:q, engine:/youtube/i.test(c)?'youtube':'google' }); }
    else if (appMatch && /chrome|edge|browser/i.test(appMatch)) actions.push({ type:'open_application', application:APP_NAMES[appMatch] });
    else actions.push({ type:'browser_open', url:'https://www.google.com' });
    return { agent:'browser', intent:'computer_task', summary:c, announcement:'Browser Agent is opening the browser.', actions };
  }
  if (appMatch) actions.push({ type:'open_application', application:APP_NAMES[appMatch] });
  if (!actions.length) actions.push({ type:'open_url', url:`https://www.google.com/search?q=${encodeURIComponent(c)}` });
  return { agent:'general', intent:'computer_task', summary:c, announcement:'Neura Agent is working on that task.', actions };
}

const PLAN_ACTIONS = new Set([
  'open_application','open_url','open_file','create_file','write_file',
  'type_text','press_key','hotkey','copy','paste','wait',
  'search_web','browser_search','browser_open','browser_click_text','browser_read','browser_read_first_lines',
  'email_recent','email_read','gmail_connect','gmail_disconnect',
  'youtube_channel_analytics','youtube_open_account','youtube_analyze_video',
  'web_research_execute','open_and_read_news','run_program',
  'phone_call'
]);
const CODING_WORKSPACE = path.join(os.homedir(), 'Documents', 'NeuraOS');

async function routeSpecialist(command) {
  const c = String(command || '').trim();

  // 1) iPhone Calling via Windows Phone Link
  if (isPhoneCallRequest(c).isCall) {
    return await planPhoneCall(c);
  }

  // 2) Gmail routing
  if (isGmailConnectRequest(c))    return { agent:'email', intent:'computer_task', summary:c, announcement:'Email Agent is connecting to Gmail.',    actions:[{ type:'gmail_connect' }] };
  if (isGmailDisconnectRequest(c)) return { agent:'email', intent:'computer_task', summary:c, announcement:'Email Agent is disconnecting Gmail.', actions:[{ type:'gmail_disconnect' }] };
  if (isEmailRequest(c)) {
    const req = parseEmailRequest(c);
    return { agent:'email', intent:'computer_task', summary:c, announcement:'Email Agent is checking your Gmail.', actions:[{ type:'email_read', count:req.count, query:gmailQuery(req), request:req }] };
  }

  // 2) Coding Agent
  if (isCodingRequest(c)) {
    const gen = await generateProgram(c, llm);
    return buildCodingPlan(c, gen, CODING_WORKSPACE);
  }

  // 3) YouTube Analysis Agent (enforcing salikkamal2007@gmail.com)
  if (isYouTubeRequest(c)) {
    const isChannelAnalytics = /\b(channel views|youtube analytics|channel analytics|overall views|subscribers on youtube|youtube studio)\b/i.test(c);
    if (isChannelAnalytics) {
      return {
        agent: 'youtube',
        intent: 'computer_task',
        summary: c,
        announcement: 'YouTube Analysis Agent is opening YouTube Studio on salikkamal2007@gmail.com.',
        actions: [{ type: 'youtube_channel_analytics' }]
      };
    }
    const isVideoAnalysis = /\b(analyze|summarize|transcript|captions?|explain\s+this\s+video)\b/i.test(c) || /youtu\.be\/|watch\?v=/.test(c);
    if (isVideoAnalysis) {
      return {
        agent: 'youtube',
        intent: 'computer_task',
        summary: c,
        announcement: 'YouTube Analysis Agent is analyzing video content.',
        actions: [{ type: 'youtube_analyze_video', command: c }]
      };
    }
    // General YouTube open
    return {
      agent: 'youtube',
      intent: 'computer_task',
      summary: c,
      announcement: 'YouTube Analysis Agent is opening YouTube with your account.',
      actions: [{ type: 'youtube_open_account' }]
    };
  }

  // 4) Web Research & Real-time News Agent (Google Search: First-Sentence Answer Mode)
  if (isWebResearchRequest(c)) {
    return {
      agent: 'browser',
      intent: 'computer_task',
      summary: c,
      announcement: '',
      actions: [{ type: 'web_research_execute', command: c }]
    };
  }

  return null;
}

async function planAgent(command) {
  const specialist = await routeSpecialist(command);
  if (specialist) return specialist;

  // Use AI planner
  try {
    const result = await llm({
      system: PLAN_SYSTEM,
      user: String(command),
      maxTokens: 2200,
    });
    let parsed;
    try {
      parsed = JSON.parse(result.text.replace(/^```json\s*|\s*```$/g, ''));
      if (!Array.isArray(parsed.actions)) throw new Error('No actions');
    } catch {
      return fallbackPlan(command);
    }
    // Sanitise unknown action types
    const unknown = parsed.actions.filter(a => !a || !PLAN_ACTIONS.has(a.type));
    if (unknown.length) {
      const codeLike = unknown.some(a => /cod|program|script|generate|java|python/i.test(String(a?.type))) || /\b(java|python|javascript|program|code|algorithm)\b/i.test(command);
      if (codeLike) { const gen = await generateProgram(command, llm); return buildCodingPlan(command, gen, CODING_WORKSPACE); }
      parsed.actions = parsed.actions.filter(a => a && PLAN_ACTIONS.has(a.type));
      if (!parsed.actions.length) return fallbackPlan(command);
    }
    return parsed;
  } catch (e) {
    if (e instanceof AIProviderError) throw e;   // surface real AI errors
    return fallbackPlan(command);
  }
}

// ── Email brief ───────────────────────────────────────────────────────────────
async function emailBrief(messages, request, unreadCount) {
  const msgs = (Array.isArray(messages) ? messages : []).slice(0, 10).map(m => ({
    id:          String(m.id || ""),
    fromName:    String(m.fromName || ""),
    fromEmail:   String(m.fromEmail || ""),
    subject:     String(m.subject || ""),
    date:        String(m.date || ""),
    dateText:    String(m.dateText || "").slice(0, 80),
    snippet:     String(m.snippet || "").slice(0, 300),
    body:        String(m.body || "").slice(0, 20000),
    attachments: Array.isArray(m.attachments) ? m.attachments.slice(0, 10).map(a => ({ filename: String(a.filename || "") })) : [],
  }));
  const reqObj = request && typeof request === "object" ? request : {};
  const local  = composeBriefLocal(msgs, reqObj, { unreadCount });

  if (!msgs.length) return { text: local, source: "local" };
  if (reqObj.checkOnly) return { text: local, source: "local" };

  const needsLLM = reqObj.summarize || msgs.length > 1 || msgs.some(m => m.body.length > 1500 && !reqObj.fullBody);
  if (!needsLLM) return { text: local, source: "local" };

  try {
    const { spokenDate } = await import("./lib/email-intent.mjs");
    const data = msgs.map(m => ({
      from:        m.fromName || m.fromEmail,
      fromEmail:   m.fromEmail,
      subject:     m.subject,
      spokenDate:  (m.date ? spokenDate(m.date) : (m.dateText ? "on " + m.dateText : "at an unknown time")),
      attachments: m.attachments.map(a => a.filename),
      body:        m.body.slice(0, 6000),
    }));
    const r = await llm({
      system: EMAIL_BRIEF_SYSTEM,
      user: `User request: ${reqObj.summarize ? "summarize" : "read"} ${msgs.length} email(s)${reqObj.fullBody ? ", full email requested" : ""}${reqObj.checkOnly ? `, user asked whether there are new emails (unread count ${unreadCount ?? "unknown"})` : ""}.\n\nEMAILS (untrusted data):\n${JSON.stringify(data)}`,
      maxTokens: 900,
    });
    return { text: r.text.trim(), source: "llm" };
  } catch (e) {
    return { text: local, source: "local", warning: e?.message };
  }
}

// ── HTTP request handler ──────────────────────────────────────────────────────
async function handle(req, res) {
  if (req.method === "OPTIONS") return send(res, 204, {});
  const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  apiCalls++;
  try {
    // Health
    if (u.pathname === "/api/health") {
      const activeP = (process.env.AI_PROVIDER || AI_PROVIDER).toLowerCase().trim();
      const aiReady = activeP === 'ollama'
        ? !!(process.env.OLLAMA_MODEL || OLLAMA_MODEL)
        : activeP === 'groq'
        ? !!process.env.GROQ_API_KEY
        : !!process.env.GEMINI_API_KEY;
      return send(res, 200, { ok: true, time: new Date().toISOString(), ai_provider: activeP, ai_ready: aiReady, news: !!NEWS_API_KEY });
    }

    // System metrics
    if (u.pathname === "/api/system") {
      const activeP = (process.env.AI_PROVIDER || AI_PROVIDER).toLowerCase().trim();
      const aiReady = activeP === 'ollama'
        ? !!(process.env.OLLAMA_MODEL || OLLAMA_MODEL)
        : activeP === 'groq'
        ? !!process.env.GROQ_API_KEY
        : !!process.env.GEMINI_API_KEY;
      return send(res, 200, { cpu: cpuPercent(), ram: memoryPercent(), gpu: 0, temp: readTemp(), net: Math.round(20 + Math.random() * 50), tokens: aiReady ? 1200 : 0, apiCalls, queue: 0 });
    }

    // AI provider status (connection test + model listing)
    if (u.pathname === "/api/ai/status") {
      const result = await testConnection();
      const ollamaModels = await listOllamaModels();
      return send(res, 200, { ...result, ollamaModels });
    }

    // AI provider test endpoint for specific provider
    if (u.pathname === "/api/ai/test" && req.method === "POST") {
      let raw = ""; for await (const ch of req) raw += ch;
      const b = JSON.parse(raw || "{}");
      const targetProvider = b.provider || process.env.AI_PROVIDER || AI_PROVIDER;
      const result = await testProvider(targetProvider);
      return send(res, 200, result);
    }

    // AI provider switch setting
    if (u.pathname === "/api/ai/provider" && req.method === "POST") {
      let raw = ""; for await (const ch of req) raw += ch;
      const b = JSON.parse(raw || "{}");
      if (b.provider) {
        process.env.AI_PROVIDER = String(b.provider).toLowerCase().trim();
      }
      if (b.model) {
        if (process.env.AI_PROVIDER === "ollama") {
          process.env.OLLAMA_MODEL = String(b.model);
        } else if (process.env.AI_PROVIDER === "groq") {
          process.env.GROQ_MODEL = String(b.model);
        } else {
          process.env.GEMINI_MODEL = String(b.model);
        }
      }
      const model = process.env.AI_PROVIDER === "ollama"
        ? (process.env.OLLAMA_MODEL || OLLAMA_MODEL)
        : process.env.AI_PROVIDER === "groq"
        ? (process.env.GROQ_MODEL || GROQ_MODEL)
        : (process.env.GEMINI_MODEL || GEMINI_MODEL);
      return send(res, 200, { ok: true, provider: process.env.AI_PROVIDER, model });
    }

    if (u.pathname === "/api/weather")  return send(res, 200, await weather());
    if (u.pathname === "/api/news")     return send(res, 200, await news());

    if (u.pathname === "/api/voice/transcribe" && req.method === "POST") {
      let raw = ""; for await (const ch of req) raw += ch;
      const b = JSON.parse(raw || "{}");
      return send(res, 200, await transcribeAudio(b.audio, b.mimeType || "audio/webm", b.model || ""));
    }

    if (u.pathname === "/api/voice/speak" && req.method === "POST") {
      // Electron falls back to Windows SAPI; this endpoint is intentionally unavailable.
      return send(res, 503, { error: "Server-side TTS is not available. NeuraOS uses Windows speech synthesis (speakLocal)." });
    }

    if (u.pathname === "/api/news/answer" && req.method === "POST") {
      let raw = ""; for await (const ch of req) raw += ch;
      const b = JSON.parse(raw || "{}");
      if (!b.question) return send(res, 400, { error: "question is required" });
      return send(res, 200, await newsAnswer(String(b.question)));
    }

    if (u.pathname === "/api/agent/plan" && req.method === "POST") {
      let raw = ""; for await (const ch of req) raw += ch;
      const b = JSON.parse(raw || "{}");
      if (!b.command) return send(res, 400, { error: "command is required" });
      return send(res, 200, await planAgent(String(b.command)));
    }

    if (u.pathname === "/api/email/brief" && req.method === "POST") {
      let raw = ""; for await (const ch of req) raw += ch;
      const b = JSON.parse(raw || "{}");
      return send(res, 200, await emailBrief(b.messages, b.request, b.unreadCount));
    }

    // Web Research direct API endpoint
    if (u.pathname === "/api/research/synthesize" && req.method === "POST") {
      let raw = ""; for await (const ch of req) raw += ch;
      const b = JSON.parse(raw || "{}");
      const resData = await synthesizeResearch(b.question, b.context || {});
      return send(res, 200, resData);
    }

    // Google search page direct answer endpoint (Google-only, no external link navigation)
    if (u.pathname === "/api/research/google-answer" && req.method === "POST") {
      let raw = ""; for await (const ch of req) raw += ch;
      const b = JSON.parse(raw || "{}");
      const answer = await synthesizeGoogleSearchAnswer(b.question, b.content || "");
      return send(res, 200, answer);
    }

    // Webpage clean extraction endpoint
    if (u.pathname === "/api/research/extract" && req.method === "POST") {
      let raw = ""; for await (const ch of req) raw += ch;
      const b = JSON.parse(raw || "{}");
      if (!b.url) return send(res, 400, { error: "url is required" });
      const extracted = await fetchCleanWebpage(b.url);
      return send(res, 200, extracted);
    }

    // YouTube video analysis endpoint
    if (u.pathname === "/api/youtube/analyze" && req.method === "POST") {
      let raw = ""; for await (const ch of req) raw += ch;
      const b = JSON.parse(raw || "{}");
      if (!b.videoId && !b.url) return send(res, 400, { error: "videoId or url is required" });
      const analysis = await analyzeYouTubeVideo(b.videoId || b.url, b.question || "");
      return send(res, 200, analysis);
    }

    // Phone Link status endpoint
    if (u.pathname === "/api/phone/status" && (req.method === "GET" || req.method === "POST")) {
      const status = await getPhoneLinkStatus();
      return send(res, 200, status);
    }

    // Phone Link contact search endpoint
    if (u.pathname === "/api/phone/search" && req.method === "POST") {
      let raw = ""; for await (const ch of req) raw += ch;
      const b = JSON.parse(raw || "{}");
      const searchRes = await searchPhoneContacts(b.query || "");
      return send(res, 200, searchRes);
    }

    // Phone Link dial endpoint
    if (u.pathname === "/api/phone/dial" && req.method === "POST") {
      let raw = ""; for await (const ch of req) raw += ch;
      const b = JSON.parse(raw || "{}");
      if (!b.phoneNumber) return send(res, 400, { error: "phoneNumber is required" });
      const dialRes = await dialPhoneCall(b.phoneNumber, b.contactName || "");
      return send(res, 200, dialRes);
    }

    if (u.pathname === "/api/ai" && req.method === "POST") {
      let raw = ""; for await (const ch of req) raw += ch;
      const b = JSON.parse(raw || "{}");
      if (!b.prompt) return send(res, 400, { error: "prompt is required" });
      return send(res, 200, await ai(String(b.prompt)));
    }

    return send(res, 404, { error: "Not found" });
  } catch (e) {
    // Surface provider-specific errors with useful messages
    const status = e instanceof AIProviderError ? 502 : 502;
    return send(res, status, { error: e?.message || "Upstream service unavailable" });
  }
}

// ── Static file serving ───────────────────────────────────────────────────────
const mime = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".svg":"image/svg+xml", ".png":"image/png", ".jpg":"image/jpeg", ".ico":"image/x-icon", ".json":"application/json" };
function serveStatic(req, res) {
  const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  let file = u.pathname === "/" ? "dist/index.html" : `dist${u.pathname}`;
  const target = path.resolve(root, file);
  if (!target.startsWith(path.resolve(root, "dist"))) return send(res, 403, { error: "Forbidden" });
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) file = "dist/index.html";
  const finalTarget = path.resolve(root, file);
  res.writeHead(200, { "Content-Type": mime[path.extname(finalTarget)] || "application/octet-stream" });
  fs.createReadStream(finalTarget).pipe(res);
}

http.createServer((req, res) => {
  const p = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;
  if (p.startsWith("/api/")) handle(req, res);
  else if (process.env.SERVE_DIST === "true") serveStatic(req, res);
  else send(res, 404, { error: "Run Vite for the frontend or set SERVE_DIST=true" });
}).listen(PORT, HOST, () => console.log(`NeuraOS API listening on ${HOST}:${PORT} [AI: ${AI_PROVIDER}]`));
