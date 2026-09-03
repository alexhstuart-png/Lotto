-- One winnings record per (draw, game line), enabling idempotent
-- auto-recording from official dividends. Rows without a game_index
-- (manual lump confirmations) stay unrestricted (NULLS DISTINCT default).
create unique index if not exists uniq_winnings_draw_game
  on winnings (draw_id, game_index);
