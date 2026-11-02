'use strict';
// TEST DOUBLE: a fake Gmail web page (jsdom) that mimics Gmail's DOM structure (tr.zA rows, .bog, .yW span[email],
// .xW, h2.hP, .adn, .gD, .g3, .a3s.aiL ...), plus a fake Chrome DevTools server for main.cjs.
// It proves the reader's logic against the DOM *shape* we target; it is NOT real Gmail.
const http = require('node:http');
const { JSDOM } = require('jsdom');

const page = (data, view) => `<!doctype html><html><head><title>${data.title}</title></head><body>
<div role="main"><div id="listwrap"><table><tbody id="list"></tbody></table><div id="emptymsg"></div></div><div id="views"></div></div>
<script>
const DATA=${JSON.stringify(data)};
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
// Like real Gmail: the inbox list and previously opened conversations stay in the DOM, merely hidden.
function hideViews(){ document.querySelectorAll('.tv').forEach(v=>v.style.display='none'); }
function renderList(){
  hideViews(); document.getElementById('listwrap').style.display='';
  const tb=document.getElementById('list');
  if(DATA.emptyInbox){ tb.innerHTML=''; document.getElementById('emptymsg').textContent='Your Primary tab is empty.'; return; }
  if(DATA.brokenLayout){ tb.innerHTML='<tr class="zzz"><td>x</td></tr>'; return; }
  tb.innerHTML=DATA.threads.map((t,i)=>'<tr class="zA '+(t.unread?'zE':'yO')+'"><td class="xY"><div class="yW"><span email="'+esc(t.fromEmail)+'" name="'+esc(t.fromName)+'">'+esc(t.fromName)+'</span></div></td><td class="xY"><span class="bog">'+esc(t.subject)+'</span><span class="y2"> - '+esc(t.snippet)+'</span>'+(DATA.noLegacyIds?'':'<span data-legacy-thread-id="LEG'+i+'" style="display:none"></span>')+'</td><td class="xW"><span title="'+esc(t.dateTitle)+'">'+esc(t.dateShort)+'</span></td></tr>').join('');
}
function threadHtml(t){
  return '<h2 class="hP">'+esc(t.subject)+'</h2>'+t.messages.map(m=>'<div class="adn"><span class="gD" email="'+esc(m.fromEmail)+'" name="'+esc(m.fromName)+'">'+esc(m.fromName)+'</span>'+(m.collapsed?'':'<span class="g3" title="'+esc(m.dateTitle)+'">x</span><div class="a3s aiL">'+esc(m.body)+'</div>'+((t.attachments||[]).length?'<div class="aZo">'+t.attachments.map(a=>'<span class="aV3">'+esc(a)+'</span>').join('')+'</div>':''))+'</div>').join('');
}
function openThread(i){
  const t=DATA.threads[i]; document.getElementById('listwrap').style.display='none'; hideViews();
  const views=document.getElementById('views'); let v=views.querySelector('.tv[data-i="'+i+'"]');
  if(!v){ v=document.createElement('div'); v.className='tv'; v.setAttribute('data-i',i); v.innerHTML=threadHtml(t); views.insertBefore(v,views.firstChild); } // newest view FIRST: stale ones come later in the DOM
  v.style.display='';
  const parts=location.hash.split('/'); const base=parts[0]==='#search'?parts.slice(0,2).join('/'):parts[0];
  if(parts.length<=(parts[0]==='#search'?2:1)) location.hash=base+'/FMfcgz'+i;
}
document.addEventListener('click',e=>{
  if(DATA.brokenClick) return;
  if(DATA.requireTrusted && !window.__trusted) return; // untrusted synthetic clicks ignored
  if(document.getElementById('listwrap').style.display==='none') return;
  const tr=e.target.closest&&e.target.closest('tr.zA'); if(tr) openThread([...document.querySelectorAll('tr.zA')].indexOf(tr));
});
window.addEventListener('hashchange',()=>{
  const p=location.hash.split('/'); const last=p[p.length-1];
  if((p[0]==='#inbox'&&p.length===1)||(p[0]==='#search'&&p.length===2)) return renderList();
  if(!DATA.brokenClick && last.indexOf('LEG')===0) openThread(Number(last.slice(3)));
});
${view === 'message0' ? 'openThread(0);' : 'renderList();'}
</script></body></html>`;

function loginPage() { return '<!doctype html><title>Sign in</title><input id="identifierId" type="email"><input type="password">'; }
function landingPage() { return '<!doctype html><title>Gmail: Private and secure email</title><a href="#">Sign in</a>'; }

function createFakeGmail(opts = {}) {
  const f = {
    signedIn: opts.signedIn !== false, landing: !!opts.landing, emptyInbox: !!opts.emptyInbox, brokenClick: !!opts.brokenClick, brokenLayout: !!opts.brokenLayout,
    unreadInTitle: opts.unreadInTitle ?? 3, restoreOpenMessage: !!opts.restoreOpenMessage, requireTrusted: !!opts.requireTrusted, noLegacyIds: !!opts.noLegacyIds,
    threads: opts.threads || defaultThreads(), opened: [], dom: null, pendingUrl: null,
  };
  const polyfill = w => {
    Object.defineProperty(w.HTMLElement.prototype, 'innerText', { get() { return this.textContent; }, configurable: true });
    w.HTMLElement.prototype.scrollIntoView = function () {};
    // jsdom has no layout: emulate "visible" (no display:none on self/ancestors) and row geometry.
    w.HTMLElement.prototype.getClientRects = function () { for (let e = this; e && e.nodeType === 1; e = e.parentElement) { if (w.getComputedStyle(e).display === 'none') return []; } return [{}]; };
    w.HTMLElement.prototype.getBoundingClientRect = function () { const tr = this.closest && this.closest('tr.zA'); const idx = tr ? [...tr.parentNode.children].indexOf(tr) : 0; return { left: 10, top: 100 * idx + 10, width: 200, height: 20 }; };
  };
  function make(html, url) { return new JSDOM(html, { url, runScripts: 'dangerously', pretendToBeVisual: true, beforeParse: polyfill }); }
  f.navigate = function (url) {
    f.opened.push(url); const u = new URL(url);
    if (u.host === 'mail.google.com') {
      if (!f.signedIn) {
        f.pendingUrl = url;
        f.dom = f.landing ? make(landingPage(), 'https://workspace.google.com/products/gmail/') : make(loginPage(), 'https://accounts.google.com/v3/signin');
      } else {
        const data = { title: `Inbox${f.unreadInTitle ? ` (${f.unreadInTitle})` : ''} - me@gmail.com - Gmail`, threads: f.threads, emptyInbox: f.emptyInbox, brokenClick: f.brokenClick, brokenLayout: f.brokenLayout, requireTrusted: f.requireTrusted, noLegacyIds: f.noLegacyIds };
        f.dom = make(page(data, f.restoreOpenMessage ? 'message0' : 'list'), f.restoreOpenMessage ? url + '/FMfcgz0' : url);
      }
    } else if (u.host === 'accounts.google.com') { f.dom = make(loginPage(), url); f.pendingUrl = f.pendingUrl || 'https://mail.google.com/mail/u/0/#inbox'; }
    else f.dom = make('<title>x</title>', url);
  };
  f.signIn = function () { f.signedIn = true; f.landing = false; f.navigate(f.pendingUrl || 'https://mail.google.com/mail/u/0/#inbox'); };
  // A trusted (user-like) click at viewport coords: row index is encoded in y by the getBoundingClientRect polyfill.
  f.click = function (x, y) {
    const idx = Math.floor(y / 100);
    f.dom.window.eval(`window.__trusted = true; (function(){ const wrap = document.getElementById('listwrap'); if (wrap && wrap.style.display !== 'none') { const r = document.querySelectorAll('tr.zA')[${idx}]; if (r) r.querySelector('.bog').dispatchEvent(new MouseEvent('click', { bubbles: true })); } })(); window.__trusted = false;`);
  };
  f.evaluate = function (expr) {
    const v = f.dom.window.eval(expr);
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  };
  return f;
}

function defaultThreads() {
  return [
    { fromName: 'Google', fromEmail: 'no-reply@accounts.google.com', subject: 'Security alert', snippet: 'A new sign-in on Windows', dateTitle: 'Sat, Oct 31, 2026, 3:15 PM', dateShort: '3:15 PM', unread: true,
      messages: [{ fromName: 'Google', fromEmail: 'no-reply@accounts.google.com', dateTitle: 'Sat, Oct 31, 2026, 3:15 PM', body: 'A new sign-in on Windows.\nIf this was you, you can ignore this email.\nOtherwise secure your account.' }] },
    { fromName: 'Priya Sharma', fromEmail: 'priya@example.com', subject: 'Re: Project plan', snippet: 'Sounds good, see below', dateTitle: 'Fri, Oct 30, 2026, 6:40 PM', dateShort: 'Oct 30', unread: true, attachments: ['plan-v2.pdf'],
      messages: [
        { fromName: 'Me', fromEmail: 'me@gmail.com', dateTitle: 'Thu, Oct 29, 2026, 9:00 AM', body: 'older', collapsed: true },
        { fromName: 'Priya Sharma', fromEmail: 'priya@example.com', dateTitle: 'Fri, Oct 30, 2026, 6:40 PM', body: 'Hi,\n\nThe plan looks good. Let us ship on Monday.\n\nThanks,\nPriya\n\nOn Thu, Oct 29, 2026 at 9:00 AM Me <me@gmail.com> wrote:\n> Here is the plan\n> thanks' }] },
    { fromName: 'Dev Weekly', fromEmail: 'news@devweekly.example', subject: 'Issue 128', snippet: 'This week in dev', dateTitle: 'Thu, Oct 29, 2026, 8:00 AM', dateShort: 'Oct 29', unread: false,
      messages: [{ fromName: 'Dev Weekly', fromEmail: 'news@devweekly.example', dateTitle: 'Thu, Oct 29, 2026, 8:00 AM', body: 'Top stories this week.' }] },
  ];
}

// Fake Chrome DevTools endpoint so main.cjs's REAL browser code can run against the fake page.
function startFakeChrome(fake, port = 9222) {
  const { WebSocketServer } = require('ws');
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); const json = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    const tab = { id: 't1', type: 'page', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/t1` };
    if (u.pathname === '/json/version') return json({ Browser: 'FakeChrome', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/1` });
    if (u.pathname === '/json/new') { fake.navigate(decodeURIComponent(u.search.slice(1))); return json(tab); }
    if (u.pathname === '/json') return json([tab]);
    res.writeHead(404); res.end();
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', ws => ws.on('message', raw => {
    const { id, method, params } = JSON.parse(raw);
    try {
      if (method === 'Input.dispatchMouseEvent') { if (params.type === 'mousePressed') ws._y = params.y; if (params.type === 'mouseReleased') fake.click(params.x, ws._y); return ws.send(JSON.stringify({ id, result: {} })); }
      if (method === 'Runtime.evaluate') return ws.send(JSON.stringify({ id, result: { result: { value: fake.evaluate(params.expression) } } }));
      ws.send(JSON.stringify({ id, result: {} }));
    } catch (e) { ws.send(JSON.stringify({ id, result: { exceptionDetails: { text: e.message } } })); }
  }));
  return new Promise(r => server.listen(port, '127.0.0.1', () => r({ close: () => { wss.close(); server.close(); } })));
}
module.exports = { createFakeGmail, startFakeChrome, defaultThreads };
