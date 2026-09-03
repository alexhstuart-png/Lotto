// Shared "fetch official results and save them" flow, used by both the
// Friday 3 AM cron and the admin's on-demand "Fetch results now" button.
// Finds the most recent past draw with no results, fetches from the provider,
// sanity-checks the draw date, then runs the one-action save pipeline
// (matching, highlighting, status — all automatic).

import { supabase, must, T } from './db.mjs';
import { perthDateString } from './reminders.mjs';
import { fetchResultWithRetries } from './results-service.mjs';
import { saveResultsAndProcess } from './results-pipeline.mjs';

/**
 * The most recent past draw that needs a fetch: either it has no result yet
 * (needs 'results'), or it has a result with no dividend data — typical for
 * manually entered numbers — and can have the official dividends backfilled
 * (needs 'dividends').
 */
export async function findDrawAwaitingResults() {
  const today = perthDateString();
  const draws = must(
    await supabase().from(T('draws')).select('*')
      .lte('draw_date', today)
      .order('draw_date', { ascending: false })
      .limit(5)
  );
  for (const d of draws) {
    const result = must(
      await supabase().from(T('results')).select('id, divisions').eq('draw_id', d.id).maybeSingle()
    );
    if (!result) return { draw: d, needs: 'results' };
    if (!result.divisions) return { draw: d, needs: 'dividends' };
  }
  return null;
}

/**
 * @param {object} opts
 * @param {number} opts.maxAttempts  fetch attempts (cron 3; button 1 to stay
 *                                   inside the interactive function timeout)
 * @param {number} opts.delayMs      delay between attempts
 * @param {boolean} opts.markFailedOnError  cron sets the draw to
 *        results_pending_failed; the button leaves status alone so a
 *        too-early tap doesn't flag a false failure.
 * @returns one of:
 *   {status:'no_draw'}
 *   {status:'fetch_failed', draw, attempts, lastError}
 *   {status:'mismatch', draw, scrapedDate}
 *   {status:'skipped', draw}            result already saved (race/manual)
 *   {status:'saved', draw, hasWinner, drawStatus}
 */
export async function fetchAndSaveLatestResults({ maxAttempts = 3, delayMs = 3000, markFailedOnError = true } = {}) {
  const found = await findDrawAwaitingResults();
  if (!found) return { status: 'no_draw' };
  const { draw, needs } = found;

  const outcome = await fetchResultWithRetries({ maxAttempts, delayMs });

  const markFailed = async () => {
    // Never flag a draw that already has results (dividend backfill mode).
    if (!markFailedOnError || needs !== 'results') return;
    must(
      await supabase().from(T('draws')).update({ status: 'results_pending_failed' })
        .eq('id', draw.id).select().single()
    );
  };

  if (!outcome.ok) {
    await markFailed();
    return { status: 'fetch_failed', draw, attempts: outcome.attempts, lastError: outcome.lastError };
  }

  // Never save numbers that aren't for our draw.
  const dateMatches = outcome.drawDate === draw.draw_date;
  const numberMatches = draw.draw_number != null && outcome.drawNumber === draw.draw_number;
  if (!dateMatches && !numberMatches) {
    await markFailed();
    return { status: 'mismatch', draw, scrapedDate: outcome.drawDate };
  }

  if (draw.draw_number == null && outcome.drawNumber != null) {
    await supabase().from(T('draws')).update({ draw_number: outcome.drawNumber }).eq('id', draw.id);
  }

  const saved = await saveResultsAndProcess({
    drawId: draw.id,
    numbers: outcome.numbers,
    powerball: outcome.powerball,
    divisions: outcome.divisions,
    source: 'scraped',
  });
  if (!saved.saved) return { status: 'skipped', draw, reason: saved.skipped, autoRecorded: saved.autoRecorded ?? 0 };
  return { status: 'saved', draw, hasWinner: saved.hasWinner, drawStatus: saved.status, autoRecorded: saved.autoRecorded ?? 0 };
}
