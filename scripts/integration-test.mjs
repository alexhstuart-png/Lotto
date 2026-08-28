#!/usr/bin/env node
// Integration test scenarios against a REAL Supabase project (use a scratch
// project or run remove_seed.sql + cleanup after). Exercises the pieces that
// depend on database constraints, which unit tests cover only with fakes:
//
//   1. Duplicate charge on re-publish: the partial unique index rejects a
//      second weekly_charge for the same (member, draw).
//   2. Scraper re-run after success: unique(draw_id) on results means the
//      pipeline skips, never duplicates.
//   3. Manual results overwrite scraped ones and matching recomputes.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/integration-test.mjs
//
// Creates rows flagged is_demo and cleans them up at the end.

import { supabase, must, chargeDb, T } from '../lib/db.mjs';
import { chargeMembersForDraw } from '../lib/ledger.mjs';
import { saveResultsAndProcess } from '../lib/results-pipeline.mjs';

const ok = (name) => console.log(`  PASS  ${name}`);
const results = { pass: 0, fail: 0 };
async function check(name, fn) {
  try { await fn(); ok(name); results.pass++; }
  catch (e) { console.error(`  FAIL  ${name}: ${e.message}`); results.fail++; }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const sb = supabase();
const cleanup = { members: [], draws: [] };

try {
  console.log('Setting up fixtures…');
  const member = must(await sb.from(T('members')).insert({
    name: 'IT Member', email: `it-${Date.now()}@example.com`, is_demo: true,
  }).select().single());
  cleanup.members.push(member.id);

  const draw = must(await sb.from(T('draws')).insert({
    draw_date: '2030-01-03', is_demo: true, // a future Thursday
  }).select().single());
  cleanup.draws.push(draw.id);

  const ticket = must(await sb.from(T('tickets')).insert({
    draw_id: draw.id, cost_cents: 2680,
  }).select().single());
  must(await sb.from(T('games')).insert({
    ticket_id: ticket.id, game_index: 1,
    numbers: [4, 11, 12, 17, 22, 31, 35], powerball: 2,
  }).select().single());

  await check('publish charges member once; re-publish charges nobody', async () => {
    const first = await chargeMembersForDraw(chargeDb(), [member], draw.id, 2500);
    assert(first.charged.length === 1, 'first publish should charge');
    const second = await chargeMembersForDraw(chargeDb(), [member], draw.id, 2500);
    assert(second.charged.length === 0 && second.skipped.length === 1, 're-publish must not re-charge');
    const rows = must(await sb.from(T('transactions')).select('id')
      .eq('member_id', member.id).eq('draw_id', draw.id).eq('type', 'weekly_charge'));
    assert(rows.length === 1, `expected 1 charge row, got ${rows.length}`);
  });

  await check('scraped save triggers matching; re-run skips without duplicating', async () => {
    const save1 = await saveResultsAndProcess({
      drawId: draw.id, numbers: [4, 8, 17, 22, 31, 33, 34], powerball: 6, source: 'scraped',
    });
    assert(save1.saved === true, 'first scraped save should persist');
    assert(save1.status === 'results_available', `status should update, got ${save1.status}`);
    const save2 = await saveResultsAndProcess({
      drawId: draw.id, numbers: [1, 2, 3, 5, 6, 7, 9], powerball: 1, source: 'scraped',
    });
    assert(save2.saved === false && save2.skipped === 'result_already_exists', 'scraper re-run must skip');
    const rows = must(await sb.from(T('results')).select('numbers').eq('draw_id', draw.id));
    assert(rows.length === 1, `expected 1 result row, got ${rows.length}`);
    assert(rows[0].numbers[0] === 4, 'original result must be untouched');
  });

  await check('manual entry overwrites and matching recomputes (winner detection)', async () => {
    // Manual result matching game 1 exactly -> Division 1.
    const save = await saveResultsAndProcess({
      drawId: draw.id, numbers: [4, 11, 12, 17, 22, 31, 35], powerball: 2, source: 'manual',
    });
    assert(save.saved === true, 'manual save must overwrite');
    assert(save.hasWinner === true && save.status === 'winner', 'winner must be detected');
    const rows = must(await sb.from(T('results')).select('source').eq('draw_id', draw.id));
    assert(rows.length === 1 && rows[0].source === 'manual', 'manual is authoritative');
  });
} finally {
  console.log('Cleaning up fixtures…');
  for (const id of cleanup.members) {
    await sb.from(T('transactions')).delete().eq('member_id', id);
    await sb.from(T('audit_logs')).delete().eq('actor_id', id);
  }
  for (const id of cleanup.draws) await sb.from(T('draws')).delete().eq('id', id);
  for (const id of cleanup.members) await sb.from(T('members')).delete().eq('id', id);
}

console.log(`\n${results.pass} passed, ${results.fail} failed`);
process.exit(results.fail > 0 ? 1 : 0);
