// blocks.ts
// Time blocks: time the owner sets aside on his dashboard for a task (a day, a start, a length).
// He plans by time blocking, after Cal Newport: meetings are fixed, and the open time between
// them gets a job. He makes blocks by dragging a task onto his week on the dashboard, or by
// telling his chatbot ("give the Riley decision 45 minutes Tuesday at 9").
//
// Blocks live only here. The site reads his Google Calendar and never writes it.

import { recordAudit } from "./audit";
import type { Db } from "./db";
import { NotFoundError } from "./errors";
import { getRow, insertRow, updateRow } from "./rows";
import { timeBlockSchema, timeBlockUpdateSchema } from "./schemas";
import type { Ctx, TimeBlock } from "./types";
import { newId, nowIso } from "./util";

/** A block with the title and desk of its task, for drawing it. */
export interface TimeBlockView extends TimeBlock {
  title: string;
  area: string;
  status: string;
}

/** Blocks from `fromDay` to `toDay` (inclusive), soonest first. Blocks of deleted tasks are left out. */
export async function listTimeBlocks(db: Db, fromDay: string, toDay: string): Promise<TimeBlockView[]> {
  return db.all<TimeBlockView>(
    `SELECT b.*, t.title, COALESCE(p.area, t.area, 'work') AS area, t.status
     FROM time_blocks b JOIN tasks t ON t.id = b.task_id LEFT JOIN projects p ON p.id = t.project_id
     WHERE b.deleted_at IS NULL AND t.deleted_at IS NULL AND b.day >= ? AND b.day <= ?
     ORDER BY b.day, b.start_min`,
    [fromDay, toDay],
  );
}

export async function addTimeBlock(ctx: Ctx, input: unknown): Promise<TimeBlock> {
  const data = timeBlockSchema.parse(input);
  const task = await ctx.db.first<{ id: string }>(`SELECT id FROM tasks WHERE id = ? AND deleted_at IS NULL`, [data.task_id]);
  if (!task) throw new NotFoundError(`No task with id ${data.task_id}`);
  const now = nowIso();
  const row: TimeBlock = { id: newId("blk"), ...data, created_by: ctx.actor, created_at: now, updated_at: now, deleted_at: null };
  await insertRow(ctx.db, "time_blocks", row as any);
  await recordAudit(ctx, "create", "time_blocks", null, row as any);
  return row;
}

async function mustBlock(db: Db, id: string): Promise<TimeBlock> {
  const b = await getRow<TimeBlock>(db, "time_blocks", { id });
  if (!b || b.deleted_at) throw new NotFoundError(`No time block with id ${id}`);
  return b;
}

/** Move a block or change its length. */
export async function updateTimeBlock(ctx: Ctx, id: string, input: unknown): Promise<TimeBlock> {
  const patch = timeBlockUpdateSchema.parse(input);
  const before = await mustBlock(ctx.db, id);
  const next: TimeBlock = { ...before, ...patch, updated_at: nowIso() };
  if (next.day === before.day && next.start_min === before.start_min && next.minutes === before.minutes) return before;
  await updateRow(ctx.db, "time_blocks", before as any, next as any);
  await recordAudit(ctx, "update", "time_blocks", before as any, next as any);
  return next;
}

/** Take a block off the week. The row is kept (deleted_at), so Activity can undo it. */
export async function deleteTimeBlock(ctx: Ctx, id: string): Promise<void> {
  const before = await mustBlock(ctx.db, id);
  const next = { ...before, deleted_at: nowIso() };
  await updateRow(ctx.db, "time_blocks", before as any, next as any);
  await recordAudit(ctx, "delete_soft", "time_blocks", before as any, next as any);
}
