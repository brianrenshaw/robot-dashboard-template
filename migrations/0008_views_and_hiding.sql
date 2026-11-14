-- 0008_views_and_hiding.sql
-- Saved views (like OmniFocus perspectives), hiding a task until a date, and knowing how long
-- The owner has been waiting on something.
-- RULE: never edit this file after it has been applied. Add a new numbered migration instead.
--
-- tasks.hide_until     a day (YYYY-MM-DD). Until then the task is left out of the ordinary lists.
--                      It is never gone: any list can be asked to include hidden tasks.
-- tasks.waiting_since  when the task started waiting on its person, so a list can say "12 days".
-- views                a named filter over tasks. `filter` is JSON in the shape of TaskFilter
--                      (packages/core/src/views.ts). The owner or his chatbot makes one; pinned ones
--                      show as buttons on the Tasks page.

ALTER TABLE tasks ADD COLUMN hide_until TEXT;
ALTER TABLE tasks ADD COLUMN waiting_since TEXT;
UPDATE tasks SET waiting_since = created_at WHERE person_id IS NOT NULL AND side = 'theirs';

CREATE TABLE views (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  filter TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
