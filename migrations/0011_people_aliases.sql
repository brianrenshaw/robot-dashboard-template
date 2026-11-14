-- 0011_people_aliases.sql
-- Other names a person goes by.
--
-- People are matched by name: when a task says "Discuss with Nina", when a chatbot is told
-- "add this for Nena", when a calendar guest is looked up. The owner dictates, and dictation
-- writes "Nena" for Nina or "Jon" for Jordan. `aliases` holds those other spellings and
-- nicknames, separated by commas, so matching is exact instead of lucky.
ALTER TABLE people ADD COLUMN aliases TEXT NOT NULL DEFAULT '';
