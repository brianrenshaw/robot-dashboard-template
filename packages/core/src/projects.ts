// projects.ts
// Projects, the people linked to them, and their tags.

import { recordAudit } from "./audit";
import type { Db, Param } from "./db";
import { placeholders } from "./db";
import { NotFoundError } from "./errors";
import { changedKeys, deleteJoinRow, insertRow, updateRow } from "./rows";
import { projectCreateSchema, projectUpdateSchema } from "./schemas";
import type { Area, Ctx, Link, PersonRef, Project, ProjectRole, ProjectStatus, Task } from "./types";
import { newId, nowIso, slugify } from "./util";
import { touchProjects } from "./touch";
import type { EntryView } from "./entries";
import { addEntry, listTimeline, sourceForActor } from "./entries";

export interface ProjectCard extends Project {
  people: PersonRef[];
  tags: string[];
  open_task_count: number;
  /** How many of those open tasks are waiting on someone else. */
  waiting_task_count: number;
  /** The person named in waiting_on_person_id, so lists can show who has the next move. */
  waiting_on_person: PersonRef | null;
}

export interface ProjectDetail extends ProjectCard {
  tasks: (Task & { person: PersonRef | null })[];
  links: Link[];
  timeline: EntryView[];
}

export interface ProjectFilter {
  areas?: Area[];
  statuses?: ProjectStatus[];
  person?: string;
  tag?: string;
  q?: string;
  includeArchived?: boolean;
  sort?: "board" | "priority" | "due" | "activity" | "title" | "created";
  limit?: number;
}

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  idea: "Idea",
  active: "Active",
  waiting: "Waiting",
  paused: "Paused",
  done: "Done",
  archived: "Archived",
};

export async function getProject(db: Db, id: string): Promise<Project | null> {
  return db.first<Project>(`SELECT * FROM projects WHERE id = ?`, [id]);
}

async function mustGetProject(db: Db, id: string): Promise<Project> {
  const p = await getProject(db, id);
  if (!p) throw new NotFoundError(`No project with id ${id}`);
  return p;
}

export async function uniqueSlug(db: Db, table: "projects" | "people", base: string, excludeId?: string) {
  const root = slugify(base);
  let slug = root;
  for (let n = 2; n < 1000; n++) {
    const row = await db.first<{ id: string }>(`SELECT id FROM ${table} WHERE slug = ?`, [slug]);
    if (!row || row.id === excludeId) return slug;
    slug = `${root}-${n}`;
  }
  return `${root}-${Date.now()}`;
}

const SORTS: Record<NonNullable<ProjectFilter["sort"]>, string> = {
  board: "p.sort_order ASC, p.priority ASC, p.title ASC",
  priority: "p.priority ASC, (p.due_date IS NULL) ASC, p.due_date ASC, p.title ASC",
  due: "(p.due_date IS NULL) ASC, p.due_date ASC, p.priority ASC",
  activity: "p.last_activity_at DESC",
  title: "p.title COLLATE NOCASE ASC",
  created: "p.created_at DESC",
};

export async function listProjects(db: Db, f: ProjectFilter = {}): Promise<ProjectCard[]> {
  const where: string[] = [];
  const params: Param[] = [];
  if (!f.includeArchived) where.push("p.archived_at IS NULL AND p.status != 'archived'");
  if (f.areas?.length) {
    where.push(`p.area IN (${placeholders(f.areas.length)})`);
    params.push(...f.areas);
  }
  if (f.statuses?.length) {
    where.push(`p.status IN (${placeholders(f.statuses.length)})`);
    params.push(...f.statuses);
  }
  if (f.person) {
    where.push(
      `(EXISTS (SELECT 1 FROM project_people pp JOIN people pe ON pe.id = pp.person_id
        WHERE pp.project_id = p.id AND (pe.id = ? OR pe.slug = ?)) OR p.waiting_on_person_id = ?)`,
    );
    params.push(f.person, f.person, f.person);
  }
  if (f.tag) {
    where.push(
      `EXISTS (SELECT 1 FROM project_tags pt JOIN tags t ON t.id = pt.tag_id
        WHERE pt.project_id = p.id AND (t.id = ? OR t.name = ? COLLATE NOCASE))`,
    );
    params.push(f.tag, f.tag);
  }
  if (f.q?.trim()) {
    const like = `%${f.q.trim()}%`;
    where.push(
      `(p.title LIKE ? OR p.summary LIKE ? OR p.next_step LIKE ? OR p.waiting_on LIKE ? OR p.notes LIKE ?)`,
    );
    params.push(like, like, like, like, like);
  }
  const limit = Math.min(Math.max(f.limit ?? 500, 1), 2000);
  const rows = await db.all<Project>(
    `SELECT p.* FROM projects p ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY ${SORTS[f.sort ?? "board"]} LIMIT ${limit}`,
    params,
  );
  return attachCardInfo(db, rows);
}

export async function attachCardInfo(db: Db, rows: Project[]): Promise<ProjectCard[]> {
  if (!rows.length) return [];
  const people = new Map<string, PersonRef[]>();
  const tags = new Map<string, string[]>();
  const counts = new Map<string, number>();
  const waitingTasks = new Map<string, number>();
  for (let i = 0; i < rows.length; i += 90) {
    const ids = rows.slice(i, i + 90).map((r) => r.id);
    const ph = placeholders(ids.length);
    const pp = await db.all<PersonRef & { project_id: string }>(
      `SELECT pp.project_id, pp.role, pe.id, pe.name, pe.slug, pe.avatar_url
       FROM project_people pp JOIN people pe ON pe.id = pp.person_id
       WHERE pp.project_id IN (${ph}) AND pe.archived_at IS NULL
       ORDER BY CASE pp.role WHEN 'owner' THEN 0 WHEN 'collaborator' THEN 1 ELSE 2 END, pe.name`,
      ids,
    );
    for (const r of pp) {
      const { project_id, ...ref } = r;
      people.set(project_id, [...(people.get(project_id) ?? []), ref]);
    }
    const tg = await db.all<{ project_id: string; name: string }>(
      `SELECT pt.project_id, t.name FROM project_tags pt JOIN tags t ON t.id = pt.tag_id
       WHERE pt.project_id IN (${ph}) ORDER BY t.name`,
      ids,
    );
    for (const r of tg) tags.set(r.project_id, [...(tags.get(r.project_id) ?? []), r.name]);
    const tc = await db.all<{ project_id: string; n: number; w: number }>(
      `SELECT project_id, COUNT(*) AS n, SUM(CASE WHEN person_id IS NOT NULL AND side = 'theirs' THEN 1 ELSE 0 END) AS w FROM tasks
       WHERE project_id IN (${ph}) AND status != 'done' AND deleted_at IS NULL GROUP BY project_id`,
      ids,
    );
    for (const r of tc) {
      counts.set(r.project_id, Number(r.n));
      waitingTasks.set(r.project_id, Number(r.w));
    }
  }
  const waiting = new Map<string, PersonRef>();
  const waitIds = [...new Set(rows.map((r) => r.waiting_on_person_id).filter((x): x is string => !!x))];
  for (let i = 0; i < waitIds.length; i += 90) {
    const chunk = waitIds.slice(i, i + 90);
    const refs = await db.all<PersonRef>(
      `SELECT id, name, slug, avatar_url FROM people WHERE id IN (${placeholders(chunk.length)})`,
      chunk,
    );
    for (const r of refs) waiting.set(r.id, r);
  }
  return rows.map((r) => ({
    ...r,
    people: people.get(r.id) ?? [],
    tags: tags.get(r.id) ?? [],
    open_task_count: counts.get(r.id) ?? 0,
    waiting_task_count: waitingTasks.get(r.id) ?? 0,
    waiting_on_person: r.waiting_on_person_id ? waiting.get(r.waiting_on_person_id) ?? null : null,
  }));
}

export async function getProjectDetail(db: Db, id: string, timelineLimit = 50): Promise<ProjectDetail | null> {
  const p = await getProject(db, id);
  if (!p) return null;
  const [card] = await attachCardInfo(db, [p]);
  const tasks = await db.all<Task & { p_id: string | null; p_name: string | null; p_slug: string | null; p_avatar: string | null }>(
    `SELECT t.*, pe.id AS p_id, pe.name AS p_name, pe.slug AS p_slug, pe.avatar_url AS p_avatar
     FROM tasks t LEFT JOIN people pe ON pe.id = t.person_id
     WHERE t.project_id = ? AND t.deleted_at IS NULL
     ORDER BY CASE t.status WHEN 'done' THEN 1 ELSE 0 END, t.sort_order, t.created_at`,
    [id],
  );
  const links = await db.all<Link>(
    `SELECT * FROM links WHERE project_id = ? AND deleted_at IS NULL ORDER BY pinned DESC, created_at`,
    [id],
  );
  const timeline = await listTimeline(db, { projectId: id, limit: timelineLimit });
  return {
    ...card!,
    tasks: tasks.map(({ p_id, p_name, p_slug, p_avatar, ...t }) => ({
      ...t,
      person: p_id ? { id: p_id, name: p_name!, slug: p_slug!, avatar_url: p_avatar } : null,
    })),
    links,
    timeline,
  };
}

export async function createProject(ctx: Ctx, input: unknown): Promise<Project> {
  const data = projectCreateSchema.parse(input);
  const { tags, ...fields } = data;
  const now = nowIso();
  const top = await ctx.db.first<{ m: number | null }>(
    `SELECT MIN(sort_order) AS m FROM projects WHERE status = ?`,
    [fields.status],
  );
  const row: Project = {
    id: newId("prj"),
    slug: await uniqueSlug(ctx.db, "projects", fields.title),
    ...fields,
    priority: fields.priority as 1 | 2 | 3,
    sort_order: (top?.m ?? 1) - 1,
    last_activity_at: now,
    created_at: now,
    updated_at: now,
    archived_at: fields.status === "archived" ? now : null,
  };
  await insertRow(ctx.db, "projects", row as any);
  await recordAudit(ctx, "create", "projects", null, row as any);
  if (tags?.length) await setProjectTags(ctx, row.id, tags);
  return row;
}

export async function updateProject(ctx: Ctx, id: string, input: unknown): Promise<Project> {
  const patch = projectUpdateSchema.parse(input);
  const before = await mustGetProject(ctx.db, id);
  const { tags, ...fields } = patch;
  if (fields.slug && fields.slug !== before.slug) {
    fields.slug = await uniqueSlug(ctx.db, "projects", fields.slug, id);
  }
  const now = nowIso();
  const next: Project = { ...before, ...fields } as Project;
  if (fields.status === "archived" && !before.archived_at) next.archived_at = now;
  if (fields.status && fields.status !== "archived" && before.status === "archived") next.archived_at = null;
  const changed = changedKeys(before as any, next as any);
  if (changed.length) {
    const onlyOrder = changed.every((k) => k === "sort_order");
    if (!onlyOrder) {
      next.updated_at = now;
      next.last_activity_at = now;
    }
    await updateRow(ctx.db, "projects", before as any, next as any);
    await recordAudit(ctx, "update", "projects", before as any, next as any);
    if (fields.status && fields.status !== before.status) {
      await addEntry(ctx, {
        project_id: id,
        kind: "status_change",
        title: `${STATUS_LABEL[before.status]} → ${STATUS_LABEL[fields.status]}`,
        source: sourceForActor(ctx.actor),
      });
    }
  }
  if (tags) await setProjectTags(ctx, id, tags);
  return (await getProject(ctx.db, id))!;
}

export async function archiveProject(ctx: Ctx, id: string): Promise<Project> {
  const before = await mustGetProject(ctx.db, id);
  if (before.archived_at) return before;
  const now = nowIso();
  const next = { ...before, archived_at: now, updated_at: now };
  await updateRow(ctx.db, "projects", before as any, next);
  await recordAudit(ctx, "archive", "projects", before as any, next);
  return next;
}

export async function restoreProject(ctx: Ctx, id: string): Promise<Project> {
  const before = await mustGetProject(ctx.db, id);
  if (!before.archived_at && before.status !== "archived") return before;
  const now = nowIso();
  const next: Project = {
    ...before,
    archived_at: null,
    status: before.status === "archived" ? "active" : before.status,
    updated_at: now,
    last_activity_at: now,
  };
  await updateRow(ctx.db, "projects", before as any, next as any);
  await recordAudit(ctx, "restore", "projects", before as any, next as any);
  return next;
}

/** Board drag and drop: set the order of a column, and move cards into it if status is given. */
export async function reorderProjects(ctx: Ctx, ids: string[], status?: ProjectStatus) {
  for (let i = 0; i < ids.length; i++) {
    const p = await mustGetProject(ctx.db, ids[i]!);
    const patch: Record<string, unknown> = {};
    if (p.sort_order !== i) patch.sort_order = i;
    if (status && p.status !== status) patch.status = status;
    if (Object.keys(patch).length) await updateProject(ctx, p.id, patch);
  }
}

export async function linkPersonToProject(
  ctx: Ctx,
  projectId: string,
  personId: string,
  role: ProjectRole = "collaborator",
) {
  await mustGetProject(ctx.db, projectId);
  const person = await ctx.db.first(`SELECT id FROM people WHERE id = ?`, [personId]);
  if (!person) throw new NotFoundError(`No person with id ${personId}`);
  const existing = await ctx.db.first<{ project_id: string; person_id: string; role: ProjectRole }>(
    `SELECT * FROM project_people WHERE project_id = ? AND person_id = ?`,
    [projectId, personId],
  );
  const row = { project_id: projectId, person_id: personId, role };
  if (existing) {
    if (existing.role === role) return row;
    await updateRow(ctx.db, "project_people", existing, row);
    await recordAudit(ctx, "update", "project_people", existing, row);
  } else {
    await insertRow(ctx.db, "project_people", row);
    await recordAudit(ctx, "create", "project_people", null, row);
  }
  await touchProjects(ctx.db, [projectId]);
  return row;
}

export async function unlinkPersonFromProject(ctx: Ctx, projectId: string, personId: string) {
  const existing = await ctx.db.first<Record<string, unknown>>(
    `SELECT * FROM project_people WHERE project_id = ? AND person_id = ?`,
    [projectId, personId],
  );
  if (!existing) return;
  await deleteJoinRow(ctx.db, "project_people", existing);
  await recordAudit(ctx, "delete_soft", "project_people", existing, null);
  await touchProjects(ctx.db, [projectId]);
}

/** Replace a project's tags with this list of names, creating tags as needed. */
export async function setProjectTags(ctx: Ctx, projectId: string, names: string[]) {
  const wanted = new Map<string, string>();
  for (const n of names) {
    const name = n.trim();
    if (name) wanted.set(name.toLowerCase(), name);
  }
  const current = await ctx.db.all<{ tag_id: string; name: string }>(
    `SELECT pt.tag_id, t.name FROM project_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.project_id = ?`,
    [projectId],
  );
  const currentKeys = new Set(current.map((c) => c.name.toLowerCase()));
  for (const c of current) {
    if (!wanted.has(c.name.toLowerCase())) {
      const row = { project_id: projectId, tag_id: c.tag_id };
      await deleteJoinRow(ctx.db, "project_tags", row);
      await recordAudit(ctx, "delete_soft", "project_tags", row, null);
    }
  }
  for (const [key, name] of wanted) {
    if (currentKeys.has(key)) continue;
    let tag = await ctx.db.first<{ id: string }>(`SELECT id FROM tags WHERE name = ? COLLATE NOCASE`, [name]);
    if (!tag) {
      const t = { id: newId("tag"), name, created_at: nowIso() };
      await insertRow(ctx.db, "tags", t);
      await recordAudit(ctx, "create", "tags", null, t);
      tag = t;
    }
    const row = { project_id: projectId, tag_id: tag.id };
    await insertRow(ctx.db, "project_tags", row, true);
    await recordAudit(ctx, "create", "project_tags", null, row);
  }
}
