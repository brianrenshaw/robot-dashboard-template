-- 0020_block_outcomes.sql
-- How a session of his own time went, said more exactly, and kept where it happened.
-- the owner, 2026-11-19: "when i timeblock something then we need some different identifications
-- if i got it done, didn't get it done or not and it shouldn't be cleared on the dashboard. i
-- should also have the freedom to say if i did not do it but did something else instead".
--
-- block_results is rebuilt with two changes:
--
-- 1. instead: what he did in that time when he did not do what it was set aside for
--    ("worked on the budget analysis"). Only ever set together with kept = 0. So a
--    session he answered for is one of three things:
--      kept = 1                    he did the work
--      kept = 0, instead = ''      he did not get to it
--      kept = 0, instead != ''     he did something else, and this says what
--    kept NULL is still "he has not said".
--
-- 2. The key is now (ref, day), not ref alone. A session is a block or calendar entry ON A
--    DAY. When he does not get to a block he often moves it to another day; the entry keeps
--    its id, so with ref alone the answer for the old day followed it to the new one and the
--    old day lost its record. Now the old day keeps its answer and the moved session starts
--    with none.
--
-- Nothing else points at block_results, so the rebuild is the plain one: set the rows aside,
-- drop the table, create it again under the same name, put the rows back (as in 0006).

CREATE TABLE block_results_old AS SELECT * FROM block_results;

DROP TABLE block_results;

CREATE TABLE block_results (
  ref TEXT NOT NULL,
  day TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  minutes INTEGER NOT NULL,
  title TEXT NOT NULL,
  task_id TEXT REFERENCES tasks(id),
  kept INTEGER CHECK (kept IN (0, 1)),
  instead TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (ref, day)
);

INSERT INTO block_results (ref, day, start_min, minutes, title, task_id, kept, instead, created_by, created_at, updated_at)
  SELECT ref, day, start_min, minutes, title, task_id, kept, '', created_by, created_at, updated_at FROM block_results_old;

DROP TABLE block_results_old;

CREATE INDEX idx_block_results_day ON block_results(day);
