// Session auth: HS256 JWT in an httpOnly cookie, signed server-side with
// SESSION_SECRET. Members authenticate with email + the shared bcrypt-hashed
// password; the admin with email + the separate admin hash. Roles are embedded
// in the signed token and re-checked server-side on every request — the client
// is never trusted for role or identity.

import crypto from 'node:crypto';

const COOKIE_NAME = 'wls_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('SESSION_SECRET env var missing or too short');
  }
  return secret;
}

export function signSession({ memberId, role }) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({ sub: memberId, role, iat: now, exp: now + SESSION_TTL_SECONDS })
  );
  const sig = crypto
    .createHmac('sha256', getSecret())
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${sig}`;
}

export function verifySession(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const expected = crypto
    .createHmac('sha256', getSecret())
    .update(`${header}.${payload}`)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof claims.exp !== 'number' || claims.exp < Date.now() / 1000) return null;
  if (typeof claims.sub !== 'string' || !['member', 'admin'].includes(claims.role)) return null;
  return { memberId: claims.sub, role: claims.role };
}

export function sessionCookie(token) {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function sessionFromRequest(req) {
  const cookies = req.headers.get('cookie') || '';
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  return verifySession(match[1]);
}
