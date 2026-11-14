-- 0014_tagged_and_one_on_one.sql
-- A person on a task is simply tagged. Two optional marks replace the four roles.
--
-- Migration 0012 gave each person on a task one of four roles: waiting, owe, discuss, mention.
-- The owner did not want to sort things into those: "I still don't like the waiting on, I owe, and
-- to discuss." What he wants: everything that involves a person is tagged with them, and a
-- separate short list for the next 1:1 that only he or his chatbot put things on.
--
-- So task_people becomes: the person is on the task (tagged), plus
--   waiting      1 when he is waiting on them for it (a quiet mark; the Tasks page still groups
--                its "Waiting on" list by it and counts the days)
--   one_on_one   1 when it is on the list for his next 1:1 with them
--
-- What carries over: "waiting" stays waiting. What was "to discuss" goes on the 1:1 list,
-- because those items came from his 1:1 lists in the first place. "owe" and "mention" become
-- plainly tagged.
--
-- Nothing else points at task_people, so it can be rebuilt by copy and rename.
CREATE TABLE task_people_v2 (
  task_id TEXT NOT NULL REFERENCES tasks(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  waiting INTEGER NOT NULL DEFAULT 0,
  one_on_one INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (task_id, person_id)
);

INSERT INTO task_people_v2 (task_id, person_id, waiting, one_on_one)
  SELECT task_id, person_id, CASE WHEN role = 'waiting' THEN 1 ELSE 0 END, CASE WHEN role = 'discuss' THEN 1 ELSE 0 END
  FROM task_people ORDER BY rowid;

DROP TABLE task_people;
ALTER TABLE task_people_v2 RENAME TO task_people;
CREATE INDEX idx_task_people_person ON task_people(person_id);

-- tasks.discuss was part of the lead-person summary. It is no longer used and stays 0.
UPDATE tasks SET discuss = 0 WHERE discuss != 0;
