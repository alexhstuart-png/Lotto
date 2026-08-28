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
