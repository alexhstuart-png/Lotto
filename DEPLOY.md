# Deploying Work Lotto Syndicate

Stack: **Netlify** (static hosting + Functions + scheduled functions),
**Supabase** (Postgres), **Resend** (email). The frontend is plain
HTML/CSS/JS in `public/` — no build step.

## 1. Supabase setup

1. Create a Supabase project (any region; Sydney is closest).
2. In the SQL editor, run in order:
   1. `supabase/migrations/001_schema.sql` — tables, constraints, RLS.
   2. `supabase/migrations/002_settings_init.sql` — **edit the two
      `CHANGE-ME` passwords first.** This creates the settings row with the
      bcrypt-hashed shared member password and the separate admin password.
   3. *(Optional, for a demo)* `supabase/seed.sql` — demo members
      (Alex/Jake/Carl/Brad/Jesse), a published 10-game ticket for the
      2026-08-27 draw and a fake official result. Demo logins:
      members `demo-powerball`, admin (alex@example.com) `demo-admin`.
3. Note your **Project URL** and **service_role key** (Project Settings →
   API). The service role key is server-only — it must never appear in
   frontend code, and it doesn't: the frontend only ever calls `/api/*`.

Key schema guarantees (don't work around them):

- `transactions` has a partial unique index on `(member_id, draw_id)` where
  `type='weekly_charge'` — the database itself makes double-charging
  impossible.
- `results` has `unique(draw_id)` — a scraper re-run can never duplicate a
  result row.
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
| `ADMIN_ALERT_EMAIL` | optional | Where scraper-failure alerts go; defaults to all active admin members |
| `RESULTS_PROVIDER` | optional | Results provider name; defaults to `thelott` |

## 4. Deploy to Netlify

1. Connect the repo. `netlify.toml` sets `publish = "public"` and
   `functions = "netlify/functions"`; there's no build command.
2. Deploy. The catch-all API function serves `/api/*`.

## 5. Scheduled functions (cron is UTC!)

Configured in `netlify.toml` — verify they appear under **Functions →
Scheduled** after deploying. Australia/Perth is **UTC+8 with no daylight
saving**, so conversions are fixed year-round:

| Job | Perth time | UTC | Cron |
|---|---|---|---|
| `reminders-cron` — Friday payment reminders | Friday 08:00 | Friday 00:00 | `0 0 * * 5` |
| `results-cron` — Powerball results scrape | Friday 03:00 | **Thursday** 19:00 | `0 19 * * 4` |

Note the results job's UTC *day* is Thursday: Friday 03:00 in Perth is still
Thursday evening in UTC.

Safety properties of both jobs (safe to trigger manually to test):

- Reminders: at most one automatic reminder per member per Perth Friday,
  enforced via an `email_logs` lookup before every send. Skips inactive
  members, disabled notifications and balances at/above the owing threshold.
- Results: up to 3 polite fetch attempts (single request each, proper
  User-Agent), then on total failure marks the draw
  *"Results pending — auto retrieve failed"* and emails the admin once.
  On success it saves once (DB unique constraint) and auto-runs matching.
  If the admin already entered results, the scraper skips the draw; if the
  admin later edits results, manual values win and matching recomputes.

## 6. First login

- Members: their email (added by admin) + the shared member password.
- Admin: the admin member's email + the admin password.
- There is deliberately no signup, verification or password reset flow.
  Rotate passwords with SQL (see `002_settings_init.sql` comments) or
  `node scripts/hash-password.mjs 'new-password'`.

## 7. Removing demo data

Run `supabase/remove_seed.sql` in the SQL editor. It deletes every demo row
(all flagged `is_demo` / fixed `dddddddd-` UUIDs) in dependency order and
leaves real data untouched. If the settings row was created by the seed,
rotate both passwords afterwards (SQL in the script's footer comment).

## 8. Tests

- `npm test` — unit tests for matching/highlighting, validation, ledger
  progression, duplicate-charge protection, reminder dedupe/audience and
  scraper parsing/retries.
- `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/integration-test.mjs`
  — runs the DB-constraint scenarios (re-publish no double charge, scraper
  re-run no duplicate rows, manual-overrides-scraped with recompute) against
  a real Supabase project, then cleans up after itself.

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
