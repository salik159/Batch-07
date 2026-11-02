import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPhoneCallRequest, getPhoneLinkStatus, searchPhoneContacts, planPhoneCall } from '../server/lib/phone-link-agent.mjs';

test('Phone Link: intent extraction', () => {
  assert.equal(isPhoneCallRequest('Hey Neura, call M.G. Krishna Vardan').isCall, true);
  assert.equal(isPhoneCallRequest('Hey Neura, call M.G. Krishna Vardan').target, 'M.G. Krishna Vardan');

  assert.equal(isPhoneCallRequest('call M.G. Krishna Vardan').isCall, true);
  assert.equal(isPhoneCallRequest('call M.G. Krishna Vardan').target, 'M.G. Krishna Vardan');

  assert.equal(isPhoneCallRequest('phone M.G. Krishna Vardan').isCall, true);
  assert.equal(isPhoneCallRequest('dial +91 95024 25650').isCall, true);
  assert.equal(isPhoneCallRequest('make a phone call to Krishna').isCall, true);
  assert.equal(isPhoneCallRequest('make a phone call to Krishna').target, 'Krishna');

  // Negative tests
  assert.equal(isPhoneCallRequest('call api endpoint').isCall, false);
  assert.equal(isPhoneCallRequest('call function calculateTax').isCall, false);
  assert.equal(isPhoneCallRequest('read my latest email').isCall, false);
  assert.equal(isPhoneCallRequest('explain Docker').isCall, false);
});

test('Phone Link: status check detects installation and iPhone line', async () => {
  const status = await getPhoneLinkStatus();
  assert.equal(status.installed, true, 'Phone Link must be installed on Windows');
  assert.ok(status.contactsDbPath, 'Contacts DB path should be found');
  assert.equal(typeof status.connected, 'boolean');
  assert.equal(typeof status.canDial, 'boolean');
});

test('Phone Link: contact search finds "M.G. Krishna Vardan"', async () => {
  const res = await searchPhoneContacts('M.G. Krishna Vardan');
  assert.equal(res.ok, true);
  assert.ok(res.matches.length > 0, 'Should find matching contact');
  const top = res.matches[0];
  assert.match(top.name, /krishna\s*vardhan/i);
  assert.match(top.phoneNumber, /9502425650/);
});

test('Phone Link: planning "Hey Neura, call M.G. Krishna Vardan" produces correct action plan and speech', async () => {
  const plan = await planPhoneCall('Hey Neura, call M.G. Krishna Vardan');
  assert.equal(plan.agent, 'phone');
  assert.equal(plan.intent, 'computer_task');
  assert.match(plan.announcement, /calling\s+mg\.krishna\s+vardhan/i);
  assert.match(plan.speech, /calling\s+mg\.krishna\s+vardhan/i);

  assert.equal(plan.actions.length, 2);
  assert.equal(plan.actions[0].type, 'open_application');
  assert.equal(plan.actions[0].application, 'phone link');

  assert.equal(plan.actions[1].type, 'phone_call');
  assert.match(plan.actions[1].phoneNumber, /9502425650/);
});

test('Phone Link: ambiguous query "Call Krishna" triggers disambiguation', async () => {
  const plan = await planPhoneCall('Call Krishna');
  assert.equal(plan.agent, 'phone');
  if (plan.disambiguation) {
    assert.equal(plan.intent, 'clarification');
    assert.match(plan.speech, /multiple contacts/i);
    assert.ok(plan.candidates.length >= 2);
  } else {
    // If exact match prioritized
    assert.match(plan.speech, /calling/i);
  }
});

test('Phone Link: unknown contact returns honest not found message', async () => {
  const plan = await planPhoneCall('Call PersonThatDoesNotExist9999');
  assert.equal(plan.agent, 'phone');
  assert.equal(plan.error, 'CONTACT_NOT_FOUND');
  assert.match(plan.speech, /could not find/i);
});
