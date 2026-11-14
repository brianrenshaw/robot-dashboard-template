-- 0001_initial.sql
-- Initial schema for the project dashboard.
-- RULE: never edit this file after it has been applied. Add a new numbered migration instead.
--
-- Conventions
--   IDs are text with a readable prefix (prj_, per_, ent_, tsk_, lnk_, tag_, dig_, aud_).
--   Timestamps are ISO 8601 UTC strings, for example 2026-11-13T14:05:00.000Z.
--   due_date and start_date are YYYY-MM-DD with no time.
--   Nothing is hard deleted. Rows get archived_at or deleted_at instead.

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  area TEXT NOT NULL CHECK (area IN ('work', 'personal', 'side_business')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('idea', 'active', 'waiting', 'paused', 'done', 'archived')),
  priority INTEGER NOT NULL DEFAULT 2 CHECK (priority IN (1, 2, 3)),
  summary TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  next_step TEXT NOT NULL DEFAULT '',
  waiting_on TEXT NOT NULL DEFAULT '',
  waiting_on_person_id TEXT REFERENCES people(id),
  start_date TEXT,
  due_date TEXT,
  color TEXT,
  cover_url TEXT,
  sort_order REAL NOT NULL DEFAULT 0,
  last_activity_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  organization TEXT NOT NULL DEFAULT '',
  area TEXT CHECK (area IS NULL OR area IN ('work', 'personal', 'side_business')),
  notes TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  last_contact_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE project_people (
  project_id TEXT NOT NULL REFERENCES projects(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  role TEXT NOT NULL DEFAULT 'collaborator' CHECK (role IN ('owner', 'collaborator', 'stakeholder')),
  PRIMARY KEY (project_id, person_id)
);

CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  kind TEXT NOT NULL CHECK (kind IN ('note', 'email', 'meeting', 'call', 'decision',
    'status_change', 'task_done', 'file', 'digest')),
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  url TEXT,
  source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'claude', 'mcp', 'import')),
  source_ref TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE entry_people (
  entry_id TEXT NOT NULL REFERENCES entries(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  PRIMARY KEY (entry_id, person_id)
);

CREATE TABLE entry_projects (
  entry_id TEXT NOT NULL REFERENCES entries(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  PRIMARY KEY (entry_id, project_id)
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  due_date TEXT,
  person_id TEXT REFERENCES people(id),
  sort_order REAL NOT NULL DEFAULT 0,
  done_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE links (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other'
    CHECK (kind IN ('doc', 'sheet', 'slides', 'folder', 'email', 'site', 'other')),
  pinned INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE project_tags (
  project_id TEXT NOT NULL REFERENCES projects(id),
  tag_id TEXT NOT NULL REFERENCES tags(id),
  PRIMARY KEY (project_id, tag_id)
);

CREATE TABLE digests (
  id TEXT PRIMARY KEY,
  run_date TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'archive', 'restore', 'delete_soft')),
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  before TEXT,
  after TEXT,
  undone_at TEXT,
  undone_by TEXT
);

CREATE INDEX idx_projects_area_status ON projects(area, status);
CREATE INDEX idx_projects_due_date ON projects(due_date);
CREATE INDEX idx_projects_last_activity ON projects(last_activity_at);
CREATE INDEX idx_projects_waiting_person ON projects(waiting_on_person_id);
CREATE INDEX idx_project_people_person ON project_people(person_id);
CREATE INDEX idx_entries_project ON entries(project_id);
CREATE INDEX idx_entries_occurred ON entries(occurred_at);
CREATE INDEX idx_entries_source_ref ON entries(source_ref);
CREATE INDEX idx_entries_created ON entries(created_at);
CREATE INDEX idx_entry_people_person ON entry_people(person_id);
CREATE INDEX idx_entry_projects_project ON entry_projects(project_id);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_due_status ON tasks(due_date, status);
CREATE INDEX idx_tasks_person ON tasks(person_id);
CREATE INDEX idx_links_project ON links(project_id);
CREATE INDEX idx_project_tags_tag ON project_tags(tag_id);
CREATE INDEX idx_digests_run_date ON digests(run_date);
CREATE INDEX idx_audit_at ON audit_log(at);
CREATE INDEX idx_audit_actor ON audit_log(actor);
CREATE INDEX idx_audit_row ON audit_log(table_name, row_id);

INSERT INTO settings (key, value) VALUES
  ('stale_days', '14'),
  ('due_soon_days', '7'),
  ('timezone', '"America/New_York"');
