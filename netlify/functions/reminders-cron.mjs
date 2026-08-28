// Scheduled: Friday payment reminders.
// Cron "0 0 * * 5" (netlify.toml) = Friday 00:00 UTC = Friday 08:00
// Australia/Perth (UTC+8, no daylight saving).
// Dedupe via email_logs means an accidental re-run sends nothing twice.

import { runReminders } from '../../lib/reminders-runner.mjs';

export default async function handler() {
  try {
    const summary = await runReminders();
    console.log('Reminder run:', JSON.stringify(summary));
  } catch (err) {
    // Never crash the scheduled function.
    console.error('Reminder run failed:', err);
  }
  return new Response('ok');
}
