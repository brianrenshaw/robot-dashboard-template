// runs.ts
// A record of each time a scheduled Claude task finished (today that is only the morning
// brief). Settings uses it to say when it last ran. The task calls the log_run tool.
//
// The queue_items table ("Needs you") that used to live beside this is retired: nothing reads
// or writes it any more. Its rows are still in the database and in the backups.

import { recordAudit } from "./audit";
import type { Db } from "./db";
import { insertRow } from "./rows";
import { runSchema } from "./schemas";
import type { Ctx, Run } from "./types";
import { newId, nowIso } from "./util";

/** Record that an automation finished, with a one-line result such as "3 replies drafted, 1 cleared". */
export async function logRun(ctx: Ctx, input: unknown): Promise<Run> {
  const data = runSchema.parse(input);
  const row: Run = { id: newId("run"), name: data.name, summary: data.summary, ran_at: nowIso(), created_by: ctx.actor };
  await insertRow(ctx.db, "runs", row as any);
  await recordAudit(ctx, "create", "runs", null, row as any);
  return row;
}

/** The most recent run of each automation, newest first. */
export async function latestRuns(db: Db): Promise<Run[]> {
  return db.all<Run>(
    `SELECT r.* FROM runs r WHERE r.id = (SELECT x.id FROM runs x WHERE x.name = r.name ORDER BY x.ran_at DESC, x.id DESC LIMIT 1)
     ORDER BY r.ran_at DESC`,
  );
}
