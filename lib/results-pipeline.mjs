// The single "save results" action. Whether numbers arrive from the scraper
// or the admin form, this one call persists them and triggers everything:
// matching runs, the draw status updates (results_available / winner), and
// every member-facing view immediately shows highlighted balls and match
// counts — matching is computed live from results + games, so there is no
// separate "check numbers" step and corrections recompute automatically.

import { supabase, must, auditLog, T } from './db.mjs';
import { matchTicket } from './matching.mjs';
import { validateResult } from './validate.mjs';

/**
 * Save official results for a draw and run the full pipeline.
 *
 * Rules enforced here:
 * - results has a UNIQUE(draw_id) constraint: a scraper re-run can never
 *   create a duplicate result row.
 * - Manual entry always wins: a scraped save NEVER overwrites an existing
 *   result (of either source) — it is skipped. A manual save overwrites
 *   anything and becomes authoritative, with an audit log entry.
 *
 * @returns {{ saved: boolean, skipped?: string, status?: string, hasWinner?: boolean }}
 */
export async function saveResultsAndProcess({ drawId, numbers, powerball, divisions = null, source, actorId = null }) {
  const check = validateResult({ numbers, powerball });
  if (!check.ok) throw new Error(check.error);
  if (!['scraped', 'manual'].includes(source)) throw new Error('Invalid result source');

  const existing = must(
    await supabase().from(T('results')).select('*').eq('draw_id', drawId).maybeSingle()
  );

  if (existing && source === 'scraped') {
    // Admin-entered (or previously saved) results are authoritative — skip.
    // One safe exception: if the scraped numbers agree exactly and the saved
    // result has no dividend data (typical for manual entry), backfill just
    // the official dividends so winnings estimates can show.
    const sameNumbers =
      JSON.stringify(existing.numbers) === JSON.stringify(check.numbers) &&
      existing.powerball === check.powerball;
    if (sameNumbers && !existing.divisions && divisions) {
      must(
        await supabase().from(T('results')).update({ divisions })
          .eq('id', existing.id).select().single()
      );
      return { saved: false, skipped: 'dividends_backfilled' };
    }
    return { saved: false, skipped: 'result_already_exists' };
  }

  if (existing) {
    // Manual edit/overwrite: authoritative, audited, matching recomputes below.
    must(
      await supabase()
        .from(T('results'))
        .update({
          numbers: check.numbers,
          powerball: check.powerball,
          divisions,
          source: 'manual',
          entered_by: actorId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single()
    );
    await auditLog({
      actorId,
      action: 'results_edited',
      entity: 'results',
      entityId: existing.id,
      details: {
        before: { numbers: existing.numbers, powerball: existing.powerball, source: existing.source },
        after: { numbers: check.numbers, powerball: check.powerball, source: 'manual' },
      },
    });
  } else {
    // Insert-once path. If a concurrent run beat us to it the unique
    // constraint fires; for a scraped save that's a silent skip.
    const { error } = await supabase().from(T('results')).insert({
      draw_id: drawId,
      numbers: check.numbers,
      powerball: check.powerball,
      divisions,
      source,
      entered_by: actorId,
    });
    if (error) {
      if (error.code === '23505' && source === 'scraped') {
        return { saved: false, skipped: 'result_already_exists' };
      }
      throw new Error(error.message);
    }
    if (source === 'manual') {
      await auditLog({
        actorId,
        action: 'results_entered',
        entity: 'draws',
        entityId: drawId,
        details: { numbers: check.numbers, powerball: check.powerball },
      });
    }
  }

  // Matching pipeline: fires automatically on every save.
  const ticket = must(
    await supabase().from(T('tickets')).select('id').eq('draw_id', drawId).maybeSingle()
  );
  let hasWinner = false;
  if (ticket) {
    const games = must(
      await supabase()
        .from(T('games'))
        .select('id, game_index, numbers, powerball, powerhit')
        .eq('ticket_id', ticket.id)
        .order('game_index')
    );
    const outcome = matchTicket(games, { numbers: check.numbers, powerball: check.powerball });
    hasWinner = outcome.hasWinner;
  }

  const status = hasWinner ? 'winner' : 'results_available';
  must(await supabase().from(T('draws')).update({ status }).eq('id', drawId).select().single());

  return { saved: true, status, hasWinner };
}
