// Photo ticket scanning: the admin snaps a photo of the physical Powerball
// ticket and Claude reads the game lines out of it. The extracted games are
// only a PRE-FILL — they go into the normal games editor for the admin to
// eyeball against the paper ticket, and they pass through the exact same
// server-side validation as hand-typed games on save. Nothing is ever saved
// straight from a scan.

import Anthropic from '@anthropic-ai/sdk';
import { validateGame } from './validate.mjs';

const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
// ~4MB of image after base64 expansion; the frontend downscales well below this.
const MAX_BASE64_CHARS = 5_500_000;

const PROMPT = `This photo shows an Australian Powerball lottery ticket.

Extract every game line printed on the ticket. A STANDARD game has exactly 7
main numbers (each 1-35); a SYSTEM entry (the ticket will say "System 8",
"Sys 8", "S8" etc., up to System 20) has that many main numbers — e.g. a
System 8 line has 8 mains. Every line then has 1 separate Powerball number
(1-20), usually labelled "PB" or printed after the mains. Game lines are
usually labelled A, B, C, D... Count each line's mains carefully and include
ALL of them — do not stop at 7 on a system entry.

A line may also be a POWERHIT (the ticket will say "PowerHit" or "PH"): it
plays EVERY Powerball 1-20, so it has mains but no single Powerball number.

Respond with ONLY a JSON object, no other text, in exactly this shape:
{"games":[{"numbers":[n,n,n,n,n,n,n],"powerball":n}, ...],"notes":"..."}
For a PowerHit line use {"numbers":[...],"powerhit":true} with NO "powerball"
key.

Rules:
- Include a game ONLY if you can read all 8 of its numbers clearly and
  unambiguously. If any digit is blurry, cut off, or uncertain, OMIT that
  whole game and explain which line and why in "notes".
- Do not guess. Missing a line is fine; a wrong number is not.
- "notes" should be a short human-readable summary (e.g. "Read 10 games A-J"
  or "Line C too blurry to read"). Empty string if nothing to note.`;

/**
 * @returns {Promise<{games: {numbers:number[], powerball:number}[], notes: string, rejected: number}>}
 * @throws on configuration, transport, or unusable-response errors — callers
 *         surface the message to the admin.
 */
export async function scanTicketImage({ imageBase64, mediaType }) {
  // Netlify's AI Gateway injects ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL into
  // functions automatically when enabled — no manual key needed. A manually
  // set ANTHROPIC_API_KEY env var also works and takes precedence.
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Ticket scanning is not enabled — turn on AI Gateway for this site in Netlify (or set ANTHROPIC_API_KEY)');
  }
  if (!ALLOWED_MEDIA_TYPES.includes(mediaType)) {
    throw new Error('Unsupported image type — use a JPEG or PNG photo');
  }
  if (typeof imageBase64 !== 'string' || imageBase64.length < 100 || imageBase64.length > MAX_BASE64_CHARS) {
    throw new Error('Image is missing or too large');
  }

  const client = new Anthropic();
  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 4000,
    // Digit transcription doesn't need deep reasoning; low effort keeps the
    // call fast enough for Netlify's function time limit.
    output_config: { effort: 'low' },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: PROMPT },
      ],
    }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('The scanner could not process this image — enter the numbers manually');
  }

  let text = '';
  for (const block of response.content) {
    if (block.type === 'text') text += block.text;
  }
  // Defensive parse: accept a bare object or one wrapped in code fences.
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Could not read the ticket from that photo — try a clearer, straight-on shot');
  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error('Could not read the ticket from that photo — try a clearer, straight-on shot');
  }
  if (!parsed || !Array.isArray(parsed.games)) {
    throw new Error('Could not read the ticket from that photo — try a clearer, straight-on shot');
  }

  // Every extracted game must pass the same validation as manual entry;
  // anything invalid is dropped and counted rather than passed along.
  const games = [];
  let rejected = 0;
  for (const g of parsed.games.slice(0, 50)) {
    const v = validateGame(g);
    if (v.ok) games.push({ numbers: v.numbers, powerball: v.powerball, powerhit: v.powerhit });
    else rejected++;
  }
  if (games.length === 0) {
    throw new Error('No readable game lines found — try a clearer photo or enter the numbers manually');
  }
  return {
    games,
    notes: typeof parsed.notes === 'string' ? parsed.notes.slice(0, 300) : '',
    rejected,
  };
}
