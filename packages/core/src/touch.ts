// touch.ts
// Keeps projects.last_activity_at and people.last_contact_at current.

import type { Db } from "./db";
import { placeholders } from "./db";
import { nowIso } from "./util";

/** Mark projects as having activity right now. */
export async function touchProjects(db: Db, ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return;
  await db.run(`UPDATE projects SET last_activity_at = ? WHERE id IN (${placeholders(list.length)})`, [
    nowIso(),
    ...list,
  ]);
}

/** Move people.last_contact_at forward to `at` if it is newer. */
export async function touchPeople(db: Db, ids: string[], at: string) {
  const list = [...new Set(ids)];
  if (!list.length) return;
  await db.run(
    `UPDATE people SET last_contact_at = ? WHERE id IN (${placeholders(list.length)})
     AND (last_contact_at IS NULL OR last_contact_at < ?)`,
    [at, ...list, at],
  );
}
