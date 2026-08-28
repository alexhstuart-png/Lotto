-- Bootstrap the first admin account. Every other member is added from the
-- Admin screen and receives an emailed set-password link — no accounts are
-- pre-provisioned.
--
-- !!! CHANGE THE EMAIL AND PASSWORD BEFORE RUNNING !!!
-- To rotate any member's password later:
--   update members set password_hash = crypt('new-password', gen_salt('bf', 10))
--   where email = 'someone@example.com';

insert into members (name, email, role, is_active, notifications_enabled, password_hash)
values (
  'Admin',
  'CHANGE-ME@example.com',
  'admin',
  true,
  true,
  crypt('CHANGE-ME-admin-password', gen_salt('bf', 10))
)
on conflict (email) do nothing;
