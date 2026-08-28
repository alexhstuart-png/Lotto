// Pure Powerball matching logic. No I/O — fully unit-testable.
//
// Australian Powerball divisions:
//   Div 1: 7 mains + Powerball     Div 6: 4 mains + Powerball
//   Div 2: 7 mains                 Div 7: 5 mains
//   Div 3: 6 mains + Powerball     Div 8: 3 mains + Powerball
//   Div 4: 6 mains                 Div 9: 2 mains + Powerball
//   Div 5: 5 mains + Powerball
// Division is fully determined by (matched mains, powerball matched) so we can
// name the division — but prize AMOUNTS are never guessed; admin confirms them.

const DIVISION_TABLE = [
  { division: 1, mains: 7, pb: true },
  { division: 2, mains: 7, pb: false },
  { division: 3, mains: 6, pb: true },
  { division: 4, mains: 6, pb: false },
  { division: 5, mains: 5, pb: true },
  { division: 6, mains: 4, pb: true },
  { division: 7, mains: 5, pb: false },
  { division: 8, mains: 3, pb: true },
  { division: 9, mains: 2, pb: true },
];

/**
 * Match one game against the official result.
 * @param {{numbers:number[], powerball:number}} game
 * @param {{numbers:number[], powerball:number}} result
 * @returns {{ matchedNumbers:number[], matchCount:number, powerballMatched:boolean,
 *             division:number|null, isWinner:boolean }}
 */
export function matchGame(game, result) {
  const winning = new Set(result.numbers);
  const matchedNumbers = game.numbers.filter((n) => winning.has(n));
  const powerballMatched = game.powerball === result.powerball;
  const row = DIVISION_TABLE.find(
    (d) => d.mains === matchedNumbers.length && d.pb === powerballMatched
  );
  return {
    matchedNumbers,
    matchCount: matchedNumbers.length,
    powerballMatched,
    division: row ? row.division : null,
    isWinner: !!row,
  };
}

/**
 * Match every game on a ticket. Returns per-game matches plus a summary used
 * to set the draw status: 'winner' if any line wins, else 'results_available'.
 */
export function matchTicket(games, result) {
  const matches = games.map((g) => ({
    gameId: g.id ?? null,
    gameIndex: g.game_index ?? g.gameIndex ?? null,
    ...matchGame({ numbers: g.numbers, powerball: g.powerball }, result),
  }));
  const winners = matches.filter((m) => m.isWinner);
  return {
    matches,
    hasWinner: winners.length > 0,
    winners,
    drawStatus: winners.length > 0 ? 'winner' : 'results_available',
  };
}
