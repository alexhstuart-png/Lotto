// The single "save results" action. The admin types the official numbers
// into the Admin form and this one call persists them and triggers
// everything: matching runs, the draw status updates (results_available /
// winner), and every member-facing view immediately shows highlighted balls
// and match counts — matching is computed live from results + games, so
// there is no separate "check numbers" step and corrections recompute
// automatically.

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
  let winners = [];
  let confirmedGames = [];
  if (ticket) {
    const games = must(
      await supabase().from(T('games'))
        .select('id, game_index, numbers, powerball, powerhit')
        .eq('ticket_id', ticket.id).order('game_index')
    );
    const outcome = matchTicket(games, { numbers, powerball });
    hasWinner = outcome.hasWinner;
    winners = outcome.winners.map((w) => ({
      gameIndex: w.gameIndex, division: w.division,
      matchedNumbers: w.matchedNumbers, powerballMatched: w.powerballMatched,
    }));

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
          // Single batched insert keeps this well inside function time limits.
          must(
            await supabase().from(T('kitty_transactions')).insert(
              data.map((w) => ({
                type: 'winnings',
                amount_cents: w.amount_cents,
                draw_id: drawId,
                note: `Auto: Div ${w.division} win (game ${w.game_index}) — official dividend`,
              }))
            ).select()
          );
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
  if (hasWinner) {
    // Lines that already have an amount on file (auto-banked now or confirmed
    // earlier) so the admin is only asked about the rest.
    const rows = must(
      await supabase().from(T('winnings')).select('game_index').eq('draw_id', drawId)
    );
    confirmedGames = rows.map((r) => r.game_index).filter((g) => g != null);
  }
  const status = hasWinner ? 'winner' : 'results_available';
  must(await supabase().from(T('draws')).update({ status }).eq('id', drawId).select().single());
  return { status, hasWinner, autoRecorded, winners, confirmedGames };
}

/**
 * Save official results for a draw and run the full pipeline.
 *
 * Rules enforced here:
 * - results has a UNIQUE(draw_id) constraint, so a draw can only ever have
 *   one result row.
 * - Saving again for the same draw overwrites the stored numbers (with an
 *   audit log entry) and matching recomputes from the new values.
 *
 * @returns {{ saved: boolean, status?: string, hasWinner?: boolean }}
 */
export async function saveResultsAndProcess({ drawId, numbers, powerball, divisions = null, actorId = null }) {
  const check = validateResult({ numbers, powerball });
  if (!check.ok) throw new Error(check.error);

  const existing = must(
    await supabase().from(T('results')).select('*').eq('draw_id', drawId).maybeSingle()
  );

  if (existing) {
    // Manual edit/overwrite: authoritative, audited, matching recomputes below.
    must(
      await supabase()
        .from(T('results'))
        .update({
          numbers: check.numbers,
          powerball: check.powerball,
          // Re-saving just the numbers keeps dividends already on file.
          divisions: divisions ?? existing.divisions ?? null,
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
    const { error } = await supabase().from(T('results')).insert({
      draw_id: drawId,
      numbers: check.numbers,
      powerball: check.powerball,
      divisions,
      source: 'manual',
      entered_by: actorId,
    });
    if (error) throw new Error(error.message);
    await auditLog({
      actorId,
      action: 'results_entered',
      entity: 'draws',
      entityId: drawId,
      details: { numbers: check.numbers, powerball: check.powerball },
    });
  }

  // Matching + auto-winnings pipeline: fires automatically on every save.
  const effectiveDivisions = divisions ?? existing?.divisions ?? null;
  const processed = await processMatchingAndWinnings(drawId, check.numbers, check.powerball, effectiveDivisions);
  return { saved: true, ...processed };
}
