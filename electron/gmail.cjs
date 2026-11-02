'use strict';
// NeuraOS Gmail service: official Gmail REST API + OAuth 2.0 (installed-app / loopback + PKCE).
// Read-only scope. Dependencies (token store, browser opener, fetch) are injected so the module
// can run inside Electron (safeStorage + shell.openExternal) and under plain Node for tests.
const http = require('node:http');
const crypto = require('node:crypto');

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const DEFAULTS = {
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  revokeUrl: 'https://oauth2.googleapis.com/revoke',
  apiBase: 'https://gmail.googleapis.com/gmail/v1',
};

class GmailError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
// codes: NOT_CONFIGURED, NOT_AUTHORIZED, AUTH_EXPIRED, AUTH_TIMEOUT, API_ERROR, NETWORK

/* ---------------- MIME / body decoding ---------------- */
function b64urlToBuffer(data) {
  return Buffer.from(String(data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
function decodeBuffer(buf, charset) {
  const cs = String(charset || 'utf-8').toLowerCase().replace(/^"|"$/g, '');
  try { return new TextDecoder(cs === 'us-ascii' ? 'utf-8' : cs, { fatal: false }).decode(buf); }
  catch { return buf.toString('utf8'); }
}
const hdr = (headers, name) => (headers || []).find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
const charsetOf = (headers) => (hdr(headers, 'Content-Type').match(/charset\s*=\s*"?([\w.\-:]+)"?/i) || [])[1];

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', copy: '©', reg: '®', trade: '™', zwnj: '', zwj: '' };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; } catch { return ''; }
    }
    const v = ENTITIES[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}
function htmlToText(html) {
  let t = String(html || '');
  t = t.replace(/<!--[\s\S]*?-->/g, ' ')
       .replace(/<(script|style|head|title|noscript)[\s\S]*?<\/\1\s*>/gi, ' ')
       .replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, href, inner) => {
         const text = inner.replace(/<[^>]+>/g, '').trim();
         return text || '';
       })
       .replace(/<img\b[^>]*>/gi, ' ')
       .replace(/<br\s*\/?>/gi, '\n')
       .replace(/<\/(p|div|tr|h[1-6]|table|ul|ol|blockquote|section|article)>/gi, '\n')
       .replace(/<(td|th)\b[^>]*>/gi, ' ')
       .replace(/<li\b[^>]*>/gi, '\n• ')
       .replace(/<[^>]+>/g, '');   // inline tags (b, i, span, a...) vanish without adding spaces
  t = decodeEntities(t);
  return tidy(t);
}
function tidy(t) {
  return String(t).replace(/\r/g, '').replace(/[\u200b-\u200f\u2060\ufeff\u00ad\u034f]/g, '').replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Walk a Gmail payload tree; return { text, html, attachments }. Handles multipart/*, nested, base64url, charsets. */
function walkPayload(part, acc = { text: [], html: [], attachments: [] }) {
  if (!part) return acc;
  const mime = (part.mimeType || '').toLowerCase();
  const filename = part.filename || '';
  if (filename && (part.body?.attachmentId || part.body?.size)) {
    acc.attachments.push({ filename, mimeType: part.mimeType || 'application/octet-stream', size: part.body?.size || 0 });
  } else if (part.body?.data && (mime === 'text/plain' || mime === 'text/html')) {
    const text = decodeBuffer(b64urlToBuffer(part.body.data), charsetOf(part.headers));
    (mime === 'text/html' ? acc.html : acc.text).push(text);
  }
  for (const child of part.parts || []) walkPayload(child, acc);
  return acc;
}
function parseFrom(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { fromName: decodeMimeWords(m[1]).trim(), fromEmail: m[2].trim() };
  return { fromName: '', fromEmail: s };
}
function decodeMimeWords(s) {
  return String(s || '').replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (m, cs, enc, txt) => {
    try {
      const buf = enc.toLowerCase() === 'b' ? Buffer.from(txt, 'base64')
        : Buffer.from(txt.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (x, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
      return decodeBuffer(buf, cs);
    } catch { return m; }
  }).replace(/\?=\s+=\?/g, '');
}

/** Convert a Gmail API `users.messages.get?format=full` response to NeuraOS' message shape. */
function parseMessage(msg) {
  const headers = msg.payload?.headers || [];
  const acc = walkPayload(msg.payload);
  const plain = tidy(acc.text.join('\n\n'));
  const fromHtml = acc.html.length ? htmlToText(acc.html.join('\n')) : '';
  const body = plain || fromHtml;
  const { fromName, fromEmail } = parseFrom(hdr(headers, 'From'));
  const internal = Number(msg.internalDate);
  const date = Number.isFinite(internal) && internal > 0 ? new Date(internal).toISOString()
    : (hdr(headers, 'Date') && !isNaN(new Date(hdr(headers, 'Date'))) ? new Date(hdr(headers, 'Date')).toISOString() : '');
  return {
    id: msg.id, threadId: msg.threadId, internalDate: internal || 0,
    fromName, fromEmail, subject: decodeMimeWords(hdr(headers, 'Subject')).trim(),
    date, snippet: decodeEntities(msg.snippet || ''),
    body, bodyFormat: plain ? 'text' : (fromHtml ? 'html' : 'none'),
    attachments: acc.attachments, unread: (msg.labelIds || []).includes('UNREAD'),
  };
}

/* ---------------- Service ---------------- */
function createGmailService(opts) {
  const cfg = { ...DEFAULTS, ...(opts.endpoints || {}) };
  const clientId = () => (typeof opts.clientId === 'function' ? opts.clientId() : opts.clientId) || '';
  const clientSecret = () => (typeof opts.clientSecret === 'function' ? opts.clientSecret() : opts.clientSecret) || '';
  const fetchFn = opts.fetch || fetch;
  const store = opts.tokenStore;           // { load(): Promise<obj|null>, save(obj), clear() }
  const openExternal = opts.openExternal;  // (url) => void
  const authTimeoutMs = opts.authTimeoutMs || 180000;
  let cached = null;
  let authInFlight = null;

  const configured = () => !!clientId();
  function requireConfigured() {
    if (!configured()) throw new GmailError('NOT_CONFIGURED', 'Gmail is not set up yet. Add GOOGLE_CLIENT_ID to the .env file (see GMAIL_SETUP.md), then restart NeuraOS.');
  }
  async function tokens() { if (!cached) cached = await store.load(); return cached; }
  async function setTokens(t) { cached = t; if (t) await store.save(t); else await store.clear(); }

  async function postForm(url, params) {
    let r;
    try { r = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() }); }
    catch (e) { throw new GmailError('NETWORK', 'I could not reach Google. Please check your internet connection.'); }
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data: d };
  }

  async function refresh(t) {
    if (!t?.refresh_token) throw new GmailError('NOT_AUTHORIZED', 'Gmail needs to be connected again.');
    const params = { client_id: clientId(), refresh_token: t.refresh_token, grant_type: 'refresh_token' };
    if (clientSecret()) params.client_secret = clientSecret();
    const { ok, data } = await postForm(cfg.tokenUrl, params);
    if (!ok) {
      if (data.error === 'invalid_grant' || data.error === 'invalid_client' || data.error === 'unauthorized_client') {
        await setTokens(null);
        throw new GmailError('AUTH_EXPIRED', 'Your Gmail authorization has expired or was revoked. Say "connect my Gmail" to authorize NeuraOS again.');
      }
      throw new GmailError('API_ERROR', `Google rejected the token refresh (${data.error || 'unknown error'}).`);
    }
    const next = { ...t, access_token: data.access_token, expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000 - 60000, scope: data.scope || t.scope };
    if (data.refresh_token) next.refresh_token = data.refresh_token;
    await setTokens(next);
    return next;
  }

  async function accessToken() {
    requireConfigured();
    let t = await tokens();
    if (!t) throw new GmailError('NOT_AUTHORIZED', 'Gmail is not connected yet.');
    if (!t.access_token || !t.expires_at || Date.now() >= t.expires_at) t = await refresh(t);
    return t.access_token;
  }

  async function api(path, query = {}, retried = false) {
    const token = await accessToken();
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (Array.isArray(v)) v.forEach(x => qs.append(k, x)); else if (v !== undefined && v !== '') qs.append(k, v);
    }
    let r;
    try { r = await fetchFn(`${cfg.apiBase}${path}${qs.toString() ? '?' + qs : ''}`, { headers: { Authorization: `Bearer ${token}` } }); }
    catch { throw new GmailError('NETWORK', 'I could not reach Gmail. Please check your internet connection.'); }
    if (r.status === 401 && !retried) {   // token invalidated server-side: force one refresh
      const t = await tokens(); if (t) { await setTokens({ ...t, access_token: '', expires_at: 0 }); return api(path, query, true); }
    }
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { await setTokens(null); throw new GmailError('AUTH_EXPIRED', 'Gmail rejected the saved authorization. Say "connect my Gmail" to authorize again.'); }
    if (r.status === 403) throw new GmailError('API_ERROR', `Gmail denied access (${d?.error?.message || 'forbidden'}). Make sure the Gmail API is enabled for your Google Cloud project and the read-only permission was granted.`);
    if (r.status === 429) throw new GmailError('API_ERROR', 'Gmail is rate limiting requests. Please try again in a minute.');
    if (!r.ok) throw new GmailError('API_ERROR', `Gmail returned an error (${r.status}${d?.error?.message ? ': ' + d.error.message : ''}).`);
    return d;
  }

  /* ---- OAuth: loopback redirect + PKCE (RFC 8252) ---- */
  function authorize() {
    requireConfigured();
    if (authInFlight) return authInFlight;
    authInFlight = new Promise((resolve, reject) => {
      const verifier = crypto.randomBytes(48).toString('base64url');
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      const state = crypto.randomBytes(16).toString('hex');
      let done = false;
      const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); try { server.close(); } catch {} authInFlight = null; fn(v); };
      const server = http.createServer(async (req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (u.pathname !== '/oauth2callback') { res.writeHead(404); return res.end(); }
        const page = (title, msg) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><meta charset="utf-8"><title>NeuraOS</title><body style="font-family:system-ui;background:#02060b;color:#cfefff;display:grid;place-items:center;height:100vh"><div style="text-align:center"><h2>${title}</h2><p>${msg}</p></div>`); };
        if (u.searchParams.get('state') !== state) { page('Authorization failed', 'State mismatch. Please try again from NeuraOS.'); return finish(reject, new GmailError('NOT_AUTHORIZED', 'Gmail authorization failed (state mismatch).')); }
        const err = u.searchParams.get('error');
        if (err) { page('Authorization cancelled', 'You can close this tab and return to NeuraOS.'); return finish(reject, new GmailError('NOT_AUTHORIZED', `Gmail authorization was not granted (${err}).`)); }
        const code = u.searchParams.get('code');
        try {
          const params = { code, client_id: clientId(), code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: `http://127.0.0.1:${server.address().port}/oauth2callback` };
          if (clientSecret()) params.client_secret = clientSecret();
          const { ok, data } = await postForm(cfg.tokenUrl, params);
          if (!ok) { page('Authorization failed', 'Google rejected the request. Return to NeuraOS for details.'); return finish(reject, new GmailError('API_ERROR', `Google rejected the authorization code (${data.error_description || data.error || 'unknown'}).`)); }
          if (!data.refresh_token) { page('Almost there', 'Google did not return a refresh token. Remove NeuraOS from your Google account permissions and try again.'); return finish(reject, new GmailError('NOT_AUTHORIZED', 'Google did not return a refresh token. Remove NeuraOS at myaccount.google.com/permissions and connect again.')); }
          await setTokens({ access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000 - 60000, scope: data.scope });
          page('NeuraOS is connected to Gmail', 'You can close this tab and return to NeuraOS.');
          finish(resolve, true);
        } catch (e) { page('Authorization failed', 'See NeuraOS for details.'); finish(reject, e); }
      });
      const timer = setTimeout(() => finish(reject, new GmailError('AUTH_TIMEOUT', 'Gmail authorization timed out. Please try again.')), authTimeoutMs);
      server.on('error', e => finish(reject, new GmailError('API_ERROR', `Could not start the local authorization listener: ${e.message}`)));
      server.listen(0, '127.0.0.1', () => {
        const redirect = `http://127.0.0.1:${server.address().port}/oauth2callback`;
        const url = `${cfg.authUrl}?${new URLSearchParams({ client_id: clientId(), redirect_uri: redirect, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256', state })}`;
        try { openExternal(url); } catch (e) { finish(reject, new GmailError('API_ERROR', `Could not open the browser for authorization: ${e.message}`)); }
      });
    });
    return authInFlight;
  }

  /* ---- Public API ---- */
  async function status() {
    const t = await tokens();
    return { configured: configured(), connected: !!t?.refresh_token, scope: SCOPE };
  }
  async function disconnect() {
    const t = await tokens();
    if (t?.refresh_token || t?.access_token) {
      try { await postForm(cfg.revokeUrl, { token: t.refresh_token || t.access_token }); } catch {}
    }
    await setTokens(null);
    return true;
  }
  async function ensureAuthorized() {
    const t = await tokens();
    if (t?.refresh_token) return false;
    await authorize();
    return true; // freshly authorized
  }
  async function unreadCount() {
    const l = await api('/users/me/labels/INBOX');
    return Number(l.messagesUnread) || 0;
  }
  /** List newest inbox messages (full content), newest first. */
  async function fetchMessages({ count = 1, query = '' } = {}) {
    const n = Math.max(1, Math.min(10, Number(count) || 1));
    const list = await api('/users/me/messages', { maxResults: n, labelIds: ['INBOX'], q: query || undefined });
    const ids = (list.messages || []).map(m => m.id);
    if (!ids.length) return [];
    const full = await Promise.all(ids.map(id => api(`/users/me/messages/${encodeURIComponent(id)}`, { format: 'full' })));
    return full.map(parseMessage).sort((a, b) => b.internalDate - a.internalDate);
  }
  return { status, authorize, ensureAuthorized, disconnect, fetchMessages, unreadCount, configured };
}

/* ---------------- Encrypted token store for Electron (safeStorage) ---------------- */
function createSafeStorageTokenStore({ safeStorage, filePath, fs }) {
  const path = require('node:path');
  return {
    async load() {
      try {
        if (!fs.existsSync(filePath)) return null;
        const raw = fs.readFileSync(filePath);
        if (!safeStorage.isEncryptionAvailable()) return null;
        return JSON.parse(safeStorage.decryptString(raw));
      } catch { return null; }
    },
    async save(obj) {
      if (!safeStorage.isEncryptionAvailable()) throw new GmailError('API_ERROR', 'Secure token storage is unavailable on this system, so Gmail tokens were not saved.');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, safeStorage.encryptString(JSON.stringify(obj)), { mode: 0o600 });
    },
    async clear() { try { fs.unlinkSync(filePath); } catch {} },
  };
}

module.exports = { createGmailService, createSafeStorageTokenStore, GmailError, parseMessage, htmlToText, SCOPE };
