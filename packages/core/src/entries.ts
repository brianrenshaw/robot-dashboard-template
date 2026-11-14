// entries.ts
// The timeline: notes, emails, meetings, calls, decisions and so on.

import { recordAudit } from "./audit";
import type { Db, Param } from "./db";
import { placeholders } from "./db";
import { NotFoundError } from "./errors";
import { changedKeys, insertRow, updateRow } from "./rows";
import { entryCreateSchema, entryUpdateSchema } from "./schemas";
import { touchPeople, touchProjects } from "./touch";
import { hashtags, setItemTags, tagsFor } from "./tags";
import type { Area, Ctx, Entry, EntryKind, EntrySource, PersonRef } from "./types";
import { newId, nowIso } from "./util";

export interface EntryView extends Entry {
  people: PersonRef[];
  /** The #hashtags written in the note's title or text. */
  tags: string[];
  project_title: string | null;
  project_slug: string | null;
  project_area: Area | null;
  extra_project_ids: string[];
}

/** "web" writes come from the website; "mcp:..." from an AI client; "script:..." from scripts. */
export function sourceForActor(actor: string): EntrySource {
  if (actor.startsWith("mcp:")) return "mcp";
  if (actor.startsWith("script:") || actor.startsWith("sync:") || actor.startsWith("import:")) return "import";
  return "web";
}

async function assertExists(db: Db, table: "projects" | "people", ids: string[]) {
  const list = [...new Set(ids)];
  if (!list.length) return;
  const rows = await db.all<{ id: string }>(
    `SELECT id FROM ${table} WHERE id IN (${placeholders(list.length)})`,
    list,
  );
  const found = new Set(rows.map((r) => r.id));
  const missing = list.filter((id) => !found.has(id));
  if (missing.length) throw new NotFoundError(`No ${table === "projects" ? "project" : "person"} with id ${missing.join(", ")}`);
}

export async function getEntry(db: Db, id: string): Promise<EntryView | null> {
  const e = await db.first<Entry>(`SELECT * FROM entries WHERE id = ?`, [id]);
  if (!e) return null;
  return (await attachEntryInfo(db, [e]))[0]!;
}

/**
 * Add a timeline entry. If source_ref is given and an entry with that source_ref already
 * exists, the existing entry is returned instead of a duplicate.
 */
export async function addEntry(ctx: Ctx, input: unknown): Promise<{ entry: EntryView; duplicate: boolean }> {
  const data = entryCreateSchema.parse(input);
  if (data.source_ref) {
    const existing = await ctx.db.first<Entry>(
      `SELECT * FROM entries WHERE source_ref = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1`,
      [data.source_ref],
    );
    if (existing) return { entry: (await attachEntryInfo(ctx.db, [existing]))[0]!, duplicate: true };
  }
  const projectIds = [data.project_id, ...data.extra_project_ids].filter((x): x is string => !!x);
  await assertExists(ctx.db, "projects", projectIds);
  await assertExists(ctx.db, "people", data.person_ids);

  const now = nowIso();
  const occurred = data.occurred_at ? new Date(data.occurred_at).toISOString() : now;
  const row: Entry = {
    id: newId("ent"),
    project_id: data.project_id,
    kind: data.kind,
    title: data.title,
    body: data.body,
    url: data.url,
    source: data.source === "web" ? sourceForActor(ctx.actor) : data.source,
    source_ref: data.source_ref,
    occurred_at: occurred,
    created_at: now,
    created_by: ctx.actor,
    deleted_at: null,
  };
  await insertRow(ctx.db, "entries", row as any);
  const extra = [...new Set(data.extra_project_ids.filter((id) => id !== data.project_id))];
  for (const pid of extra) await insertRow(ctx.db, "entry_projects", { entry_id: row.id, project_id: pid }, true);
  const people = [...new Set(data.person_ids)];
  for (const pid of people) await insertRow(ctx.db, "entry_people", { entry_id: row.id, person_id: pid }, true);
  await recordAudit(ctx, "create", "entries", null, { ...row, _person_ids: people, _project_ids: extra });
  await touchProjects(ctx.db, [row.project_id, ...extra]);
  await touchPeople(ctx.db, people, occurred);
  const typed = hashtags(`${row.title} ${row.body}`);
  if (typed.length) await setItemTags(ctx, "entry", row.id, typed);
  return { entry: (await getEntry(ctx.db, row.id))!, duplicate: false };
}

export async function updateEntry(ctx: Ctx, id: string, input: unknown): Promise<EntryView> {
  const patch = entryUpdateSchema.parse(input);
  const before = await ctx.db.first<Entry>(`SELECT * FROM entries WHERE id = ?`, [id]);
  if (!before) throw new NotFoundError(`No entry with id ${id}`);
  const { person_ids, ...fields } = patch;
  if (fields.project_id) await assertExists(ctx.db, "projects", [fields.project_id]);
  if (fields.occurred_at) fields.occurred_at = new Date(fields.occurred_at).toISOString();
  const next = { ...before, ...fields } as Entry;
  const beforePeople = (await ctx.db.all<{ person_id: string }>(`SELECT person_id FROM entry_people WHERE entry_id = ?`, [id])).map(
    (r) => r.person_id,
  );
  let afterPeople = beforePeople;
  if (person_ids) {
    await assertExists(ctx.db, "people", person_ids);
    afterPeople = [...new Set(person_ids)];
    await ctx.db.run(`DELETE FROM entry_people WHERE entry_id = ?`, [id]);
    for (const pid of afterPeople) await insertRow(ctx.db, "entry_people", { entry_id: id, person_id: pid }, true);
    await touchPeople(ctx.db, afterPeople, next.occurred_at);
  }
  const changed = changedKeys(before as any, next as any);
  if (changed.length || person_ids) {
    await updateRow(ctx.db, "entries", before as any, next as any);
    await recordAudit(
      ctx,
      "update",
      "entries",
      { ...before, _person_ids: beforePeople },
      { ...next, _person_ids: afterPeople },
    );
    await touchProjects(ctx.db, [before.project_id, next.project_id]);
  }
  // The tags follow the text: edit a #hashtag out of a note and the tag comes off.
  if (changed.includes("title") || changed.includes("body")) await setItemTags(ctx, "entry", id, hashtags(`${next.title} ${next.body}`));
  return (await getEntry(ctx.db, id))!;
}

export async function deleteEntry(ctx: Ctx, id: string): Promise<void> {
  const before = await ctx.db.first<Entry>(`SELECT * FROM entries WHERE id = ?`, [id]);
  if (!before) throw new NotFoundError(`No entry with id ${id}`);
  if (before.deleted_at) return;
  const next = { ...before, deleted_at: nowIso() };
  await updateRow(ctx.db, "entries", before as any, next);
  await recordAudit(ctx, "delete_soft", "entries", before as any, next);
}

export interface TimelineFilter {
  projectId?: string;
  personId?: string;
  kinds?: EntryKind[];
  areas?: Area[];
  since?: string;
  before?: string;
  limit?: number;
}

export async function listTimeline(db: Db, f: TimelineFilter = {}): Promise<EntryView[]> {
  const where: string[] = ["e.deleted_at IS NULL"];
  const params: Param[] = [];
  if (f.projectId) {
    where.push(`(e.project_id = ? OR EXISTS (SELECT 1 FROM entry_projects ep WHERE ep.entry_id = e.id AND ep.project_id = ?))`);
    params.push(f.projectId, f.projectId);
  }
  if (f.personId) {
    where.push(`EXISTS (SELECT 1 FROM entry_people x WHERE x.entry_id = e.id AND x.person_id = ?)`);
    params.push(f.personId);
  }
  if (f.kinds?.length) {
    where.push(`e.kind IN (${placeholders(f.kinds.length)})`);
    params.push(...f.kinds);
  }
  if (f.areas?.length) {
    // Entries with no project always show. Entries on a project follow the area toggles.
    where.push(`(e.project_id IS NULL OR EXISTS (SELECT 1 FROM projects ap WHERE ap.id = e.project_id
      AND ap.area IN (${placeholders(f.areas.length)})))`);
    params.push(...f.areas);
  }
  if (f.since) {
    where.push(`e.occurred_at >= ?`);
    params.push(f.since);
  }
  if (f.before) {
    where.push(`e.occurred_at < ?`);
    params.push(f.before);
  }
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 500);
  const rows = await db.all<Entry>(
    `SELECT e.* FROM entries e WHERE ${where.join(" AND ")} ORDER BY e.occurred_at DESC, e.id DESC LIMIT ${limit}`,
    params,
  );
  return attachEntryInfo(db, rows);
}

/** Entries written (created_at) since a time, newest first. */
export async function entriesCreatedSince(db: Db, since: string, limit = 200): Promise<EntryView[]> {
  const rows = await db.all<Entry>(
    `SELECT * FROM entries WHERE deleted_at IS NULL AND created_at >= ? ORDER BY created_at DESC LIMIT ${Math.min(limit, 1000)}`,
    [since],
  );
  return attachEntryInfo(db, rows);
}

export async function attachEntryInfo(db: Db, rows: Entry[]): Promise<EntryView[]> {
  if (!rows.length) return [];
  const people = new Map<string, PersonRef[]>();
  const extras = new Map<string, string[]>();
  const projects = new Map<string, { title: string; slug: string; area: Area }>();
  for (let i = 0; i < rows.length; i += 90) {
    const chunk = rows.slice(i, i + 90);
    const ids = chunk.map((r) => r.id);
    const ph = placeholders(ids.length);
    const ppl = await db.all<PersonRef & { entry_id: string }>(
      `SELECT ep.entry_id, p.id, p.name, p.slug, p.avatar_url FROM entry_people ep
       JOIN people p ON p.id = ep.person_id WHERE ep.entry_id IN (${ph}) ORDER BY p.name`,
      ids,
    );
    for (const { entry_id, ...ref } of ppl) people.set(entry_id, [...(people.get(entry_id) ?? []), ref]);
    const ex = await db.all<{ entry_id: string; project_id: string }>(
      `SELECT entry_id, project_id FROM entry_projects WHERE entry_id IN (${ph})`,
      ids,
    );
    for (const r of ex) extras.set(r.entry_id, [...(extras.get(r.entry_id) ?? []), r.project_id]);
    const pids = [...new Set(chunk.map((r) => r.project_id).filter((x): x is string => !!x))];
    if (pids.length) {
      const pr = await db.all<{ id: string; title: string; slug: string; area: Area }>(
        `SELECT id, title, slug, area FROM projects WHERE id IN (${placeholders(pids.length)})`,
        pids,
      );
      for (const p of pr) projects.set(p.id, p);
    }
  }
  const tags = await tagsFor(db, "entry", rows.map((r) => r.id));
  return rows.map((r) => {
    const p = r.project_id ? projects.get(r.project_id) : undefined;
    return {
      ...r,
      people: people.get(r.id) ?? [],
      tags: tags.get(r.id) ?? [],
      project_title: p?.title ?? null,
      project_slug: p?.slug ?? null,
      project_area: p?.area ?? null,
      extra_project_ids: extras.get(r.id) ?? [],
    };
  });
}
