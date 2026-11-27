// Syndicate shares. A Lott syndicate ticket is sold in shares; owning
// 1 of 15 means a fifteenth of the ticket and a fifteenth of every prize.
// Pure helpers, unit-tested; the same arithmetic is mirrored in the
// frontend for display.

const MAX_SHARES = 1000;

/**
 * Validate a share fraction. Missing/blank means the whole ticket (1/1).
 * @returns {{ok:true, held:number, total:number}|{ok:false, error:string}}
 */
export function validateShare(held, total) {
  const h = held === undefined || held === null || held === '' ? 1 : Number(held);
  const t = total === undefined || total === null || total === '' ? 1 : Number(total);
  if (!Number.isInteger(h) || !Number.isInteger(t)) return { ok: false, error: 'Shares must be whole numbers' };
  if (h < 1 || t < 1 || t > MAX_SHARES) return { ok: false, error: `Shares must be between 1 and ${MAX_SHARES}` };
  if (h > t) return { ok: false, error: "You can't hold more shares than the ticket has" };
  return { ok: true, held: h, total: t };
}

/** Our part of an amount, rounded to the cent. 1/1 passes through. */
export function applyShareCents(cents, held = 1, total = 1) {
  if (!Number.isFinite(cents)) return cents;
  if (!total || total <= 1 || held === total) return cents;
  return Math.round((cents * held) / total);
}

/** "1/15 share (6.7%)", or null for a whole ticket. */
export function shareLabel(held = 1, total = 1) {
  if (!total || total <= 1) return null;
  const pct = (held / total) * 100;
  const pctText = Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
  return `${held}/${total} share (${pctText})`;
}
