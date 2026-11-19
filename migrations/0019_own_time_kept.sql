-- 0019_own_time_kept.sql
-- Time he set aside for his own work is not a meeting, and he wants to see over time whether
-- he went through with it. The owner, 2026-11-16: "if something was a time block it wasn't a
-- meeting -- it would be nice though to kind of track over time how much I get done during
-- time blocked sessions (like if I actually went through with it)".
--
-- 1. calendar_events.guests: how many other people are on the event (rooms left out). An
--    event with none, that names none of his people, is his own time, not a meeting. NULL
--    until the next calendar sync fills it in; NULL is read as "a meeting", as before.
--
-- 2. block_results: one row for each session of his own time he has answered for.
--      ref     what the session was: 'block:<time_blocks.id>' for a block made on the
--              dashboard, 'calendar:<calendar_events.id>' for one he made in his calendar.
--      day, start_min, minutes, title, task_id
--              a copy of the session as it was, so the record still reads after the calendar
--              copy has moved on (it only reaches back about a day) or the block is taken off.
--      kept    1: he did the work in that time. 0: he did not get to it. NULL: not said.
--    Rows are never removed. A row starts with kept NULL and is then filled in, so the first
--    answer can be undone like any other.

ALTER TABLE calendar_events ADD COLUMN guests INTEGER;

CREATE TABLE block_results (
  ref TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  minutes INTEGER NOT NULL,
  title TEXT NOT NULL,
  task_id TEXT REFERENCES tasks(id),
  kept INTEGER CHECK (kept IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_block_results_day ON block_results(day);
