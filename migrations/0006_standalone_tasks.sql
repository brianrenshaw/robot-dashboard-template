-- 0006_standalone_tasks.sql
-- Tasks that stand on their own, and tags on tasks and notes.
-- RULE: never edit this file after it has been applied. Add a new numbered migration instead.
--
-- Until now every task had to belong to a project. Most of what the owner tracks is a single task
-- ("a project implies more than one task"), so project_id becomes optional. SQLite cannot drop
-- NOT NULL from a column, so the table is rebuilt with the looser rule. Two columns are added
-- on the way:
--   area    the desk a task belongs to when it has no project (a task on a project uses the
--           project's desk and leaves this empty)
--   notes   free text under the task
-- task_tags and entry_tags let tasks and notes carry the same tags projects already have.

-- The order of the rebuild matters. Other tables point at tasks (queue_items.task_id), and
-- SQLite only lets those links be broken for a moment if the rows come back into a table that
-- is already called "tasks". So: set the rows aside, drop the table, create it again under the
-- same name, and put the rows back. (Copying into a new table and renaming it fails with
-- "FOREIGN KEY constraint failed" as soon as any queue item points at a task; that was tried.)

PRAGMA defer_foreign_keys = true;

CREATE TABLE tasks_old AS SELECT * FROM tasks;

DROP TABLE tasks;

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  area TEXT CHECK (area IS NULL OR area IN ('work', 'personal', 'side_business')),
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  due_date TEXT,
  person_id TEXT REFERENCES people(id),
  sort_order REAL NOT NULL DEFAULT 0,
  done_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

INSERT INTO tasks (id, project_id, area, title, notes, status, due_date, person_id, sort_order, done_at, created_at, updated_at, deleted_at)
  SELECT id, project_id, NULL, title, '', status, due_date, person_id, sort_order, done_at, created_at, updated_at, deleted_at FROM tasks_old;

DROP TABLE tasks_old;

CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_due_status ON tasks(due_date, status);
CREATE INDEX idx_tasks_person ON tasks(person_id);

CREATE TABLE task_tags (
  task_id TEXT NOT NULL REFERENCES tasks(id),
  tag_id TEXT NOT NULL REFERENCES tags(id),
  PRIMARY KEY (task_id, tag_id)
);
CREATE INDEX idx_task_tags_tag ON task_tags(tag_id);

CREATE TABLE entry_tags (
  entry_id TEXT NOT NULL REFERENCES entries(id),
  tag_id TEXT NOT NULL REFERENCES tags(id),
  PRIMARY KEY (entry_id, tag_id)
);
CREATE INDEX idx_entry_tags_tag ON entry_tags(tag_id);
