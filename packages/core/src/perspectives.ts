// perspectives.ts
// Saved views of the task list, in the spirit of OmniFocus perspectives. A view is a name and
// a filter ("budget, due this week", "everything older than 12 days or tied to an email").
// The owner makes one on the Tasks page with "Save view", or asks his chatbot to. Pinned views
// show as buttons at the top of the Tasks page. A view stores the filter, not the tasks, so it
// is always current.
// (The file is not called views.ts because that name was already taken by the read queries.)

import { recordAudit } from "./audit";
import type { Db } from "./db";
import { NotFoundError } from "./errors";
import { insertRow, updateRow } from "./rows";
import { taskFilterSchema, viewCreateSchema, viewUpdateSchema, type TaskFilterInput } from "./schemas";
import type { Ctx } from "./types";
import { newId, nowIso } from "./util";
import { listTasks, type TaskItem } from "./views";

interface ViewRow {
  id: string;
  name: string;
  filter: string;
  pinned: number;
  created_at: string;
  created_by: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface SavedView {
  id: string;
  name: string;
  filter: TaskFilterInput;
  pinned: boolean;
  created_by: string;
  updated_at: string;
}

function toView(r: ViewRow): SavedView {
  // A filter saved by an older version may have fields this one no longer knows; drop them
  // rather than fail to open the view.
  const parsed = taskFilterSchema.safeParse(JSON.parse(r.filter));
  return { id: r.id, name: r.name, filter: parsed.success ? parsed.data : {}, pinned: !!r.pinned, created_by: r.created_by, updated_at: r.updated_at };
}

export async function listSavedViews(db: Db): Promise<SavedView[]> {
  return (await db.all<ViewRow>(`SELECT * FROM views WHERE deleted_at IS NULL ORDER BY pinned DESC, name COLLATE NOCASE`)).map(toView);
}

async function mustGet(db: Db, id: string): Promise<ViewRow> {
  const row = await db.first<ViewRow>(`SELECT * FROM views WHERE id = ? AND deleted_at IS NULL`, [id]);
  if (!row) throw new NotFoundError(`No saved view with id ${id}`);
  return row;
}

export async function createSavedView(ctx: Ctx, input: unknown): Promise<SavedView> {
  const data = viewCreateSchema.parse(input);
  const now = nowIso();
  const row: ViewRow = { id: newId("viw"), name: data.name, filter: JSON.stringify(data.filter), pinned: data.pinned ? 1 : 0, created_at: now, created_by: ctx.actor, updated_at: now, deleted_at: null };
  await insertRow(ctx.db, "views", row as any);
  await recordAudit(ctx, "create", "views", null, row as any);
  return toView(row);
}

export async function updateSavedView(ctx: Ctx, id: string, input: unknown): Promise<SavedView> {
  const patch = viewUpdateSchema.parse(input);
  const before = await mustGet(ctx.db, id);
  const next: ViewRow = {
    ...before,
    name: patch.name ?? before.name,
    filter: patch.filter ? JSON.stringify(patch.filter) : before.filter,
    pinned: patch.pinned === undefined ? before.pinned : patch.pinned ? 1 : 0,
    updated_at: nowIso(),
  };
  await updateRow(ctx.db, "views", before as any, next as any);
  await recordAudit(ctx, "update", "views", before as any, next as any);
  return toView(next);
}

export async function deleteSavedView(ctx: Ctx, id: string): Promise<void> {
  const before = await mustGet(ctx.db, id);
  const next = { ...before, deleted_at: nowIso() };
  await updateRow(ctx.db, "views", before as any, next as any);
  await recordAudit(ctx, "delete_soft", "views", before as any, next as any);
}

/** A saved view and the tasks it shows right now. */
export async function openSavedView(db: Db, id: string): Promise<{ view: SavedView; tasks: TaskItem[] }> {
  const view = toView(await mustGet(db, id));
  return { view, tasks: await listTasks(db, view.filter) };
}

/** The weekly look-back: what got done, what is late, and what has been waiting more than a week. */
export async function weekReview(db: Db, areas?: TaskFilterInput["areas"]): Promise<{ done: TaskItem[]; late: TaskItem[]; waiting: TaskItem[]; hidden: TaskItem[] }> {
  return {
    done: await listTasks(db, { areas, state: "done", done_within_days: 7, hidden: "include" }),
    late: await listTasks(db, { areas, due: "late" }),
    waiting: (await listTasks(db, { areas, waiting_days: 7 })).sort((a, b) => (a.waiting_since ?? a.created_at).localeCompare(b.waiting_since ?? b.created_at)),
    hidden: await listTasks(db, { areas, hidden: "only" }),
  };
}
