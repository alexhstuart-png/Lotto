// Invite / password-reset tokens. When the admin adds a member (or hits
// "send reset link"), a single-use token is generated; only its SHA-256 hash
// is stored, alongside an expiry. The emailed link carries the raw token,
// which the set-password endpoint verifies before letting the member choose
// their own password. Pure logic — unit-tested.

import crypto from 'node:crypto';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // links last 7 days

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createInviteToken(now = new Date()) {
  const token = crypto.randomBytes(32).toString('hex');
  return {
    token,
    tokenHash: hashToken(token),
    expires: new Date(now.getTime() + INVITE_TTL_MS).toISOString(),
  };
}

/** Verify a raw token against the member row's stored hash + expiry. */
export function verifyInviteToken(member, token, now = new Date()) {
  if (!member || typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return false;
  if (!member.reset_token_hash || !member.reset_token_expires) return false;
  if (new Date(member.reset_token_expires).getTime() < now.getTime()) return false;
  const a = Buffer.from(hashToken(token));
  const b = Buffer.from(String(member.reset_token_hash));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function validatePassword(pw) {
  return typeof pw === 'string' && pw.length >= 8 && pw.length <= 100;
}
