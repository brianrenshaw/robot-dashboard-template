// rows.ts
// Generic insert and update helpers plus the table registry. Column names are checked
// against this registry so no user input ever becomes part of SQL text.

import type { Db, Param } from "./db";

interface TableDef {
  pk: string[];
  columns: string[];
  /** Column set when a row is "removed". Rows are never hard deleted, except join rows. */
  soft?: "archived_at" | "deleted_at";
  /** Join tables (many to many). Unlinking deletes the join row; the audit log keeps it. */
  join?: boolean;
}

export const TABLES: Record<string, TableDef> = {
  projects: {
    pk: ["id"],
    soft: "archived_at",
    columns: [
      "id", "title", "slug", "area", "status", "priority", "summary", "notes", "next_step",
      "waiting_on", "waiting_on_person_id", "start_date", "due_date", "color", "cover_url",
      "sort_order", "last_activity_at", "created_at", "updated_at", "archived_at",
    ],
  },
  people: {
    pk: ["id"],
    soft: "archived_at",
    columns: [
      "id", "name", "slug", "email", "aliases", "role", "organization", "area", "notes", "avatar_url",
      "last_contact_at", "created_at", "updated_at", "archived_at",
    ],
  },
  project_people: { pk: ["project_id", "person_id"], join: true, columns: ["project_id", "person_id", "role"] },
  entries: {
    pk: ["id"],
    soft: "deleted_at",
    columns: [
      "id", "project_id", "kind", "title", "body", "url", "source", "source_ref", "occurred_at",
      "created_at", "created_by", "deleted_at",
    ],
  },
  entry_people: { pk: ["entry_id", "person_id"], join: true, columns: ["entry_id", "person_id"] },
  entry_projects: { pk: ["entry_id", "project_id"], join: true, columns: ["entry_id", "project_id"] },
  tasks: {
    pk: ["id"],
    soft: "deleted_at",
    columns: [
      "id", "project_id", "area", "title", "notes", "status", "due_date", "person_id", "side", "discuss", "source_ref", "hide_until", "waiting_since", "sort_order", "done_at", "board", "meeting_ref",
      "created_at", "updated_at", "deleted_at",
    ],
  },
  links: {
    pk: ["id"],
    soft: "deleted_at",
    columns: ["id", "project_id", "label", "url", "kind", "pinned", "created_at", "deleted_at"],
  },
  tags: { pk: ["id"], columns: ["id", "name", "created_at"] },
  project_tags: { pk: ["project_id", "tag_id"], join: true, columns: ["project_id", "tag_id"] },
  views: { pk: ["id"], soft: "deleted_at", columns: ["id", "name", "filter", "pinned", "created_at", "created_by", "updated_at", "deleted_at"] },
  task_tags: { pk: ["task_id", "tag_id"], join: true, columns: ["task_id", "tag_id"] },
  task_people: { pk: ["task_id", "person_id"], join: true, columns: ["task_id", "person_id", "waiting", "one_on_one"] },
  entry_tags: { pk: ["entry_id", "tag_id"], join: true, columns: ["entry_id", "tag_id"] },
  digests: { pk: ["id"], columns: ["id", "run_date", "body", "created_by", "created_at"] },
  time_blocks: { pk: ["id"], soft: "deleted_at", columns: ["id", "task_id", "day", "start_min", "minutes", "created_by", "created_at", "updated_at", "deleted_at"] },
  daily_logs: { pk: ["day"], columns: ["day", "body", "notes", "created_by", "created_at", "updated_at"] },
  settings: { pk: ["key"], columns: ["key", "value"] },
  queue_items: {
    pk: ["id"],
    soft: "deleted_at",
    columns: [
      "id", "kind", "status", "area", "project_id", "person_id", "title", "summary", "draft",
      "task_title", "due_date", "url", "source_ref", "mail_account", "from_name", "received_at",
      "snoozed_until", "task_id", "created_at", "created_by", "updated_at", "resolved_at", "deleted_at",
    ],
  },
  one_on_ones: {
    pk: ["person_id"],
    soft: "archived_at",
    columns: ["person_id", "relationship", "cadence_days", "next_at", "notes", "created_at", "updated_at", "archived_at"],
  },
  agenda_items: {
    pk: ["id"],
    soft: "deleted_at",
    columns: [
      "id", "person_id", "kind", "owner", "title", "notes", "status", "project_id", "entry_id", "due_date",
      "url", "source_ref", "created_at", "created_by", "updated_at", "closed_at", "deleted_at",
    ],
  },
  // Connections. These are written by connections.ts and calsync.ts, not by the generic helpers,
  // and their audit rows (where they have any) never carry a secret value. None can be undone.
  connection_secrets: { pk: ["key"], columns: ["key", "hint"] },
  google_accounts: { pk: ["email"], columns: ["email", "area"] },
  runs: { pk: ["id"], columns: ["id", "name", "summary", "ran_at", "created_by"] },
};

export function tableDef(table: string): TableDef {
  const def = TABLES[table];
  if (!def) throw new Error(`Unknown table ${table}`);
  return def;
}

/** Keep only real columns, drop keys starting with "_" (extra info stored in audit JSON). */
export function cleanRow(table: string, row: Record<string, unknown>): Record<string, Param> {
  const def = tableDef(table);
  const out: Record<string, Param> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!def.columns.includes(k)) continue;
    out[k] = toParam(v);
  }
  return out;
}

function toParam(v: unknown): Param {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" || typeof v === "string") return v;
  return JSON.stringify(v);
}

/** Row ID used in the audit log. Join tables use "a:b". */
export function rowIdOf(table: string, row: Record<string, unknown>): string {
  return tableDef(table)
    .pk.map((k) => String(row[k]))
    .join(":");
}

export async function insertRow(db: Db, table: string, row: Record<string, unknown>, orIgnore = false) {
  const clean = cleanRow(table, row);
  const cols = Object.keys(clean);
  const sql = `INSERT ${orIgnore ? "OR IGNORE " : ""}INTO ${table} (${cols.join(", ")}) VALUES (${cols
    .map(() => "?")
    .join(", ")})`;
  await db.run(sql, cols.map((c) => clean[c]!));
}

export async function updateRow(db: Db, table: string, pkRow: Record<string, unknown>, patch: Record<string, unknown>) {
  const def = tableDef(table);
  const clean = cleanRow(table, patch);
  for (const k of def.pk) delete clean[k];
  const cols = Object.keys(clean);
  if (cols.length === 0) return;
  const where = def.pk.map((k) => `${k} = ?`).join(" AND ");
  await db.run(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE ${where}`, [
    ...cols.map((c) => clean[c]!),
    ...def.pk.map((k) => toParam(pkRow[k])),
  ]);
}

export async function deleteJoinRow(db: Db, table: string, row: Record<string, unknown>) {
  const def = tableDef(table);
  if (!def.join) throw new Error(`Refusing to hard delete from ${table}`);
  await db.run(
    `DELETE FROM ${table} WHERE ${def.pk.map((k) => `${k} = ?`).join(" AND ")}`,
    def.pk.map((k) => toParam(row[k])),
  );
}

export async function getRow<T>(db: Db, table: string, pkRow: Record<string, unknown>): Promise<T | null> {
  const def = tableDef(table);
  return db.first<T>(
    `SELECT * FROM ${table} WHERE ${def.pk.map((k) => `${k} = ?`).join(" AND ")}`,
    def.pk.map((k) => toParam(pkRow[k])),
  );
}

/** Which keys differ between two rows (shallow). */
export function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return Object.keys(after).filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null));
}
