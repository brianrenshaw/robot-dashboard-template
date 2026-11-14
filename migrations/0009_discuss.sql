-- 0009_discuss.sql
-- A task can be something to discuss with its person.
--
-- Until now a task with a person on it was one of two things: the owner is waiting on them
-- (side 'theirs') or he owes it to them (side 'mine'). He also sends tasks like
-- "Identify the scholarship funds. Discuss with Nina." and expects them to show under
-- "To discuss" on Nina's page. `discuss` = 1 marks such a task. It stays his own task
-- (side is kept at 'mine', so every "is this mine?" rule still works) and is listed
-- under "To discuss" for that person instead of under "You owe".
ALTER TABLE tasks ADD COLUMN discuss INTEGER NOT NULL DEFAULT 0;
