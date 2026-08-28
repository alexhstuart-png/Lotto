import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGame, validateEmail, validateCents, validateDate, validateUuid } from '../lib/validate.mjs';

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
