import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInviteToken, verifyInviteToken, hashToken, validatePassword, INVITE_TTL_MS } from '../lib/invites.mjs';

test('created token verifies against its stored hash until expiry', () => {
  const now = new Date('2026-08-28T00:00:00Z');
  const { token, tokenHash, expires } = createInviteToken(now);
  const member = { reset_token_hash: tokenHash, reset_token_expires: expires };
  assert.equal(verifyInviteToken(member, token, now), true);
  // still valid one minute before expiry
  assert.equal(verifyInviteToken(member, token, new Date(now.getTime() + INVITE_TTL_MS - 60000)), true);
  // expired after the TTL
  assert.equal(verifyInviteToken(member, token, new Date(now.getTime() + INVITE_TTL_MS + 1000)), false);
});

test('rejects tampered, malformed and missing tokens', () => {
  const now = new Date();
  const { token, tokenHash, expires } = createInviteToken(now);
  const member = { reset_token_hash: tokenHash, reset_token_expires: expires };
  const flipped = (token[0] === 'a' ? 'b' : 'a') + token.slice(1);
  assert.equal(verifyInviteToken(member, flipped, now), false);
  assert.equal(verifyInviteToken(member, 'short', now), false);
  assert.equal(verifyInviteToken(member, null, now), false);
  assert.equal(verifyInviteToken({ reset_token_hash: null, reset_token_expires: expires }, token, now), false);
  assert.equal(verifyInviteToken(null, token, now), false);
});

test('tokens are single-purpose: a different token never matches', () => {
  const a = createInviteToken();
  const b = createInviteToken();
  assert.notEqual(a.token, b.token);
  assert.equal(verifyInviteToken({ reset_token_hash: a.tokenHash, reset_token_expires: a.expires }, b.token), false);
  assert.equal(hashToken(a.token), a.tokenHash);
});

test('password rules: 8-100 chars', () => {
  assert.equal(validatePassword('stuart15'), true);
  assert.equal(validatePassword('short'), false);
  assert.equal(validatePassword('x'.repeat(101)), false);
  assert.equal(validatePassword(12345678), false);
});
