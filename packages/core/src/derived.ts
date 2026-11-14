// derived.ts
// Pure rules for stale, due soon, overdue and waiting on. No database access, so they are
// easy to test. The SQL in queries mirrors these rules; keep them in sync.

import type { Project, Settings, Task } from "./types";
import { addDays, isoDaysAgo } from "./util";

const CLOSED: string[] = ["done", "archived"];

export function isOpenProject(p: Pick<Project, "status" | "archived_at">): boolean {
  return !CLOSED.includes(p.status) && !p.archived_at;
}

/** Active or waiting, and nothing has happened for stale_days. */
export function isStale(
  p: Pick<Project, "status" | "archived_at" | "last_activity_at">,
  settings: Pick<Settings, "stale_days">,
  now: Date = new Date(),
): boolean {
  if (p.archived_at) return false;
  if (p.status !== "active" && p.status !== "waiting") return false;
  return p.last_activity_at < isoDaysAgo(settings.stale_days, now);
}

/** Due before today and not finished. */
export function isOverdue(dueDate: string | null, closed: boolean, today: string): boolean {
  if (!dueDate || closed) return false;
  return dueDate < today;
}

/** Due today or within due_soon_days, and not finished. */
export function isDueSoon(
  dueDate: string | null,
  closed: boolean,
  today: string,
  settings: Pick<Settings, "due_soon_days">,
): boolean {
  if (!dueDate || closed) return false;
  return dueDate >= today && dueDate <= addDays(today, settings.due_soon_days);
}

export function isProjectWaiting(p: Pick<Project, "status" | "archived_at" | "waiting_on">): boolean {
  if (!isOpenProject(p)) return false;
  return p.status === "waiting" || p.waiting_on.trim() !== "";
}

/**
 * Whose turn it is on a project. This is what splits each desk into "Your move" and "Their move".
 *   theirs: open, and marked waiting or carrying a "waiting on" note or person
 *   yours:  active and not waiting on anyone
 *   parked: an idea or paused
 *   closed: done or archived
 */
export type Move = "yours" | "theirs" | "parked" | "closed";

/**
 * Whose move a project is. The tasks decide when there are any: an open task of the owner's own
 * makes it his move; open tasks that are all waiting on other people make it theirs. Only a
 * project with no open tasks falls back to its status and its "waiting on" field, so he does
 * not have to keep those up by hand.
 */
export function whoseMove(p: Pick<Project, "status" | "archived_at" | "waiting_on" | "waiting_on_person_id"> & { open_task_count?: number; waiting_task_count?: number }): Move {
  if (!isOpenProject(p)) return "closed";
  if (p.status === "idea" || p.status === "paused") return "parked";
  const open = p.open_task_count ?? 0;
  const waiting = p.waiting_task_count ?? 0;
  if (open > waiting) return "yours";
  if (waiting > 0) return "theirs";
  if (isProjectWaiting(p) || !!p.waiting_on_person_id) return "theirs";
  return p.status === "active" ? "yours" : "parked";
}

/** An open task assigned to someone (The owner is not a person record, so any person_id counts). */
export function isTaskWaiting(t: Pick<Task, "status" | "person_id" | "deleted_at"> & { side?: Task["side"] }): boolean {
  return t.status !== "done" && !t.deleted_at && !!t.person_id && t.side !== "mine";
}

/** True when a task is the owner's to do: it has no person, or it is something he owes that person. */
export function isMine(t: Pick<Task, "person_id"> & { side?: Task["side"] }): boolean {
  return !t.person_id || t.side === "mine";
}

export function daysSince(iso: string | null, now: Date = new Date()): number | null {
  if (!iso) return null;
  return Math.floor((now.getTime() - Date.parse(iso)) / 86_400_000);
}
