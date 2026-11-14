-- 0010_calendar_people.sql
-- Who each calendar meeting is with.
--
-- Until now the calendar copy only knew about 1:1s (calendar_events.person_id). The owner wants
-- the dashboard's people list in the order of his next meeting with each person, and that is
-- any meeting, not only a 1:1. This table says which of his people are in which event: a
-- guest matched by email or name, or a person named in the title ("Lunch with Kai Ellis").
--
-- Like calendar_events it is a cache of Google Calendar, not the owner's own data: each sync
-- replaces an account's rows, and nothing here is in the audit log.
CREATE TABLE calendar_event_people (
  event_id TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES people(id),
  PRIMARY KEY (event_id, person_id)
);
CREATE INDEX idx_calendar_event_people_person ON calendar_event_people(person_id);
