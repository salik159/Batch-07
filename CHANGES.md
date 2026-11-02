# Update 3: fix "I could not open the email in Gmail" (first run against real Gmail)

**Cause:** real Gmail keeps the inbox rows (hidden) in the page while an email is open, and the reader treated *any* `tr.zA` row as "inbox is showing", so it could never notice that an email had opened. Synthetic JS clicks may also be ignored by Gmail.
**Fix (`electron/gmail-browser.cjs`, `electron/main.cjs`):** all page queries now count only *visible* elements (inbox rows, open conversation, newest message); opening an email now tries (1) a real mouse click through Chrome's DevTools input, (2) a synthetic click, (3) direct navigation by Gmail's thread id; failures include a short page diagnostic (`[page: {...}]`) so a layout change can be pinpointed.
**Tests:** the fake Gmail page now behaves like real Gmail (hidden list and stale conversations stay in the DOM, synthetic clicks can be ignored, thread-id URLs). The previous reader reproduces your exact error against it; the new reader passes (17 reader tests, 9 end-to-end tests).

---

# Update 2: Gmail reading now uses the Browser Agent (no Google Cloud, no API)

**Why:** you asked for browser automation only. Browser mode is now the default; the earlier API code is kept but only used if you set `GMAIL_MODE=api`.

**New:** `electron/gmail-browser.cjs` (reader), wired into `electron/main.cjs` (`email_read`, `gmail_connect`).
Flow: open `mail.google.com` with the existing Browser Agent -> detect state (signed in / login page / Gmail landing page / empty inbox / loading) -> if signed out, announce it, bring Chrome forward and wait up to 3 min -> read the inbox rows -> click the newest row -> extract sender, subject, date, newest message body (quoted history cut), attachment names -> speak via the existing TTS and show the full text. Layout changes, timeouts and empty inboxes are reported, never invented. "Check my Gmail" = 3 newest, summarized.

**Also fixed**
- `coding_ai_generate` "Blocked action" error: the AI planner can invent action names the executor rejects. The server now re-routes any unknown planner action to the Coding Agent (or drops it), so it never reaches the executor.
- A race in the existing browser agent: when a new tab was opened, the *old* DevTools socket's close handler cleared the *new* socket ("Browser connection closed"). The handler now ignores replaced sockets (`ensureBrowser`).
- "Do I have new emails?" no longer calls the LLM.

**Tests: 69 passing** (`npm test`, serialized). New: 13 reader tests and 8 end-to-end tests that run the REAL `main.cjs` + API server + browser-agent code over WebSocket against a FAKE Chrome serving a FAKE Gmail page that mimics Gmail's DOM (login page, landing page, inbox, threads with quoted replies and attachments, empty inbox, broken layout). The fake-page tests need `npm i --no-save jsdom ws` and skip otherwise.

**Not tested (important):** the real Gmail website and real Chrome. The fake page reproduces the DOM structure the selectors target, not Gmail itself, and jsdom's `innerText` is approximated. Expect the first real run to be the true test; if Gmail's markup differs, the agent will say the layout may have changed and the selectors at the top of `gmail-browser.cjs` are the one place to adjust. Google may also refuse sign-in inside a DevTools-controlled Chrome (workaround in GMAIL_SETUP.md).

---

# NeuraOS: Java Coding Agent and Gmail Agent fix

## Root causes found
| Problem | Cause |
|---|---|
| Java agent always wrote "reverse a number" | `fallbackPlan()` in `server/server.mjs` held hardcoded Java templates (default body = reverse-integer; only hello/palindrome/fibonacci/prime keyword overrides). With no AI key, or whenever the planner reply wasn't parseable JSON, it used them. The LLM path also asked the model to inline code inside a 2,200-token JSON plan. |
| "Read my email" only opened Gmail | The `email_recent` action in `electron/main.cjs` launched Chrome, opened mail.google.com and scraped Gmail's DOM selectors. No Gmail API, no OAuth. |
| "Read my **latest** email" never reached the Email Agent | `HomeMode.tsx` sent any text containing "latest" to the news handler *before* agent routing. |

## What changed
**Coding Agent** (`server/lib/coding-agent.mjs`, wired in `server/server.mjs`)
- Removed all hardcoded program generation.
- Your instruction goes to the existing OpenAI integration with a dedicated coding prompt; complete source is extracted from the reply.
- Java: class/file name derived from the generated code; compiled with `javac`; compile errors are fed back to the model (max 2 repairs). Saved/opened in VS Code, compiled and run via the existing allowlisted `run_program` action.
- "code only" returns only code (shown on screen, not read aloud); "explain" speaks an explanation.
- Programs using stdin, JDBC/network/GUI, process execution or file deletion are compiled but not auto-run.
- No API key => a clear error, never a canned program.

**Email Agent** (`electron/gmail.cjs`, `server/lib/email-intent.mjs`, `electron/main.cjs`)
- Gmail REST API with OAuth 2.0 loopback + PKCE (S256), scope `gmail.readonly` only.
- Tokens encrypted with Electron `safeStorage`; refresh and one-time retry on 401; revoke on disconnect.
- `format=full` messages: recursive multipart walk, base64url + charset decoding, plain-text preferred, HTML stripped (style/script/tags removed, entities decoded), RFC 2047 subjects, attachment metadata, newest-first by `internalDate`.
- Voice requests parsed into count / sender / unread / yesterday / today / summarize / full. Spoken brief via `/api/email/brief` (LLM summary for long/multiple emails, with a prompt that treats email text as untrusted data; deterministic fallback otherwise).
- New actions `email_read`, `gmail_connect`, `gmail_disconnect`; the legacy `email_recent` now maps to the API reader.
- Full decoded text is shown in the UI; speech uses the brief.

**Routing / security**
- `HomeMode.tsx`: email and coding requests bypass the news handler. Error events are spoken.
- IPC: sender-origin check on `agent:run` and Gmail channels, command validation, `system:open-url` limited to http(s). No secrets in the frontend.
- No dependency or lockfile changes.

New/changed files: `server/lib/*`, `electron/gmail.cjs`, `electron/main.cjs`, `electron/preload.cjs`, `server/server.mjs`, `src/components/neuraos/modes/HomeMode.tsx`, `src/electron.d.ts`, `.env.example`, `package.json` (test script only), `RUN_ME.md`, `GMAIL_SETUP.md`, `CHANGES.md`, `tests/*`.

## Tests performed (`npm test`: 47 passed, 0 failed)
- **Coding (8):** 7 different Java requests (prime, binary search, multilevel inheritance, factorial, Two Sum, linked list, switch calculator) each produced a *different* program; every one was compiled with real `javac` and executed with real `java`, output asserted. JDBC compiled but not auto-run; compile-error repair loop; unfixable code reported; code-only / explain modes; no-API-key error.
- **Gmail service (20):** newest email; multiple emails sorted; multipart/alternative; HTML-only (tags, style, script, entities, list items); nested multipart/mixed with ISO-8859-1 body and attachment; message with no text; empty inbox; query forwarding; unread count; expired access token refresh; revoked refresh token; 401 retry; 403/429/500; not configured / not authorized; network failure; full OAuth flow with PKCE verification; state mismatch; missing refresh token; user denial; timeout; disconnect/revoke; encrypted-at-rest token store.
- **Email intent & routing (11):** all your example phrases parsed and routed to `email_read` (never to a browser); no collision with coding; brief composition; LLM-failure fallback; empty inbox; prompt-injection safeguard present; news-handler bypass for email/coding while real news questions still reach news.
- **Electron glue (8):** the real `main.cjs` + real API server + real IPC handlers with fake Electron/Google/OpenAI: origin and input validation, setup error, first-use OAuth then reading the message, token reuse, empty inbox, connect/disconnect, coding end to end (file written, `javac`/`java` run, output returned).
- Regression: browser, YouTube, and app-launch plans unchanged. Frontend type-check shows the same 2 errors as the original (pre-existing, unrelated); `vite build` succeeds.

## NOT tested (be aware)
- **Real model output.** The AI was replaced by a local mock that returns varied valid programs, so this proves the pipeline is instruction-driven, not how well your configured model writes code. Try the sample prompts with your key.
- **Real Google account / consent screen.** OAuth was run against a mock Google server that verifies PKCE, state and scopes. First real authorization needs your Cloud project (GMAIL_SETUP.md).
- **The Electron runtime on Windows**: window, mic, wake word, faster-whisper, Windows TTS, and VS Code launching (stubbed). I did not modify those code paths, but I could not run them.
- Gmail attachments are listed (name/size), not downloaded or read.
