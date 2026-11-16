-- 0017_meeting_tasks_and_notes.sql
-- Tasks and notes for a meeting on his calendar (2026-11-16: "with meetings I think being able
-- to add tasks or notes to it would be good").
--
-- tasks.meeting_ref  the calendar event a task was added for (calendar_events.id, which is the
--                    Google account and Google's event id, and stays the same across syncs).
--                    The task shows in that meeting on the dashboard. NULL for most tasks.
-- A meeting's note is an ordinary entry (kind 'meeting') whose source_ref is
-- 'calendar:<event id>': one per meeting, added to over time, filed with the meeting's people
-- and dated when it starts, so it shows on their pages and in that day's log.

ALTER TABLE tasks ADD COLUMN meeting_ref TEXT;
CREATE INDEX idx_tasks_meeting ON tasks(meeting_ref);
