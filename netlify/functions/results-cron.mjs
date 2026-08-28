// Scheduled: automatic Powerball results retrieval.
// Cron "0 19 * * 4" (netlify.toml) = Thursday 19:00 UTC = Friday 03:00
// Australia/Perth (UTC+8, no daylight saving) — a few hours after the
// Thursday night draw.
//
// Flow: find the most recent draw without results -> fetch official numbers
// (up to 3 attempts with a delay, one polite request per attempt) -> save via
// the shared pipeline (unique constraint prevents duplicates; manual entry
// always wins) which auto-triggers matching and status updates. On total
// failure: mark the draw "results pending - auto retrieve failed" and email
// the admin one alert (logged in email_logs). Never crashes.

import { supabase, must } from '../../lib/db.mjs';
import { fetchResultWithRetries } from '../../lib/results-service.mjs';
import { saveResultsAndProcess } from '../../lib/results-pipeline.mjs';
import { sendEmail, adminScrapeFailedEmail } from '../../lib/email.mjs';

async function findDrawAwaitingResults() {
  const today = new Date().toISOString().slice(0, 10);
  const draws = must(
    await supabase().from('draws').select('*')
      .lte('draw_date', today)
      .order('draw_date', { ascending: false })
      .limit(5)
  );
  for (const d of draws) {
    const result = must(
      await supabase().from('results').select('id').eq('draw_id', d.id).maybeSingle()
    );
    if (!result) return d; // most recent past draw with no results yet
  }
  return null;
}

async function alertAdmin(draw, attempts, lastError) {
  // One alert per draw failure: skip if we already logged one for this draw today.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const prior = must(
    await supabase().from('email_logs').select('id')
      .eq('type', 'admin_alert').eq('draw_id', draw.id).eq('status', 'sent')
      .gte('sent_at', since)
  );
  if (prior.length > 0) return;
  const admins = must(await supabase().from('members').select('*').eq('role', 'admin').eq('is_active', true));
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
    const draw = await findDrawAwaitingResults();
    if (!draw) {
      console.log('Results cron: no draw awaiting results.');
      return new Response('ok');
    }

    // 3 attempts, 5s fetch timeout each, 3s between: worst case ~21s, inside
    // Netlify's function execution limit.
    const outcome = await fetchResultWithRetries({ maxAttempts: 3, delayMs: 3000 });

    if (!outcome.ok) {
      console.error(`Results retrieval failed for draw ${draw.draw_date}: ${outcome.lastError}`);
      must(
        await supabase().from('draws').update({ status: 'results_pending_failed' })
          .eq('id', draw.id).select().single()
      );
      await alertAdmin(draw, outcome.attempts, outcome.lastError);
      return new Response('ok');
    }

    // Sanity check: the scraped result must be for our draw's date (or its
    // official draw number if we know it). A mismatch is treated as a failure
    // rather than saving wrong numbers against the draw.
    const dateMatches = outcome.drawDate === draw.draw_date;
    const numberMatches = draw.draw_number != null && outcome.drawNumber === draw.draw_number;
    if (!dateMatches && !numberMatches) {
      const msg = `Scraped draw date ${outcome.drawDate} does not match our draw ${draw.draw_date}`;
      console.error(msg);
      must(
        await supabase().from('draws').update({ status: 'results_pending_failed' })
          .eq('id', draw.id).select().single()
      );
      await alertAdmin(draw, outcome.attempts, msg);
      return new Response('ok');
    }

    if (draw.draw_number == null && outcome.drawNumber != null) {
      await supabase().from('draws').update({ draw_number: outcome.drawNumber }).eq('id', draw.id);
    }

    const saved = await saveResultsAndProcess({
      drawId: draw.id,
      numbers: outcome.numbers,
      powerball: outcome.powerball,
      divisions: outcome.divisions,
      source: 'scraped',
    });
    console.log('Results cron outcome:', JSON.stringify(saved));
  } catch (err) {
    // Never crash the scheduled function.
    console.error('Results cron error:', err);
  }
  return new Response('ok');
}
