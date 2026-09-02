// Server-side input validation. Nothing from the client is trusted.

export const POWERBALL_RULES = {
  mainCount: 7,      // a standard game; System entries pick 8-20 mains
  systemMaxMains: 20,
  mainMin: 1,
  mainMax: 35,
  pbMin: 1,
  pbMax: 20,
};

function isInt(n) {
  return typeof n === 'number' && Number.isInteger(n);
}

function checkMainsAndPb(input, minMains, maxMains, { allowPowerhit = false } = {}) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Invalid game' };
  const { numbers, powerball } = input;
  const powerhit = allowPowerhit && input.powerhit === true;
  if (!Array.isArray(numbers) || numbers.length < minMains || numbers.length > maxMains) {
    return {
      ok: false,
      error: minMains === maxMains
        ? `Needs exactly ${minMains} main numbers`
        : `Each game needs ${minMains} main numbers (or ${minMains + 1}-${maxMains} for a System entry)`,
    };
  }
  for (const n of numbers) {
    if (!isInt(n) || n < POWERBALL_RULES.mainMin || n > POWERBALL_RULES.mainMax) {
      return { ok: false, error: `Main numbers must be whole numbers between ${POWERBALL_RULES.mainMin} and ${POWERBALL_RULES.mainMax}` };
    }
  }
  if (new Set(numbers).size !== numbers.length) {
    return { ok: false, error: 'Main numbers must not repeat within a game' };
  }
  if (powerhit) {
    // PowerHit: plays every Powerball 1-20, so no single PB number.
    if (powerball !== undefined && powerball !== null) {
      return { ok: false, error: 'A PowerHit line has no single Powerball — it plays all 20' };
    }
    return { ok: true, numbers: [...numbers].sort((a, b) => a - b), powerball: null, powerhit: true };
  }
  if (!isInt(powerball) || powerball < POWERBALL_RULES.pbMin || powerball > POWERBALL_RULES.pbMax) {
    return { ok: false, error: `Powerball must be a whole number between ${POWERBALL_RULES.pbMin} and ${POWERBALL_RULES.pbMax}` };
  }
  return { ok: true, numbers: [...numbers].sort((a, b) => a - b), powerball, powerhit: false };
}

/**
 * Validate one Powerball game: 7 distinct mains 1-35 (standard) or 8-20
 * (System 8-20 entry), plus either a single powerball 1-20 or
 * powerhit: true (plays all 20 Powerballs). Returns { ok: true, numbers,
 * powerball, powerhit } with mains sorted ascending, or { ok: false, error }.
 */
export function validateGame(input) {
  return checkMainsAndPb(input, POWERBALL_RULES.mainCount, POWERBALL_RULES.systemMaxMains, { allowPowerhit: true });
}

/** Official results are always exactly 7 mains + 1 Powerball (never PowerHit). */
export function validateResult(input) {
  return checkMainsAndPb(input, POWERBALL_RULES.mainCount, POWERBALL_RULES.mainCount);
}

export function validateEmail(email) {
  if (typeof email !== 'string') return null;
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 254) return null;
  return e;
}

export function validateName(name) {
  if (typeof name !== 'string') return null;
  const n = name.trim();
  if (n.length < 1 || n.length > 80) return null;
  return n;
}

/** Signed money amount in cents; bounded to something sane. */
export function validateCents(v, { allowNegative = false, max = 100_000_000 } = {}) {
  if (!isInt(v)) return null;
  if (!allowNegative && v < 0) return null;
  if (Math.abs(v) > max) return null;
  return v;
}

/** ISO date string YYYY-MM-DD. */
export function validateDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

export function validateUuid(s) {
  if (typeof s !== 'string') return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s.toLowerCase() : null;
}
