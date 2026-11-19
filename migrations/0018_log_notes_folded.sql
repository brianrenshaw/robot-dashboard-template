-- 0018_log_notes_folded.sql
-- The daily log should not say the same thing twice. The owner, 2026-11-16: "it should be smart
-- enough to group together similar things, like if I sent an email and said something about it
-- in my own words... I just don't want duplicated line items."
--
-- The write-up (body) is now written with his own notes folded into it, one line for each
-- thing he worked on. So the pages must stop listing those notes a second time beneath it.
--   notes_folded  how many of the day's notes (counted from the first) the write-up already
--                 covers. Notes are only ever added at the end, so a count is enough: the
--                 notes after it were said since the write-up and still show on their own.
-- It is set whenever the write-up is saved. 0 for a day with no write-up, and for the days
-- written before this, whose write-ups left his notes out.

ALTER TABLE daily_logs ADD COLUMN notes_folded INTEGER NOT NULL DEFAULT 0;
