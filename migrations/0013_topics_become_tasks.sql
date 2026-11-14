-- 0013_topics_become_tasks.sql
-- The last of the old 1:1 lists becomes tasks.
--
-- agenda_items held 1:1 topics ("discuss") and next steps from meetings ("action"). Tasks
-- took over what people owe each other in migration 0007, and "to discuss" in 0009 / 0012. The
-- site and the chatbot no longer read or write agenda_items, so anything still open there is
-- copied across as a task with the person on it:
--   a topic                      -> to discuss with them
--   an action that was theirs    -> waiting on them
--   an action that was his       -> owed to them
--   an action never sorted       -> mentions them
-- The originals are then marked deleted (never removed), so nothing shows twice.
INSERT INTO tasks (id, project_id, area, title, notes, status, due_date, person_id, side, discuss, source_ref, hide_until, waiting_since, sort_order, done_at, created_at, updated_at, deleted_at)
  SELECT 'tsk_' || substr(a.id, 5), NULL, COALESCE(p.area, 'work'), a.title, a.notes, 'todo', a.due_date, a.person_id,
         CASE WHEN a.kind = 'action' AND a.owner = 'them' THEN 'theirs' ELSE 'mine' END,
         CASE WHEN a.kind = 'discuss' THEN 1 ELSE 0 END,
         NULL, NULL,
         CASE WHEN a.kind = 'action' AND a.owner = 'them' THEN a.created_at ELSE NULL END,
         0, NULL, a.created_at, a.created_at, NULL
  FROM agenda_items a JOIN people p ON p.id = a.person_id
  WHERE a.status = 'open' AND a.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = 'tsk_' || substr(a.id, 5));

INSERT OR IGNORE INTO task_people (task_id, person_id, role)
  SELECT 'tsk_' || substr(a.id, 5), a.person_id,
         CASE WHEN a.kind = 'discuss' THEN 'discuss' WHEN a.owner = 'them' THEN 'waiting' WHEN a.owner = 'me' THEN 'owe' ELSE 'mention' END
  FROM agenda_items a
  WHERE a.status = 'open' AND a.deleted_at IS NULL;

UPDATE agenda_items SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE status = 'open' AND deleted_at IS NULL;
