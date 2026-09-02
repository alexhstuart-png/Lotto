#!/usr/bin/env node
// One-off email pipeline test, run during a Netlify build (which has full
// network access). Sends a single rendered Lotto Lord publish email via
// Resend to TEST_EMAIL_TO. Does nothing unless TEST_EMAIL_TO is set, and
// never fails the build.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ticketPublishedEmail } from '../lib/email.mjs';

// Armed only while the marker file exists in the repo (removed after the
// one-off test); TEST_EMAIL_TO env var overrides the marker's address.
const here = path.dirname(fileURLToPath(import.meta.url));
const markerPath = path.join(here, '.send-test');
const marker = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf8').trim() : '';
const to = process.env.TEST_EMAIL_TO || marker;
const key = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM || 'Lotto Lord <onboarding@resend.dev>';

if (!to) {
  console.log('[test-email] no TEST_EMAIL_TO and no marker file — skipping.');
  process.exit(0);
}
if (!key) {
  console.log('[test-email] RESEND_API_KEY not available at build time — skipping.');
  process.exit(0);
}

const tpl = ticketPublishedEmail({
  memberName: 'Stu',
  drawDate: '2026-09-03',
  games: [
    { numbers: [3, 9, 14, 21, 27, 30, 33], powerball: 7 },
    { numbers: [2, 5, 11, 18, 24, 29, 31, 35], powerball: 12 },          // Sys 8
    { numbers: [1, 8, 16, 20, 25, 28, 34], powerball: null, powerhit: true }, // PowerHit
  ],
  costCents: 5460,
  kittyCents: 70000,
  balanceCents: 10000,
  weeklyChargeCents: 2500,
});

try {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject: `[TEST] ${tpl.subject}`, html: tpl.html }),
  });
  const body = await res.text();
  console.log(`[test-email] Resend responded ${res.status}: ${body.slice(0, 400)}`);
} catch (err) {
  console.log(`[test-email] send failed: ${err.message}`);
}
process.exit(0);
