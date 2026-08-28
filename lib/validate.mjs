// Server-side input validation. Nothing from the client is trusted.

export const POWERBALL_RULES = {
  mainCount: 7,
  mainMin: 1,
  mainMax: 35,
  pbMin: 1,
  pbMax: 20,
};

function isInt(n) {
  return typeof n === 'number' && Number.isInteger(n);
}

/**
 * Validate one Powerball game: exactly 7 distinct mains 1-35 + powerball 1-20.
 * Returns { ok: true, numbers, powerball } with mains sorted ascending,
 * or { ok: false, error }.
 */
export function validateGame(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Invalid game' };
  const { numbers, powerball } = input;
  if (!Array.isArray(numbers) || numbers.length !== POWERBALL_RULES.mainCount) {
    return { ok: false, error: `Each game needs exactly ${POWERBALL_RULES.mainCount} main numbers` };
  }
  for (const n of numbers) {
    if (!isInt(n) || n < POWERBALL_RULES.mainMin || n > POWERBALL_RULES.mainMax) {
      return { ok: false, error: `Main numbers must be whole numbers between ${POWERBALL_RULES.mainMin} and ${POWERBALL_RULES.mainMax}` };
    }
  }
  if (new Set(numbers).size !== numbers.length) {
    return { ok: false, error: 'Main numbers must not repeat within a game' };
  }
  if (!isInt(powerball) || powerball < POWERBALL_RULES.pbMin || powerball > POWERBALL_RULES.pbMax) {
    return { ok: false, error: `Powerball must be a whole number between ${POWERBALL_RULES.pbMin} and ${POWERBALL_RULES.pbMax}` };
  }
  return { ok: true, numbers: [...numbers].sort((a, b) => a - b), powerball };
}

/** Validate an official result set — same shape as a game. */
export function validateResult(input) {
  return validateGame(input);
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
