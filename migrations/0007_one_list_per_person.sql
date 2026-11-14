-- 0007_one_list_per_person.sql
-- One list of owed things per person.
-- RULE: never edit this file after it has been applied. Add a new numbered migration instead.
--
-- Until now there were two places a "Sam owes me X" could live: a task waiting on Sam, and
-- an action on Sam's 1:1 list (agenda_items). The owner asked for them to be merged. From here on
-- an owed thing is always a task with a person on it:
--   side 'theirs'   the owner is waiting on that person (the default when a task has a person)
--   side 'mine'     the owner owes it to that person
-- A task with no person is simply his own; side does not matter for it.
-- agenda_items keeps only what is not a task: topics to discuss in the next 1:1.
--
-- source_ref lets a task remember where it came from (an OmniFocus task id, a thread, a note),
-- so the same thing is never added twice.

ALTER TABLE tasks ADD COLUMN side TEXT NOT NULL DEFAULT 'theirs' CHECK (side IN ('mine', 'theirs'));
ALTER TABLE tasks ADD COLUMN source_ref TEXT;
CREATE INDEX idx_tasks_source ON tasks(source_ref);

-- Carry the sorted 1:1 actions across as tasks. An item id "agn_..." becomes task id "tsk_...".
-- Finished items come across finished and dropped ones come across deleted, so nothing is lost.
INSERT INTO tasks (id, project_id, area, title, notes, status, due_date, person_id, side, source_ref, sort_order, done_at, created_at, updated_at, deleted_at)
SELECT
  'tsk_' || substr(a.id, 5),
  a.project_id,
  CASE WHEN a.project_id IS NULL THEN COALESCE(p.area, 'work') END,
  a.title,
  TRIM(a.notes || CASE WHEN a.url IS NOT NULL AND instr(a.notes, a.url) = 0 THEN char(10) || a.url ELSE '' END),
  CASE a.status WHEN 'open' THEN 'todo' ELSE 'done' END,
  a.due_date,
  a.person_id,
  CASE a.owner WHEN 'me' THEN 'mine' ELSE 'theirs' END,
  a.source_ref,
  0,
  CASE WHEN a.status != 'open' THEN COALESCE(a.closed_at, a.updated_at) END,
  a.created_at,
  a.updated_at,
  CASE WHEN a.status = 'dropped' THEN COALESCE(a.closed_at, a.updated_at) END
FROM agenda_items a JOIN people p ON p.id = a.person_id
WHERE a.kind = 'action' AND a.owner IN ('me', 'them') AND a.deleted_at IS NULL;

-- The originals are put away (soft-deleted, never removed). Actions that were never sorted into
-- mine or theirs stay where they are: nothing here guesses whose they are.
UPDATE agenda_items SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE kind = 'action' AND owner IN ('me', 'them') AND deleted_at IS NULL;
