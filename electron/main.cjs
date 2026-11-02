const { app, BrowserWindow, ipcMain, shell, clipboard, session, safeStorage } = require('electron');
const { createGmailService, createSafeStorageTokenStore, GmailError } = require('./gmail.cjs');
const { createGmailBrowserReader, gmailUiQuery } = require('./gmail-browser.cjs');
const { spawn, execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');

let mainWindow;
let apiProcess;
let cancelled = false;
const isWin = process.platform === 'win32';

function envFile() {
  const candidates = [path.join(process.cwd(), '.env'), path.join(__dirname, '..', '.env')];
  for (const file of candidates) if (fs.existsSync(file)) return file;
  return null;
}
function loadDotEnv() {
  const file = envFile();
  if (!file) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
loadDotEnv();

function startApi() {
  const server = path.join(__dirname, '..', 'server', 'server.mjs');
  apiProcess = spawn(process.execPath, [server], { cwd: path.join(__dirname, '..'), env: { ...process.env, SERVE_DIST: 'true', HOST: '127.0.0.1', PORT: '8080' }, stdio: 'inherit' });
}
function waitForApi(timeout = 12000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const ping = () => {
      const req = http.get('http://127.0.0.1:8080/api/health', res => { res.resume(); if (res.statusCode === 200) return resolve(); setTimeout(ping, 200); });
      req.on('error', () => { if (Date.now() - started > timeout) reject(new Error('NeuraOS backend did not start.')); else setTimeout(ping, 200); });
      req.setTimeout(800, () => req.destroy());
    };
    ping();
  });
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1100, minHeight: 700,
    backgroundColor: '#02060b', title: 'NeuraOS',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false }
  });
  mainWindow.loadURL('http://127.0.0.1:8080');
}

const APP_ALIASES = {
  camera: 'microsoft.windows.camera:', calculator: 'calc.exe', calc: 'calc.exe', notepad: 'notepad.exe',
  'file explorer': 'explorer.exe', files: 'explorer.exe', explorer: 'explorer.exe', settings: 'ms-settings:',
  chrome: 'chrome.exe', 'google chrome': 'chrome.exe', edge: 'msedge.exe', 'microsoft edge': 'msedge.exe',
  'vs code': 'code.exe', 'visual studio code': 'code.exe', 'visual_studio_code': 'code.exe', code: 'code.exe', spotify: 'spotify.exe', discord: 'discord.exe',
  whatsapp: 'whatsapp.exe', 'phone link': 'ms-phone:', 'phone': 'ms-phone:', 'your phone': 'ms-phone:'
};
const SAFE_ACTIONS = new Set([
  'open_application','open_url','open_file','create_file','write_file',
  'type_text','press_key','hotkey','copy','paste','wait',
  'search_web','browser_search','browser_open','browser_click_text','browser_read','browser_read_first_lines',
  'email_recent','email_read','gmail_connect','gmail_disconnect',
  'youtube_channel_analytics','youtube_open_account','youtube_analyze_video',
  'web_research_execute','open_and_read_news','run_program',
  'phone_call'
]);
const CONFIRM_ACTIONS = new Set(['run_program','delete_file','system_command']);

function normalizeApp(name='') { return APP_ALIASES[String(name).trim().toLowerCase()] || name; }
function powershell(script) {
  if (!isWin) throw new Error('Desktop control is supported on Windows only.');
  return execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command', script], { windowsHide: true, encoding: 'utf8' });
}
function resolveWindowsExecutable(target) {
  if (!isWin) return null;
  try {
    const found = execFileSync('where.exe', [target], { windowsHide: true, encoding: 'utf8' }).split(/\r?\n/).map(s => s.trim()).find(Boolean);
    if (found) return found;
  } catch {}

  const candidates = {
    'code.exe': [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
      path.join(process.env.ProgramFiles || '', 'Microsoft VS Code', 'Code.exe'),
      path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft VS Code', 'Code.exe')
    ],
    'chrome.exe': [
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
    ],
    'msedge.exe': [
      path.join(process.env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    ],
    'spotify.exe': [
      path.join(process.env.APPDATA || '', 'Spotify', 'Spotify.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'Spotify.exe')
    ],
    'discord.exe': [
      path.join(process.env.LOCALAPPDATA || '', 'Discord', 'Update.exe')
    ],
    'whatsapp.exe': [
      path.join(process.env.LOCALAPPDATA || '', 'WhatsApp', 'WhatsApp.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'WhatsApp', 'current', 'WhatsApp.exe')
    ]
  };
  return (candidates[target] || []).find(p => p && fs.existsSync(p)) || null;
}

function launchApp(name, args=[]) {
  const target = normalizeApp(name);
  if (target.startsWith('ms-') || target.endsWith(':')) {
    shell.openExternal(target); return `Opened ${name}`;
  }
  if (!isWin) throw new Error('NeuraOS desktop mode requires Windows.');

  const executable = resolveWindowsExecutable(target);
  if (!executable) {
    throw new Error(`${name} is not installed or could not be located. If it is installed, add its executable to PATH or install the standard Windows version.`);
  }

  // Discord's Update.exe needs the --processStart argument instead of launching the updater alone.
  let launchTarget = executable;
  let launchArgs = args.slice();
  if (target === 'discord.exe' && /\bUpdate\.exe$/i.test(executable)) {
    launchArgs = ['--processStart', 'Discord.exe', ...launchArgs];
  }
  const psArgs = launchArgs.map(a => `'${String(a).replace(/'/g, "''")}'`).join(',');
  powershell(`Start-Process -FilePath '${launchTarget.replace(/'/g,"''")}'${launchArgs.length ? ` -ArgumentList ${psArgs}` : ''}`);
  return `Opened ${name}`;
}
function focusAndPaste(text) {
  clipboard.writeText(String(text));
  powershell(`$w=New-Object -ComObject WScript.Shell; Start-Sleep -Milliseconds 350; $w.SendKeys('^v')`);
}
function createFile(filePath, content='') {
  const full = path.resolve(filePath.replace(/^~(?=$|[\\/])/, os.homedir()));
  fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, content, 'utf8'); return full;
}


const BROWSER_PORT = 9222;
let browserWs = null;
let browserMessageId = 0;
const browserPending = new Map();

async function browserFetch(pathname, options={}) {
  const r = await fetch(`http://127.0.0.1:${BROWSER_PORT}${pathname}`, options);
  if (!r.ok) throw new Error(`Browser control HTTP ${r.status}`);
  return r.json();
}

function browserRpc(method, params={}) {
  if (!browserWs || browserWs.readyState !== 1) return Promise.reject(new Error('Browser Agent is not connected to Chrome.'));
  const id = ++browserMessageId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { browserPending.delete(id); reject(new Error(`Browser command timed out: ${method}`)); }, 12000);
    browserPending.set(id, {resolve, reject, timer});
    browserWs.send(JSON.stringify({id, method, params}));
  });
}

function getDedicatedYouTubeProfile() {
  const profileDir = path.join(app ? app.getPath('userData') : path.join(os.homedir(), 'AppData', 'Roaming', 'NeuraOS'), 'Chrome-YouTube-Profile');
  fs.mkdirSync(profileDir, { recursive: true });
  return profileDir;
}

async function ensureBrowser(forYouTube = false) {
  if (!isWin) throw new Error('Browser Agent currently requires Windows desktop mode.');
  try {
    await fetch(`http://127.0.0.1:${BROWSER_PORT}/json/version`);
  } catch {
    const chrome = resolveWindowsExecutable('chrome.exe');
    if (!chrome) throw new Error('Google Chrome was not found.');
    
    // For YouTube analysis, we specifically enforce the profile that contains salikkamal2007@gmail.com
    const profile = forYouTube ? getDedicatedYouTubeProfile() : path.join(os.tmpdir(), 'NeuraOS-Chrome-Agent');
    fs.mkdirSync(profile, { recursive: true });

    // Seed from temp agent profile if the dedicated profile is fresh
    if (forYouTube) {
      const seedSrc = path.join(os.tmpdir(), 'NeuraOS-Chrome-Agent');
      const targetState = path.join(profile, 'Local State');
      if (!fs.existsSync(targetState) && fs.existsSync(seedSrc)) {
        try {
          fs.cpSync(seedSrc, profile, { recursive: true });
        } catch {}
      }
    }

    const chromeArgs = [
      `--remote-debugging-port=${BROWSER_PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check'
    ];
    if (forYouTube) {
      chromeArgs.push('--profile-directory=Default');
    }
    chromeArgs.push('about:blank');

    spawn(chrome, chromeArgs, { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
    const started = Date.now();
    while (Date.now() - started < 10000) {
      try {
        await browserFetch('/json/version');
        break;
      } catch {
        await new Promise(r => setTimeout(r, 250));
      }
    }
  }

  const version = await browserFetch('/json/version');
  if (!version.webSocketDebuggerUrl) throw new Error('Chrome DevTools endpoint unavailable.');
  if (!browserWs || browserWs.readyState !== 1) {
    browserWs = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Could not connect to Chrome.')), 8000);
      browserWs.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      browserWs.addEventListener('error', e => { clearTimeout(timer); reject(e); }, { once: true });
    });
    browserWs.addEventListener('message', event => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.id && browserPending.has(msg.id)) {
          const p = browserPending.get(msg.id);
          browserPending.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.error) p.reject(new Error(msg.error.message || 'Browser command failed'));
          else p.resolve(msg.result);
        }
      } catch {}
    });
    {
      const sock = browserWs;
      sock.addEventListener('close', () => {
        if (browserWs !== sock) return;
        for (const p of browserPending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error('Browser connection closed.'));
        }
        browserPending.clear();
        browserWs = null;
      });
    }
  }
  return browserWs;
}

async function browserTab(url='about:blank') {
  await ensureBrowser();
  const target = await browserFetch(`/json/new?${encodeURIComponent(url)}`, {method:'PUT'}).catch(async()=>browserFetch('/json').then(x=>x.find(t=>t.type==='page')));
  if (!target?.webSocketDebuggerUrl) throw new Error('Could not create a browser tab.');
  if (browserWs) browserWs.close();
  browserWs = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ const timer=setTimeout(()=>reject(new Error('Could not connect to browser tab.')),8000); browserWs.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true}); browserWs.addEventListener('error',e=>{clearTimeout(timer);reject(e);},{once:true}); });
  browserWs.addEventListener('message',event=>{ try { const msg=JSON.parse(event.data); if(msg.id && browserPending.has(msg.id)){ const p=browserPending.get(msg.id); browserPending.delete(msg.id); clearTimeout(p.timer); if(msg.error)p.reject(new Error(msg.error.message||'Browser command failed')); else p.resolve(msg.result); } } catch {} });
  await browserRpc('Page.enable');
  await new Promise(r=>setTimeout(r,1200));
  return target;
}

async function browserEvaluate(expression) {
  await ensureBrowser();
  const r=await browserRpc('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text || 'Browser evaluation failed.');
  return r?.result?.value;
}

async function browserSearch(query, engine='google') {
  const q=String(query||'').trim();
  if(!q) throw new Error('Browser search query is empty.');
  const base=String(engine).toLowerCase()==='youtube' ? `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` : `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  await browserTab(base);
  return `Browser Agent searched for ${q}`;
}

async function browserOpen(url) { await browserTab(String(url)); return `Browser Agent opened ${url}`; }
async function browserClickText(text) {
  const needle=JSON.stringify(String(text||'').trim().toLowerCase());
  const result=await browserEvaluate(`(()=>{const n=${needle}; const els=[...document.querySelectorAll('a,button,[role="button"]')]; const el=els.find(e=>(e.innerText||e.textContent||'').trim().toLowerCase().includes(n)); if(!el)return false; el.scrollIntoView({block:'center'}); el.click(); return true;})()`);
  if(!result) throw new Error(`Could not find a clickable element containing "${text}".`);
  await new Promise(r=>setTimeout(r,1000));
  return `Clicked ${text}`;
}
async function browserRead() {
  const text=await browserEvaluate(`document.body ? document.body.innerText.slice(0,12000) : ''`);
  return String(text||'').trim() || 'No readable page text was found.';
}
async function browserReadFirstLines(count=6) {
  const n=Math.max(1,Math.min(12,Number(count)||6));
  const text=await browserEvaluate(`document.body ? document.body.innerText : ''`);
  return String(text||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean).slice(0,n).join(' | ') || 'No readable page text was found.';
}
// ---- Email Agent: Gmail API (OAuth 2.0, read-only). Never scrapes or merely opens Gmail. ----
let gmailSvc = null;
function gmail() {
  if (!gmailSvc) {
    gmailSvc = createGmailService({
      clientId: () => process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: () => process.env.GOOGLE_CLIENT_SECRET || '',
      tokenStore: createSafeStorageTokenStore({ safeStorage, fs, filePath: path.join(app.getPath('userData'), 'gmail-token.bin') }),
      openExternal: (url) => { if (!/^https:\/\/accounts\.google\.com\//.test(url) && !process.env.NEURAOS_TEST_AUTH) throw new Error('Unexpected authorization URL.'); shell.openExternal(url); },
    });
  }
  return gmailSvc;
}
function emit(evt) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('agent:event', evt); }
async function postJson(pathname, body) {
  const r = await fetch(`http://127.0.0.1:8080${pathname}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
  return d;
}
async function ensureGmail() {
  const svc = gmail();
  const st = await svc.status();
  if (!st.configured) throw new GmailError('NOT_CONFIGURED', 'Gmail is not set up yet. Add GOOGLE_CLIENT_ID to the .env file, as described in GMAIL_SETUP.md, then restart NeuraOS.');
  if (!st.connected) {
    emit({ type: 'announcement', agent: 'email', text: 'I need your permission to read Gmail. A browser window is opening for Google sign in.' });
    await svc.ensureAuthorized();
  }
  return svc;
}
// ---- Email Agent, default mode: reuses the Browser Agent (Chrome) to read Gmail. No Google Cloud, no API. ----
const gmailMode = () => (String(process.env.GMAIL_MODE || 'browser').toLowerCase() === 'api' ? 'api' : 'browser');
function gmailBrowserReader() {
  return createGmailBrowserReader({
    open: (url) => browserOpen(url),
    evaluate: (js) => browserEvaluate(js),
    // Trusted mouse click through Chrome's input pipeline (what a real user click looks like to Gmail).
    click: async (x, y) => {
      await browserRpc('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await browserRpc('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await browserRpc('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    },
    emit,
    bringToFront: () => browserRpc('Page.bringToFront'),
  });
}
function formatEmailsForDisplay(messages) {
  return messages.map((m, i) => `${messages.length > 1 ? `#${i + 1}  ` : ''}From: ${m.fromName ? `${m.fromName}${m.fromEmail ? ` <${m.fromEmail}>` : ''}` : m.fromEmail}\nSubject: ${m.subject || '(no subject)'}\nDate: ${m.dateText || (m.date ? new Date(m.date).toLocaleString() : 'unknown')}${m.attachments?.length ? `\nAttachments: ${m.attachments.map(x => x.filename).join(', ')}` : ''}\n\n${m.body || m.snippet || '(no readable text body)'}`).join('\n\n----------\n\n');
}
async function emailReadBrowser(a) {
  const request = (a.request && typeof a.request === 'object') ? a.request : {};
  const count = Math.max(1, Math.min(5, Number(a.count) || 1));
  emit({ type: 'announcement', agent: 'email', text: 'Opening Gmail in the browser.' });
  let result;
  try {
    result = await gmailBrowserReader().read({ count, uiQuery: gmailUiQuery(request), listOnly: !!request.checkOnly });
  } catch (e) {
    if (e && ['LOGIN_TIMEOUT', 'PAGE', 'DOM'].includes(e.code)) throw e;
    throw new Error(`I could not read Gmail: ${e?.message || e}`);
  }
  const { messages, unreadCount } = result;
  const brief = await postJson('/api/email/brief', { messages, request, unreadCount: request.checkOnly ? (unreadCount || messages.length) : null });
  return { speech: brief.text, display: messages.length ? formatEmailsForDisplay(messages) : brief.text };
}
async function gmailConnectBrowser() {
  await gmailBrowserReader().connect();
  return { speech: 'You are signed in to Gmail. I can read your email.', display: 'Gmail is signed in (browser session).' };
}

async function emailRead(a) {
  const count = Math.max(1, Math.min(10, Number(a.count) || 1));
  const query = String(a.query || '').slice(0, 300);
  const request = (a.request && typeof a.request === 'object') ? a.request : {};
  const svc = await ensureGmail();
  const messages = await svc.fetchMessages({ count, query });
  const unreadCount = request.checkOnly || request.unreadOnly ? await svc.unreadCount().catch(() => null) : null;
  const brief = await postJson('/api/email/brief', { messages, request, unreadCount });
  // Full, decoded text is shown on screen; speech uses the (possibly summarised) brief.
  const display = messages.length
    ? messages.map((m, i) => `${messages.length > 1 ? `#${i + 1}  ` : ''}From: ${m.fromName ? `${m.fromName} <${m.fromEmail}>` : m.fromEmail}\nSubject: ${m.subject || '(no subject)'}\nDate: ${m.date ? new Date(m.date).toLocaleString() : 'unknown'}${m.attachments.length ? `\nAttachments: ${m.attachments.map(x => x.filename).join(', ')}` : ''}\n\n${m.body || '(no readable text body)'}`).join('\n\n----------\n\n')
    : brief.text;
  return { speech: brief.text, display };
}
async function gmailConnectAction() {
  const svc = gmail();
  const st = await svc.status();
  if (!st.configured) throw new GmailError('NOT_CONFIGURED', 'Gmail is not set up yet. Add GOOGLE_CLIENT_ID to the .env file, as described in GMAIL_SETUP.md, then restart NeuraOS.');
  if (st.connected) return { speech: 'Gmail is already connected.', display: 'Gmail is already connected.' };
  emit({ type: 'announcement', agent: 'email', text: 'A browser window is opening for Google sign in.' });
  await svc.authorize();
  return { speech: 'Gmail is connected. I can now read your email.', display: 'Gmail connected (read-only).' };
}
async function gmailDisconnectAction() {
  await gmail().disconnect();
  return { speech: 'Gmail has been disconnected and the saved authorization was removed.', display: 'Gmail disconnected.' };
}

async function openAndReadNewsSource(url) {
  const target=String(url||'').trim();
  if(!/^https?:\/\//i.test(target)) throw new Error('Invalid news source URL.');
  await browserOpen(target);
  await new Promise(r=>setTimeout(r,3000));
  const text=await browserReadFirstLines(8);
  return `News source opened. First lines: ${text}`;
}

async function verifyYouTubeAccount() {
  const REQUIRED_ACCOUNT = 'salikkamal2007@gmail.com';
  // Check Chrome Local State for dedicated YouTube profile
  const profileDir = getDedicatedYouTubeProfile();
  const statePath = path.join(profileDir, 'Local State');
  if (fs.existsSync(statePath)) {
    try {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8').replace(/^\uFEFF/, ''));
      const cache = state?.profile?.info_cache || {};
      const found = Object.values(cache).some(p => String(p?.user_name || '').toLowerCase() === REQUIRED_ACCOUNT);
      if (found) return { ok: true, account: REQUIRED_ACCOUNT };
    } catch {}
  }
  // Also check temp agent profile as fallback
  const tempState = path.join(os.tmpdir(), 'NeuraOS-Chrome-Agent', 'Local State');
  if (fs.existsSync(tempState)) {
    try {
      const state = JSON.parse(fs.readFileSync(tempState, 'utf8').replace(/^\uFEFF/, ''));
      const cache = state?.profile?.info_cache || {};
      const found = Object.values(cache).some(p => String(p?.user_name || '').toLowerCase() === REQUIRED_ACCOUNT);
      if (found) return { ok: true, account: REQUIRED_ACCOUNT };
    } catch {}
  }
  return { ok: false, account: null };
}

async function youtubeOpenAccount() {
  const ver = await verifyYouTubeAccount();
  await ensureBrowser(true);
  await browserTab('https://www.youtube.com');
  if (!ver.ok) {
    emit({ type: 'announcement', agent: 'youtube', text: 'Please sign in to Google with salikkamal2007@gmail.com in the opened browser window.' });
    return { speech: 'Opened YouTube. Please make sure salikkamal2007@gmail.com is signed in.', display: 'Opened YouTube (Account: salikkamal2007@gmail.com requested)' };
  }
  return { speech: 'YouTube opened with salikkamal2007@gmail.com.', display: 'YouTube opened under salikkamal2007@gmail.com.' };
}

async function youtubeChannelAnalytics() {
  const ver = await verifyYouTubeAccount();
  await ensureBrowser(true);
  await browserTab('https://studio.youtube.com/');
  await new Promise(r=>setTimeout(r,3500));
  const text=await browserReadFirstLines(12);
  const accountNote = ver.ok ? `Verified account: salikkamal2007@gmail.com` : `Account verification alert: Please check that salikkamal2007@gmail.com is signed in.`;
  return {
    speech: `YouTube Studio opened for salikkamal2007@gmail.com. Channel overview: ${text.slice(0, 300)}`,
    display: `${accountNote}\n\nYouTube Studio metrics:\n${text}`
  };
}

async function youtubeAnalyzeVideoAction(command) {
  // Check if current browser tab is on YouTube or if a URL is in the command
  let videoTarget = '';
  const urlMatch = String(command || '').match(/(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[a-zA-Z0-9_-]{11})/i);
  if (urlMatch) {
    videoTarget = urlMatch[1];
  } else {
    // Try reading current browser tab URL
    try {
      const currentUrl = await browserEvaluate(`window.location.href`);
      if (/(youtube\.com\/watch|youtu\.be)/i.test(currentUrl)) {
        videoTarget = currentUrl;
      }
    } catch {}
  }

  if (!videoTarget) {
    // Search YouTube and open first video
    const query = String(command || '').replace(/\b(analyze|summarize|transcript|video|youtube)\b/gi, '').trim() || 'trending';
    emit({ type: 'announcement', agent: 'youtube', text: `Searching YouTube for ${query}...` });
    await ensureBrowser(true);
    await browserSearch(query, 'youtube');
    await new Promise(r => setTimeout(r, 2500));
    // Click first video link
    await browserEvaluate(`(()=>{ const v = document.querySelector('a#video-title, ytd-video-renderer a#thumbnail'); if(v) { v.click(); return true; } return false; })()`);
    await new Promise(r => setTimeout(r, 3000));
    try {
      videoTarget = await browserEvaluate(`window.location.href`);
    } catch {}
  }

  emit({ type: 'announcement', agent: 'youtube', text: 'Extracting video transcript and generating analysis...' });
  const res = await postJson('/api/youtube/analyze', { url: videoTarget, question: command });
  return {
    speech: res.speech,
    display: res.display
  };
}

async function executeWebResearchAction(command) {
  const c = String(command || '').trim();
  emit({ type: 'announcement', agent: 'browser', text: 'Opening Google in browser...', speak: false });

  // 1. Open Google in the browser
  await ensureBrowser(false);
  await browserTab('https://www.google.com');
  await new Promise(r => setTimeout(r, 1800));

  // 2. Find the Google search bar and type the user's exact question into the search bar
  emit({ type: 'announcement', agent: 'browser', text: `Searching Google for: ${c}`, speak: false });
  await browserEvaluate(`(()=>{
    const input = document.querySelector('textarea[name="q"], input[name="q"], [title="Search"], input[type="text"]');
    if (input) {
      input.focus();
      input.value = ${JSON.stringify(c)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    return false;
  })()`);

  // 3. Press Enter to perform the search
  await new Promise(r => setTimeout(r, 600));
  try {
    await browserRpc('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
    await browserRpc('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13 });
  } catch {}

  // Fallback submit if key event did not trigger navigation
  await browserEvaluate(`(()=>{
    const form = document.querySelector('form[action="/search"], form');
    if (form && (!window.location.href.includes('/search') || window.location.href === 'https://www.google.com/')) {
      form.submit();
    }
  })()`);

  // 4. Wait for the Google search results page to load
  await new Promise(r => setTimeout(r, 3500));

  // 5. Read the information displayed directly on the Google search results page.
  // IMPORTANT: Do NOT open individual websites or additional links.
  const searchPageData = await browserEvaluate(`(()=>{
    // AI Overview / SGE (if present)
    const aiEl = document.querySelector('[data-async-context*="sge"], [aria-label*="AI Overview"], div.w7Dbne, div[data-attrid="wa:/description"]');
    const aiText = aiEl ? (aiEl.innerText || '').trim() : '';

    // Direct answer / Featured snippet / Knowledge panel
    const directEl = document.querySelector('div.Z0LcW, div.hgKElc, div.kno-rdesc, div[data-attrid*="kc:/"], div.xpdopen, div.IZ6rdc, div.BNeawe');
    const directText = directEl ? (directEl.innerText || '').trim() : '';

    // Knowledge graph title & summary
    const kpTitle = document.querySelector('[data-attrid="title"], h2[data-attrid="title"]')?.innerText || '';
    const kpSub = document.querySelector('[data-attrid="subtitle"]')?.innerText || '';
    const kpDesc = document.querySelector('div[data-attrid*="description"]')?.innerText || '';

    // Visible search result snippets
    const snippets = [...document.querySelectorAll('div.VwiC3b, div.MjjYud, div[data-sncf="1"], #rso .g')]
      .map(el => (el.innerText || '').trim())
      .filter(t => t.length > 25)
      .slice(0, 6)
      .join('\\n\\n');

    // Entire visible search block as comprehensive fallback
    const mainCol = document.querySelector('#search, #rso, #center_col')?.innerText || document.body.innerText || '';

    return [
      aiText ? ('[AI OVERVIEW]\\n' + aiText) : '',
      directText ? ('[DIRECT ANSWER]\\n' + directText) : '',
      kpTitle ? ('[KNOWLEDGE PANEL]\\n' + kpTitle + (kpSub ? ' - ' + kpSub : '') + '\\n' + kpDesc) : '',
      snippets ? ('[TOP SEARCH SNIPPETS]\\n' + snippets) : '',
      (!aiText && !directText && !kpTitle && !snippets) ? mainCol.slice(0, 3000) : ''
    ].filter(Boolean).join('\\n\\n');
  })()`);

  const pageContent = (searchPageData || await browserRead()).trim();

  // 6. Extract the relevant answer directly from Google results and speak aloud
  emit({ type: 'announcement', agent: 'browser', text: 'Reading Google search results...', speak: false });
  const answerRes = await postJson('/api/research/google-answer', {
    question: c,
    content: pageContent
  });

  return {
    speech: answerRes.speech,
    display: answerRes.display
  };
}

const DEV_PROGRAMS = new Set(['javac','java','python','python.exe','node','node.exe','g++','gcc','go']);
function runDeveloperProgram(program, args=[], cwd, timeoutMs=15000) {
  const name=path.basename(String(program||'')).toLowerCase();
  if(!DEV_PROGRAMS.has(name)) throw new Error(`Coding Agent cannot run ${program}. Allowed runtimes: python, node, javac, java, g++, gcc.`);
  const workspace=path.resolve(path.join(os.homedir(),'Documents','NeuraOS'));
  const work=path.resolve(String(cwd||workspace));
  if(work!==workspace && !work.startsWith(workspace+path.sep)) throw new Error('Coding Agent can only execute programs inside Documents\\NeuraOS.');
  fs.mkdirSync(work,{recursive:true});
  const cleanArgs=(args||[]).map(String);
  if(cleanArgs.some(a=>/[;&|<>`$]/.test(a))) throw new Error('Unsafe shell characters are not allowed in Coding Agent arguments.');
  try {
    const output=execFileSync(program,cleanArgs,{cwd:work,windowsHide:true,encoding:'utf8',timeout:Math.min(60000,Math.max(1000,Number(timeoutMs||15000))),stdio:['ignore','pipe','pipe']});
    return `${name} completed${output?.trim()?`: ${output.trim().slice(0,3000)}`:''}`;
  } catch(e) {
    const detail=String(e?.stderr||e?.stdout||e?.message||'').trim();
    throw new Error(`${name} failed${detail?`: ${detail.slice(0,4000)}`:''}`);
  }
}
async function executePhoneCallAction(phoneNumber, contactName) {
  emit({ type: 'announcement', agent: 'phone', text: `Calling ${contactName || phoneNumber}, boss.` });
  const res = await postJson('/api/phone/dial', { phoneNumber, contactName });
  if (!res.ok) {
    const err = res.error || 'Failed to place call on connected iPhone.';
    return {
      speech: `Boss, could not place call: ${err}`,
      display: `Phone Call Failed: ${err}`
    };
  }
  return {
    speech: `Calling ${contactName || phoneNumber}, boss.`,
    display: `Calling ${contactName || phoneNumber} (${phoneNumber}) through connected iPhone via Windows Phone Link.`
  };
}

function executeAction(a) {
  if (cancelled) throw new Error('Task cancelled.');
  if (!a || !SAFE_ACTIONS.has(a.type)) throw new Error(`Blocked action: ${a?.type || 'unknown'}`);
  switch (a.type) {
    case 'open_application': return launchApp(a.application, a.args || []);
    case 'open_url': shell.openExternal(String(a.url)); return `Opened ${a.url}`;
    case 'open_file': { const fp=path.resolve(String(a.path)); if (/\.(java|js|ts|tsx|jsx|py|cpp|c|cs|html|css|json|md)$/i.test(fp) && isWin) return launchApp('visual studio code',[fp]); const err=shell.openPath(fp); return err ? Promise.reject(new Error(err)) : `Opened ${a.path}`; }
    case 'create_file': return `Created ${createFile(String(a.path), String(a.content || ''))}`;
    case 'write_file': fs.writeFileSync(path.resolve(String(a.path)), String(a.content || ''), 'utf8'); return `Wrote ${a.path}`;
    case 'copy': clipboard.writeText(String(a.text || '')); return 'Copied text';
    case 'paste': focusAndPaste(clipboard.readText()); return 'Pasted text';
    case 'type_text': focusAndPaste(String(a.text || '')); return 'Typed text';
    case 'press_key': powershell(`$w=New-Object -ComObject WScript.Shell; $w.SendKeys('${String(a.key || '').replace(/'/g,"''")}')`); return `Pressed ${a.key}`;
    case 'hotkey': powershell(`$w=New-Object -ComObject WScript.Shell; $w.SendKeys('${String(a.keys || '').replace(/'/g,"''")}')`); return `Pressed ${a.keys}`;
    case 'wait': return new Promise(r => setTimeout(r, Math.min(10000, Math.max(0, Number(a.ms || 300)) ))).then(() => `Waited ${a.ms}ms`);
    case 'search_web': shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(String(a.query || ''))}`); return `Searched for ${a.query}`;
    case 'browser_search': return browserSearch(a.query, a.engine || 'google');
    case 'browser_open': return browserOpen(a.url);
    case 'browser_click_text': return browserClickText(a.text);
    case 'browser_read': return browserRead();
    case 'browser_read_first_lines': return browserReadFirstLines(a.count || 6);
    case 'email_recent': return gmailMode() === 'api' ? emailRead({ count: 1, query: '', request: {} }) : emailReadBrowser({ count: 1, request: {} });
    case 'email_read': return gmailMode() === 'api' ? emailRead(a) : emailReadBrowser(a);
    case 'gmail_connect': return gmailMode() === 'api' ? gmailConnectAction() : gmailConnectBrowser();
    case 'gmail_disconnect': return gmailMode() === 'api' ? gmailDisconnectAction() : { speech: 'NeuraOS stores no Gmail password. To sign out, sign out of Google in the NeuraOS browser window.', display: 'No stored credentials. Sign out of Google in the NeuraOS Chrome window if you want to.' };
    case 'youtube_channel_analytics': return youtubeChannelAnalytics();
    case 'youtube_open_account': return youtubeOpenAccount();
    case 'youtube_analyze_video': return youtubeAnalyzeVideoAction(a.command);
    case 'web_research_execute': return executeWebResearchAction(a.command);
    case 'open_and_read_news': return openAndReadNewsSource(a.url);
    case 'run_program': return runDeveloperProgram(a.program, a.args || [], a.cwd, a.timeoutMs || 15000);
    case 'phone_call': return executePhoneCallAction(a.phoneNumber, a.contactName);
    default: throw new Error(`Unsupported action: ${a.type}`);
  }
}

const TRUSTED_ORIGIN = 'http://127.0.0.1:8080';
function assertTrusted(event) {
  const url = event?.senderFrame?.url || event?.sender?.getURL?.() || '';
  if (!url.startsWith(TRUSTED_ORIGIN)) throw new Error('Blocked IPC request from an untrusted origin.');
}
ipcMain.handle('agent:run', async (event, command) => {
  assertTrusted(event);
  if (typeof command !== 'string' || !command.trim() || command.length > 2000) throw new Error('Invalid command.');
  cancelled = false;
  const planRes = await fetch('http://127.0.0.1:8080/api/agent/plan', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ command }) });
  const plan = await planRes.json();
  if (!planRes.ok) { const msg = plan.error || 'Could not plan command.'; if (/code|program|java|python|gmail|email|inbox|phone|call/i.test(command)) emit({ type:'error', agent:plan.agent || 'general', text: msg }); throw new Error(msg); }
  const results = [];
  let resultText = plan.speech || plan.finalText || '';
  let displayText = plan.display || plan.finalText || resultText;
  let lastRunOutput = '';
  if (mainWindow && plan.announcement) mainWindow.webContents.send('agent:event', { type:'announcement', agent:plan.agent || 'general', text:plan.announcement });
  for (let i=0;i<(plan.actions||[]).length;i++) {
    if (cancelled) throw new Error('Task cancelled.');
    const action = plan.actions[i];
    if (CONFIRM_ACTIONS.has(action.type) || action.requiresConfirmation) {
      // Programs the Coding Agent just generated and compiled inside Documents\NeuraOS may run; everything else needs confirmation.
      const progName = path.basename(String(action.program || '')).toLowerCase();
      const trusted = plan.agent === 'coding' && action.type === 'run_program' && ['javac','java','python','python.exe','node','node.exe','g++','gcc'].includes(progName);
      if (!trusted) throw new Error(`Confirmation required before ${action.type}.`);
    }
    try {
      if (mainWindow) mainWindow.webContents.send('agent:event', { type:'action', agent:plan.agent || 'general', index:i, action:action.type });
      const message = await executeAction(action);
      if (action.type === 'run_program' && plan.agent === 'coding' && String(action.program) !== 'javac') lastRunOutput = String(message || '');
      if (message && typeof message === 'object' && message.speech !== undefined) { resultText = String(message.speech); displayText = String(message.display || message.speech); }
      else if (message && ['email_recent','youtube_channel_analytics','open_and_read_news','browser_read','browser_read_first_lines'].includes(action.type)) resultText = String(message);
      results.push({ index:i, type:action.type, status:'completed', message: typeof message === 'object' ? message?.speech : message });
    }
    catch (e) {
      results.push({ index:i, type:action.type, status:'failed', message:e.message });
      if (plan.agent === 'email' || plan.agent === 'coding') emit({ type:'error', agent:plan.agent, text: (plan.agent === 'coding' ? `Coding Agent hit a problem: ${e.message}` : e.message).slice(0, 600) });
      throw e;
    }
  }
  if (plan.agent === 'coding') {
    const out = lastRunOutput.replace(/^\w+(?:\.exe)? completed:?\s*/i, '').trim();
    resultText = plan.codeOnly ? `Done. ${plan.fileName} is ready in VS Code.` : [plan.finalText, out ? `Program output: ${out.slice(0, 300)}` : ''].filter(Boolean).join(' ');
    displayText = plan.codeOnly ? String(plan.code || '') : `${plan.fileName}\n\n${plan.code || ''}${out ? `\n\n--- Output ---\n${out}` : ''}`;
  }
  if (mainWindow) mainWindow.webContents.send('agent:event', { type:'completed', agent:plan.agent || 'general', text: resultText || 'Task completed.', display: displayText || undefined });
  return { ...plan, code: undefined, results, resultText, displayText };
});
ipcMain.handle('agent:cancel', () => { cancelled = true; return true; });
ipcMain.handle('system:open-url', (e, url) => { assertTrusted(e); if (!/^https?:\/\//i.test(String(url))) throw new Error('Only http(s) links can be opened.'); return shell.openExternal(String(url)); });
ipcMain.handle('gmail:status', async (e) => { assertTrusted(e); return gmail().status(); });
ipcMain.handle('gmail:connect', async (e) => { assertTrusted(e); return gmailConnectAction(); });
ipcMain.handle('gmail:disconnect', async (e) => { assertTrusted(e); return gmailDisconnectAction(); });
ipcMain.handle('news:open-read', async (_e, url) => openAndReadNewsSource(url));
let localVoiceProcess = null;
function localWindowsListen(timeoutSeconds = 10) {
  if (!isWin) return Promise.reject(new Error('Local Windows speech recognition is available only on Windows.'));
  if (localVoiceProcess) return Promise.reject(new Error('Already listening.'));
  return new Promise((resolve, reject) => {
    const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Speech; $r=New-Object System.Speech.Recognition.SpeechRecognitionEngine; $r.SetInputToDefaultAudioDevice(); $r.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar)); $x=$r.Recognize([TimeSpan]::FromSeconds(${Math.max(3, Math.min(30, Number(timeoutSeconds)||10))})); if($x){[Console]::Out.Write($x.Text)}`;
    const child = require('node:child_process').spawn('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command', script], { windowsHide: true });
    localVoiceProcess = child;
    let stdout=''; let stderr='';
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    child.on('error', err => { localVoiceProcess=null; reject(err); });
    child.on('close', code => { localVoiceProcess=null; const text=stdout.trim(); if(text) resolve({text}); else reject(new Error(stderr.trim() || 'No speech was recognized. Make sure a Windows speech language and microphone are installed and enabled.')); });
  });
}
ipcMain.handle('voice:listen-local', async () => { throw new Error('Wake-word listening uses local faster-whisper.'); });
ipcMain.handle('voice:stop-local', () => { if(localVoiceProcess){ localVoiceProcess.kill(); localVoiceProcess=null; } return true; });
let activeSpeakProcess = null;

ipcMain.handle('voice:speak-local', async (_e, text) => {
  return await localWindowsSpeak(text);
});

ipcMain.handle('voice:stop-speaking', () => {
  cancelled = true;
  if (activeSpeakProcess) {
    try { activeSpeakProcess.kill(); } catch {}
    activeSpeakProcess = null;
  }
  // Also stop SAPI speech via powershell if any dangling background synthesizer exists
  powershell(`Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SpeakAsyncCancelAll()`).catch?.(()=>{});
  return true;
});
ipcMain.handle('voice:transcribe', async (_e, payload) => {
  const r = await fetch('http://127.0.0.1:8080/api/voice/transcribe', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload||{}) });
  const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Voice transcription failed.'); return d;
});
ipcMain.handle('voice:speak', async (_e, text) => {
  try { return await (async()=>{ const r=await fetch('http://127.0.0.1:8080/api/voice/speak',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})}); const d=await r.json(); if(!r.ok) throw new Error(d.error||'Voice response failed.'); return d; })(); } catch { return await localWindowsSpeak(text); }
});

function localWindowsSpeak(text){
  if (!isWin) return Promise.reject(new Error('Local Windows speech is available only on Windows.'));
  if (activeSpeakProcess) {
    try { activeSpeakProcess.kill(); } catch {}
    activeSpeakProcess = null;
  }
  return new Promise((resolve,reject)=>{
    const safe=String(text||'').replace(/`/g,'``').replace(/'/g,"''").slice(0,4000);
    const script=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate=0; $s.Volume=100; $s.Speak('${safe}')`;
    const child=require('node:child_process').spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],{windowsHide:true});
    activeSpeakProcess = child;
    let err='';
    child.stderr.on('data',d=>err+=d.toString());
    child.on('error', err => { activeSpeakProcess = null; reject(err); });
    child.on('close',c=>{
      activeSpeakProcess = null;
      c===0?resolve({ok:true}):reject(new Error(err||'Speech failed'));
    });
  });
}

// ----------------- Background Wake-Word Service -----------------
let wakeServiceProcess = null;
let currentVoiceState = 'idle'; // idle | activated | listening | thinking | executing | speaking | stopping | error
let isAppQuitting = false;

function setVoiceState(newState, extra = {}) {
  currentVoiceState = newState;
  if (wakeServiceProcess && !wakeServiceProcess.killed) {
    try {
      wakeServiceProcess.stdin.write(JSON.stringify({ cmd: 'set_state', state: newState }) + '\n');
    } catch {}
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('voice:state', { state: newState, timestamp: Date.now(), ...extra });
  }
}

async function handleWakeServiceEvent(msg) {
  if (!msg || !msg.event) return;

  if (msg.event === 'ready') {
    setVoiceState('idle', { message: 'Listening for "Hey Neura"' });
    return;
  }

  if (msg.event === 'stop') {
    const phrase = String(msg.phrase || '').toLowerCase();
    if (phrase.includes('stop listening')) {
      setVoiceState('idle', { message: 'Stopped listening. Say "Hey Neura" to wake.' });
      try { await localWindowsSpeak('Stopped listening, boss.'); } catch {}
      return;
    }

    // Instant global stop / cancel
    cancelled = true;
    if (activeSpeakProcess) {
      try { activeSpeakProcess.kill(); } catch {}
      activeSpeakProcess = null;
    }
    powershell(`Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SpeakAsyncCancelAll()`).catch?.(()=>{});

    setVoiceState('stopping', { message: 'Stopped.' });
    setTimeout(() => {
      setVoiceState('idle', { message: 'Listening for "Hey Neura"' });
    }, 600);
    return;
  }

  if (msg.event === 'wake') {
    setVoiceState('activated', { message: 'Wake phrase detected' });

    // Respond: "Yes boss?"
    try {
      await localWindowsSpeak('Yes boss?');
    } catch (e) {
      console.error('TTS error on wake:', e);
    }

    // Automatically transition to LISTENING for command
    setVoiceState('listening', { message: "Yes boss, I'm listening..." });
    return;
  }

  if (msg.event === 'wake_with_command') {
    const cmd = msg.command;
    setVoiceState('thinking', { message: `Processing: ${cmd}` });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('voice:command', { text: cmd });
    }
    return;
  }

  if (msg.event === 'command') {
    const text = String(msg.text || '').trim();
    if (!text) return;

    if (/^(neura,?\s*stop|stop|stop\s+speaking|stop\s+listening|cancel|that's\s+enough)\.?$/i.test(text)) {
      handleWakeServiceEvent({ event: 'stop', phrase: text });
      return;
    }

    setVoiceState('thinking', { message: `Processing: ${text}` });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('voice:command', { text, audioPath: msg.audioPath });
    }
    return;
  }

  if (msg.event === 'error') {
    setVoiceState('error', { message: msg.message });
    return;
  }
}

function startWakeService() {
  if (!isWin) return;
  if (wakeServiceProcess && !wakeServiceProcess.killed) return;

  const venvPython = path.join(__dirname, '..', '.voice-venv', 'Scripts', 'python.exe');
  const pyScript = path.join(__dirname, '..', 'voice', 'wake_service.py');
  const psScript = path.join(__dirname, '..', 'voice', 'wake_service.ps1');

  let spawnCmd = 'powershell.exe';
  let spawnArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psScript];

  if (fs.existsSync(venvPython) && fs.existsSync(pyScript)) {
    spawnCmd = venvPython;
    spawnArgs = ['-u', pyScript];
  } else if (fs.existsSync(pyScript)) {
    spawnCmd = 'python';
    spawnArgs = ['-u', pyScript];
  } else if (!fs.existsSync(psScript)) {
    console.error('Neither wake_service.py nor wake_service.ps1 found.');
    return;
  }

  try {
    const child = require('node:child_process').spawn(spawnCmd, spawnArgs, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    wakeServiceProcess = child;

    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          handleWakeServiceEvent(msg);
        } catch {}
      }
    });

    child.stderr.on('data', (d) => {
      console.error('[WakeService Error]', d.toString());
    });

    child.on('error', (err) => {
      wakeServiceProcess = null;
      setVoiceState('error', { message: err.message });
    });

    child.on('close', () => {
      wakeServiceProcess = null;
      if (!isAppQuitting) {
        setTimeout(() => startWakeService(), 2000);
      }
    });
  } catch (err) {
    console.error('Failed to start wake service:', err);
    setVoiceState('error', { message: err.message });
  }
}

function stopWakeService() {
  isAppQuitting = true;
  if (wakeServiceProcess) {
    try {
      wakeServiceProcess.stdin.write(JSON.stringify({ cmd: 'exit' }) + '\n');
      wakeServiceProcess.kill();
    } catch {}
    wakeServiceProcess = null;
  }
}

ipcMain.handle('voice:set-state', (_e, state) => {
  setVoiceState(state);
  return { ok: true, state };
});

ipcMain.handle('voice:get-state', () => currentVoiceState);

ipcMain.handle('voice:emulate', (_e, text) => {
  if (wakeServiceProcess && !wakeServiceProcess.killed) {
    wakeServiceProcess.stdin.write(JSON.stringify({ cmd: 'emulate', text }) + '\n');
  }
  return true;
});

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => callback(permission === 'media'));
  startApi(); await waitForApi(); createWindow();
  startWakeService();
});
app.on('window-all-closed', () => {
  stopWakeService();
  if (apiProcess) apiProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
  stopWakeService();
  if (apiProcess) apiProcess.kill();
});
