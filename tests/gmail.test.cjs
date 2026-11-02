'use strict';
// Tests electron/gmail.cjs against a LOCAL MOCK of Google's OAuth + Gmail API (test double, not Google).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { createGmailService, createSafeStorageTokenStore, GmailError, parseMessage, htmlToText } = require('../electron/gmail.cjs');

const b64 = s => Buffer.from(s).toString('base64url');
const H = (name, value) => ({ name, value });
const NOW = Date.now();

// ---- fixtures: realistic Gmail "format=full" payloads ----
const MSGS = {
  m_sec: { id: 'm_sec', threadId: 't1', internalDate: String(NOW - 3600e3), labelIds: ['INBOX', 'UNREAD'], snippet: 'Security alert snippet',
    payload: { mimeType: 'multipart/alternative', headers: [H('From', 'Google <no-reply@accounts.google.com>'), H('Subject', 'Security alert'), H('Date', new Date(NOW - 3600e3).toUTCString())],
      parts: [
        { mimeType: 'text/plain', headers: [H('Content-Type', 'text/plain; charset="UTF-8"')], body: { size: 50, data: b64('A new sign-in on Windows.\nIf this was you, you can ignore this email.') } },
        { mimeType: 'text/html', headers: [H('Content-Type', 'text/html; charset="UTF-8"')], body: { size: 90, data: b64('<html><body><p>A new sign-in on Windows.</p></body></html>') } },
      ] } },
  m_html: { id: 'm_html', threadId: 't2', internalDate: String(NOW - 26 * 3600e3), labelIds: ['INBOX'], snippet: 'Weekly digest',
    payload: { mimeType: 'text/html', headers: [H('From', '"Dev Weekly" <news@devweekly.example>'), H('Subject', '=?UTF-8?B?Q2Fmw6kgbmV3cw==?='), H('Content-Type', 'text/html; charset=UTF-8')],
      body: { size: 400, data: b64('<!DOCTYPE html><html><head><title>x</title><style>.a{color:red}</style><script>alert(1)</script></head><body><div><h1>Hello&nbsp;there</h1><p>Rock &amp; roll &#8212; it&rsquo;s <b>great</b>.</p><ul><li>One</li><li>Two</li></ul><a href="https://t.example/track?x=1">Read more</a><img src="x.png"></div></body></html>') } } },
  m_mixed: { id: 'm_mixed', threadId: 't3', internalDate: String(NOW - 50 * 3600e3), labelIds: ['INBOX'], snippet: 'Invoice attached',
    payload: { mimeType: 'multipart/mixed', headers: [H('From', 'billing@shop.example'), H('Subject', 'Invoice 42')],
      parts: [
        { mimeType: 'multipart/alternative', parts: [
          { mimeType: 'text/plain', headers: [H('Content-Type', 'text/plain; charset=iso-8859-1')], body: { size: 20, data: Buffer.from('Caf\xe9 total: 12 EUR', 'latin1').toString('base64url') } },
        ] },
        { mimeType: 'application/pdf', filename: 'invoice-42.pdf', body: { attachmentId: 'att1', size: 48213 } },
      ] } },
  m_empty_body: { id: 'm_empty_body', threadId: 't4', internalDate: String(NOW - 80 * 3600e3), labelIds: ['INBOX'], snippet: '',
    payload: { mimeType: 'multipart/mixed', headers: [H('From', 'x@y.example'), H('Subject', '(photo)')], parts: [{ mimeType: 'image/png', filename: 'p.png', body: { attachmentId: 'a2', size: 10 } }] } },
};

let google, gport, state;
function reset() { state = { inbox: ['m_sec', 'm_html', 'm_mixed'], refreshMode: 'ok', apiStatus: 200, tokenCalls: [], apiAuthHeaders: [], pkce: null, unread: 4, revoked: [] }; }
const base = () => `http://127.0.0.1:${gport}`;
const endpoints = () => ({ authUrl: `${base()}/auth`, tokenUrl: `${base()}/token`, revokeUrl: `${base()}/revoke`, apiBase: `${base()}/gmail/v1` });

before(async () => {
  reset();
  google = http.createServer(async (req, res) => {
    const u = new URL(req.url, base()); let raw = ''; for await (const c of req) raw += c;
    const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/auth') { // pretend the user clicked "Allow"
      state.pkce = { challenge: u.searchParams.get('code_challenge'), method: u.searchParams.get('code_challenge_method'), scope: u.searchParams.get('scope'), access_type: u.searchParams.get('access_type') };
      const redirect = new URL(u.searchParams.get('redirect_uri'));
      redirect.searchParams.set('code', 'auth-code-1'); redirect.searchParams.set('state', state.badState ? 'WRONG' : u.searchParams.get('state'));
      res.writeHead(302, { Location: redirect.toString() }); return res.end();
    }
    if (u.pathname === '/token') {
      const p = new URLSearchParams(raw); state.tokenCalls.push(Object.fromEntries(p));
      if (p.get('grant_type') === 'authorization_code') {
        const ok = crypto.createHash('sha256').update(p.get('code_verifier') || '').digest('base64url') === state.pkce.challenge;
        if (!ok || p.get('code') !== 'auth-code-1') return json(400, { error: 'invalid_grant', error_description: 'bad verifier' });
        return json(200, state.noRefreshToken ? { access_token: 'AT1', expires_in: 3600 } : { access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600, scope: state.pkce.scope });
      }
      if (state.refreshMode === 'invalid_grant') return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      return json(200, { access_token: 'AT-refreshed-' + state.tokenCalls.length, expires_in: 3600 });
    }
    if (u.pathname === '/revoke') { state.revoked.push(raw); return json(200, {}); }
    if (u.pathname.startsWith('/gmail/v1/')) {
      state.apiAuthHeaders.push(req.headers.authorization);
      if (state.apiStatus !== 200) return json(state.apiStatus, { error: { message: 'mock failure' } });
      if (u.pathname === '/gmail/v1/users/me/labels/INBOX') return json(200, { id: 'INBOX', messagesUnread: state.unread });
      if (u.pathname === '/gmail/v1/users/me/messages') { state.lastListQuery = Object.fromEntries(u.searchParams); state.lastLabelIds = u.searchParams.getAll('labelIds'); const n = Number(u.searchParams.get('maxResults') || 10); const ids = state.inbox.slice(0, n); return json(200, ids.length ? { messages: ids.map(id => ({ id, threadId: 't' })), resultSizeEstimate: ids.length } : { resultSizeEstimate: 0 }); }
      const m = u.pathname.match(/\/messages\/(\w+)$/); if (m) { assert.equal(u.searchParams.get('format'), 'full'); return json(200, MSGS[m[1]]); }
    }
    json(404, { error: 'nope' });
  });
  await new Promise(r => google.listen(0, '127.0.0.1', r)); gport = google.address().port;
});
after(() => google.close());
beforeEach(reset);

function memoryStore(initial) { let t = initial || null; return { load: async () => t, save: async o => { t = o; }, clear: async () => { t = null; }, peek: () => t }; }
const fresh = (over = {}) => ({ access_token: 'AT-valid', refresh_token: 'RT1', expires_at: Date.now() + 3600e3, ...over });
function svc(store, extra = {}) { return createGmailService({ clientId: 'cid.apps.googleusercontent.com', clientSecret: 'sec', tokenStore: store, endpoints: endpoints(), openExternal: async url => { await fetch(url); }, ...extra }); }

test('retrieves the NEWEST email with real decoded body, sender, subject, date', async () => {
  const [m] = await svc(memoryStore(fresh())).fetchMessages({ count: 1 });
  assert.equal(m.id, 'm_sec'); assert.equal(m.fromName, 'Google'); assert.equal(m.fromEmail, 'no-reply@accounts.google.com');
  assert.equal(m.subject, 'Security alert'); assert.equal(m.bodyFormat, 'text');
  assert.match(m.body, /A new sign-in on Windows\.\nIf this was you/); assert.ok(new Date(m.date).getTime() > NOW - 2 * 3600e3);
  assert.equal(m.unread, true);
  assert.deepEqual(state.lastLabelIds, ['INBOX']);
});

test('retrieves multiple recent emails, sorted newest first even if API order differs', async () => {
  state.inbox = ['m_mixed', 'm_sec', 'm_html'];
  const ms = await svc(memoryStore(fresh())).fetchMessages({ count: 3 });
  assert.deepEqual(ms.map(m => m.id), ['m_sec', 'm_html', 'm_mixed']);
});

test('HTML-only email: tags/style/script stripped, entities decoded, RFC2047 subject decoded', async () => {
  state.inbox = ['m_html'];
  const [m] = await svc(memoryStore(fresh())).fetchMessages({ count: 1 });
  assert.equal(m.bodyFormat, 'html'); assert.equal(m.subject, 'Café news'); assert.equal(m.fromName, 'Dev Weekly');
  assert.ok(!/[<>]/.test(m.body), m.body); assert.ok(!/alert\(1\)|color:red/.test(m.body));
  assert.match(m.body, /Hello there/); assert.match(m.body, /Rock & roll — it’s great\./); assert.match(m.body, /• One\n• Two/); assert.match(m.body, /Read more/); assert.ok(!/t\.example/.test(m.body));
});

test('nested multipart/mixed > alternative, non-UTF8 charset, and attachment metadata', async () => {
  state.inbox = ['m_mixed'];
  const [m] = await svc(memoryStore(fresh())).fetchMessages({ count: 1 });
  assert.equal(m.body, 'Café total: 12 EUR');
  assert.deepEqual(m.attachments, [{ filename: 'invoice-42.pdf', mimeType: 'application/pdf', size: 48213 }]);
});

test('email with no text body is reported as empty (never invented)', async () => {
  state.inbox = ['m_empty_body'];
  const [m] = await svc(memoryStore(fresh())).fetchMessages({ count: 1 });
  assert.equal(m.body, ''); assert.equal(m.bodyFormat, 'none'); assert.equal(m.attachments.length, 1);
});

test('empty inbox returns an empty list', async () => {
  state.inbox = [];
  assert.deepEqual(await svc(memoryStore(fresh())).fetchMessages({ count: 3 }), []);
});

test('search query and unread count are forwarded to Gmail', async () => {
  const s = svc(memoryStore(fresh()));
  await s.fetchMessages({ count: 2, query: 'from:(google) after:1700000000' });
  assert.equal(state.lastListQuery.q, 'from:(google) after:1700000000'); assert.equal(state.lastListQuery.maxResults, '2');
  assert.equal(await s.unreadCount(), 4);
});

test('expired access token is refreshed transparently and persisted', async () => {
  const store = memoryStore(fresh({ access_token: 'old', expires_at: Date.now() - 1000 }));
  const ms = await svc(store).fetchMessages({ count: 1 });
  assert.equal(ms.length, 1); assert.match(state.apiAuthHeaders[0], /^Bearer AT-refreshed-/);
  assert.equal(state.tokenCalls[0].grant_type, 'refresh_token'); assert.match(store.peek().access_token, /^AT-refreshed-/); assert.equal(store.peek().refresh_token, 'RT1');
});

test('revoked/expired refresh token -> AUTH_EXPIRED and tokens are cleared', async () => {
  state.refreshMode = 'invalid_grant';
  const store = memoryStore(fresh({ access_token: '', expires_at: 0 }));
  await assert.rejects(() => svc(store).fetchMessages({ count: 1 }), e => e instanceof GmailError && e.code === 'AUTH_EXPIRED' && /connect my Gmail/.test(e.message));
  assert.equal(store.peek(), null);
});

test('API 401 forces one refresh+retry; persistent 401 -> AUTH_EXPIRED', async () => {
  state.apiStatus = 401;
  const store = memoryStore(fresh());
  await assert.rejects(() => svc(store).fetchMessages({ count: 1 }), e => e.code === 'AUTH_EXPIRED');
  assert.ok(state.tokenCalls.some(c => c.grant_type === 'refresh_token'));
});

test('403 / 429 / 500 give actionable errors', async () => {
  for (const [code, re] of [[403, /Gmail API is enabled|denied access/], [429, /rate limiting/], [500, /returned an error \(500/]]) {
    state.apiStatus = code;
    await assert.rejects(() => svc(memoryStore(fresh())).fetchMessages({ count: 1 }), e => e.code === 'API_ERROR' && re.test(e.message));
  }
});

test('not configured (no client id) -> NOT_CONFIGURED; not connected -> NOT_AUTHORIZED', async () => {
  await assert.rejects(() => createGmailService({ clientId: '', tokenStore: memoryStore(), endpoints: endpoints(), openExternal() {} }).fetchMessages({}), e => e.code === 'NOT_CONFIGURED');
  await assert.rejects(() => svc(memoryStore(null)).fetchMessages({}), e => e.code === 'NOT_AUTHORIZED');
});

test('network failure -> NETWORK error, no fake data', async () => {
  const s = createGmailService({ clientId: 'x', tokenStore: memoryStore(fresh()), endpoints: { apiBase: 'http://127.0.0.1:1/gmail/v1' }, openExternal() {} });
  await assert.rejects(() => s.fetchMessages({}), e => e.code === 'NETWORK');
});

test('OAuth: loopback + PKCE(S256) + read-only scope + offline access; tokens stored', async () => {
  const store = memoryStore(null); const s = svc(store);
  assert.equal(await s.ensureAuthorized(), true);
  assert.equal(state.pkce.method, 'S256'); assert.equal(state.pkce.scope, 'https://www.googleapis.com/auth/gmail.readonly'); assert.equal(state.pkce.access_type, 'offline');
  assert.equal(store.peek().refresh_token, 'RT1'); assert.deepEqual(await s.status(), { configured: true, connected: true, scope: 'https://www.googleapis.com/auth/gmail.readonly' });
  assert.equal(await s.ensureAuthorized(), false);
  const ms = await s.fetchMessages({ count: 1 }); assert.equal(ms[0].id, 'm_sec');
});

test('OAuth: state mismatch is rejected and nothing is stored', async () => {
  state.badState = true; const store = memoryStore(null);
  await assert.rejects(() => svc(store).authorize(), e => /state mismatch/.test(e.message)); assert.equal(store.peek(), null);
});

test('OAuth: missing refresh token and user cancellation are handled', async () => {
  state.noRefreshToken = true; const store = memoryStore(null);
  await assert.rejects(() => svc(store).authorize(), e => /refresh token/.test(e.message)); assert.equal(store.peek(), null);
  const denied = svc(memoryStore(null), { openExternal: async url => { const u = new URL(url); const r = new URL(u.searchParams.get('redirect_uri')); r.searchParams.set('error', 'access_denied'); r.searchParams.set('state', u.searchParams.get('state')); await fetch(r); } });
  await assert.rejects(() => denied.authorize(), e => /access_denied/.test(e.message));
});

test('OAuth: timeout when the user never completes consent', async () => {
  await assert.rejects(() => svc(memoryStore(null), { authTimeoutMs: 150, openExternal() {} }).authorize(), e => e.code === 'AUTH_TIMEOUT');
});

test('disconnect revokes at Google and deletes stored tokens', async () => {
  const store = memoryStore(fresh()); await svc(store).disconnect();
  assert.equal(store.peek(), null); assert.match(state.revoked[0], /token=RT1/);
});

test('token store encrypts at rest (no plaintext tokens in the file)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neura-tok-')); const file = path.join(dir, 'gmail-token.bin');
  const key = crypto.randomBytes(32);
  const fakeSafe = { isEncryptionAvailable: () => true, encryptString: s => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv); const e = Buffer.concat([c.update(s, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), e]); },
    decryptString: b => { const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); } };
  const st = createSafeStorageTokenStore({ safeStorage: fakeSafe, filePath: file, fs });
  await st.save({ refresh_token: 'SUPER-SECRET-RT' });
  assert.ok(!fs.readFileSync(file).toString('latin1').includes('SUPER-SECRET-RT'));
  assert.equal((await st.load()).refresh_token, 'SUPER-SECRET-RT');
  await st.clear(); assert.equal(await st.load(), null);
  const noEnc = createSafeStorageTokenStore({ safeStorage: { isEncryptionAvailable: () => false }, filePath: file, fs });
  await assert.rejects(() => noEnc.save({ a: 1 }), /unavailable/);
});

test('htmlToText / parseMessage edge cases', () => {
  assert.equal(htmlToText('<p>a</p><p>b</p>'), 'a\nb');
  assert.equal(htmlToText('&unknown; &#x1F600; &#0;'), '&unknown; 😀');
  assert.equal(parseMessage({ id: 'x', payload: { headers: [], body: {} } }).body, '');
});
