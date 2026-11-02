# Gmail reading in NeuraOS (browser mode, no Google Cloud, no API)

The Email Agent reuses NeuraOS's existing **Browser Agent** (Chrome controlled over the DevTools port). It opens Gmail,
checks whether you are signed in, opens the newest email, extracts sender, subject, date and body from the page, and reads it
aloud through the existing text-to-speech. Nothing is sent to Google except what your normal Gmail session already does,
and NeuraOS never sees or stores your Google password.

## Setup
There is nothing to configure. Requirements: Windows, Google Chrome installed, and the usual NeuraOS setup.

**First use:** say "Hey Neura, check my Gmail". NeuraOS opens Gmail in its own Chrome window (profile
`%TEMP%\NeuraOS-Chrome-Agent`). If you are not signed in, NeuraOS says so, brings that window forward and **waits up to
3 minutes** while you sign in; it continues automatically once your inbox appears. Your session is kept in that profile,
so later requests need no sign-in (unless Google logs you out or Windows clears the temp folder).

> **If Google refuses sign-in in that window** ("This browser or app may not be secure"): close it, start Chrome once
> normally with the same profile, sign in, close it, then ask NeuraOS again:
> `"C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="%TEMP%\NeuraOS-Chrome-Agent"`

## Voice commands
| Say | What happens |
|---|---|
| "Hey Neura, read my latest email" / "read my recent email" | Opens the newest email; speaks sender, subject, date, then the body (a summary if it is long) |
| "Check my Gmail" / "Check my inbox" | Reads the 3 newest emails and summarizes them |
| "What is my newest email about?" / "Summarize my recent emails" | Summary of the newest 1 / 5 emails |
| "Do I have any new emails?" | Unread count plus newest unread senders/subjects (no emails are opened) |
| "Read the latest email from Google" | Uses Gmail search for that sender |
| "Read the email I received yesterday" | Uses Gmail search with yesterday's date |
| "Read the full email" | Reads a long body completely |
| "Connect my Gmail" | Opens Gmail and waits for you to sign in |

The complete extracted text always appears on screen; speech uses a shorter version when the email is long.
At most 5 emails are opened per request (each takes a few seconds). Attachments are listed by name, not opened.
Quoted reply history ("On <date> ... wrote:") is cut so only the new message is read.

## Limits you should know
- Gmail's page uses internal CSS class names (`tr.zA`, `.bog`, `.gD`, `.a3s`...). They have been stable for years, but
  if Google changes them NeuraOS will say "Gmail's page layout may have changed" instead of guessing. The selectors are
  isolated at the top of `electron/gmail-browser.cjs`.
- Date filters ("yesterday") use Gmail's own search, which interprets dates in your Google account's time zone.
- Only the first inbox page is used (newest emails); the Primary/Social/Promotions tab you last used applies.

## Optional: Gmail API mode (not needed)
If you ever prefer the official API instead, set `GMAIL_MODE=api` in `.env` and add `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET` from a Google Cloud *Desktop app* OAuth client with the Gmail API enabled (read-only scope
`gmail.readonly`). On first use NeuraOS opens Google's consent page; the refresh token is stored encrypted with Electron
`safeStorage`. Voice commands are the same. This mode is off by default.
