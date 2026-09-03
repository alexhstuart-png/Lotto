// The single "save results" action. Whether numbers arrive from the scraper
// or the admin form, this one call persists them and triggers everything:
// matching runs, the draw status updates (results_available / winner), and
// every member-facing view immediately shows highlighted balls and match
// counts — matching is computed live from results + games, so there is no
// separate "check numbers" step and corrections recompute automatically.

import { supabase, must, auditLog, T } from './db.mjs';
import { matchTicket } from './matching.mjs';
import { validateResult } from './validate.mjs';
import { estimateWinnings } from './winnings-estimate.mjs';

/**
 * Matching + auto-winnings, run on every result save or dividend backfill.
 * When a winning line's division has an OFFICIAL published dividend, a
 * winnings record is created automatically (added to the kitty) — protected
 * by the unique (draw_id, game_index) index so re-runs never double-record.
 * Lines without a published dividend are left for manual Confirm Winnings.
 */
async function processMatchingAndWinnings(drawId, numbers, powerball, divisions) {
  const ticket = must(
    await supabase().from(T('tickets')).select('id').eq('draw_id', drawId).maybeSingle()
  );
  let hasWinner = false;
  let autoRecorded = 0;
  if (ticket) {
    const games = must(
      await supabase().from(T('games'))
        .select('id, game_index, numbers, powerball, powerhit')
        .eq('ticket_id', ticket.id).order('game_index')
    );
    const outcome = matchTicket(games, { numbers, powerball });
    hasWinner = outcome.hasWinner;

    if (hasWinner && divisions) {
      const est = estimateWinnings(outcome.winners, divisions);
      const known = (est?.lines || []).filter((l) => l.amountCents != null);
      if (known.length) {
        const { data, error } = await supabase().from(T('winnings')).upsert(
          known.map((l) => ({
            draw_id: drawId,
            game_index: l.gameIndex,
            division: l.division,
            amount_cents: l.amountCents,
            added_to_kitty: true,
          })),
          { onConflict: 'draw_id,game_index', ignoreDuplicates: true }
        ).select();
        if (error) {
          console.error('auto-winnings upsert failed:', error.message);
        } else if (data && data.length) {
          for (const w of data) {
            must(
              await supabase().from(T('kitty_transactions')).insert({
                type: 'winnings',
                amount_cents: w.amount_cents,
                draw_id: drawId,
                note: `Auto: Div ${w.division} win (game ${w.game_index}) — official dividend`,
              }).select().single()
            );
          }
          autoRecorded = data.length;
          await auditLog({
            action: 'winnings_auto_recorded',
            entity: 'draws',
            entityId: drawId,
            details: { lines: data.map((w) => ({ game: w.game_index, division: w.division, cents: w.amount_cents })) },
          });
        }
      }
    }
  }
  const status = hasWinner ? 'winner' : 'results_available';
  must(await supabase().from(T('draws')).update({ status }).eq('id', drawId).select().single());
  return { status, hasWinner, autoRecorded };
}

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
      const processed = await processMatchingAndWinnings(drawId, check.numbers, check.powerball, divisions);
      return { saved: false, skipped: 'dividends_backfilled', ...processed };
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

  // Matching + auto-winnings pipeline: fires automatically on every save.
  const processed = await processMatchingAndWinnings(drawId, check.numbers, check.powerball, divisions);
  return { saved: true, ...processed };
}
