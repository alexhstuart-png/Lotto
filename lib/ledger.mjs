// Ledger logic. Balances are ALWAYS computed from transaction rows — there is
// no stored balance field anywhere. Pure helpers here are unit-tested; the
// charge writer relies on the database's partial unique index
// (member_id, draw_id) where type='weekly_charge' for duplicate protection.

/** Member balance in cents from their transaction rows. */
export function balanceFromTransactions(rows) {
  return rows.reduce((sum, r) => sum + r.amount_cents, 0);
}

/** Kitty balance in cents from kitty ledger rows. */
export function kittyBalanceFromTransactions(rows) {
  return rows.reduce((sum, r) => sum + r.amount_cents, 0);
}

/**
 * How much the kitty still has to move so a draw's ticket is settled.
 * The weekly charges cover the ticket first; the kitty takes only the
 * DIFFERENCE (charges - cost). Whatever ticket_cost rows the draw already
 * has are subtracted, so this is a true-up: calling it again after the
 * ticket price changes (extra lines bought after publishing) yields just
 * the delta, and calling it when nothing changed yields 0.
 * @param {{costCents:number, collectedCents:number, recordedNetCents:number}} p
 * @returns {number} cents to add as a new ticket_cost row (0 = nothing to do)
 */
export function ticketCostDeltaCents({ costCents, collectedCents, recordedNetCents }) {
  const desiredNet = collectedCents - costCents;
  return desiredNet - recordedNetCents;
}

/**
 * Charge every active member the weekly amount for a draw — once.
 * Inserts one weekly_charge row per member; rows that would violate the
 * unique (member_id, draw_id, type=weekly_charge) constraint are skipped, so
 * re-publishing or editing a published ticket never re-charges anyone.
 *
 * @param {object} db  adapter with insertChargeIgnoringDuplicates(row) -> {inserted:boolean}
 * @param {{id:string}[]} activeMembers
 * @param {string} drawId
 * @param {number} amountCents  positive weekly charge amount
 * @param {string|null} createdBy
 * @returns {Promise<{charged:string[], skipped:string[]}>}
 */
export async function chargeMembersForDraw(db, activeMembers, drawId, amountCents, createdBy = null) {
  const charged = [];
  const skipped = [];
  for (const m of activeMembers) {
    const { inserted } = await db.insertChargeIgnoringDuplicates({
      member_id: m.id,
      type: 'weekly_charge',
      amount_cents: -Math.abs(amountCents),
      draw_id: drawId,
      note: 'Weekly Powerball charge',
      created_by: createdBy,
    });
    (inserted ? charged : skipped).push(m.id);
  }
  return { charged, skipped };
}
