-- Initialise the single settings row, including the two password hashes.
--
-- !!! CHANGE BOTH PASSWORDS BEFORE RUNNING THIS IN PRODUCTION !!!
-- pgcrypto's crypt(..., gen_salt('bf', 10)) produces bcrypt hashes that the
-- app verifies server-side with bcryptjs. Passwords are never stored in
-- plaintext anywhere. To rotate later:
--   update settings set member_password_hash = crypt('new-password', gen_salt('bf', 10)) where id = 1;
--   update settings set admin_password_hash  = crypt('new-password', gen_salt('bf', 10)) where id = 1;

insert into settings (id, weekly_charge_cents, charge_on_publish, owing_threshold_cents,
                      member_password_hash, admin_password_hash)
values (
  1,
  2500,   -- $25 weekly charge (configurable in Admin -> Settings)
  true,   -- charge on publish: default ON
  0,      -- remind members whose balance is below $0
  crypt('CHANGE-ME-member-password', gen_salt('bf', 10)),
  crypt('CHANGE-ME-admin-password',  gen_salt('bf', 10))
)
on conflict (id) do nothing;
