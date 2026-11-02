'use strict';
// Tests electron/gmail-browser.cjs (login detection, inbox read, open email, extract) against the fake Gmail page.
let jsdomOk = true; try { require('jsdom'); } catch { jsdomOk = false; }
const { test } = require('node:test');
const assert = require('node:assert/strict');
const skip = jsdomOk ? false : 'jsdom not installed (npm i --no-save jsdom ws)';
const { createGmailBrowserReader, GmailBrowserError, parseGmailDate, tidyBody, gmailUiQuery, LOGIN_URL } = require('../electron/gmail-browser.cjs');
const fakeMod = jsdomOk ? require('./fake-gmail.cjs') : null;

function setup(opts = {}, readerOpts = {}) {
  const fake = fakeMod.createFakeGmail(opts); const events = []; let polls = 0;
  const reader = createGmailBrowserReader({
    open: async url => fake.navigate(url), evaluate: async js => fake.evaluate(js), click: readerOpts.noClick ? null : async (x, y) => fake.click(x, y), emit: e => events.push(e), bringToFront: async () => { events.push({ type: 'front' }); },
    sleep: async () => { polls++; await new Promise(r => setImmediate(r)); if (opts.signInAfterPolls && polls === opts.signInAfterPolls) fake.signIn(); },
    pollMs: 1, pageTimeoutMs: 400, loginTimeoutMs: 600, openTimeoutMs: 150, ...readerOpts,
  });
  return { fake, events, reader };
}

test('latest email: sender, subject, date, body, unread flag', { skip }, async () => {
  const { reader, fake } = setup();
  const { messages, unreadCount } = await reader.read({ count: 1 });
  assert.equal(messages.length, 1); const m = messages[0];
  assert.deepEqual([m.fromName, m.fromEmail, m.subject], ['Google', 'no-reply@accounts.google.com', 'Security alert']);
  assert.equal(m.dateText, 'Sat, Oct 31, 2026, 3:15 PM'); assert.equal(new Date(m.date).getFullYear(), 2026); assert.equal(new Date(m.date).getHours(), 15);
  assert.equal(m.body, 'A new sign-in on Windows.\nIf this was you, you can ignore this email.\nOtherwise secure your account.');
  assert.equal(unreadCount, 3); assert.equal(m.unread, true);
  assert.equal(fake.opened[0], 'https://mail.google.com/mail/u/0/#inbox');
});

test('threads: reads the NEWEST message, strips quoted history, lists attachments', { skip }, async () => {
  const { reader } = setup();
  const { messages } = await reader.read({ count: 2 });
  assert.equal(messages.length, 2);
  const m = messages[1];
  assert.equal(m.fromName, 'Priya Sharma'); assert.equal(m.subject, 'Re: Project plan');
  assert.match(m.body, /Let us ship on Monday/); assert.ok(!/wrote:|Here is the plan|older/.test(m.body), m.body);
  assert.deepEqual(m.attachments, [{ filename: 'plan-v2.pdf' }]);
});

test('three emails are opened one after another, newest first', { skip }, async () => {
  const { reader } = setup();
  const { messages } = await reader.read({ count: 3 });
  assert.deepEqual(messages.map(m => m.subject), ['Security alert', 'Re: Project plan', 'Issue 128']);
  assert.equal(messages[2].body, 'Top stories this week.');
});

test('count is capped at 5 and at the number of emails available', { skip }, async () => {
  const { reader } = setup(); assert.equal((await reader.read({ count: 50 })).messages.length, 3);
});

test('check-only (list mode) returns senders/subjects without opening emails', { skip }, async () => {
  const { reader, fake } = setup();
  const { messages, unreadCount } = await reader.read({ count: 3, listOnly: true });
  assert.equal(unreadCount, 3); assert.deepEqual(messages.map(m => [m.fromName, m.unread]), [['Google', true], ['Priya Sharma', true], ['Dev Weekly', false]]);
  assert.ok(messages.every(m => m.body === '')); assert.equal(fake.opened.length, 1);
});

test('NOT signed in: announces, brings the browser forward, waits, then reads after login', { skip }, async () => {
  const { reader, events, fake } = setup({ signedIn: false, signInAfterPolls: 4 });
  const { messages } = await reader.read({ count: 1 });
  assert.equal(messages[0].subject, 'Security alert');
  assert.ok(events.some(e => e.type === 'announcement' && /not signed in/i.test(e.text)));
  assert.ok(events.some(e => e.type === 'front'));
  assert.equal(events.filter(e => e.type === 'announcement').length, 1);
});

test('Gmail marketing/landing page (signed out) is sent to Google sign-in', { skip }, async () => {
  const { reader, fake, events } = setup({ signedIn: false, landing: true, signInAfterPolls: 6 });
  const { messages } = await reader.read({ count: 1 });
  assert.equal(messages.length, 1); assert.ok(fake.opened.includes(LOGIN_URL));
});

test('login never completed -> LOGIN_TIMEOUT (nothing invented)', { skip }, async () => {
  const { reader } = setup({ signedIn: false });
  await assert.rejects(() => reader.read({ count: 1 }), e => e instanceof GmailBrowserError && e.code === 'LOGIN_TIMEOUT' && /sign in/i.test(e.message));
});

test('empty inbox -> no messages', { skip }, async () => {
  const { reader } = setup({ emptyInbox: true });
  assert.deepEqual((await reader.read({ count: 1 })).messages, []);
});

test('Gmail restored an open conversation: reader returns to the list first', { skip }, async () => {
  const { reader } = setup({ restoreOpenMessage: true });
  const { messages } = await reader.read({ count: 1 }); assert.equal(messages[0].subject, 'Security alert');
});

test('changed Gmail layout is reported, never faked', { skip }, async () => {
  await assert.rejects(() => setup({ brokenLayout: true }).reader.read({ count: 1 }), e => e instanceof GmailBrowserError);
  await assert.rejects(() => setup({ brokenClick: true }).reader.read({ count: 1 }), e => e.code === 'DOM' && /layout may have changed/.test(e.message));
});

test('REAL-GMAIL BEHAVIOUR: hidden inbox rows and stale conversations stay in the DOM; only the visible email is read', { skip }, async () => {
  const { reader, fake } = setup();
  const { messages } = await reader.read({ count: 3 });
  assert.deepEqual(messages.map(m => m.subject), ['Security alert', 'Re: Project plan', 'Issue 128']);
  assert.equal(fake.dom.window.document.querySelectorAll('tr.zA').length, 3);        // list still in DOM
  assert.equal(fake.dom.window.document.querySelectorAll('.tv').length, 3);          // stale conversations still in DOM
  assert.equal(messages[0].body.startsWith('A new sign-in'), true); assert.ok(!messages[0].body.includes('Top stories'));
});

test('Gmail ignores synthetic clicks: a trusted mouse click (CDP input) opens the email', { skip }, async () => {
  const { reader } = setup({ requireTrusted: true });
  const { messages } = await reader.read({ count: 2 }); assert.equal(messages.length, 2); assert.equal(messages[1].subject, 'Re: Project plan');
});

test('no trusted click available and synthetic clicks ignored: falls back to the thread id URL', { skip }, async () => {
  const { reader } = setup({ requireTrusted: true }, { noClick: true });
  const { messages } = await reader.read({ count: 2 }); assert.equal(messages[0].subject, 'Security alert'); assert.equal(messages[1].subject, 'Re: Project plan');
});

test('every way of opening fails: clear error WITH a page diagnostic', { skip }, async () => {
  const { reader } = setup({ requireTrusted: true, noLegacyIds: true }, { noClick: true });
  await assert.rejects(() => reader.read({ count: 1 }), e => e.code === 'DOM' && /could not open the email/.test(e.message) && /\[page: \{.*"rows":3.*"allRows":3/.test(e.message));
});

test('search URL is used for sender/date filters', { skip }, async () => {
  const { reader, fake } = setup();
  await reader.read({ count: 1, uiQuery: 'in:inbox from:(google)' });
  assert.equal(fake.opened[0], 'https://mail.google.com/mail/u/0/#search/in%3Ainbox%20from%3A(google)');
});

test('helpers: dates, quoted text, UI query', () => {
  assert.equal(new Date(parseGmailDate('Sat, Oct 31, 2026, 3:15 PM')).getDate(), 31);
  assert.equal(new Date(parseGmailDate('Sat, Oct 31, 2026 at 3:15\u202fPM')).getHours(), 15);
  assert.equal(parseGmailDate('garbage'), '');
  assert.equal(tidyBody('Hello\n\n\n\nWorld \u200b'), 'Hello\n\nWorld');
  const day = Math.floor(new Date(2026, 9, 30).getTime() / 1000);
  assert.equal(gmailUiQuery({ from: 'google', unreadOnly: true, after: day, before: day + 86400 }), 'in:inbox is:unread from:(google) after:2026/10/30 before:2026/10/31');
  assert.equal(gmailUiQuery({}), '');
});
