// Scheduled: automatic Powerball results retrieval.
// Cron "0 19 * * 4" (netlify.toml) = Thursday 19:00 UTC = Friday 03:00
// Australia/Perth (UTC+8, no daylight saving) — hours after the Thursday
// night draw, as the safety net behind the admin's on-demand fetch button.
//
// Up to 3 polite attempts; on total failure the draw is marked
// "results pending - auto retrieve failed" and the admin gets one alert
// email (logged + deduped via email_logs). Never crashes.

import { supabase, must, T } from '../../lib/db.mjs';
import { fetchAndSaveLatestResults } from '../../lib/results-runner.mjs';
import { sendEmail, adminScrapeFailedEmail } from '../../lib/email.mjs';

async function alertAdmin(draw, attempts, lastError) {
  // One alert per draw failure: skip if we already logged one for this draw today.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const prior = must(
    await supabase().from(T('email_logs')).select('id')
      .eq('type', 'admin_alert').eq('draw_id', draw.id).eq('status', 'sent')
      .gte('sent_at', since)
  );
  if (prior.length > 0) return;
  const admins = must(await supabase().from(T('members')).select('*').eq('role', 'admin').eq('is_active', true));
  const alertTo = process.env.ADMIN_ALERT_EMAIL
    ? [{ email: process.env.ADMIN_ALERT_EMAIL, id: null }]
    : admins.map((a) => ({ email: a.email, id: a.id }));
  const tpl = adminScrapeFailedEmail({ drawDate: draw.draw_date, attempts, lastError });
  for (const a of alertTo) {
    await sendEmail({ ...tpl, to: a.email, type: 'admin_alert', memberId: a.id, drawId: draw.id });
  }
}

export default async function handler() {
  try {
    // 3 attempts, 5s fetch timeout each, 3s between: worst case ~21s, inside
    // Netlify's function execution limit.
    const outcome = await fetchAndSaveLatestResults({ maxAttempts: 3, delayMs: 3000, markFailedOnError: true });
    console.log('Results cron outcome:', JSON.stringify({ ...outcome, draw: outcome.draw?.draw_date }));
    if (outcome.status === 'fetch_failed') {
      await alertAdmin(outcome.draw, outcome.attempts, outcome.lastError);
    } else if (outcome.status === 'mismatch') {
      await alertAdmin(outcome.draw, 1, `Scraped draw date ${outcome.scrapedDate} does not match our draw ${outcome.draw.draw_date}`);
    }
  } catch (err) {
    // Never crash the scheduled function.
    console.error('Results cron error:', err);
  }
  return new Response('ok');
}
