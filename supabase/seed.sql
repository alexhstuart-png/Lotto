-- DEMO SEED DATA — easily removable (see remove_seed.sql).
-- Members: Alex (admin, $100 credit), Jake ($25 credit), Carl ($0),
-- Brad (-$25 owing), Jesse (-$50 owing, notifications off).
-- Plus a published 10-game Powerball ticket for the 2026-08-27 draw and a
-- fake official result so highlighting/matching shows immediately.
-- All demo rows use fixed UUIDs beginning dddddddd- and is_demo = true.

-- Demo login password for every demo member (bcrypt-hashed): demo-powerball
insert into members (id, name, email, role, is_active, notifications_enabled, password_hash, is_demo) values
  ('dddddddd-0000-0000-0000-000000000001', 'Alex',  'alex@example.com',  'admin',  true, true,  crypt('demo-powerball', gen_salt('bf', 10)), true),
  ('dddddddd-0000-0000-0000-000000000002', 'Jake',  'jake@example.com',  'member', true, true,  crypt('demo-powerball', gen_salt('bf', 10)), true),
  ('dddddddd-0000-0000-0000-000000000003', 'Carl',  'carl@example.com',  'member', true, true,  crypt('demo-powerball', gen_salt('bf', 10)), true),
  ('dddddddd-0000-0000-0000-000000000004', 'Brad',  'brad@example.com',  'member', true, true,  crypt('demo-powerball', gen_salt('bf', 10)), true),
  ('dddddddd-0000-0000-0000-000000000005', 'Jesse', 'jesse@example.com', 'member', true, false, crypt('demo-powerball', gen_salt('bf', 10)), true)
on conflict (id) do nothing;

-- Last Thursday's draw, with published ticket and official result.
insert into draws (id, draw_date, draw_number, status, is_demo) values
  ('dddddddd-1111-0000-0000-000000000001', '2026-08-27', 1528, 'results_available', true)
on conflict (id) do nothing;

insert into tickets (id, draw_id, cost_cents, status, published_at, published_by) values
  ('dddddddd-2222-0000-0000-000000000001', 'dddddddd-1111-0000-0000-000000000001',
   2680, 'published', '2026-08-27T02:00:00Z', 'dddddddd-0000-0000-0000-000000000001')
on conflict (id) do nothing;

-- 10 games. Game 1 is the spec's highlighting test case (Powerball-legal):
-- official mains 4 8 17 22 31 33 34 vs game 4 11 12 17 22 31 35
-- -> exactly 4, 17, 22, 31 highlight green.
insert into games (ticket_id, game_index, numbers, powerball) values
  ('dddddddd-2222-0000-0000-000000000001', 1,  '{4,11,12,17,22,31,35}', 2),
  ('dddddddd-2222-0000-0000-000000000001', 2,  '{1,5,9,13,21,27,33}',   7),
  ('dddddddd-2222-0000-0000-000000000001', 3,  '{2,6,10,14,18,26,30}',  11),
  ('dddddddd-2222-0000-0000-000000000001', 4,  '{3,7,15,19,23,28,32}',  15),
  ('dddddddd-2222-0000-0000-000000000001', 5,  '{4,8,16,20,24,29,35}',  19),
  ('dddddddd-2222-0000-0000-000000000001', 6,  '{1,2,3,4,5,6,7}',       1),
  ('dddddddd-2222-0000-0000-000000000001', 7,  '{29,30,31,32,33,34,35}',20),
  ('dddddddd-2222-0000-0000-000000000001', 8,  '{5,10,15,20,25,30,35}', 10),
  ('dddddddd-2222-0000-0000-000000000001', 9,  '{6,12,17,23,28,33,34}', 3),
  ('dddddddd-2222-0000-0000-000000000001', 10, '{8,9,18,22,27,31,34}',  6)
on conflict (ticket_id, game_index) do nothing;

-- Fake official result for the demo draw.
insert into results (draw_id, numbers, powerball, source) values
  ('dddddddd-1111-0000-0000-000000000001', '{4,8,17,22,31,33,34}', 6, 'manual')
on conflict (draw_id) do nothing;

-- Ledger rows producing the mixed balances (weekly charge $25):
-- Alex:  +125 payment, -25 charge          = +$100
-- Jake:  +50 payment,  -25 charge          = +$25
-- Carl:  +25 payment,  -25 charge          = $0
-- Brad:  -25 charge                        = -$25
-- Jesse: -25 charge, -25 adjustment        = -$50
insert into transactions (member_id, type, amount_cents, draw_id, note, is_demo) values
  ('dddddddd-0000-0000-0000-000000000001', 'payment', 12500, null, 'Opening top-up', true),
  ('dddddddd-0000-0000-0000-000000000002', 'payment', 5000,  null, 'Bank transfer', true),
  ('dddddddd-0000-0000-0000-000000000003', 'payment', 2500,  null, 'Cash', true),
  ('dddddddd-0000-0000-0000-000000000001', 'weekly_charge', -2500, 'dddddddd-1111-0000-0000-000000000001', 'Weekly Powerball charge', true),
  ('dddddddd-0000-0000-0000-000000000002', 'weekly_charge', -2500, 'dddddddd-1111-0000-0000-000000000001', 'Weekly Powerball charge', true),
  ('dddddddd-0000-0000-0000-000000000003', 'weekly_charge', -2500, 'dddddddd-1111-0000-0000-000000000001', 'Weekly Powerball charge', true),
  ('dddddddd-0000-0000-0000-000000000004', 'weekly_charge', -2500, 'dddddddd-1111-0000-0000-000000000001', 'Weekly Powerball charge', true),
  ('dddddddd-0000-0000-0000-000000000005', 'weekly_charge', -2500, 'dddddddd-1111-0000-0000-000000000001', 'Weekly Powerball charge', true),
  ('dddddddd-0000-0000-0000-000000000005', 'adjustment', -2500, null, 'Missed last week (carried over)', true)
on conflict do nothing;

-- Kitty: payments in, ticket cost out.
insert into kitty_transactions (type, amount_cents, member_id, draw_id, note, is_demo) values
  ('member_payment', 12500, 'dddddddd-0000-0000-0000-000000000001', null, 'Opening top-up', true),
  ('member_payment', 5000,  'dddddddd-0000-0000-0000-000000000002', null, 'Bank transfer', true),
  ('member_payment', 2500,  'dddddddd-0000-0000-0000-000000000003', null, 'Cash', true),
  ('ticket_cost', -2680, null, 'dddddddd-1111-0000-0000-000000000001', 'Powerball ticket 2026-08-27', true)
on conflict do nothing;
