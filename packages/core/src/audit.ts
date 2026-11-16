// audit.ts
// Every write through the API or MCP adds a row to audit_log. This file records those rows,
// describes them in plain language for the Activity view, and undoes them.

import type { Db } from "./db";
import { placeholders } from "./db";
import { changedKeys, deleteJoinRow, getRow, insertRow, rowIdOf, tableDef, updateRow } from "./rows";
import type { AuditAction, AuditRow, Ctx } from "./types";
import { newId, nowIso, parseJson } from "./util";

export async function recordAudit(
  ctx: Ctx,
  action: AuditAction,
  table: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Promise<string> {
  const id = newId("aud");
  const rowId = rowIdOf(table, (after ?? before)!);
  await ctx.db.run(
    `INSERT INTO audit_log (id, at, actor, action, table_name, row_id, before, after)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      nowIso(),
      ctx.actor,
      action,
      table,
      rowId,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
    ],
  );
  return id;
}

export interface AuditView {
  id: string;
  at: string;
  actor: string;
  actor_label: string;
  action: AuditAction;
  table_name: string;
  row_id: string;
  summary: string;
  link: string | null;
  undone_at: string | null;
  can_undo: boolean;
}

export interface AuditFilter {
  limit?: number;
  since?: string;
  actor?: string;
  table?: string;
}

export async function listAudit(db: Db, f: AuditFilter = {}): Promise<AuditView[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.since) {
    where.push("at >= ?");
    params.push(f.since);
  }
  if (f.actor) {
    where.push("actor = ?");
    params.push(f.actor);
  }
  if (f.table) {
    where.push("table_name = ?");
    params.push(f.table);
  }
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 1000);
  const rows = await db.all<AuditRow>(
    `SELECT * FROM audit_log ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY at DESC, id DESC LIMIT ${limit}`,
    params,
  );
  return describeAudit(db, rows);
}

export function actorLabel(actor: string): string {
  if (actor === "web") return "You";
  if (actor.startsWith("undo:")) return actorLabel(actor.slice(5)) + " (undo)";
  if (actor.startsWith("mcp:")) {
    const name = actor.slice(4);
    if (!name || name === "unknown") return "An AI";
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  if (actor.startsWith("script:")) return `Script (${actor.slice(7)})`;
  if (actor === "sync:granola") return "Granola";
  if (actor === "sync:mail") return "The email check";
  if (actor === "sync:calendar") return "The calendar sync";
  if (actor === "import:omnifocus") return "The OmniFocus import";
  return actor;
}

const KIND_LABEL: Record<string, string> = {
  note: "a note",
  email: "an email",
  meeting: "a meeting",
  call: "a call",
  decision: "a decision",
  status_change: "a status change",
  task_done: "a completed task",
  file: "a file",
  digest: "a digest",
};

/** Connections are changed in Settings and cannot be put back from the audit log (no secret is kept there). */
const NO_UNDO = new Set(["connection_secrets", "google_accounts"]);
const SECRET_LABEL: Record<string, string> = {
  google_client_id: "the Google sign-in client ID",
  google_client_secret: "the Google sign-in client secret",
  granola_api_key: "the Granola API key",
};

const QUEUE_LABEL: Record<string, string> = {
  reply: "a reply",
  task: "a suggested task",
  follow_up: "a follow-up",
  heads_up: "a heads-up",
};

const FIELD_LABEL: Record<string, string> = {
  task_title: "task wording",
  snoozed_until: "snooze",
  next_step: "next step",
  waiting_on: "waiting on",
  waiting_on_person_id: "waiting on person",
  due_date: "due date",
  start_date: "start date",
  sort_order: "order",
  cover_url: "cover",
  avatar_url: "photo",
  person_id: "assignee",
  project_id: "project",
  occurred_at: "date",
  board: "board row",
  start_min: "start",
  minutes: "length",
};

async function describeAudit(db: Db, rows: AuditRow[]): Promise<AuditView[]> {
  const projectIds = new Set<string>();
  const personIds = new Set<string>();
  const parsed = rows.map((r) => {
    const before = parseJson<Record<string, any> | null>(r.before, null);
    const after = parseJson<Record<string, any> | null>(r.after, null);
    const row = after ?? before ?? {};
    if (r.table_name === "projects") projectIds.add(r.row_id);
    if (r.table_name === "people") personIds.add(r.row_id);
    if (row.project_id) projectIds.add(row.project_id);
    if (row.person_id) personIds.add(row.person_id);
    return { r, before, after, row };
  });
  const projectNames = await nameMap(db, "projects", "title", [...projectIds]);
  const personNames = await nameMap(db, "people", "name", [...personIds]);

  return parsed.map(({ r, before, after, row }) => {
    const who = actorLabel(r.actor);
    const project = row.project_id ? projectNames.get(row.project_id) ?? "a project" : null;
    let thing = "";
    let link: string | null = null;
    switch (r.table_name) {
      case "projects":
        thing = row.title ?? projectNames.get(r.row_id) ?? "a project";
        link = `/projects/${r.row_id}`;
        break;
      case "people":
        thing = row.name ?? personNames.get(r.row_id) ?? "a person";
        link = `/people/${r.row_id}`;
        break;
      case "entries":
        thing = `${KIND_LABEL[row.kind] ?? "an entry"}${row.title ? ` (“${row.title}”)` : ""}`;
        link = row.project_id ? `/projects/${row.project_id}` : null;
        break;
      case "tasks":
        thing = `task “${row.title}”`;
        link = row.project_id ? `/projects/${row.project_id}` : null;
        break;
      case "links":
        thing = `link “${row.label}”`;
        link = row.project_id ? `/projects/${row.project_id}` : null;
        break;
      case "project_people":
        thing = personNames.get(row.person_id) ?? "a person";
        link = `/projects/${row.project_id}`;
        break;
      case "digests":
        thing = `the digest for ${row.run_date}`;
        link = "/";
        break;
      case "time_blocks":
        thing = `a block of time on ${row.day}`;
        link = "/";
        break;
      case "daily_logs":
        thing = `the log for ${row.day}`;
        link = "/log";
        break;
      case "settings":
        thing = `setting ${row.key}`;
        link = "/settings";
        break;
      case "queue_items":
        thing = `${QUEUE_LABEL[row.kind] ?? "an item"} “${row.title}”`;
        link = "/";
        break;
      case "connection_secrets":
        thing = SECRET_LABEL[row.key] ?? "a connection key";
        link = "/settings";
        break;
      case "google_accounts":
        thing = `the Google account ${row.email}`;
        link = "/settings";
        break;
      case "one_on_ones":
        thing = `the 1:1 with ${personNames.get(row.person_id) ?? "someone"}`;
        link = `/people/${row.person_id}`;
        break;
      case "agenda_items":
        thing = `“${row.title}”`;
        link = `/people/${row.person_id}`;
        break;
      case "runs":
        thing = String(row.name ?? "an automation").replace(/-/g, " ");
        link = "/settings";
        break;
      case "tags":
      case "project_tags":
      case "task_tags":
      case "entry_tags":
        thing = "tags";
        link = row.project_id ? `/projects/${row.project_id}` : row.task_id ? "/tasks" : null;
        break;
      default:
        thing = r.table_name;
    }

    let summary: string;
    const on = project && !["projects", "people"].includes(r.table_name) ? ` on ${project}` : "";
    switch (r.action) {
      case "create":
        if (r.table_name === "entries") summary = `${who} added ${thing}${project ? ` to ${project}` : ""}`;
        else if (r.table_name === "project_people") summary = `${who} linked ${thing} to ${project}`;
        else if (r.table_name === "projects") summary = `${who} created project ${thing}`;
        else if (r.table_name === "digests") summary = `${who} saved ${thing}`;
        else if (r.table_name === "daily_logs") summary = `${who} started ${thing}`;
        else if (r.table_name === "queue_items") summary = `${who} queued ${thing}`;
        else if (r.table_name === "one_on_ones") summary = `${who} started ${thing}`;
        else if (r.table_name === "connection_secrets") summary = `${who} saved ${thing}`;
        else if (r.table_name === "google_accounts") summary = `${who} connected ${thing}`;
        else if (r.table_name === "agenda_items")
          summary = `${who} added ${thing} to the list for ${personNames.get(row.person_id) ?? "someone"}`;
        else if (r.table_name === "runs") summary = `${who} ran the ${thing}${row.summary ? `: ${row.summary}` : ""}`;
        else summary = `${who} added ${thing}${on}`;
        break;
      case "update": {
        let keys = before && after ? changedKeys(before, after).filter((k) => !["updated_at", "last_activity_at", "resolved_at"].includes(k)) : [];
        // A board move changes order and status together; describe it as a move.
        if (keys.length > 1) keys = keys.filter((k) => k !== "sort_order");
        if (r.table_name === "daily_logs") {
          // The written-up day changed, or he only jotted something down.
          summary = keys.includes("body") ? `${who} wrote up ${thing}` : `${who} added a note to ${thing}`;
        } else if (r.table_name === "agenda_items" && keys.includes("status")) {
          const to = String(after?.status);
          const whose = personNames.get(row.person_id) ?? "someone";
          summary = to === "open" ? `${who} reopened ${thing} for ${whose}` : `${who} ${to === "done" ? "checked off" : "dropped"} ${thing} for ${whose}`;
        } else if (r.table_name === "queue_items" && keys.includes("status")) {
          const to = String(after?.status);
          summary =
            to === "open"
              ? `${who} reopened ${thing}`
              : after?.task_id && !before?.task_id
                ? `${who} turned ${thing} into a task`
                : `${who} ${to === "done" ? "cleared" : "dismissed"} ${thing}`;
        } else if (r.table_name === "queue_items" && keys.length === 1 && keys[0] === "snoozed_until") {
          summary = after?.snoozed_until ? `${who} snoozed ${thing} until ${after.snoozed_until}` : `${who} brought back ${thing}`;
        } else if (keys.length === 1 && keys[0] === "status") {
          summary = `${who} moved ${thing}${on} to ${String(after?.status).replace("_", " ")}`;
        } else {
          const names = keys.map((k) => FIELD_LABEL[k] ?? k).slice(0, 4).join(", ");
          summary = `${who} changed ${names || "details"} on ${thing}${on}`;
        }
        break;
      }
      case "archive":
        summary = `${who} archived ${thing}`;
        break;
      case "restore":
        summary = `${who} restored ${thing}${on}`;
        break;
      case "delete_soft":
        if (r.table_name === "connection_secrets" || r.table_name === "google_accounts") {
          summary = `${who} ${r.table_name === "google_accounts" ? "disconnected" : "removed"} ${thing}`;
          break;
        }
        summary =
          r.table_name === "project_people"
            ? `${who} removed ${thing} from ${project}`
            : `${who} deleted ${thing}${on}`;
        break;
    }
    const def = tableDef(r.table_name);
    const canUndo = !r.undone_at && !(r.action === "create" && !def.soft && !def.join) && !NO_UNDO.has(r.table_name);
    return {
      id: r.id,
      at: r.at,
      actor: r.actor,
      actor_label: who,
      action: r.action,
      table_name: r.table_name,
      row_id: r.row_id,
      summary,
      link,
      undone_at: r.undone_at,
      can_undo: canUndo,
    };
  });
}

async function nameMap(db: Db, table: "projects" | "people", col: string, ids: string[]) {
  const map = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const rows = await db.all<{ id: string; n: string }>(
      `SELECT id, ${col} AS n FROM ${table} WHERE id IN (${placeholders(chunk.length)})`,
      chunk,
    );
    for (const r of rows) map.set(r.id, r.n);
  }
  return map;
}

export type UndoResult = { ok: true; message: string } | { ok: false; error: string };

/** Reverse one audit entry. Only fields that entry changed are reverted, so later edits stay. */
export async function undoAudit(ctx: Ctx, auditId: string): Promise<UndoResult> {
  const a = await ctx.db.first<AuditRow>(`SELECT * FROM audit_log WHERE id = ?`, [auditId]);
  if (!a) return { ok: false, error: `No audit entry ${auditId}` };
  if (a.undone_at) return { ok: false, error: "That change was already undone" };
  if (NO_UNDO.has(a.table_name)) return { ok: false, error: "Connections are changed in Settings, not undone from here" };
  const def = tableDef(a.table_name);
  const before = parseJson<Record<string, unknown> | null>(a.before, null);
  const after = parseJson<Record<string, unknown> | null>(a.after, null);
  const undoCtx: Ctx = { db: ctx.db, actor: `undo:${ctx.actor}` };
  const now = nowIso();

  if (a.action === "create") {
    if (!after) return { ok: false, error: "Nothing recorded to undo" };
    if (def.join) {
      await deleteJoinRow(ctx.db, a.table_name, after);
      await recordAudit(undoCtx, "delete_soft", a.table_name, after, null);
    } else if (def.soft) {
      const current = await getRow<Record<string, unknown>>(ctx.db, a.table_name, after);
      if (!current) return { ok: false, error: "The row no longer exists" };
      const patch: Record<string, unknown> = { [def.soft]: now };
      if (a.table_name === "projects" || a.table_name === "people") patch.updated_at = now;
      await updateRow(ctx.db, a.table_name, current, patch);
      await recordAudit(
        undoCtx,
        def.soft === "archived_at" ? "archive" : "delete_soft",
        a.table_name,
        current,
        { ...current, ...patch },
      );
    } else {
      return { ok: false, error: `Creating a row in ${a.table_name} cannot be undone` };
    }
  } else if (a.action === "delete_soft" && def.join) {
    if (!before) return { ok: false, error: "Nothing recorded to undo" };
    await insertRow(ctx.db, a.table_name, before, true);
    await recordAudit(undoCtx, "create", a.table_name, null, before);
  } else {
    // update, archive, restore, delete_soft on a normal table: put back the old values.
    if (!before || !after) return { ok: false, error: "Nothing recorded to undo" };
    const current = await getRow<Record<string, unknown>>(ctx.db, a.table_name, before);
    if (!current) return { ok: false, error: "The row no longer exists" };
    const keys = changedKeys(before, after).filter((k) => !k.startsWith("_"));
    const patch: Record<string, unknown> = {};
    for (const k of keys) patch[k] = before[k] ?? null;
    if ("updated_at" in current) patch.updated_at = now;
    await updateRow(ctx.db, a.table_name, current, patch);
    const restored = { ...current, ...patch };
    const action: AuditAction =
      a.action === "archive" || a.action === "delete_soft" ? "restore" : a.action === "restore" ? "archive" : "update";
    await recordAudit(undoCtx, action, a.table_name, current, restored);
  }

  await ctx.db.run(`UPDATE audit_log SET undone_at = ?, undone_by = ? WHERE id = ?`, [now, ctx.actor, auditId]);
  return { ok: true, message: "Undone" };
}

/** Undo the most recent change made by an actor (for the MCP undo_last tool). */
export async function lastAuditBy(db: Db, actor: string): Promise<AuditRow | null> {
  return db.first<AuditRow>(
    `SELECT * FROM audit_log WHERE actor = ? AND undone_at IS NULL ORDER BY at DESC, id DESC LIMIT 1`,
    [actor],
  );
}
