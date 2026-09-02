-- System entry support (System 8-20): a game may have 7-20 mains.
-- Official results stay exactly 7 mains — that constraint is untouched.

alter table games drop constraint if exists games_seven_mains;
alter table games add constraint games_mains_range check (
  array_length(numbers, 1) between 7 and 20
  and 1 <= all(numbers) and 35 >= all(numbers)
);
