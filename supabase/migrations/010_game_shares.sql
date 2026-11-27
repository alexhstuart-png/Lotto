-- Per-line syndicate share. One draw's ticket can mix, say, a 1/15 share of
-- a Lott syndicate ticket with full-price lines bought alongside it (a
-- PowerPick). Each game carries its own fraction, defaulting to the
-- ticket's share; winnings are banked line by line at that fraction.
-- (Shared-project installs: apply with the same TABLE_PREFIX on table names.)

alter table games add column if not exists shares_held  int not null default 1 check (shares_held >= 1);
alter table games add column if not exists shares_total int not null default 1 check (shares_total >= 1);
alter table games drop constraint if exists games_share_fraction;
alter table games add constraint games_share_fraction check (shares_held <= shares_total);

-- Lines of tickets that already carry a share inherit it.
update games g set shares_held = t.shares_held, shares_total = t.shares_total
  from tickets t where t.id = g.ticket_id and (t.shares_held <> 1 or t.shares_total <> 1);
