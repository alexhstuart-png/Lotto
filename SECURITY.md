# Security review — Work Lotto Syndicate

Review pass over auth, admin protection, secret handling and input
validation. Findings were fixed before release; residual notes at the end.

## Auth

- Sessions are HS256 JWTs signed with `SESSION_SECRET`, verified with
  `crypto.timingSafeEqual`, delivered as an `HttpOnly; Secure; SameSite=Lax`
  cookie. No token ever reaches JS-readable storage.
- Each member has their own bcrypt password hash on their member row, set
  through a single-use invite/reset link: the server stores only the SHA-256
  of the link token plus an expiry, verifies it with a timing-safe compare,
  and clears it on use. Failure responses are identical for unknown email,
  inactive member, unset password, and wrong password.
- Member rows are sanitised before leaving the server — password hashes and
  reset-token hashes are never included in any API response.
- Every authenticated request re-checks the live member row: deactivating a
  member (or demoting an admin) invalidates their existing sessions
  immediately, not at token expiry. *(Fixed during review — member routes
  originally trusted the token for 30 days.)*
- No signup/reset flows exist, so that attack surface is absent by design.

## Admin endpoint protection

- All `/api/admin/*` routes require both the signed token role AND the
  current database role to be `admin`. The client never supplies role
  information; the frontend hiding the Admin tab is cosmetic only.

## Secrets

- `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `SESSION_SECRET` are read
  exclusively from `process.env` inside Netlify Functions. `public/` contains
  no keys and calls only `/api/*`.
- API responses never include password hashes (fields are explicitly picked).
- RLS is enabled on every table with zero policies, so the Supabase anon key
  is useless even if exposed.

## Input validation

- Every write endpoint validates server-side: game numbers (exactly 7
  distinct mains 1–35 + powerball 1–20), money amounts (bounded integers,
  cents), emails, dates (draws must be Thursdays), UUIDs, booleans, string
  lengths. Client-side parsing is a convenience only.
- All user-derived HTML output in the frontend and in emails is escaped.
- The scraper validates fetched numbers through the same validator and
  refuses ambiguous parses; it also refuses results whose draw date doesn't
  match the awaited draw.

## Abuse / integrity

- CSRF: state-changing routes are POST/PATCH behind a `SameSite=Lax` cookie.
- Double-charging and duplicate results are prevented by database
  constraints, not application memory.
- Errors return a generic message; details go to function logs only.

## Residual notes (accepted for a small private app)

- No rate limiting on `/api/login` beyond bcrypt's inherent cost. If the
  site URL is widely known, consider Netlify rate limiting or an IP-based
  limiter in the login handler.
- The shared member password means members are not cryptographically
  distinguishable from each other at login; the syndicate model accepts this.
  The admin password is separate.
