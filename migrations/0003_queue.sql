-- 0003_queue.sql
-- The "Needs you" queue and the automation run log.
-- RULE: never edit this file after it has been applied. Add a new numbered migration instead.
--
-- queue_items: things an AI automation prepared for the owner to act on. A reply that is drafted and
--   waiting in Superhuman, a suggested task, a follow-up to send, or a heads-up. The website shows
--   them at the top of each desk. Nothing is hard deleted: an item is marked done or dismissed.
-- runs: one row each time an automation finishes (email check, morning brief, meeting follow-up),
--   so the website can say when it last ran.

CREATE TABLE queue_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('reply', 'task', 'follow_up', 'heads_up')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dismissed')),
  area TEXT CHECK (area IS NULL OR area IN ('work', 'personal', 'side_business')),
  project_id TEXT REFERENCES projects(id),
  person_id TEXT REFERENCES people(id),
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  draft TEXT NOT NULL DEFAULT '',
  task_title TEXT NOT NULL DEFAULT '',
  due_date TEXT,
  url TEXT,
  source_ref TEXT,
  mail_account TEXT NOT NULL DEFAULT '',
  from_name TEXT NOT NULL DEFAULT '',
  received_at TEXT,
  snoozed_until TEXT,
  task_id TEXT REFERENCES tasks(id),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  deleted_at TEXT
);

CREATE INDEX idx_queue_status ON queue_items(status, area);
CREATE INDEX idx_queue_source_ref ON queue_items(source_ref);
CREATE INDEX idx_queue_project ON queue_items(project_id);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  ran_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

CREATE INDEX idx_runs_name ON runs(name, ran_at);
