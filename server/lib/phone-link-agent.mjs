/**
 * NeuraOS iPhone Calling & Windows Phone Link Agent
 * 
 * Supports:
 * - Detecting Phone Link installation and active iPhone Bluetooth HFP connection
 * - Extracting and matching contacts from Phone Link SQLite DB (contacts.db)
 * - Disambiguating multiple contact matches
 * - Opening Phone Link and dialing through connected iPhone via Windows ApplicationModel Calls API
 * - Honest error reporting when iPhone is disconnected or calling is unsupported
 */

import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');

const PS_HELPER = path.join(__dirname, 'phone-helper.ps1');
const PY_CONTACTS = path.join(__dirname, 'phone-contacts.py');

/**
 * Identify if a user voice or text command is a phone call request.
 * @param {string} command 
 * @returns {{ isCall: boolean, target?: string }}
 */
export function isPhoneCallRequest(command) {
  const c = String(command || '').trim();
  // Filter out non-telephony phrases
  if (/\b(?:call|calling)\s+(?:api|function|method|stack|procedure|macro|endpoint)\b/i.test(c)) {
    return { isCall: false };
  }

  // Regex matching "Hey Neura, call X", "call X", "dial X", "phone X", "make a call to X"
  const m = c.match(/\b(?:make\s+a\s+phone\s+call\s+to|make\s+a\s+call\s+to|place\s+a\s+call\s+to|call\s+up|call|dial|phone|ring)\s+(?:on\s+phone\s+|on\s+iphone\s+|through\s+iphone\s+)?(.+)/i);
  if (m) {
    let target = m[1].trim();
    // Strip trailing polite phrases or punctuation
    target = target.replace(/^(?:my\s+friend\s+|my\s+|contact\s+)/i, '');
    target = target.replace(/[?,.!\s]+$/, '');
    target = target.replace(/\s+(?:please|now|boss)$/i, '');
    if (target.length >= 2) {
      return { isCall: true, target };
    }
  }

  return { isCall: false };
}

/**
 * Execute PowerShell helper script
 * @param {string[]} args 
 * @returns {Promise<any>}
 */
function runPowerShell(args) {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', PS_HELPER,
      ...args
    ], { windowsHide: true });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    child.on('error', (err) => resolve({ ok: false, error: err.message }));
    child.on('close', (code) => {
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(parsed);
      } catch {
        resolve({ ok: false, error: stderr.trim() || stdout.trim() || `Exit code ${code}` });
      }
    });
  });
}

/**
 * Execute Python contact search helper
 * @param {string} query 
 * @returns {Promise<{ ok: boolean, matches: any[], error?: string }>}
 */
export function searchPhoneContacts(query = '') {
  return new Promise((resolve) => {
    const py = path.join(root, '.voice-venv', 'Scripts', 'python.exe');
    const child = spawn(py, [PY_CONTACTS, String(query)], {
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1' }
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    child.on('error', (err) => resolve({ ok: false, error: err.message, matches: [] }));
    child.on('close', (code) => {
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(parsed);
      } catch {
        resolve({ ok: false, error: stderr.trim() || stdout.trim() || `Exit code ${code}`, matches: [] });
      }
    });
  });
}

/**
 * Retrieve status of Windows Phone Link and connected iPhone
 * @returns {Promise<{ installed: boolean, connected: boolean, deviceName: string, canDial: boolean, error?: string }>}
 */
export async function getPhoneLinkStatus() {
  const res = await runPowerShell(['-Action', 'status']);
  return res;
}

/**
 * Initiate an actual call through connected iPhone
 * @param {string} phoneNumber 
 * @param {string} contactName 
 * @returns {Promise<{ ok: boolean, status?: string, error?: string }>}
 */
export async function dialPhoneCall(phoneNumber, contactName = '') {
  return await runPowerShell([
    '-Action', 'dial',
    '-PhoneNumber', String(phoneNumber),
    '-DisplayName', String(contactName)
  ]);
}

/**
 * Open Phone Link application
 */
export async function openPhoneLink() {
  return await runPowerShell(['-Action', 'open']);
}

/**
 * Plan phone call command
 * @param {string} command 
 * @returns {Promise<any>}
 */
export async function planPhoneCall(command) {
  const req = isPhoneCallRequest(command);
  const target = req.target || command;

  // 1. Check Phone Link & iPhone connection
  const status = await getPhoneLinkStatus();
  if (!status.installed) {
    const msg = 'Boss, Windows Phone Link is not installed on this PC.';
    return {
      agent: 'phone',
      intent: 'computer_task',
      actions: [],
      announcement: msg,
      finalText: msg,
      speech: msg,
      display: msg,
      error: 'PHONE_LINK_NOT_INSTALLED'
    };
  }

  if (!status.connected || !status.canDial) {
    const reason = status.error || 'Your iPhone is not currently connected to Phone Link over Bluetooth.';
    const msg = `Boss, I cannot place the call because your iPhone is disconnected. ${reason}`;
    return {
      agent: 'phone',
      intent: 'computer_task',
      actions: [{ type: 'open_application', application: 'phone link' }],
      announcement: msg,
      finalText: msg,
      speech: msg,
      display: `iPhone Calling Unavailable:\n${reason}\n\nMake sure Bluetooth is enabled and paired on both your PC and iPhone.`,
      error: 'IPHONE_DISCONNECTED'
    };
  }

  // 2. Direct phone number dial if target looks like a raw phone number
  const cleanNumber = target.replace(/[^0-9+]/g, '');
  if (cleanNumber.length >= 7 && !/[a-zA-Z]/.test(target)) {
    const announce = `Calling ${target}, boss.`;
    return {
      agent: 'phone',
      intent: 'computer_task',
      announcement: announce,
      actions: [
        { type: 'open_application', application: 'phone link' },
        { type: 'phone_call', phoneNumber: cleanNumber, contactName: target }
      ],
      finalText: announce,
      speech: announce,
      display: `Calling ${target} through connected iPhone via Windows Phone Link.`
    };
  }

  // 3. Search synced iPhone contacts
  const searchRes = await searchPhoneContacts(target);
  const matches = searchRes.matches || [];

  if (!matches.length) {
    const msg = `Boss, I could not find "${target}" in your Phone Link iPhone contacts.`;
    return {
      agent: 'phone',
      intent: 'computer_task',
      actions: [{ type: 'open_application', application: 'phone link' }],
      announcement: msg,
      finalText: msg,
      speech: msg,
      display: `Contact Not Found: "${target}"\n\nNo matching contacts found in synced Phone Link contacts.`,
      error: 'CONTACT_NOT_FOUND'
    };
  }

  // 4. Handle multiple ambiguous matches (Requirement 6)
  // If top 2 matches both have high scores and are close in score
  if (matches.length > 1) {
    const top = matches[0];
    const second = matches[1];
    const isAmbiguous = (second.score >= 0.88 && (top.score - second.score) < 0.08) || (top.score < 0.92);

    if (isAmbiguous) {
      const options = matches.slice(0, 3).map((m, i) => `${i + 1}. ${m.name} (${m.displayPhoneNumber})`).join('\n');
      const speechOptions = matches.slice(0, 3).map((m, i) => `${i + 1}, ${m.name}`).join('; or ');
      const question = `Boss, I found multiple contacts matching "${target}". Did you mean ${speechOptions}?`;
      
      return {
        agent: 'phone',
        intent: 'clarification',
        announcement: question,
        actions: [],
        finalText: question,
        speech: question,
        display: `Multiple Contacts Found for "${target}":\n\n${options}\n\nWhich contact would you like to call, boss?`,
        disambiguation: true,
        candidates: matches.slice(0, 3)
      };
    }
  }

  // 5. Single / Best Match -> Initiate Call (Requirements 2, 3, 4, 5)
  const contact = matches[0];
  const announce = `Calling ${contact.name}, boss.`;
  return {
    agent: 'phone',
    intent: 'computer_task',
    announcement: announce,
    actions: [
      { type: 'open_application', application: 'phone link' },
      { type: 'phone_call', phoneNumber: contact.phoneNumber, contactName: contact.name }
    ],
    finalText: announce,
    speech: announce,
    display: `Calling ${contact.name} (${contact.displayPhoneNumber}) through connected iPhone (${status.deviceName || 'iPhone'}) via Windows Phone Link.`
  };
}
