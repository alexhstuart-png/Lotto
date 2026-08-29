-- Work Lotto Syndicate — schema (Powerball only)
-- Run via Supabase SQL editor or `supabase db push`. See DEPLOY.md.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Settings: single-row app configuration. Balances/kitty are NEVER stored
-- here or anywhere else — they are always computed from ledger rows.
-- ---------------------------------------------------------------------------
create table if not exists settings (
  id                       int primary key default 1 check (id = 1),
  weekly_charge_cents      int not null default 2500 check (weekly_charge_cents >= 0),
  charge_on_publish        boolean not null default true,
  -- Members with a balance at or below this get Friday reminders (prepay
  -- model: $25 = one draw of credit left, top up before going negative).
  owing_threshold_cents    int not null default 2500,
  updated_at               timestamptz not null default now()
);

insert into settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Members. Each member has their own bcrypt password, set via a single-use
-- emailed invite/reset link (only the token's SHA-256 hash is stored). Admin
-- is a member row with role='admin'. No open signup — admin adds members and
-- the app emails them a set-password link.
-- ---------------------------------------------------------------------------
create table if not exists members (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  email                  text not null unique check (email = lower(email)),
  role                   text not null default 'member' check (role in ('member','admin')),
  is_active              boolean not null default true,
  notifications_enabled  boolean not null default true,
  password_hash          text,          -- null until the member sets a password
  reset_token_hash       text,          -- sha256 of the pending invite/reset token
  reset_token_expires    timestamptz,
  is_demo                boolean not null default false,
  created_at             timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Draws: one row per Thursday Powerball draw.
-- ---------------------------------------------------------------------------
create table if not exists draws (
  id           uuid primary key default gen_random_uuid(),
  draw_date    date not null unique,          -- the Thursday of the draw
  draw_number  int,                            -- official Powerball draw number, if known
  status       text not null default 'upcoming' check (status in (
                 'upcoming',            -- created, ticket not yet published
                 'waiting_results',     -- ticket published, waiting for Thursday night
                 'results_pending_failed', -- auto-retrieve failed; manual entry needed
                 'results_available',   -- official numbers saved, matching done, no win
                 'checked',             -- alias state after admin has reviewed a no-win draw
                 'winner'               -- at least one winning line detected
               )),
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Tickets: the syndicate's entry for a draw (one per draw), with games.
-- ---------------------------------------------------------------------------
create table if not exists tickets (
  id            uuid primary key default gen_random_uuid(),
  draw_id       uuid not null unique references draws(id) on delete cascade,
  cost_cents    int not null default 0 check (cost_cents >= 0),
  status        text not null default 'draft' check (status in ('draft','published')),
  published_at  timestamptz,
  published_by  uuid references members(id),
  created_at    timestamptz not null default now()
);

-- Powerball game: exactly 7 distinct mains 1-35 + 1 powerball 1-20.
create table if not exists games (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references tickets(id) on delete cascade,
  game_index  int not null check (game_index >= 1),
  numbers     int[] not null,
  powerball   int not null check (powerball between 1 and 20),
  unique (ticket_id, game_index),
  constraint games_seven_mains check (
    array_length(numbers, 1) = 7
    and 1 <= all(numbers) and 35 >= all(numbers)
  )
);

-- ---------------------------------------------------------------------------
-- Results: official numbers for a draw. UNIQUE on draw_id so a scraper re-run
-- can never duplicate a result row. Manual entry always wins (source flag).
-- ---------------------------------------------------------------------------
create table if not exists results (
  id          uuid primary key default gen_random_uuid(),
  draw_id     uuid not null unique references draws(id) on delete cascade,
  numbers     int[] not null,
  powerball   int not null check (powerball between 1 and 20),
  source      text not null check (source in ('scraped','manual')),
  divisions   jsonb,                 -- optional division/prize info
  entered_by  uuid references members(id),  -- null for scraper
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint results_seven_mains check (
    array_length(numbers, 1) = 7
    and 1 <= all(numbers) and 35 >= all(numbers)
  )
);

-- ---------------------------------------------------------------------------
-- Member ledger. Member balance = sum(amount_cents) — never stored.
-- Duplicate-charge protection: a member can be charged for a draw exactly
-- once, enforced by a partial unique index at the database level.
-- ---------------------------------------------------------------------------
create table if not exists transactions (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null references members(id) on delete restrict,
  type         text not null check (type in ('weekly_charge','payment','adjustment','winnings_credit')),
  amount_cents int not null,          -- signed: charges negative, payments positive
  draw_id      uuid references draws(id),
  note         text,
  created_by   uuid references members(id),
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now()
);

create unique index if not exists uniq_weekly_charge_per_member_per_draw
  on transactions (member_id, draw_id)
  where type = 'weekly_charge';

-- ---------------------------------------------------------------------------
-- Kitty ledger. Kitty balance = sum(amount_cents) — never stored.
-- ---------------------------------------------------------------------------
create table if not exists kitty_transactions (
  id           uuid primary key default gen_random_uuid(),
  type         text not null check (type in ('member_payment','ticket_cost','winnings','adjustment')),
  amount_cents int not null,          -- signed: payments/winnings +, ticket cost -
  member_id    uuid references members(id),
  draw_id      uuid references draws(id),
  note         text,
  created_by   uuid references members(id),
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Winnings: admin-confirmed only. Prize amounts are never guessed.
-- ---------------------------------------------------------------------------
create table if not exists winnings (
  id             uuid primary key default gen_random_uuid(),
  draw_id        uuid not null references draws(id) on delete cascade,
  game_index     int,
  division       int check (division between 1 and 9),
  amount_cents   int not null check (amount_cents >= 0),
  added_to_kitty boolean not null default false,
  confirmed_by   uuid references members(id),
  confirmed_at   timestamptz not null default now(),
  is_demo        boolean not null default false
);

-- ---------------------------------------------------------------------------
-- Email log: every outbound email. Reminder dedupe checks this before send.
-- ---------------------------------------------------------------------------
create table if not exists email_logs (
  id         uuid primary key default gen_random_uuid(),
  type       text not null check (type in ('reminder','ticket_published','results','admin_alert','announce_win','invite')),
  member_id  uuid references members(id),
  draw_id    uuid references draws(id),
  to_email   text not null,
  subject    text,
  status     text not null default 'sent' check (status in ('sent','failed')),
  resend_id  text,
  meta       jsonb,
  sent_at    timestamptz not null default now()
);

create index if not exists idx_email_logs_reminder_dedupe
  on email_logs (member_id, type, sent_at);

-- ---------------------------------------------------------------------------
-- Audit log: any edit to a published ticket, results edits, winnings, etc.
-- ---------------------------------------------------------------------------
create table if not exists audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references members(id),
  action      text not null,
  entity      text not null,
  entity_id   uuid,
  details     jsonb,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security. All app access goes through Netlify Functions using the
-- service role key (which bypasses RLS). Enabling RLS with NO policies means
-- the anon/publishable key can read or write NOTHING — defence in depth if the
-- anon key ever leaks into a client.
-- ---------------------------------------------------------------------------
alter table settings            enable row level security;
alter table members             enable row level security;
alter table draws               enable row level security;
alter table tickets             enable row level security;
alter table games               enable row level security;
alter table results             enable row level security;
alter table transactions        enable row level security;
alter table kitty_transactions  enable row level security;
alter table winnings            enable row level security;
alter table email_logs          enable row level security;
alter table audit_logs          enable row level security;
