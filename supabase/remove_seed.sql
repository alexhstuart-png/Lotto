-- Remove ALL demo seed data in dependency order. Safe to run repeatedly.
-- Real (non-demo) data is untouched: everything demo is flagged is_demo or
-- hangs off the fixed dddddddd- UUIDs.

delete from email_logs
  where member_id in (select id from members where is_demo)
     or draw_id  in (select id from draws where is_demo);

delete from audit_logs
  where actor_id in (select id from members where is_demo);

delete from winnings where draw_id in (select id from draws where is_demo) or is_demo;

delete from transactions
  where is_demo
     or member_id in (select id from members where is_demo)
     or draw_id  in (select id from draws where is_demo);

delete from kitty_transactions
  where is_demo
     or member_id in (select id from members where is_demo)
     or draw_id  in (select id from draws where is_demo);

-- draws cascade to tickets -> games and to results.
delete from draws where is_demo;

delete from members where is_demo;

-- Note: the settings row (and its passwords) stays. If it was created by the
-- seed with demo passwords, rotate them:
--   update settings set member_password_hash = crypt('new-password', gen_salt('bf', 10)),
--                       admin_password_hash  = crypt('new-admin-password', gen_salt('bf', 10))
--   where id = 1;
