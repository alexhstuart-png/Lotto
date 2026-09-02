import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGame, validateResult, validateEmail, validateCents, validateDate, validateUuid } from '../lib/validate.mjs';

test('valid Powerball game passes and mains come back sorted', () => {
  const v = validateGame({ numbers: [35, 1, 17, 22, 31, 4, 11], powerball: 20 });
  assert.equal(v.ok, true);
  assert.deepEqual(v.numbers, [1, 4, 11, 17, 22, 31, 35]);
  assert.equal(v.powerball, 20);
});

test('rejects wrong main count, out-of-range, duplicates, bad powerball', () => {
  assert.equal(validateGame({ numbers: [1, 2, 3, 4, 5, 6], powerball: 5 }).ok, false);
  assert.equal(validateGame({ numbers: [1, 2, 3, 4, 5, 6, 36], powerball: 5 }).ok, false);
  assert.equal(validateGame({ numbers: [0, 2, 3, 4, 5, 6, 7], powerball: 5 }).ok, false);
  assert.equal(validateGame({ numbers: [1, 1, 3, 4, 5, 6, 7], powerball: 5 }).ok, false);
  assert.equal(validateGame({ numbers: [1, 2, 3, 4, 5, 6, 7], powerball: 21 }).ok, false);
  assert.equal(validateGame({ numbers: [1, 2, 3, 4, 5, 6, 7], powerball: 0 }).ok, false);
  assert.equal(validateGame({ numbers: [1, 2, 3, 4, 5, 6, 7.5], powerball: 5 }).ok, false);
  assert.equal(validateGame({ numbers: [1, 2, 3, 4, 5, 6, '7'], powerball: 5 }).ok, false);
  assert.equal(validateGame(null).ok, false);
});

test('email / cents / date / uuid validators', () => {
  assert.equal(validateEmail(' Alex@Example.COM '), 'alex@example.com');
  assert.equal(validateEmail('nope'), null);
  assert.equal(validateCents(2500), 2500);
  assert.equal(validateCents(-1), null);
  assert.equal(validateCents(-1, { allowNegative: true }), -1);
  assert.equal(validateCents(25.5), null);
  assert.equal(validateDate('2026-08-27'), '2026-08-27');
  assert.equal(validateDate('27/08/2026'), null);
  assert.equal(validateUuid('dddddddd-0000-0000-0000-000000000001'), 'dddddddd-0000-0000-0000-000000000001');
  assert.equal(validateUuid('not-a-uuid'), null);
});

test('System entries: 8-20 mains valid for games, results stay exactly 7', () => {
  const sys8 = validateGame({ numbers: [1, 2, 3, 4, 5, 6, 7, 8], powerball: 5 });
  assert.equal(sys8.ok, true);
  assert.equal(sys8.numbers.length, 8);
  const sys20 = validateGame({ numbers: Array.from({ length: 20 }, (_, i) => i + 1), powerball: 5 });
  assert.equal(sys20.ok, true);
  assert.equal(validateGame({ numbers: Array.from({ length: 21 }, (_, i) => i + 1), powerball: 5 }).ok, false);
  // official results must be exactly 7 mains
  assert.equal(validateResult({ numbers: [1, 2, 3, 4, 5, 6, 7, 8], powerball: 5 }).ok, false);
  assert.equal(validateResult({ numbers: [1, 2, 3, 4, 5, 6, 7], powerball: 5 }).ok, true);
});

test('PowerHit validation: no single powerball; results never PowerHit', () => {
  const ph = validateGame({ numbers: [1, 2, 3, 4, 5, 6, 7], powerhit: true });
  assert.equal(ph.ok, true);
  assert.equal(ph.powerball, null);
  assert.equal(ph.powerhit, true);
  // PowerHit with a powerball set is contradictory
  assert.equal(validateGame({ numbers: [1, 2, 3, 4, 5, 6, 7], powerball: 5, powerhit: true }).ok, false);
  // System PowerHit (8 mains + all PBs) is fine
  assert.equal(validateGame({ numbers: [1, 2, 3, 4, 5, 6, 7, 8], powerhit: true }).ok, true);
  // official results can never be PowerHit
  assert.equal(validateResult({ numbers: [1, 2, 3, 4, 5, 6, 7], powerhit: true }).ok, false);
});
