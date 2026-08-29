import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectReminderRecipients, perthDateString, perthDayWindow } from '../lib/reminders.mjs';
import { selectBroadcastAudience } from '../lib/audience.mjs';

const members = [
  { id: 'alex', is_active: true, notifications_enabled: true },   // $100 credit
  { id: 'jake', is_active: true, notifications_enabled: true },   // -$25 owing
  { id: 'carl', is_active: true, notifications_enabled: false },  // -$25 but notifications off
  { id: 'brad', is_active: false, notifications_enabled: true },  // -$50 but inactive
  { id: 'jesse', is_active: true, notifications_enabled: true },  // -$50 owing
];
const balances = new Map([
  ['alex', 10000], ['jake', -2500], ['carl', -2500], ['brad', -5000], ['jesse', -5000],
]);

test('reminders go only to active, notifications-on members below the threshold', () => {
  const r = selectReminderRecipients(members, balances, [], 0);
  assert.deepEqual(r.map((m) => m.id), ['jake', 'jesse']);
});

test('re-run the same Friday sends nothing twice (email_logs dedupe)', () => {
  const logs = [
    { member_id: 'jake', status: 'sent' },
    { member_id: 'jesse', status: 'sent' },
  ];
  assert.deepEqual(selectReminderRecipients(members, balances, logs, 0), []);
});

test('a failed send does not block a retry, and threshold is respected', () => {
  const logs = [{ member_id: 'jake', status: 'failed' }];
  const r = selectReminderRecipients(members, balances, logs, 0);
  assert.deepEqual(r.map((m) => m.id), ['jake', 'jesse']);
  // A lower threshold narrows who gets reminded; the rule is "at or below".
  const r2 = selectReminderRecipients(members, balances, [], -3000);
  assert.deepEqual(r2.map((m) => m.id), ['jesse']); // only jesse is at/below -$30
  const r3 = selectReminderRecipients(members, balances, [], -2500);
  assert.deepEqual(r3.map((m) => m.id), ['jake', 'jesse']); // both at/below -$25
});

test('Perth day window: Friday 00:00 UTC cron fires on Perth Friday morning', () => {
  const cronFire = new Date('2026-08-28T00:00:00Z'); // Friday 00:00 UTC
  assert.equal(perthDateString(cronFire), '2026-08-28'); // 8am Friday in Perth
  const { startUtc, endUtc } = perthDayWindow(cronFire);
  assert.equal(startUtc.toISOString(), '2026-08-27T16:00:00.000Z'); // Perth Fri 00:00
  assert.equal(endUtc.toISOString(), '2026-08-28T16:00:00.000Z');   // Perth Sat 00:00
});

test('broadcast (ticket email) audience: active members with notifications enabled only', () => {
  assert.deepEqual(selectBroadcastAudience(members).map((m) => m.id), ['alex', 'jake', 'jesse']);
});
