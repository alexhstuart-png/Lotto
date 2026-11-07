# Work Lotto Syndicate

A mobile-first web app for running a workplace **Thursday night Powerball**
syndicate: shared ticket, per-member ledger balances, kitty tracking,
results entry with automatic matching and ball highlighting, and email
notifications.

- **Frontend**: vanilla HTML/CSS/JS in `public/` (no framework, no build
  step). Anton/Barlow typography, gold perforated ticket stub, lotto ball
  chips, bottom nav (Home · Ticket · History · Account · Admin).
- **Backend**: Netlify Functions (`netlify/functions/`) — one catch-all API
  plus one scheduled job (Friday payment reminders).
- **Database**: Supabase Postgres (`supabase/migrations/`). Balances are
  ledger-derived, duplicate charges are impossible at the DB level.
- **Email**: Resend.

See **[DEPLOY.md](DEPLOY.md)** for setup, environment variables, cron/UTC
conversions and demo-data removal.

## Core guarantees

1. Member balances and the kitty are always computed from transaction rows —
   never stored or editable directly.
2. Publishing a draw charges each active member once; a partial unique index
   on `(member_id, draw_id)` for `weekly_charge` makes re-charging impossible.
3. Friday reminders (8:00 AM Perth) send at most one email per member per
   Friday, deduped via `email_logs`.
4. Saving official results (the admin types in the winning numbers) is one
   action that triggers matching, highlighting, win detection and status
   updates automatically. Saving again overwrites and recomputes.
5. Prize amounts are never guessed; the admin confirms winnings explicitly.
6. All secrets live in Netlify env vars; the browser only ever talks to
   `/api/*`; admin role is verified server-side on every request. An admin
   can grant or remove admin access for any other member from the Admin
   screen (never their own, so there is always at least one admin).
7. Per-member passwords: adding a member emails them a single-use
   set-password link (7-day expiry); the admin can re-send it any time as a
   password reset. No open signup.

## Development

```bash
npm install
npm test           # unit tests (pure logic)
netlify dev        # local dev with functions (needs env vars)
```
