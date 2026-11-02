'use strict';
// END-TO-END (default browser mode): REAL electron/main.cjs + REAL API server + REAL browser-agent code (CDP over
// WebSocket) talking to a FAKE Chrome serving a FAKE Gmail page. Test doubles: Electron, Chrome/Gmail, OpenAI, VS Code.
let ok = true; try { require('jsdom'); require('ws'); } catch { ok = false; }
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const skip = ok ? false : 'jsdom/ws not installed (npm i --no-save jsdom ws)';
const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neura-e2e-'));
process.env.HOME = tmp; process.env.USERPROFILE = tmp; process.env.OPENAI_API_KEY = 'test'; delete process.env.GMAIL_MODE; delete process.env.GOOGLE_CLIENT_ID;
const events = []; const handlers = new Map(); let onAllClosed, windowCreated = false, fake, chrome, mockOpenAI;

before(async () => {
  if (skip) return;
  const { startMock } = await import('./mock-openai.mjs'); mockOpenAI = await startMock();
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${mockOpenAI.port}`;
  const { createFakeGmail, startFakeChrome } = require('./fake-gmail.cjs');
  fake = createFakeGmail(); chrome = await startFakeChrome(fake, 9222);
  Object.defineProperty(process, 'platform', { value: 'win32' });
  const fakeElectron = {
    app: { getPath: () => tmp, whenReady: () => Promise.resolve(), on: (e, f) => { if (e === 'window-all-closed') onAllClosed = f; }, quit() {} },
    BrowserWindow: class { constructor() { windowCreated = true; this.webContents = { send: (c, p) => events.push(p) }; } loadURL() {} isDestroyed() { return false; } },
    ipcMain: { handle: (n, f) => handlers.set(n, f) }, shell: { openExternal: async () => { throw new Error('browser must not be opened via shell'); } },
    clipboard: { writeText() {}, readText: () => '' }, session: { defaultSession: { setPermissionRequestHandler() {} } },
    safeStorage: { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString() },
  };
  const orig = Module._load; Module._load = function (req, ...r) { return req === 'electron' ? fakeElectron : orig.call(this, req, ...r); };
  process.chdir(root); require('../electron/main.cjs');
  for (let i = 0; i < 150 && !windowCreated; i++) await new Promise(r => setTimeout(r, 100));
  assert.ok(windowCreated, 'main.cjs never created its window');
});
after(() => { try { onAllClosed?.(); } catch {} chrome?.close(); mockOpenAI?.server.close(); setTimeout(() => process.exit(0), 200).unref(); });

const ev = { senderFrame: { url: 'http://127.0.0.1:8080/' } };
const run = async cmd => { events.length = 0; fake.opened.length = 0; try { return { ok: await handlers.get('agent:run')(ev, cmd) }; } catch (e) { return { err: e.message }; } };
const done = () => events.find(e => e.type === 'completed');

test('"Hey Neura, read my latest email": opens Gmail in the browser agent, reads the real page, speaks sender/subject/date/body', { skip }, async () => {
  const r = await run('Hey Neura, read my latest email');
  assert.equal(r.err, undefined, r.err);
  assert.equal(fake.opened[0], 'https://mail.google.com/mail/u/0/#inbox');
  const d = done();
  assert.match(d.text, /^Your latest email is from Google\. The subject is Security alert\. It was received (?:today|yesterday|on [A-Za-z]+, [A-Za-z]+ \d+) at 3:15 PM\. Here's the email\. A new sign-in on Windows\. If this was you/);
  assert.match(d.display, /^From: Google <no-reply@accounts\.google\.com>\nSubject: Security alert\nDate: Sat, Oct 31, 2026, 3:15 PM\n\nA new sign-in on Windows\./);
  assert.ok(events.some(e => e.type === 'announcement' && /Opening Gmail in the browser/.test(e.text)));
  assert.deepEqual(r.ok.actions.map(a => a.type), ['email_read']);
});

test('"check my Gmail" reads/summarizes the three newest emails', { skip }, async () => {
  const r = await run('check my Gmail'); assert.equal(r.err, undefined, r.err);
  assert.deepEqual(r.ok.actions[0].count, 3);
  assert.ok(done().text); const disp = done().display;
  for (const s of ['Security alert', 'Re: Project plan', 'Issue 128', 'Let us ship on Monday', 'plan-v2.pdf']) assert.ok(disp.includes(s), s);
  assert.ok(!/wrote:/.test(disp));
});

test('"Do I have any new emails?" reports the unread count and senders without opening messages', { skip }, async () => {
  const r = await run('Do I have any new emails?'); assert.equal(r.err, undefined, r.err);
  assert.match(done().text, /You have 3 unread emails\. Newest: Google, subject Security alert; Priya Sharma, subject Re: Project plan/);
});

test('sender filter uses Gmail search in the browser', { skip }, async () => {
  const r = await run('Read the latest email from Google.'); assert.equal(r.err, undefined, r.err);
  assert.equal(fake.opened[0], 'https://mail.google.com/mail/u/0/#search/in%3Ainbox%20from%3A(google)');
});

test('not signed in: asks you to sign in, waits, then reads the email once you do', { skip }, async () => {
  fake.signedIn = false; setTimeout(() => fake.signIn(), 1800);
  const r = await run('read my latest email'); assert.equal(r.err, undefined, r.err);
  const ann = events.filter(e => e.type === 'announcement').map(e => e.text);
  assert.ok(ann.some(t => /not signed in to Gmail/i.test(t)), JSON.stringify(ann));
  assert.match(done().text, /subject is Security alert/);
});

test('Gmail ignores synthetic clicks: main.cjs performs a real DevTools mouse click and the email opens', { skip }, async () => {
  fake.requireTrusted = true; const r = await run('read my latest email'); fake.requireTrusted = false;
  assert.equal(r.err, undefined, r.err); assert.match(done().text, /subject is Security alert/);
});

test('empty inbox is reported honestly', { skip }, async () => {
  fake.emptyInbox = true; const r = await run('read my latest email'); fake.emptyInbox = false;
  assert.match(done().text, /couldn't find any emails in your inbox/);
});

test('if Gmail changes its layout the failure is spoken, nothing is invented', { skip }, async () => {
  fake.brokenClick = true; const r = await run('read my latest email'); fake.brokenClick = false;
  assert.match(r.err, /layout may have changed/); assert.ok(events.some(e => e.type === 'error' && /layout may have changed/.test(e.text))); assert.ok(!done());
});

test('"connect my gmail" signs in via the browser; no API/Google Cloud is touched', { skip }, async () => {
  const r = await run('connect my gmail'); assert.equal(r.err, undefined, r.err);
  assert.match(done().text, /signed in to Gmail/);
  assert.equal((await handlers.get('gmail:status')(ev)).configured, false); // no Google Cloud client configured, and none needed
});
