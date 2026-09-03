// Standalone, swappable results retrieval service.
//
// Contract: a provider exposes fetchLatestPowerballResult() and returns either
//   { ok: true, drawNumber, drawDate: 'YYYY-MM-DD', numbers: number[7], powerball: number, divisions: object|null }
// or throws. The caller (results-cron) owns retries, fallback and persistence.
//
// Default provider: the Lott's public results JSON API — a single POST per
// attempt with a proper User-Agent (polite: no crawling, no HTML scraping,
// one request per attempt). Swap providers by setting RESULTS_PROVIDER or by
// registering another module here.
//
// Defensive parsing throughout: any ambiguity is a thrown error, never a
// partial or unvalidated number set.

import { validateResult } from './validate.mjs';
import { validateSflResult } from './setforlife.mjs';

const USER_AGENT = 'WorkLottoSyndicate/1.0 (private workplace syndicate; results check once weekly)';

async function fetchLatestFromTheLott(productFilter = null) {
  const res = await fetch('https://data.api.thelott.com/sales/vmax/web/data/lotto/latestresults', {
    method: 'POST',
    // Bounded so 3 attempts + delays always fit inside Netlify's function
    // execution limit (see results-cron).
    signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({
      CompanyId: 'GoldenCasket',
      MaxDrawCountPerProduct: 1,
      // With no filter the API returns the latest draw of every product —
      // used for games whose internal ProductId varies (e.g. Set for Life
      // appears as "SetForLife2"); we then select by pattern.
      ...(productFilter ? { OptionalProductFilter: [productFilter] } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Results API returned HTTP ${res.status}`);
  return res.json();
}

export const theLottProvider = {
  name: 'thelott',
  async fetchLatestPowerballResult() {
    return parseTheLottResponse(await fetchLatestFromTheLott('Powerball'));
  },
  async fetchLatestSetForLifeResult() {
    return parseTheLottSflResponse(await fetchLatestFromTheLott());
  },
};

/** Set for Life: 7 winning (1-44) + 2 bonus numbers, drawn nightly. */
export function parseTheLottSflResponse(body) {
  if (!body || !Array.isArray(body.DrawResults)) throw new Error('Unexpected response shape: no DrawResults');
  // Match any ProductId spelling: SetForLife, SetForLife2, Set4Life, ...
  const isSfl = (id) => /set\s*(for|4)\s*life/i.test(String(id).replace(/[^a-z0-9]/gi, ' '))
    || /set(for|4)life/i.test(String(id));
  const draw = body.DrawResults.find((d) => isSfl(d.ProductId));
  if (!draw) {
    const seen = body.DrawResults.map((d) => d.ProductId).filter(Boolean).join(', ');
    throw new Error(`No Set for Life draw in response (products: ${seen || 'none'})`);
  }
  const check = validateSflResult({ numbers: draw.PrimaryNumbers, bonus: draw.SecondaryNumbers });
  if (!check.ok) throw new Error(`Scraped Set for Life numbers failed validation: ${check.error}`);
  const dateMatch = String(draw.DrawDate ?? '').match(/^(\d{4}-\d{2}-\d{2})/);
  if (!dateMatch) throw new Error(`Unparseable draw date: ${draw.DrawDate}`);
  let divisions = null;
  if (Array.isArray(draw.Dividends)) {
    divisions = draw.Dividends
      .map((d) => ({
        division: d.Division ?? null,
        blocDividend: d.BlocDividend ?? null,
        blocNumberOfWinners: d.BlocNumberOfWinners ?? null,
      }))
      .filter((d) => d.division != null);
    if (divisions.length === 0) divisions = null;
  }
  return {
    ok: true,
    drawNumber: Number.isInteger(draw.DrawNumber) ? draw.DrawNumber : null,
    drawDate: dateMatch[1],
    numbers: check.numbers,
    bonus: check.bonus,
    divisions,
  };
}

/** Exported separately so parsing is unit-testable without network. */
export function parseTheLottResponse(body) {
  if (!body || !Array.isArray(body.DrawResults)) throw new Error('Unexpected response shape: no DrawResults');
  const draw = body.DrawResults.find((d) => /powerball/i.test(String(d.ProductId ?? '')));
  if (!draw) throw new Error('No Powerball draw in response');

  const numbers = draw.PrimaryNumbers;
  const secondary = draw.SecondaryNumbers;
  if (!Array.isArray(numbers) || !Array.isArray(secondary) || secondary.length !== 1) {
    throw new Error('Ambiguous number arrays in response — refusing to parse');
  }
  const powerball = secondary[0];
  const check = validateResult({ numbers, powerball });
  if (!check.ok) throw new Error(`Scraped numbers failed validation: ${check.error}`);

  const rawDate = String(draw.DrawDate ?? '');
  const dateMatch = rawDate.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!dateMatch) throw new Error(`Unparseable draw date: ${rawDate}`);

  const drawNumber = Number.isInteger(draw.DrawNumber) ? draw.DrawNumber : null;

  // Division/prize info if the API supplies it; optional, never required.
  let divisions = null;
  if (Array.isArray(draw.Dividends)) {
    divisions = draw.Dividends
      .map((d) => ({
        division: d.Division ?? null,
        blocDividend: d.BlocDividend ?? null,
        blocNumberOfWinners: d.BlocNumberOfWinners ?? null,
      }))
      .filter((d) => d.division != null);
    if (divisions.length === 0) divisions = null;
  }

  return {
    ok: true,
    drawNumber,
    drawDate: dateMatch[1],
    numbers: check.numbers,
    powerball: check.powerball,
    divisions,
  };
}

export function getProvider() {
  const name = process.env.RESULTS_PROVIDER || 'thelott';
  const providers = { thelott: theLottProvider };
  const p = providers[name];
  if (!p) throw new Error(`Unknown RESULTS_PROVIDER: ${name}`);
  return p;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch with up to `maxAttempts` tries, delaying between failures.
 * Never throws — returns { ok:true, ...result } or { ok:false, attempts, lastError }.
 */
export async function fetchResultWithRetries({ maxAttempts = 3, delayMs = 3000, provider = null } = {}) {
  const p = provider ?? getProvider();
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await p.fetchLatestPowerballResult();
      return { ...result, attempts: attempt };
    } catch (err) {
      lastError = err.message || String(err);
      console.error(`Results fetch attempt ${attempt}/${maxAttempts} failed: ${lastError}`);
      if (attempt < maxAttempts) await sleep(delayMs);
    }
  }
  return { ok: false, attempts: maxAttempts, lastError };
}
