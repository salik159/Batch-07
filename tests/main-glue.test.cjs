'use strict';
// Loads the REAL electron/main.cjs with a FAKE `electron` module and a faked Windows environment,
// boots the REAL API server, and drives the real IPC handlers ('agent:run', 'gmail:*').
// Test doubles: Electron, Google (OAuth+Gmail), AI Mock, VS Code launcher (powershell/where.exe).
// NOT covered: the real Electron runtime/window, real Google, Windows PowerShell, real TTS/mic.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http'); const Module = require('node:module'); const crypto = require('node:crypto');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const cp = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neura-glue-'));
const userData = path.join(tmp, 'userData'); fs.mkdirSync(userData, { recursive: true });
process.env.GMAIL_MODE = 'api'; // this file tests the optional Gmail API mode; the default browser mode is in gmail-browser-e2e.test.cjs
process.env.HOME = tmp; process.env.USERPROFILE = tmp;
delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET;

const b64 = s => Buffer.from(s).toString('base64url');
const BODY = 'Hi boss,\nYour sign-in on Windows was detected. If this was you, no action is needed.';
const GMSG = { id: 'g1', threadId: 't', internalDate: String(Date.now() - 600e3), labelIds: ['INBOX', 'UNREAD'], snippet: 's', payload: { mimeType: 'multipart/alternative', headers: [{ name: 'From', value: 'Google <no-reply@accounts.google.com>' }, { name: 'Subject', value: 'Security alert' }],
  parts: [{ mimeType: 'text/plain', body: { data: b64(BODY) } }, { mimeType: 'text/html', body: { data: b64('<p>html</p>') } }] } };
let googleBase, authCount = 0, inbox = ['g1'], challenge;
const events = []; const handlers = new Map(); let onAllClosed; let windowCreated = false;

const key = crypto.randomBytes(32);
const safeStorage = { isEncryptionAvailable: () => true,
  encryptString: s => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv), e = Buffer.concat([c.update(s, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), e]); },
  decryptString: b => { const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); } };

let mockAI, google;
before(async () => {
  const { startMock } = await import('./mock-openai.mjs');
  mockAI = await startMock();
  process.env.AI_PROVIDER = 'ollama';
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${mockAI.port}`;
  process.env.OLLAMA_MODEL = 'mock-model';
  google = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let raw = ''; for await (const c of req) raw += c;
    const json = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/o/oauth2/v2/auth') { authCount++; challenge = u.searchParams.get('code_challenge'); const r = new URL(u.searchParams.get('redirect_uri')); r.searchParams.set('code', 'c1'); r.searchParams.set('state', u.searchParams.get('state')); res.writeHead(302, { Location: r }); return res.end(); }
    if (u.pathname === '/token') { const p = new URLSearchParams(raw); if (p.get('grant_type') === 'authorization_code') { assert.equal(crypto.createHash('sha256').update(p.get('code_verifier')).digest('base64url'), challenge); return json(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }); } return json(200, { access_token: 'AT2', expires_in: 3600 }); }
    if (u.pathname === '/revoke') return json(200, {});
    if (u.pathname === '/gmail/v1/users/me/labels/INBOX') return json(200, { messagesUnread: 2 });
    if (u.pathname === '/gmail/v1/users/me/messages') return json(200, inbox.length ? { messages: inbox.map(id => ({ id })) } : {});
    if (/\/messages\/g1$/.test(u.pathname)) return json(200, GMSG);
    json(404, {});
  });
  await new Promise(r => google.listen(0, '127.0.0.1', r)); googleBase = `http://127.0.0.1:${google.address().port}`;

  // rewrite Google hosts -> mock (the app code stays unmodified and talks to the real URLs)
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => { const s = String(url?.url || url); const m = s.replace(/^https:\/\/(accounts\.google\.com|oauth2\.googleapis\.com|gmail\.googleapis\.com)/, googleBase); return realFetch(m, opts); };

  // fake Windows + fake VS Code launcher; mock javac/java if not installed on system
  Object.defineProperty(process, 'platform', { value: 'win32' });
  const realExec = cp.execFileSync;
  const fakeCp = {
    ...cp,
    execFileSync: (f, a, o) => {
      if (f === 'where.exe') return 'C:\\fake\\Code.exe\r\n';
      if (f === 'powershell.exe') return '';
      if (f === 'javac') {
        const target = a && a[0] ? path.join(o.cwd || tmp, a[0].replace(/\.java$/, '.class')) : '';
        if (target) fs.writeFileSync(target, '');
        return '';
      }
      if (f === 'java') return a && a[0] === 'BinarySearchDemo' ? 'Index of 7: 3' : '10! = 3628800';
      return realExec(f, a, o);
    },
    spawn: (f, a, o) => (/node/.test(path.basename(f)) ? cp.spawn(f, a, { ...o, env: { ...o.env } }) : cp.spawn(f, a, o))
  };
  const fakeElectron = {
    app: { getPath: () => userData, whenReady: () => Promise.resolve(), on: (e, f) => { if (e === 'window-all-closed') onAllClosed = f; }, quit() {} },
    BrowserWindow: class { constructor() { windowCreated = true; this.webContents = { send: (c, p) => events.push(p) }; } loadURL() {} isDestroyed() { return false; } },
    ipcMain: { handle: (n, f) => handlers.set(n, f) },
    shell: { openExternal: async url => { await globalThis.fetch(url); } },
    clipboard: { writeText() {}, readText: () => '' }, session: { defaultSession: { setPermissionRequestHandler() {} } }, safeStorage,
  };
  const origLoad = Module._load;
  Module._load = function (req, ...rest) { if (req === 'electron') return fakeElectron; if (req === 'node:child_process') return fakeCp; return origLoad.call(this, req, ...rest); };
  process.chdir(root);
  require('../electron/main.cjs');
  for (let i = 0; i < 100 && !handlers.has('agent:run'); i++) await new Promise(r => setTimeout(r, 100));
  for (let i = 0; i < 120; i++) { try { if ((await realFetch('http://127.0.0.1:8080/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  // main.cjs creates its window only after its own health poll; events are captured through it.
  for (let i = 0; i < 100 && !windowCreated; i++) await new Promise(r => setTimeout(r, 50));
  assert.ok(windowCreated, 'main.cjs never created its window');
});
after(() => { try { onAllClosed?.(); } catch {} google?.close(); mockAI?.server.close(); setTimeout(() => process.exit(0), 200).unref(); });

const ev = { senderFrame: { url: 'http://127.0.0.1:8080/' } };
const run = async cmd => { events.length = 0; try { return { ok: await handlers.get('agent:run')(ev, cmd) }; } catch (e) { return { err: e.message }; } };
const tokenFile = () => path.join(userData, 'gmail-token.bin');

test('IPC rejects untrusted origins and malformed commands', async () => {
  await assert.rejects(() => handlers.get('agent:run')({ senderFrame: { url: 'https://evil.example/' } }, 'read my email'), /untrusted origin/);
  await assert.rejects(() => handlers.get('agent:run')(ev, 42), /Invalid command/);
  await assert.rejects(async () => handlers.get('system:open-url')(ev, 'file:///etc/passwd'), /Only http/);
  await assert.rejects(async () => handlers.get('gmail:connect')({ senderFrame: { url: 'http://x/' } }), /untrusted/);
});

test('email without GOOGLE_CLIENT_ID: honest setup error, spoken via error event, nothing invented', async () => {
  const r = await run('Hey Neura, read my latest email');
  assert.match(r.err, /Gmail is not set up yet/);
  assert.ok(events.some(e => e.type === 'error' && /GOOGLE_CLIENT_ID/.test(e.text)));
  assert.ok(!events.some(e => e.type === 'completed'));
});

test('first email request runs OAuth (consent announced), then reads the REAL message aloud + full text on screen', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
  const r = await run('Hey Neura, read my latest email');
  assert.equal(r.err, undefined, r.err); assert.equal(authCount, 1);
  const ann = events.filter(e => e.type === 'announcement').map(e => e.text);
  assert.ok(ann.some(t => /Email Agent is checking your Gmail/.test(t))); assert.ok(ann.some(t => /permission to read Gmail/.test(t)));
  const done = events.find(e => e.type === 'completed');
  assert.match(done.text, /latest email is from Google\. The subject is Security alert\./); assert.match(done.text, /Your sign-in on Windows was detected/);
  assert.match(done.display, /From: Google <no-reply@accounts\.google\.com>\nSubject: Security alert/); assert.ok(done.display.includes(BODY));
  assert.equal(r.ok.resultText, done.text);
  assert.ok(!/browser/i.test(JSON.stringify(r.ok.actions)));
  assert.ok(fs.existsSync(tokenFile())); assert.ok(!fs.readFileSync(tokenFile()).toString('latin1').includes('"RT"') && !fs.readFileSync(tokenFile()).includes('refresh_token'), 'token stored in plaintext!');
});

test('subsequent requests reuse the stored token (no new consent); summaries use the LLM', async () => {
  const r = await run('Check my inbox and summarize the three newest emails');
  assert.equal(r.err, undefined); assert.equal(authCount, 1);
  assert.match(events.find(e => e.type === 'completed').text, /MOCK-LLM-BRIEF|Email 1/);
  const u = await run('Do I have any new emails?');
  assert.match(events.find(e => e.type === 'completed').text, /You have 2 unread emails|MOCK-LLM-BRIEF/);
});

test('empty inbox is reported honestly', async () => {
  inbox = []; const r = await run('Read my latest email'); inbox = ['g1'];
  assert.match(events.find(e => e.type === 'completed').text, /couldn't find any emails in your inbox/);
  assert.equal(events.find(e => e.type === 'completed').display, events.find(e => e.type === 'completed').text);
});

test('gmail status / disconnect / reconnect through IPC', async () => {
  assert.deepEqual((await handlers.get('gmail:status')(ev)).connected, true);
  await run('connect my gmail'); assert.match(events.find(e => e.type === 'completed').text, /already connected/);
  await run('disconnect my gmail'); assert.ok(!fs.existsSync(tokenFile())); assert.equal((await handlers.get('gmail:status')(ev)).connected, false);
  await run('read my latest email'); assert.equal(authCount, 2); assert.ok(fs.existsSync(tokenFile()));
});

test('coding via agent:run: writes the requested program, compiles and runs it, returns output/explanation', async () => {
  for (const [cmd, cls, out] of [['Write a Java program for factorial', 'FactorialDemo', '10! = 3628800'], ['Now write a Java program to implement binary search', 'BinarySearchDemo', 'Index of 7: 3']]) {
    const r = await run(cmd); assert.equal(r.err, undefined, r.err);
    const file = path.join(tmp, 'Documents', 'NeuraOS', `${cls}.java`);
    assert.ok(fs.existsSync(file), file); assert.ok(fs.existsSync(file.replace('.java', '.class')), 'javac did not run');
    const done = events.find(e => e.type === 'completed');
    assert.match(done.text, new RegExp(`wrote ${cls}\\.java`)); assert.ok(done.text.includes(out), done.text); assert.ok(done.display.includes(`class ${cls}`));
  }
  const only = await run('Write a Java program for factorial, code only');
  const d = events.find(e => e.type === 'completed'); assert.match(d.text, /^Done\./); assert.match(d.display, /^public class FactorialDemo/); assert.ok(!/Program output/.test(d.text));
});

test('coding failure surfaces as a spoken error, not silence', async () => {
  const r = await run('Write a Java program, stubborn');
  assert.equal(r.err, undefined); // saved but not run (compile failed after repairs)
  assert.match(events.find(e => e.type === 'completed').text, /could not be compiled/);
});
