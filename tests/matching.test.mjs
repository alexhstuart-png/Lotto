import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchGame, matchTicket } from '../lib/matching.mjs';

test('spec highlighting scenario: official 4 8 17 22 31 44 vs game 4 11 17 22 31 40 highlights 4, 17, 22, 31 only', () => {
  const m = matchGame(
    { numbers: [4, 11, 17, 22, 31, 40], powerball: 2 },
    { numbers: [4, 8, 17, 22, 31, 44], powerball: 7 }
  );
  assert.deepEqual(m.matchedNumbers, [4, 17, 22, 31]);
  assert.equal(m.matchCount, 4);
  assert.equal(m.powerballMatched, false);
});

test('Powerball-legal version of the spec scenario (7 mains, as seeded)', () => {
  const m = matchGame(
    { numbers: [4, 11, 12, 17, 22, 31, 35], powerball: 2 },
    { numbers: [4, 8, 17, 22, 31, 33, 34], powerball: 6 }
  );
  assert.deepEqual(m.matchedNumbers, [4, 17, 22, 31]);
  assert.equal(m.matchCount, 4);
  assert.equal(m.powerballMatched, false);
  assert.equal(m.division, null); // 4 mains without PB is not a division
  assert.equal(m.isWinner, false);
});

test('division table is correct for every winning combination', () => {
  const result = { numbers: [1, 2, 3, 4, 5, 6, 7], powerball: 10 };
  const game = (mains, pb) => {
    // take `mains` matching numbers, fill the rest with non-matching
    const nums = [...result.numbers.slice(0, mains)];
    for (let n = 30; nums.length < 7; n++) nums.push(n);
    return { numbers: nums, powerball: pb ? 10 : 20 };
  };
  const cases = [
    [7, true, 1], [7, false, 2], [6, true, 3], [6, false, 4], [5, true, 5],
    [4, true, 6], [5, false, 7], [3, true, 8], [2, true, 9],
    [4, false, null], [3, false, null], [2, false, null],
    [1, true, null], [0, true, null], [1, false, null], [0, false, null],
  ];
  for (const [mains, pb, expected] of cases) {
    const m = matchGame(game(mains, pb), result);
    assert.equal(m.division, expected, `${mains} mains, pb=${pb}`);
    assert.equal(m.isWinner, expected !== null);
  }
});

test('matchTicket flags winner and sets draw status', () => {
  const result = { numbers: [1, 2, 3, 4, 5, 6, 7], powerball: 10 };
  const losing = { id: 'a', game_index: 1, numbers: [8, 9, 11, 12, 13, 14, 15], powerball: 3 };
  const div9 = { id: 'b', game_index: 2, numbers: [1, 2, 11, 12, 13, 14, 15], powerball: 10 };

  const noWin = matchTicket([losing], result);
  assert.equal(noWin.hasWinner, false);
  assert.equal(noWin.drawStatus, 'results_available');

  const win = matchTicket([losing, div9], result);
  assert.equal(win.hasWinner, true);
  assert.equal(win.drawStatus, 'winner');
  assert.equal(win.winners.length, 1);
  assert.equal(win.winners[0].gameIndex, 2);
  assert.equal(win.winners[0].division, 9);
});

test('System 8 entry: intersection highlighting and best-line division', () => {
  
  // official 7 mains all inside the system 8 picks + PB matched -> best line Div 1
  const result = { numbers: [1, 2, 3, 4, 5, 6, 7], powerball: 10 };
  const sys8 = { numbers: [1, 2, 3, 4, 5, 6, 7, 20], powerball: 10 };
  const m = matchGame(sys8, result);
  assert.equal(m.matchCount, 7);
  assert.equal(m.powerballMatched, true);
  assert.equal(m.division, 1);
  assert.equal(m.isWinner, true);
  // partial: 4 of the 8 mains match, no PB -> not a winning line
  const m2 = matchGame({ numbers: [1, 2, 3, 4, 21, 22, 23, 24], powerball: 3 }, result);
  assert.deepEqual(m2.matchedNumbers, [1, 2, 3, 4]);
  assert.equal(m2.division, null);
});

test('PowerHit: powerball always counts as matched, division reflects it', () => {
  const result = { numbers: [1, 2, 3, 4, 5, 6, 7], powerball: 10 };
  // PowerHit with all 7 mains matched -> Division 1 regardless of the drawn PB
  const ph = matchGame({ numbers: [1, 2, 3, 4, 5, 6, 7], powerball: null, powerhit: true }, result);
  assert.equal(ph.powerballMatched, true);
  assert.equal(ph.division, 1);
  // PowerHit with 2 mains matched -> Division 9 (2 + PB)
  const ph2 = matchGame({ numbers: [1, 2, 11, 12, 13, 14, 15], powerball: null, powerhit: true }, result);
  assert.equal(ph2.division, 9);
  assert.equal(ph2.isWinner, true);
});

test('winnings estimate from official dividends: 2 x Div 9', async () => {
  const { estimateWinnings } = await import('../lib/winnings-estimate.mjs');
  const divisions = [
    { division: 1, blocDividend: 0, blocNumberOfWinners: 0 },
    { division: 9, blocDividend: 10.6, blocNumberOfWinners: 250000 },
  ];
  const est = estimateWinnings(
    [{ gameIndex: 2, division: 9 }, { gameIndex: 7, division: 9 }],
    divisions
  );
  assert.equal(est.totalCents, 2120); // 2 x $10.60
  assert.equal(est.allKnown, true);
  // unknown division (jackpot not declared / missing) -> partial estimate
  const est2 = estimateWinnings(
    [{ gameIndex: 1, division: 1 }, { gameIndex: 2, division: 9 }],
    divisions
  );
  assert.equal(est2.totalCents, 1060);
  assert.equal(est2.allKnown, false);
  // no dividends at all -> zero known
  const est3 = estimateWinnings([{ gameIndex: 1, division: 9 }], null);
  assert.equal(est3.totalCents, 0);
  assert.equal(est3.allKnown, false);
  // no winners -> null
  assert.equal(estimateWinnings([], divisions), null);
});
