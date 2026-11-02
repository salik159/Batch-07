'use strict';
// Gmail reader that drives the EXISTING NeuraOS browser agent (Chrome via DevTools). No Google Cloud, no API.
// Browser primitives are injected: open(url), evaluate(js) and optionally click(x, y) (trusted mouse click via CDP).
// NOTE: Gmail's DOM uses obfuscated class names (tr.zA, .bog, .gD, .a3s ...). They have been stable for
// years but Google can change them; every extraction is validated and failures are reported, never faked.
// Gmail keeps hidden copies of the inbox list and of previously opened conversations in the page, so every
// query below only considers VISIBLE elements.

const MAIL_BASE = 'https://mail.google.com/mail/u/0/';
const LOGIN_URL = 'https://accounts.google.com/ServiceLogin?service=mail&continue=' + encodeURIComponent(MAIL_BASE);

const VIS = `const vis = el => !!el && el.getClientRects().length > 0;
  const q = (sel, root) => [...(root || document).querySelectorAll(sel)].filter(vis);
  const t = el => (el && (el.innerText || el.textContent) || '').trim();`;

// Runs in the page. Returns what the tab is showing.
const STATE_JS = `(() => {
  ${VIS}
  const host = location.host, href = location.href;
  if (host === 'accounts.google.com') return { kind: 'login', href };
  if (host !== 'mail.google.com') return { kind: /workspace\\.google\\.com|google\\.com\\/gmail|about\\/gmail/.test(href) ? 'landing' : 'other', href };
  if (q('input[type=password], input#identifierId').length) return { kind: 'login', href };
  const unreadMatch = /\\((\\d[\\d,]*)\\)/.exec(document.title || '');
  const unreadCount = unreadMatch ? Number(unreadMatch[1].replace(/,/g, '')) : 0;
  if (q('h2.hP').length && q('.a3s').length) return { kind: 'message', href, unreadCount };
  if (q('tr.zA').length) return { kind: 'list', href, unreadCount };
  const main = q('[role=main]')[0];
  const txt = main ? main.innerText : '';
  if (/no (new )?(mail|messages|conversations)|nothing in|tab is empty|no messages matched|didn.t match any/i.test(txt)) return { kind: 'empty', href, unreadCount };
  return { kind: 'loading', href, unreadCount };
})()`;

// Runs in the page. Visible rows of the list view.
const LIST_JS = (max) => `(() => {
  ${VIS}
  const rows = q('tr.zA').slice(0, ${Number(max) || 5});
  const n = el => t(el).replace(/\\s+/g, ' ');
  return rows.map((r, i) => {
    const s = r.querySelector('.yW span[email], .yP[email], span.zF, .yX .yW span');
    const dt = r.querySelector('.xW span');
    const idEl = r.querySelector('[data-legacy-thread-id]');
    return {
      index: i,
      fromName: (s && (s.getAttribute('name') || n(s))) || '',
      fromEmail: (s && s.getAttribute('email')) || '',
      subject: n(r.querySelector('.bog')),
      snippet: n(r.querySelector('.y2')).replace(/^-\\s*/, ''),
      dateText: (dt && (dt.getAttribute('title') || n(dt))) || '',
      unread: r.classList.contains('zE'),
      threadId: (idEl && idEl.getAttribute('data-legacy-thread-id')) || '',
    };
  });
})()`;

// Runs in the page. Centre point (viewport coordinates) of row #i's subject cell, for a real mouse click.
const ROW_POINT_JS = (i) => `(() => {
  ${VIS}
  const r = q('tr.zA')[${Number(i)}];
  if (!r) return null;
  r.scrollIntoView({ block: 'center' });
  const target = r.querySelector('.bog') || r.querySelector('td.xY') || r;
  const b = target.getBoundingClientRect();
  return { x: Math.round(b.left + Math.min(b.width / 2, 120)), y: Math.round(b.top + b.height / 2) };
})()`;

// Runs in the page. Synthetic click fallback.
const OPEN_ROW_JS = (i) => `(() => {
  ${VIS}
  const r = q('tr.zA')[${Number(i)}];
  if (!r) return false;
  r.scrollIntoView({ block: 'center' });
  const target = r.querySelector('.bog') || r.querySelector('td.xY') || r;
  for (const type of ['mousedown', 'mouseup', 'click']) target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  return true;
})()`;

// Runs in the page. Newest message of the visible conversation (the last one with a rendered body).
const EXTRACT_JS = `(() => {
  ${VIS}
  const containers = q('.adn');
  let scope = null;
  for (let i = containers.length - 1; i >= 0; i--) if (q('.a3s', containers[i]).length) { scope = containers[i]; break; }
  const root = scope || document;
  const from = q('.gD', root)[0] || (root.querySelector && root.querySelector('.gD'));
  const dateEl = q('.g3', root)[0] || (root.querySelector && root.querySelector('.g3'));
  const bodyEl = q('.a3s.aiL', root)[0] || q('.a3s', root)[0];
  const atts = q('.aZo [download_url], .aQH .aV3, .aZo .aV3', root).map(a => (a.getAttribute('download_url') ? a.getAttribute('download_url').split(':')[1] : t(a))).filter(Boolean);
  const h = q('h2.hP')[0] || q('[role=main] h2')[0];
  return {
    subject: t(h),
    fromName: (from && (from.getAttribute('name') || t(from))) || '',
    fromEmail: (from && from.getAttribute('email')) || '',
    dateText: (dateEl && (dateEl.getAttribute('title') || t(dateEl))) || '',
    body: t(bodyEl),
    attachments: [...new Set(atts)],
  };
})()`;

// Runs in the page. Short description of what the page looks like, appended to error messages for diagnosis.
const DEBUG_JS = `(() => {
  ${VIS}
  return { hash: location.hash.slice(0, 60), rows: q('tr.zA').length, allRows: document.querySelectorAll('tr.zA').length, subjects: q('h2.hP').length, bodies: q('.a3s').length, allBodies: document.querySelectorAll('.a3s').length };
})()`;

function tidyBody(s) {
  let t = String(s || '').replace(/\r/g, '').replace(/[\u200b-\u200f\u2060\ufeff\u00ad\u034f]/g, '').replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  // Drop quoted reply history ("On <date>, X wrote:") so only the new message is read.
  const cut = t.search(/\n\s*On .{5,140} wrote:\s*(\n|$)/);
  if (cut > 40) t = t.slice(0, cut).trim();
  return t;
}
// Gmail's date title looks like "Sat, Oct 31, 2026, 3:15 PM" (or "... at 3:15 PM"); returns ISO or ''.
function parseGmailDate(text) {
  const s = String(text || '').replace(/\u202f|\u00a0/g, ' ').replace(/^[A-Za-z]{3,9},\s*/, '').replace(/\s+at\s+/i, ', ').trim();
  const d = new Date(s);
  return isNaN(d) ? '' : d.toISOString();
}

class GmailBrowserError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

function createGmailBrowserReader({ open, evaluate, click = null, sleep = ms => new Promise(r => setTimeout(r, ms)), emit = () => {}, bringToFront = async () => {}, loginTimeoutMs = 180000, pageTimeoutMs = 25000, openTimeoutMs = 7000, pollMs = 600 }) {
  async function waitFor(pred, timeoutMs) {
    const start = Date.now(); let last = null;
    while (Date.now() - start < timeoutMs) {
      try { last = await evaluate(STATE_JS); } catch { last = null; }
      if (last && pred(last)) return last;
      await sleep(pollMs);
    }
    return last;
  }
  const READY = s => ['list', 'empty', 'message'].includes(s.kind);
  const diag = async () => { try { return ' [page: ' + JSON.stringify(await evaluate(DEBUG_JS)) + ']'; } catch { return ''; } };

  async function ensureSignedIn(url) {
    await open(url);
    let st = await waitFor(s => READY(s) || s.kind === 'login' || s.kind === 'landing', pageTimeoutMs);
    if (st && READY(st)) return st;
    if (st && st.kind === 'landing') { await open(LOGIN_URL); st = await waitFor(s => READY(s) || s.kind === 'login', pageTimeoutMs); if (st && READY(st)) return st; }
    if (st && st.kind === 'login') {
      emit({ type: 'announcement', agent: 'email', text: 'You are not signed in to Gmail. Please sign in in the browser window. I will wait.' });
      try { await bringToFront(); } catch {}
      st = await waitFor(s => READY(s), loginTimeoutMs);
      if (st && READY(st)) return st;
      throw new GmailBrowserError('LOGIN_TIMEOUT', 'I did not see you sign in to Gmail in time. Say "check my Gmail" again once you are signed in.');
    }
    throw new GmailBrowserError('PAGE', `Gmail did not load${st?.href ? ` (the browser is at ${String(st.href).slice(0, 80)})` : ''}. Check your internet connection and try again.` + await diag());
  }

  async function backToList(url) {
    await evaluate(`location.hash = ${JSON.stringify(new URL(url).hash || '#inbox')}; true`);
    return waitFor(s => s.kind === 'list' || s.kind === 'empty', pageTimeoutMs);
  }

  // Open row #i like a user would: trusted mouse click, then synthetic click, then direct thread URL.
  async function openRow(i, row, url) {
    const isOpen = () => waitFor(s => s.kind === 'message', openTimeoutMs).then(s => s && s.kind === 'message');
    if (click) {
      try { const pt = await evaluate(ROW_POINT_JS(i)); if (pt && Number.isFinite(pt.x)) { await click(pt.x, pt.y); if (await isOpen()) return true; } } catch {}
    }
    try { if (await evaluate(OPEN_ROW_JS(i)) && await isOpen()) return true; } catch {}
    if (row && row.threadId) {
      try { await evaluate(`location.hash = ${JSON.stringify((new URL(url).hash || '#inbox') + '/' + row.threadId)}; true`); if (await isOpen()) return true; } catch {}
    }
    return false;
  }

  /** read({count, uiQuery, listOnly}) -> { messages, unreadCount } */
  async function read({ count = 1, uiQuery = '', listOnly = false } = {}) {
    const n = Math.max(1, Math.min(5, Number(count) || 1));
    const url = uiQuery ? `${MAIL_BASE}#search/${encodeURIComponent(uiQuery)}` : `${MAIL_BASE}#inbox`;
    const st = await ensureSignedIn(url);
    try { await bringToFront(); } catch {}
    if (st.kind === 'empty') return { messages: [], unreadCount: st.unreadCount || 0 };
    let ready = st;
    if (ready.kind === 'message') ready = await backToList(url);   // Gmail restored an open conversation
    if (!ready || ready.kind === 'empty') return { messages: [], unreadCount: ready?.unreadCount || 0 };

    const rows = await evaluate(LIST_JS(n));
    if (!Array.isArray(rows) || !rows.length) throw new GmailBrowserError('DOM', 'I could not read the Gmail inbox list. Gmail\'s page layout may have changed.' + await diag());
    const unreadCount = ready.unreadCount || 0;
    if (listOnly) return { unreadCount, messages: rows.map(r => ({ id: String(r.index), fromName: r.fromName, fromEmail: r.fromEmail, subject: r.subject, date: parseGmailDate(r.dateText), dateText: r.dateText, snippet: r.snippet, body: '', attachments: [], unread: r.unread })) };

    const messages = [];
    for (let i = 0; i < rows.length; i++) {
      if (i > 0) { const back = await backToList(url); if (!back || back.kind !== 'list') break; }
      if (!(await openRow(i, rows[i], url))) throw new GmailBrowserError('DOM', 'I could not open the email in Gmail. Gmail\'s page layout may have changed.' + await diag());
      await sleep(500); // let the body finish rendering
      const m = await evaluate(EXTRACT_JS);
      if (!m || (!m.subject && !m.body)) throw new GmailBrowserError('DOM', 'I opened the email but could not read its text. Gmail\'s page layout may have changed.' + await diag());
      const row = rows[i];
      messages.push({
        id: String(i), fromName: m.fromName || row.fromName, fromEmail: m.fromEmail || row.fromEmail, subject: m.subject || row.subject,
        date: parseGmailDate(m.dateText) || parseGmailDate(row.dateText), dateText: m.dateText || row.dateText,
        snippet: row.snippet, body: tidyBody(m.body), attachments: (m.attachments || []).map(filename => ({ filename })), unread: row.unread,
      });
    }
    if (!messages.length) throw new GmailBrowserError('DOM', 'I could not read any email from Gmail.');
    return { messages, unreadCount };
  }

  async function connect() { const st = await ensureSignedIn(`${MAIL_BASE}#inbox`); return !!st; }
  return { read, connect };
}

/** Gmail UI search string (dates as yyyy/mm/dd, which the Gmail web UI understands). */
function gmailUiQuery(req) {
  const ymd = epoch => { const d = new Date(epoch * 1000); return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`; };
  const parts = ['in:inbox'];
  if (req.unreadOnly) parts.push('is:unread');
  if (req.from) parts.push(/@/.test(req.from) ? `from:${req.from}` : `from:(${req.from})`);
  if (req.after) parts.push(`after:${ymd(req.after)}`);
  if (req.before) parts.push(`before:${ymd(req.before)}`);
  return parts.length > 1 ? parts.join(' ') : '';
}

module.exports = { createGmailBrowserReader, GmailBrowserError, parseGmailDate, tidyBody, gmailUiQuery, STATE_JS, LIST_JS, OPEN_ROW_JS, ROW_POINT_JS, EXTRACT_JS, DEBUG_JS, MAIL_BASE, LOGIN_URL };
