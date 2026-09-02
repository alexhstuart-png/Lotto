-- PowerHit support: a line that plays every Powerball 1-20.
-- powerhit=true rows carry no single powerball; standard rows keep 1-20.

alter table games alter column powerball drop not null;
alter table games add column if not exists powerhit boolean not null default false;
alter table games drop constraint if exists games_powerball_check;
alter table games add constraint games_powerball_or_powerhit check (
  (powerhit and powerball is null)
  or (not powerhit and powerball between 1 and 20)
);
