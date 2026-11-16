-- 0015_daily_log.sql
-- The daily log: a short, casual record of what the owner worked on each day. He does not keep it
-- himself. His chatbot writes it: at the end of the day it gathers the day's meetings, the
-- mail he sent and the tasks he added and finished, and through the day he can tell it
-- "log that I ..." to jot something down.
--
-- One row per day. The day (YYYY-MM-DD in his time zone) is the key, so a day never has two.
--   body   the day written up (markdown). Saving it again replaces it.
--   notes  what he said he did, one thing per line, in the order he said it. Only added to.
-- A row with both empty counts as no log for that day.

CREATE TABLE daily_logs (
  day TEXT PRIMARY KEY,
  body TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
