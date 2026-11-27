-- Syndicate share of a ticket. 1/1 means we own the whole ticket; 1/15 means
-- one of fifteen shares in a Lott syndicate ticket. Shown on the ticket and
-- used to scale winnings: a $14.10 Div 9 on a 1/15 share pays $0.94.
-- Applies to both the syndicate ticket and the admin's personal tickets.
-- (Shared-project installs: apply with the same TABLE_PREFIX on table names.)

alter table tickets add column if not exists shares_held  int not null default 1 check (shares_held >= 1);
alter table tickets add column if not exists shares_total int not null default 1 check (shares_total >= 1);
alter table tickets drop constraint if exists tickets_share_fraction;
alter table tickets add constraint tickets_share_fraction check (shares_held <= shares_total);

alter table personal_tickets add column if not exists shares_held  int not null default 1 check (shares_held >= 1);
alter table personal_tickets add column if not exists shares_total int not null default 1 check (shares_total >= 1);
alter table personal_tickets drop constraint if exists personal_tickets_share_fraction;
alter table personal_tickets add constraint personal_tickets_share_fraction check (shares_held <= shares_total);
