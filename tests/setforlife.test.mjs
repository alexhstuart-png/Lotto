import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSflGame, validateSflResult, matchSflGame } from '../lib/setforlife.mjs';

test('Set for Life validation: 7 numbers 1-44, systems 8-15, results 7+2', () => {
  assert.equal(validateSflGame({ numbers: [1, 5, 12, 22, 33, 40, 44] }).ok, true);
  assert.equal(validateSflGame({ numbers: [1, 5, 12, 22, 33, 40, 45] }).ok, false); // out of range
  assert.equal(validateSflGame({ numbers: [1, 5, 12, 22, 33, 40] }).ok, false);     // too few
  assert.equal(validateSflGame({ numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9] }).ok, true); // system 9
  assert.equal(validateSflGame({ numbers: Array.from({ length: 16 }, (_, i) => i + 1) }).ok, false);

  const r = validateSflResult({ numbers: [7, 3, 1, 44, 20, 11, 30], bonus: [9, 2] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.numbers, [1, 3, 7, 11, 20, 30, 44]);
  assert.deepEqual(r.bonus, [2, 9]);
  assert.equal(validateSflResult({ numbers: [1, 2, 3, 4, 5, 6, 7], bonus: [7, 9] }).ok, false); // bonus overlaps
  assert.equal(validateSflResult({ numbers: [1, 2, 3, 4, 5, 6, 7], bonus: [9] }).ok, false);    // one bonus
});

test('Set for Life matching and divisions', () => {
  const result = { numbers: [1, 2, 3, 4, 5, 6, 7], bonus: [8, 9] };
  // all 7 -> Division 1
  assert.equal(matchSflGame({ numbers: [1, 2, 3, 4, 5, 6, 7] }, result).division, 1);
  // 6 winning + a bonus -> Division 2
  const d2 = matchSflGame({ numbers: [1, 2, 3, 4, 5, 6, 8] }, result);
  assert.equal(d2.division, 2);
  assert.deepEqual(d2.matchedBonus, [8]);
  // 6 winning, no bonus -> Division 3
  assert.equal(matchSflGame({ numbers: [1, 2, 3, 4, 5, 6, 40] }, result).division, 3);
  // 3 winning + bonus -> Division 8; 3 winning alone -> nothing
  assert.equal(matchSflGame({ numbers: [1, 2, 3, 9, 30, 40, 44] }, result).division, 8);
  assert.equal(matchSflGame({ numbers: [1, 2, 3, 20, 30, 40, 44] }, result).division, null);
  // system 9 holding all 7 winning -> Division 1 (best line)
  const sys = matchSflGame({ numbers: [1, 2, 3, 4, 5, 6, 7, 8, 40] }, result);
  assert.equal(sys.division, 1);
  assert.equal(sys.matchCount, 7);
});
