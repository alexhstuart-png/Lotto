# Deploying Work Lotto Syndicate

Stack: **Netlify** (static hosting + Functions + scheduled functions),
**Supabase** (Postgres), **Resend** (email). The frontend is plain
HTML/CSS/JS in `public/` — no build step.

## 1. Supabase setup

1. Create a Supabase project (any region; Sydney is closest).
2. In the SQL editor, run in order:
   1. `supabase/migrations/001_schema.sql` — tables, constraints, RLS,
      default settings row.
   2. `supabase/migrations/002_admin_bootstrap.sql` — **edit the `CHANGE-ME`
      email and password first.** Creates the one bootstrap admin account;
      every other member is added from the Admin screen and receives an
      emailed set-password link.
   3. *(Optional, for a demo)* `supabase/seed.sql` — demo members
      (Alex/Jake/Carl/Brad/Jesse, password `demo-powerball` each), a
      published 10-game ticket for the 2026-08-27 draw and a fake result.
3. Note your **Project URL** and **service_role key** (Project Settings →
   API). The service role key is server-only — it must never appear in
   frontend code, and it doesn't: the frontend only ever calls `/api/*`.

Key schema guarantees (don't work around them):

- `transactions` has a partial unique index on `(member_id, draw_id)` where
  `type='weekly_charge'` — the database itself makes double-charging
  impossible.
- `results` has `unique(draw_id)` — saving results twice for a draw can
  never duplicate a result row; the second save overwrites the first.
- Balances and the kitty are always `sum(amount_cents)` over ledger rows.
  There is no stored balance column anywhere.
- RLS is enabled on every table with **no policies**, so the anon key can
  access nothing. All access goes through Netlify Functions with the
  service role key.

## 2. Resend setup

1. Create a Resend account and (recommended) verify a sending domain.
2. Create an API key.
3. Emails send from `EMAIL_FROM` (e.g. `Work Lotto <lotto@yourdomain.com>`).
   Without a verified domain you can use `onboarding@resend.dev` for testing,
   which only delivers to your own account's email.

## 3. Netlify environment variables

Site settings → Environment variables. **All secrets live here and only
here** — never in the repo, never in frontend code.

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-side DB access (Functions only) |
| `RESEND_API_KEY` | yes | Email sending |
| `SESSION_SECRET` | yes | Signs session JWTs. Long random string, e.g. `openssl rand -hex 32` |
| `EMAIL_FROM` | recommended | From address, e.g. `Work Lotto <lotto@yourdomain.com>` |
| `ANTHROPIC_API_KEY` | optional | Enables 📷 ticket photo scanning (Claude vision). Easiest: enable **Netlify AI Gateway** for the site — it injects this (and `ANTHROPIC_BASE_URL`) automatically and bills through Netlify. A manually set key from console.anthropic.com also works. Manual entry always works without it |

## 4. Deploy to Netlify

1. Connect the repo. `netlify.toml` sets `publish = "public"` and
   `functions = "netlify/functions"`; there's no build command.
2. Deploy. The catch-all API function serves `/api/*`.

## 5. Scheduled function (cron is UTC!)

Configured in `netlify.toml` — verify it appears under **Functions →
Scheduled** after deploying. Australia/Perth is **UTC+8 with no daylight
saving**, so the conversion is fixed year-round:

| Job | Perth time | UTC | Cron |
|---|---|---|---|
| `reminders-cron` — Friday payment reminders | Friday 08:00 | Friday 00:00 | `0 0 * * 5` |

Safety properties (safe to trigger manually to test): at most one automatic
reminder per member per Perth Friday, enforced via an `email_logs` lookup
before every send. Skips inactive members, disabled notifications and
balances at/above the owing threshold.

There is no automatic results retrieval. After each draw an admin types the
winning numbers into **Admin → Official Results**; saving runs matching,
highlighting, win detection and the draw status in one action, and saving
again overwrites and recomputes.

## 6. Accounts and passwords

- Every member has their **own password**. Newly added members start with
  the default password (`lotto2026`, set in `netlify/functions/api.mjs`) so
  they can log in immediately. The Admin screen's "Reset link" button emails
  (or shows) a single-use set-password link — valid 7 days — for anyone who
  wants their own password or forgets theirs.
- There is deliberately no open signup. To force-set a password with SQL:
  `update members set password_hash = crypt('new-password', gen_salt('bf', 10)) where email = '...';`
  (or hash locally with `node scripts/hash-password.mjs`).
- **Admin access**: any admin can press **Make admin** / **Remove admin**
  next to a member on the Admin screen (never on themselves). The member
  must log out and back in for a new role to take effect. With SQL:
  `update members set role = 'admin' where email = '...';`
- `SITE_URL` (optional env var) sets the base URL used in emailed links;
  it defaults to Netlify's own `URL` variable.

## 7. Removing demo data

Run `supabase/remove_seed.sql` in the SQL editor. It deletes every demo row
(all flagged `is_demo` / fixed `dddddddd-` UUIDs) in dependency order and
leaves real data untouched. If the settings row was created by the seed,
rotate both passwords afterwards (SQL in the script's footer comment).

## 8. Tests

- `npm test` — unit tests for matching/highlighting, validation, ledger
  progression, duplicate-charge protection and reminder dedupe/audience.
- `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/integration-test.mjs`
  — runs the DB-constraint scenarios (re-publish no double charge, re-saving
  results never duplicates a row, corrected results recompute matching)
  against a real Supabase project, then cleans up after itself.

## Appendix: shared-project deployment options

Two extra env vars support deploying into a shared Supabase project or
without a service role key:

- `TABLE_PREFIX` (e.g. `lotto_`) — all tables are read/written with this
  prefix. Apply the migrations with the same prefix on the table names.
- Anon-key gateway — when the service role key can't be provisioned, run
  `supabase/migrations/003_anon_gateway.sql`, store a long random secret in
  `lotto_private.config`, and set `SUPABASE_ANON_KEY` + `SUPABASE_DB_SECRET`
  instead of `SUPABASE_SERVICE_ROLE_KEY`. RLS policies grant access only to
  requests carrying the matching `x-app-secret` header, which the Netlify
  Functions attach; the anon key alone can access nothing. With a service
  role key configured, skip 003 entirely — the key bypasses RLS.

> Note: when setting env vars through the Netlify API/MCP, avoid the
> "secret" flag — secret-flagged writes have been observed not to persist.
> Use regular env vars (they're still server-side only) and remember that
> functions pick up env changes only on the next deploy.
