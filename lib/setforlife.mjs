// Set for Life (AU, the Lott): pick 7 numbers from 1-44; every night's draw
// pulls 7 winning numbers + 2 bonus numbers. System entries pick 8-15.
//
// Divisions (best line):
//   Div 1: 7 winning                Div 5: 5 winning
//   Div 2: 6 winning + 1 bonus      Div 6: 4 winning + 1 bonus
//   Div 3: 6 winning                Div 7: 4 winning
//   Div 4: 5 winning + 1 bonus      Div 8: 3 winning + 1 bonus

export const SFL_RULES = { mainCount: 7, systemMaxMains: 15, min: 1, max: 44, bonusCount: 2 };

const isInt = (n) => typeof n === 'number' && Number.isInteger(n);

function checkNumbers(numbers, minLen, maxLen) {
  if (!Array.isArray(numbers) || numbers.length < minLen || numbers.length > maxLen) {
    return `Needs ${minLen === maxLen ? `exactly ${minLen}` : `${minLen}-${maxLen}`} numbers`;
  }
  for (const n of numbers) {
    if (!isInt(n) || n < SFL_RULES.min || n > SFL_RULES.max) {
      return `Numbers must be whole numbers between ${SFL_RULES.min} and ${SFL_RULES.max}`;
    }
  }
  if (new Set(numbers).size !== numbers.length) return 'Numbers must not repeat';
  return null;
}

/** A Set for Life game: 7 numbers (or 8-15 for a system entry), 1-44. */
export function validateSflGame(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Invalid game' };
  const err = checkNumbers(input.numbers, SFL_RULES.mainCount, SFL_RULES.systemMaxMains);
  if (err) return { ok: false, error: err };
  return { ok: true, numbers: [...input.numbers].sort((a, b) => a - b) };
}

/** An official Set for Life result: 7 winning + 2 bonus, all distinct 1-44. */
export function validateSflResult(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Invalid result' };
  const errW = checkNumbers(input.numbers, SFL_RULES.mainCount, SFL_RULES.mainCount);
  if (errW) return { ok: false, error: `Winning numbers: ${errW}` };
  const errB = checkNumbers(input.bonus, SFL_RULES.bonusCount, SFL_RULES.bonusCount);
  if (errB) return { ok: false, error: `Bonus numbers: ${errB}` };
  if (input.bonus.some((b) => input.numbers.includes(b))) {
    return { ok: false, error: 'Bonus numbers must differ from the winning numbers' };
  }
  return {
    ok: true,
    numbers: [...input.numbers].sort((a, b) => a - b),
    bonus: [...input.bonus].sort((a, b) => a - b),
  };
}

const SFL_DIVISIONS = [
  { division: 1, wins: 7, bonus: false },
  { division: 2, wins: 6, bonus: true },
  { division: 3, wins: 6, bonus: false },
  { division: 4, wins: 5, bonus: true },
  { division: 5, wins: 5, bonus: false },
  { division: 6, wins: 4, bonus: true },
  { division: 7, wins: 4, bonus: false },
  { division: 8, wins: 3, bonus: true },
];

/**
 * Match one game (standard or system) against a night's result. For system
 * entries the best 7-number line takes every matched winning number and, if
 * there's a spare slot, a matched bonus number — so the division reported is
 * the best line the entry contains.
 */
export function matchSflGame(game, result) {
  const winning = new Set(result.numbers);
  const bonusSet = new Set(result.bonus);
  const matchedNumbers = game.numbers.filter((n) => winning.has(n));
  const matchedBonus = game.numbers.filter((n) => bonusSet.has(n));
  const wins = Math.min(matchedNumbers.length, 7);
  const bonusUsable = matchedBonus.length > 0 && (7 - wins) >= 1;
  const row =
    SFL_DIVISIONS.find((d) => d.wins === wins && d.bonus === bonusUsable) ||
    // a bonus in hand never demotes: fall back to the no-bonus division
    SFL_DIVISIONS.find((d) => d.wins === wins && d.bonus === false);
  return {
    matchedNumbers,
    matchedBonus,
    matchCount: matchedNumbers.length,
    bonusCount: matchedBonus.length,
    division: row ? row.division : null,
    isWinner: !!row,
  };
}
