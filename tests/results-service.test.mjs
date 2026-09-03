import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTheLottResponse, fetchResultWithRetries } from '../lib/results-service.mjs';

const goodPayload = {
  DrawResults: [{
    ProductId: 'Powerball',
    DrawNumber: 1528,
    DrawDate: '2026-08-27T00:00:00',
    PrimaryNumbers: [4, 8, 17, 22, 31, 33, 34],
    SecondaryNumbers: [6],
    Dividends: [{ Division: 1, BlocDividend: 20000000, BlocNumberOfWinners: 0 }],
  }],
};

test('parses a well-formed response', () => {
  const r = parseTheLottResponse(goodPayload);
  assert.equal(r.ok, true);
  assert.equal(r.drawNumber, 1528);
  assert.equal(r.drawDate, '2026-08-27');
  assert.deepEqual(r.numbers, [4, 8, 17, 22, 31, 33, 34]);
  assert.equal(r.powerball, 6);
  assert.equal(r.divisions.length, 1);
});

test('ambiguous or invalid payloads throw instead of saving wrong numbers', () => {
  assert.throws(() => parseTheLottResponse(null));
  assert.throws(() => parseTheLottResponse({}));
  assert.throws(() => parseTheLottResponse({ DrawResults: [] }));
  // wrong product only
  assert.throws(() => parseTheLottResponse({ DrawResults: [{ ProductId: 'OzLotto' }] }));
  // two secondary numbers = ambiguous
  const twoPb = structuredClone(goodPayload);
  twoPb.DrawResults[0].SecondaryNumbers = [6, 7];
  assert.throws(() => parseTheLottResponse(twoPb));
  // out-of-range main = invalid, never saved
  const badMain = structuredClone(goodPayload);
  badMain.DrawResults[0].PrimaryNumbers = [4, 8, 17, 22, 31, 33, 44];
  assert.throws(() => parseTheLottResponse(badMain));
  // six mains only
  const sixMains = structuredClone(goodPayload);
  sixMains.DrawResults[0].PrimaryNumbers = [4, 8, 17, 22, 31, 33];
  assert.throws(() => parseTheLottResponse(sixMains));
  // unparseable date
  const badDate = structuredClone(goodPayload);
  badDate.DrawResults[0].DrawDate = 'yesterday';
  assert.throws(() => parseTheLottResponse(badDate));
});

test('retries up to 3 times then reports failure without throwing', async () => {
  let calls = 0;
  const failing = {
    name: 'failing',
    async fetchLatestPowerballResult() { calls++; throw new Error('boom'); },
  };
  const out = await fetchResultWithRetries({ maxAttempts: 3, delayMs: 1, provider: failing });
  assert.equal(out.ok, false);
  assert.equal(out.attempts, 3);
  assert.equal(calls, 3);
  assert.equal(out.lastError, 'boom');
});

test('succeeds on a later attempt', async () => {
  let calls = 0;
  const flaky = {
    name: 'flaky',
    async fetchLatestPowerballResult() {
      calls++;
      if (calls < 2) throw new Error('transient');
      return parseTheLottResponse(goodPayload);
    },
  };
  const out = await fetchResultWithRetries({ maxAttempts: 3, delayMs: 1, provider: flaky });
  assert.equal(out.ok, true);
  assert.equal(out.attempts, 2);
  assert.deepEqual(out.numbers, [4, 8, 17, 22, 31, 33, 34]);
});

test('Set for Life parse: finds SetForLife2 product without a filter', async () => {
  const { parseTheLottSflResponse } = await import('../lib/results-service.mjs');
  const body = {
    DrawResults: [
      { ProductId: 'Powerball', PrimaryNumbers: [1,2,3,4,5,6,7], SecondaryNumbers: [9], DrawDate: '2026-09-03T00:00:00' },
      { ProductId: 'SetForLife2', DrawNumber: 3210, DrawDate: '2026-09-01T00:00:00',
        PrimaryNumbers: [3, 9, 14, 21, 30, 38, 44], SecondaryNumbers: [7, 25] },
    ],
  };
  const r = parseTheLottSflResponse(body);
  assert.equal(r.ok, true);
  assert.equal(r.drawDate, '2026-09-01');
  assert.deepEqual(r.numbers, [3, 9, 14, 21, 30, 38, 44]);
  assert.deepEqual(r.bonus, [7, 25]);
  // no SFL product at all -> error names what WAS there
  assert.throws(() => parseTheLottSflResponse({ DrawResults: [{ ProductId: 'OzLotto' }] }), /products: OzLotto/);
});
