-- Personal tickets: winnings auto-recorded from official dividends when a
-- result lands (display/tracking only — no ledger involvement).
alter table personal_tickets add column if not exists winnings_cents int not null default 0;
