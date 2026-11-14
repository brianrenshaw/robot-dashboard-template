// people.ts

import { recordAudit } from "./audit";
import type { Db, Param } from "./db";
import { placeholders } from "./db";
import { NotFoundError } from "./errors";
import { changedKeys, insertRow, updateRow } from "./rows";
import { personCreateSchema, personUpdateSchema } from "./schemas";
import type { Area, Ctx, Person, Project, ProjectRole, Task } from "./types";
import { newId, nowIso } from "./util";
import { attachCardInfo, uniqueSlug, type ProjectCard } from "./projects";
import { listTimeline, type EntryView } from "./entries";
import { getOneOnOne, type OneOnOneDetail } from "./oneonones";

export interface PersonCard extends Person {
  active_project_count: number;
  last_talked_at: string | null;
}

export interface PersonDetail extends PersonCard {
  /** Their standing 1:1 with the owner (the list and past meetings), or null if there is none. */
  one_on_one: OneOnOneDetail | null;
  projects: (ProjectCard & { person_role: ProjectRole | null })[];
  timeline: EntryView[];
  /** Open tasks waiting on this person, with or without a project. */
  open_tasks: (Task & { project_title: string | null })[];
  waiting_projects: Project[];
}

const LAST_TALKED = `(SELECT MAX(e.occurred_at) FROM entry_people ep JOIN entries e ON e.id = ep.entry_id
  WHERE ep.person_id = p.id AND e.deleted_at IS NULL)`;

function areaClause(areas: Area[] | undefined, params: Param[], alias = "pr"): string {
  if (!areas?.length) return "";
  params.push(...areas);
  return ` AND ${alias}.area IN (${placeholders(areas.length)})`;
}

export async function getPerson(db: Db, id: string): Promise<Person | null> {
  return db.first<Person>(`SELECT * FROM people WHERE id = ?`, [id]);
}

export interface PeopleFilter {
  areas?: Area[];
  q?: string;
  includeArchived?: boolean;
}

export async function listPeople(db: Db, f: PeopleFilter = {}): Promise<PersonCard[]> {
  const params: Param[] = [];
  const countAreas = areaClause(f.areas, params);
  const where: string[] = [];
  if (!f.includeArchived) where.push("p.archived_at IS NULL");
  if (f.areas?.length) {
    // Show people whose own area is on, who have no area, or who are on a project in an area that is on.
    where.push(`(p.area IS NULL OR p.area IN (${placeholders(f.areas.length)}) OR EXISTS (
      SELECT 1 FROM project_people x JOIN projects xp ON xp.id = x.project_id
      WHERE x.person_id = p.id AND xp.area IN (${placeholders(f.areas.length)})))`);
    params.push(...f.areas, ...f.areas);
  }
  if (f.q?.trim()) {
    const like = `%${f.q.trim()}%`;
    where.push(`(p.name LIKE ? OR p.email LIKE ? OR p.role LIKE ? OR p.organization LIKE ?)`);
    params.push(like, like, like, like);
  }
  return db.all<PersonCard>(
    `SELECT p.*,
       (SELECT COUNT(*) FROM project_people pp JOIN projects pr ON pr.id = pp.project_id
        WHERE pp.person_id = p.id AND pr.archived_at IS NULL AND pr.status IN ('idea','active','waiting','paused')${countAreas}
       ) AS active_project_count,
       ${LAST_TALKED} AS last_talked_at
     FROM people p ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY p.name COLLATE NOCASE`,
    params,
  );
}

export async function getPersonDetail(db: Db, id: string, areas?: Area[]): Promise<PersonDetail | null> {
  const params: Param[] = [id];
  const countAreas = areaClause(areas, params);
  const p = await db.first<PersonCard>(
    `SELECT p.*,
       (SELECT COUNT(*) FROM project_people pp JOIN projects pr ON pr.id = pp.project_id
        WHERE pp.person_id = p.id AND pr.archived_at IS NULL AND pr.status IN ('idea','active','waiting','paused')${countAreas}
       ) AS active_project_count,
       ${LAST_TALKED} AS last_talked_at
     FROM people p WHERE p.id = ?`,
    [...params.slice(1), id],
  );
  if (!p) return null;
  const projParams: Param[] = [id];
  const projAreas = areaClause(areas, projParams);
  const projects = await db.all<Project & { person_role: ProjectRole }>(
    `SELECT pr.*, pp.role AS person_role FROM project_people pp JOIN projects pr ON pr.id = pp.project_id
     WHERE pp.person_id = ? AND pr.archived_at IS NULL${projAreas}
     ORDER BY CASE pr.status WHEN 'done' THEN 1 ELSE 0 END, pr.last_activity_at DESC`,
    projParams,
  );
  const cards = await attachCardInfo(db, projects);
  const roleById = new Map(projects.map((x) => [x.id, x.person_role]));
  const timeline = await listTimeline(db, { personId: id, areas, limit: 100 });
  const open_tasks = await db.all<Task & { project_title: string | null }>(
    `SELECT t.*, pr.title AS project_title FROM tasks t LEFT JOIN projects pr ON pr.id = t.project_id
     WHERE EXISTS (SELECT 1 FROM task_people tp WHERE tp.task_id = t.id AND tp.person_id = ? AND tp.waiting = 1) AND t.status != 'done' AND t.deleted_at IS NULL AND (t.project_id IS NULL OR pr.archived_at IS NULL)
     ORDER BY (t.due_date IS NULL), t.due_date, t.created_at`,
    [id],
  );
  const waiting_projects = await db.all<Project>(
    `SELECT * FROM projects WHERE waiting_on_person_id = ? AND archived_at IS NULL AND status NOT IN ('done','archived')`,
    [id],
  );
  return {
    ...p,
    one_on_one: await getOneOnOne(db, id),
    projects: cards.map((c) => ({ ...c, person_role: roleById.get(c.id) ?? null })),
    timeline,
    open_tasks,
    waiting_projects,
  };
}

export async function createPerson(ctx: Ctx, input: unknown): Promise<Person> {
  const data = personCreateSchema.parse(input);
  const now = nowIso();
  const row: Person = {
    id: newId("per"),
    slug: await uniqueSlug(ctx.db, "people", data.name),
    ...data,
    last_contact_at: null,
    created_at: now,
    updated_at: now,
    archived_at: null,
  };
  await insertRow(ctx.db, "people", row as any);
  await recordAudit(ctx, "create", "people", null, row as any);
  return row;
}

export async function updatePerson(ctx: Ctx, id: string, input: unknown): Promise<Person> {
  const patch = personUpdateSchema.parse(input);
  const before = await getPerson(ctx.db, id);
  if (!before) throw new NotFoundError(`No person with id ${id}`);
  const next = { ...before, ...patch } as Person;
  if (!changedKeys(before as any, next as any).length) return before;
  next.updated_at = nowIso();
  await updateRow(ctx.db, "people", before as any, next as any);
  await recordAudit(ctx, "update", "people", before as any, next as any);
  return next;
}

export async function archivePerson(ctx: Ctx, id: string): Promise<Person> {
  const before = await getPerson(ctx.db, id);
  if (!before) throw new NotFoundError(`No person with id ${id}`);
  if (before.archived_at) return before;
  const now = nowIso();
  const next = { ...before, archived_at: now, updated_at: now };
  await updateRow(ctx.db, "people", before as any, next);
  await recordAudit(ctx, "archive", "people", before as any, next);
  return next;
}

export async function restorePerson(ctx: Ctx, id: string): Promise<Person> {
  const before = await getPerson(ctx.db, id);
  if (!before) throw new NotFoundError(`No person with id ${id}`);
  if (!before.archived_at) return before;
  const next = { ...before, archived_at: null, updated_at: nowIso() };
  await updateRow(ctx.db, "people", before as any, next);
  await recordAudit(ctx, "restore", "people", before as any, next);
  return next;
}
