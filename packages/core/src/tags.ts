// tags.ts
// Tags on tasks and notes. The owner organizes by tag more than by project, so anything can carry
// tags and one tag gathers everything that has it (a "tag view").
//
// Two ways a tag gets on something:
//   - it is given as a list (the tag editor on a task, or an AI passing `tags`);
//   - it is typed as #hashtag. In a task's title the hashtag is lifted out and becomes a tag
//     ("Call the registrar #records" is saved as "Call the registrar", tagged records). In a
//     note the text is left as written and the hashtags are read from it.
// Project tags are older and live in projects.ts (setProjectTags); they share the `tags` table.

import { recordAudit } from "./audit";
import type { Db } from "./db";
import { placeholders } from "./db";
import { deleteJoinRow, insertRow } from "./rows";
import type { Ctx } from "./types";
import { newId, nowIso } from "./util";

const HASHTAG = /(^|\s)#([\p{L}\p{N}][\p{L}\p{N}_-]{0,39})/gu;

/** The #hashtags in a piece of text, without the "#". */
export function hashtags(text: string): string[] {
  return [...new Set([...text.matchAll(HASHTAG)].map((m) => m[2]!))];
}

/** The text with its #hashtags taken out. If nothing else is left, the text is returned as it was. */
export function stripHashtags(text: string): string {
  const rest = text.replace(HASHTAG, "$1").replace(/\s{2,}/g, " ").trim();
  return rest || text.trim();
}

const JOIN = {
  task: { table: "task_tags", col: "task_id" },
  entry: { table: "entry_tags", col: "entry_id" },
} as const;
export type Taggable = keyof typeof JOIN;

/** Replace the tags on a task or a note with this list of names, creating tags as needed. */
export async function setItemTags(ctx: Ctx, kind: Taggable, id: string, names: string[]): Promise<void> {
  const { table, col } = JOIN[kind];
  const wanted = new Map<string, string>();
  for (const n of names) {
    const name = n.trim().replace(/^#/, "");
    if (name) wanted.set(name.toLowerCase(), name);
  }
  const current = await ctx.db.all<{ tag_id: string; name: string }>(`SELECT j.tag_id, t.name FROM ${table} j JOIN tags t ON t.id = j.tag_id WHERE j.${col} = ?`, [id]);
  const have = new Set(current.map((c) => c.name.toLowerCase()));
  for (const c of current) {
    if (wanted.has(c.name.toLowerCase())) continue;
    const row = { [col]: id, tag_id: c.tag_id };
    await deleteJoinRow(ctx.db, table, row);
    await recordAudit(ctx, "delete_soft", table, row, null);
  }
  for (const [key, name] of wanted) {
    if (have.has(key)) continue;
    let tag = await ctx.db.first<{ id: string }>(`SELECT id FROM tags WHERE name = ? COLLATE NOCASE`, [name]);
    if (!tag) {
      const t = { id: newId("tag"), name, created_at: nowIso() };
      await insertRow(ctx.db, "tags", t);
      await recordAudit(ctx, "create", "tags", null, t);
      tag = t;
    }
    const row = { [col]: id, tag_id: tag.id };
    await insertRow(ctx.db, table, row, true);
    await recordAudit(ctx, "create", table, null, row);
  }
}

/** The tag names on each of these tasks or notes, keyed by id. */
export async function tagsFor(db: Db, kind: Taggable, ids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const { table, col } = JOIN[kind];
  // D1 allows 100 bound values in one statement.
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const rows = await db.all<{ id: string; name: string }>(`SELECT j.${col} AS id, t.name FROM ${table} j JOIN tags t ON t.id = j.tag_id WHERE j.${col} IN (${placeholders(chunk.length)}) ORDER BY t.name COLLATE NOCASE`, chunk);
    for (const r of rows) out.set(r.id, [...(out.get(r.id) ?? []), r.name]);
  }
  return out;
}

export interface TagCount {
  id: string;
  name: string;
  /** Open tasks, notes and projects that carry the tag. */
  tasks: number;
  notes: number;
  projects: number;
  count: number;
}

/** Every tag with how much carries it, most used first. Tags on nothing are left out. */
export async function listTags(db: Db): Promise<TagCount[]> {
  const rows = await db.all<Omit<TagCount, "count">>(
    `SELECT t.id, t.name,
       (SELECT COUNT(*) FROM task_tags j JOIN tasks k ON k.id = j.task_id WHERE j.tag_id = t.id AND k.deleted_at IS NULL AND k.status != 'done') AS tasks,
       (SELECT COUNT(*) FROM entry_tags j JOIN entries e ON e.id = j.entry_id WHERE j.tag_id = t.id AND e.deleted_at IS NULL) AS notes,
       (SELECT COUNT(*) FROM project_tags j JOIN projects p ON p.id = j.project_id WHERE j.tag_id = t.id AND p.archived_at IS NULL) AS projects
     FROM tags t`,
  );
  return rows
    .map((r) => ({ ...r, tasks: Number(r.tasks), notes: Number(r.notes), projects: Number(r.projects), count: Number(r.tasks) + Number(r.notes) + Number(r.projects) }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
