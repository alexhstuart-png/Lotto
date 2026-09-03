#!/usr/bin/env node
// One-off: run the results fetch/backfill from a Netlify build (which has
// full network access). Armed by the marker file scripts/.run-fetch —
// removed after use — and never fails the build.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
if (!fs.existsSync(path.join(here, '.run-fetch'))) {
  console.log('[run-fetch] marker not present — skipping.');
  process.exit(0);
}

try {
  const { fetchAndSaveLatestResults } = await import('../lib/results-runner.mjs');
  const out = await fetchAndSaveLatestResults({ maxAttempts: 2, delayMs: 2000, markFailedOnError: false });
  console.log('[run-fetch] outcome:', JSON.stringify({ ...out, draw: out.draw?.draw_date }));
} catch (err) {
  console.log('[run-fetch] failed:', err.message);
}
process.exit(0);
