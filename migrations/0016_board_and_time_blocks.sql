-- 0016_board_and_time_blocks.sql
-- The planning board and time blocks (2026-11-15).
--
-- The owner plans by time blocking, after Cal Newport, and keeps what needs doing on a board of
-- rows he moves things between himself.
--
-- tasks.board  the row a task sits in on the board: 'todo', 'waiting', 'back' (back burner) or
--              'figure' (to figure out). NULL means he has not placed it yet: it waits in New,
--              unless he is waiting on someone for it, in which case it shows in 'waiting'.
--              The order within a row is tasks.sort_order.
--
-- time_blocks  time he set aside for a task: a day, a start (minutes after midnight, his time
--              zone) and a length in minutes. A task can have several. They live here, on his
--              dashboard; the site still never writes his Google Calendar.

ALTER TABLE tasks ADD COLUMN board TEXT;

CREATE TABLE time_blocks (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  day TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  minutes INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_time_blocks_day ON time_blocks(day);
CREATE INDEX idx_time_blocks_task ON time_blocks(task_id);
