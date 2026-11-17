import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balanceFromTransactions, chargeMembersForDraw, ticketCostDeltaCents } from '../lib/ledger.mjs';

/** In-memory stand-in for the transactions table enforcing the same unique
 *  (member_id, draw_id) where type='weekly_charge' constraint as Postgres. */
function fakeChargeDb() {
  const rows = [];
  return {
    rows,
    async insertChargeIgnoringDuplicates(row) {
      const dup = rows.some(
        (r) => r.type === 'weekly_charge' && r.member_id === row.member_id && r.draw_id === row.draw_id
      );
      if (dup) return { inserted: false };
      rows.push(row);
      return { inserted: true };
    },
  };
}

test('spec balance progression: $100 credit charged $25 weekly ends at $25 owing', () => {
  const rows = [{ amount_cents: 10000 }]; // $100 opening credit
  const balances = [];
  for (let week = 0; week < 5; week++) {
    rows.push({ amount_cents: -2500 });
    balances.push(balanceFromTransactions(rows));
  }
  assert.deepEqual(balances, [7500, 5000, 2500, 0, -2500]);
});

test('publishing charges each active member exactly once', async () => {
  const db = fakeChargeDb();
  const members = [{ id: 'alex' }, { id: 'jake' }, { id: 'carl' }];
  const first = await chargeMembersForDraw(db, members, 'draw-1', 2500, 'admin');
  assert.deepEqual(first.charged, ['alex', 'jake', 'carl']);
  assert.equal(db.rows.length, 3);
  assert.ok(db.rows.every((r) => r.amount_cents === -2500 && r.type === 'weekly_charge'));
});

test('re-publish never double-charges (duplicate key -> skip)', async () => {
  const db = fakeChargeDb();
  const members = [{ id: 'alex' }, { id: 'jake' }];
  await chargeMembersForDraw(db, members, 'draw-1', 2500);
  const rerun = await chargeMembersForDraw(db, members, 'draw-1', 2500);
  assert.deepEqual(rerun.charged, []);
  assert.deepEqual(rerun.skipped, ['alex', 'jake']);
  assert.equal(db.rows.length, 2);
  // A different draw still charges normally.
  const nextWeek = await chargeMembersForDraw(db, members, 'draw-2', 2500);
  assert.equal(nextWeek.charged.length, 2);
  assert.equal(db.rows.length, 4);
});

test('ticket cost settles against the kitty as a true-up, so price changes after publish flow through', () => {
  // First publish: $294 ticket vs $275 charges -> kitty covers $19.
  assert.equal(ticketCostDeltaCents({ costCents: 29400, collectedCents: 27500, recordedNetCents: 0 }), -1900);
  // Re-publish with nothing changed -> nothing more moves.
  assert.equal(ticketCostDeltaCents({ costCents: 29400, collectedCents: 27500, recordedNetCents: -1900 }), 0);
  // $50 of extra lines bought after publishing -> kitty covers the extra $50 only.
  assert.equal(ticketCostDeltaCents({ costCents: 34400, collectedCents: 27500, recordedNetCents: -1900 }), -5000);
  // Price corrected downwards -> the kitty gets the difference back.
  assert.equal(ticketCostDeltaCents({ costCents: 25000, collectedCents: 27500, recordedNetCents: -6900 }), 9400);
});
