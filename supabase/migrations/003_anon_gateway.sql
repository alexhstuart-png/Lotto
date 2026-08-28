-- OPTIONAL: anon-key gateway.
--
-- Use this ONLY when the Supabase service role key cannot be provisioned
-- (e.g. the project is managed through tooling that never exposes it).
-- It grants full table access to requests that carry an `x-app-secret`
-- header matching a secret stored server-side in Postgres — the same trust
-- model as the service role key: the secret lives only in Netlify env vars
-- (SUPABASE_DB_SECRET), and the anon key alone can access nothing.
--
-- With a real service role key configured, skip this file entirely.
--
-- After running it, store the secret (NOT in the repo — run in SQL editor):
--   insert into lotto_private.config (id, api_secret)
--   values (1, '<64+ char random string, e.g. openssl rand -hex 32>')
--   on conflict (id) do update set api_secret = excluded.api_secret;

create schema if not exists lotto_private;

create table if not exists lotto_private.config (
  id         int primary key default 1 check (id = 1),
  api_secret text not null
);

revoke all on schema lotto_private from public, anon, authenticated;
revoke all on lotto_private.config from public, anon, authenticated;

create or replace function lotto_private.request_secret_ok()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from lotto_private.config c
    where length(c.api_secret) >= 32
      and c.api_secret = coalesce(
        ((current_setting('request.headers', true))::json ->> 'x-app-secret'), ''
      )
  );
$$;

grant execute on function lotto_private.request_secret_ok() to anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'settings','members','draws','tickets','games','results',
    'transactions','kitty_transactions','winnings','email_logs','audit_logs'
  ]
  loop
    execute format(
      'create policy api_gateway_all on public.%I for all to anon, authenticated
         using (lotto_private.request_secret_ok())
         with check (lotto_private.request_secret_ok());',
      t
    );
  end loop;
end $$;
