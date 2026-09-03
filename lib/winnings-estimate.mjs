// Winnings estimates from OFFICIAL published dividends — never guesses.
// The Lott's results feed includes each division's declared dividend for the
// draw; an estimate is simply (winning lines × their division's dividend).
// Displayed clearly as an estimate; the admin-confirmed amount remains the
// only thing that ever touches the ledger. For System/PowerHit entries the
// best line understates the true payout (they also collect lower divisions),
// so estimates are a floor, not a ceiling.

/** divisions rows ({division, blocDividend} — dollars) -> Map(division -> cents) */
export function dividendMapCents(divisions) {
  const map = new Map();
  if (!Array.isArray(divisions)) return map;
  for (const d of divisions) {
    const div = d?.division;
    const amt = d?.blocDividend;
    if (Number.isInteger(div) && typeof amt === 'number' && amt > 0) {
      map.set(div, Math.round(amt * 100));
    }
  }
  return map;
}

/**
 * @param {{gameIndex:number, division:number}[]} winners  winning lines
 * @param {Array|null} divisions  stored official dividend rows
 * @returns {{ totalCents:number, lines:{gameIndex:number, division:number, amountCents:number|null}[], allKnown:boolean }|null}
 *          null when there are no winners.
 */
export function estimateWinnings(winners, divisions) {
  if (!Array.isArray(winners) || winners.length === 0) return null;
  const map = dividendMapCents(divisions);
  let totalCents = 0;
  let allKnown = true;
  const lines = winners.map((w) => {
    const amountCents = map.get(w.division) ?? null;
    if (amountCents === null) allKnown = false;
    else totalCents += amountCents;
    return { gameIndex: w.gameIndex, division: w.division, amountCents };
  });
  return { totalCents, lines, allKnown };
}
