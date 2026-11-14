-- 0004_one_on_ones.sql
-- 1:1 meetings: who the owner meets with regularly, and the running list he keeps for each person.
-- RULE: never edit this file after it has been applied. Add a new numbered migration instead.
--
-- one_on_ones: one row per person the owner has a standing 1:1 with (a direct report, his manager,
--   a peer). Holds the rhythm, the date of the next one when known, and standing notes.
-- agenda_items: the list for each person. Two kinds:
--     discuss  something to bring up next time
--     action   something that came out of a meeting. owner says whose it is: 'me' (The owner owes
--              them), 'them' (they owe the owner), or NULL when it has not been sorted yet
--   The meetings themselves are ordinary timeline entries (kind 'meeting') linked to the person.

CREATE TABLE one_on_ones (
  person_id TEXT PRIMARY KEY REFERENCES people(id),
  relationship TEXT NOT NULL DEFAULT 'direct' CHECK (relationship IN ('direct', 'manager', 'peer', 'other')),
  cadence_days INTEGER NOT NULL DEFAULT 14,
  next_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE agenda_items (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id),
  kind TEXT NOT NULL DEFAULT 'discuss' CHECK (kind IN ('discuss', 'action')),
  owner TEXT CHECK (owner IS NULL OR owner IN ('me', 'them')),
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dropped')),
  project_id TEXT REFERENCES projects(id),
  entry_id TEXT REFERENCES entries(id),
  due_date TEXT,
  url TEXT,
  source_ref TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  deleted_at TEXT
);

CREATE INDEX idx_agenda_person ON agenda_items(person_id, status);
CREATE INDEX idx_agenda_source_ref ON agenda_items(source_ref);
CREATE INDEX idx_agenda_entry ON agenda_items(entry_id);
