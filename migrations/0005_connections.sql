-- 0005_connections.sql
-- Connections: the outside services the site reads by itself (Google Calendar, Gmail, Granola)
-- and the keys it needs for them.
-- RULE: never edit this file after it has been applied. Add a new numbered migration instead.
--
-- connection_secrets   API keys pasted into Settings (Granola, the Google sign-in client).
--                      Stored encrypted with the Worker's CONNECTIONS_KEY secret, so a
--                      database dump never holds a usable key. `hint` is the last four characters.
-- google_accounts      One row per Google account the owner has connected, with which desk it
--                      belongs to and an encrypted refresh token.
-- calendar_events      A copy of the next few weeks of each connected calendar. It is a cache:
--                      rows are replaced on every sync and are not in the audit log.
-- mail_seen            Which email threads have already been looked at, and as of which message,
--                      so the same thread is not judged again until something new arrives.
-- sync_state           When each background sync last ran (heartbeats, not audited).

CREATE TABLE connection_secrets (
  key TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  hint TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE google_accounts (
  email TEXT PRIMARY KEY,
  area TEXT NOT NULL CHECK (area IN ('work', 'personal', 'side_business')),
  refresh_token TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  calendar_synced_at TEXT,
  mail_synced_at TEXT,
  connected_at TEXT NOT NULL,
  disconnected_at TEXT
);

CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  area TEXT NOT NULL,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  all_day INTEGER NOT NULL DEFAULT 0,
  day TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  url TEXT,
  person_id TEXT REFERENCES people(id)
);

CREATE INDEX idx_calendar_day ON calendar_events(day);
CREATE INDEX idx_calendar_person ON calendar_events(person_id, starts_at);

CREATE TABLE mail_seen (
  thread_id TEXT NOT NULL,
  account TEXT NOT NULL,
  last_message_at TEXT NOT NULL,
  verdict TEXT NOT NULL,
  -- Gmail's change marker for the thread when it was last read. Same marker, nothing new to read.
  version TEXT NOT NULL DEFAULT '',
  seen_at TEXT NOT NULL,
  PRIMARY KEY (thread_id, account)
);

CREATE TABLE sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
