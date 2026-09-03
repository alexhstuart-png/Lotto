-- Admin's private ticket tracker (My Tickets tab): Powerball and Set for
-- Life entries, games and results stored as validated JSON. No emails, no
-- ledger involvement — purely personal tracking, scoped to the owner.

create table if not exists personal_tickets (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references members(id) on delete cascade,
  game_type   text not null check (game_type in ('powerball','setforlife')),
  draw_date   date,
  note        text,
  games       jsonb not null,
  result      jsonb,
  result_date date,
  created_at  timestamptz not null default now()
);

alter table personal_tickets enable row level security;

-- Anon-gateway installs (003): give the API's secret-header policy access.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'lotto_private' and p.proname = 'request_secret_ok'
  ) then
    execute 'create policy api_gateway_all on personal_tickets for all to anon, authenticated
               using (lotto_private.request_secret_ok())
               with check (lotto_private.request_secret_ok())';
  end if;
end $$;
