-- 0012_task_people.sql
-- People work like tags: a task can carry several, and each has a role.
--
-- Until now a task had one person (tasks.person_id) and the pair side / discuss said what
-- they were to it. "Jordan to email Dylan" could sit under only one of them. The owner's words:
-- "persons should probably work similar to tags too".
--
-- task_people is now the full answer to "who is on this task, and as what":
--   waiting   he is waiting on them
--   owe       he owes it to them
--   discuss   something to raise with them
--   mention   it involves them, nothing more
--
-- tasks.person_id, tasks.side and tasks.discuss stay as a summary of the task's lead person
-- (waiting first, then discuss, owe, mention), kept in step by packages/core/src/tasks.ts. The
-- lists that ask "is this mine or am I waiting?" read the summary; everything that asks about
-- a particular person reads this table.
CREATE TABLE task_people (
  task_id TEXT NOT NULL REFERENCES tasks(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  role TEXT NOT NULL DEFAULT 'waiting' CHECK (role IN ('waiting', 'owe', 'discuss', 'mention')),
  PRIMARY KEY (task_id, person_id)
);
CREATE INDEX idx_task_people_person ON task_people(person_id, role);

-- Every task keeps the one person it has, in the role it has now.
INSERT INTO task_people (task_id, person_id, role)
  SELECT id, person_id, CASE WHEN side = 'theirs' THEN 'waiting' WHEN discuss = 1 THEN 'discuss' ELSE 'owe' END
  FROM tasks WHERE person_id IS NOT NULL;
