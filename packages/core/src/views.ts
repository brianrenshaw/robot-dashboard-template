// views.ts
// Read-only views: Today/home, due soon, overdue, waiting on, stale, search, digests,
// the morning brief data, and fuzzy name resolution for the MCP tools.

import { recordAudit, listAudit, type AuditView } from "./audit";
import type { Db, Param } from "./db";
import { placeholders } from "./db";
import { AmbiguousError, NotFoundError } from "./errors";
import { insertRow } from "./rows";
import { digestSchema, type TaskFilterInput } from "./schemas";
import { getSettings } from "./settings";
import type { Area, BlockResult, Ctx, DailyLog, Digest, Entry, Person, Project, Run, Settings, Task, TaskPerson } from "./types";
import { listTags, tagsFor, type TagCount } from "./tags";
import { latestRuns } from "./runs";
import { listOneOnOnes, type OneOnOneCard } from "./oneonones";
import { listCalendarEventPeople, listCalendarEvents, type CalendarEvent, type CalendarEventPerson } from "./calsync";
import { peopleComingUp, type PersonComingUp } from "./plan";
import { listGoogleAccounts } from "./connections";
import { latestDailyLog, searchDailyLogs } from "./daylog";
import { addDays, isoDaysAgo, newId, nowIso, todayInTz } from "./util";
import { attachCardInfo, listProjects, type ProjectCard } from "./projects";
import { listTimeBlocks, type TimeBlockView } from "./blocks";
import { listBlockResults } from "./owntime";
import { meetingNotes } from "./meetings";
import { attachEntryInfo, entriesCreatedSince, listTimeline, type EntryView } from "./entries";

export interface TaskItem extends Task {
  /** Null for a task that stands on its own. */
  project_title: string | null;
  project_slug: string | null;
  /** The task's desk: its project's, or its own when it has no project. */
  project_area: Area;
  /** The lead person's name (see Task.person_id). Null when no one is on it. */
  person_name: string | null;
  /** Everyone on the task, anyone he is waiting on first. */
  people: TaskPerson[];
  tags: string[];
}

const OPEN_PROJECT = `p.archived_at IS NULL AND p.status NOT IN ('done','archived')`;
/** In SQL: a task the owner is waiting on someone for, and a task that is his to do. */
const WAITING = `(t.person_id IS NOT NULL AND t.side = 'theirs')`;
const MINE = `(t.person_id IS NULL OR t.side = 'mine')`;
/** A task's desk, in SQL: its project's area, or its own. */
const TASK_AREA = `COALESCE(p.area, t.area, 'work')`;

function areaFilter(areas: Area[] | undefined, params: Param[], col = "p.area"): string {
  if (!areas?.length) return "";
  params.push(...areas);
  return ` AND ${col} IN (${placeholders(areas.length)})`;
}

async function projectsWhere(db: Db, sql: string, params: Param[], order: string): Promise<ProjectCard[]> {
  const rows = await db.all<Project>(`SELECT p.* FROM projects p WHERE ${sql} ORDER BY ${order}`, params);
  return attachCardInfo(db, rows);
}

const TASK_SELECT = `SELECT t.*, p.title AS project_title, p.slug AS project_slug, ${TASK_AREA} AS project_area, pe.name AS person_name
     FROM tasks t LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN people pe ON pe.id = t.person_id`;

/** Adds what hangs off each task: its tags and its people (anyone he is waiting on first). */
async function withTags(db: Db, rows: Omit<TaskItem, "tags" | "people">[]): Promise<TaskItem[]> {
  const ids = rows.map((r) => r.id);
  const tags = await tagsFor(db, "task", ids);
  const people = new Map<string, TaskPerson[]>();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const found = await db.all<{ task_id: string; id: string; name: string; waiting: number; one_on_one: number }>(
      `SELECT tp.task_id, tp.person_id AS id, pe.name, tp.waiting, tp.one_on_one FROM task_people tp JOIN people pe ON pe.id = tp.person_id
       WHERE tp.task_id IN (${placeholders(chunk.length)}) ORDER BY tp.waiting DESC, tp.rowid`,
      chunk,
    );
    for (const f of found) people.set(f.task_id, [...(people.get(f.task_id) ?? []), { id: f.id, name: f.name, waiting: !!f.waiting, one_on_one: !!f.one_on_one }]);
  }
  return rows.map((r) => ({ ...r, tags: tags.get(r.id) ?? [], people: people.get(r.id) ?? [] }));
}

/** One task with its project, tags and people. Null if there is none. */
export async function getTaskItem(db: Db, id: string): Promise<TaskItem | null> {
  const rows = await db.all<Omit<TaskItem, "tags" | "people">>(`${TASK_SELECT} WHERE t.id = ?`, [id]);
  return (await withTags(db, rows))[0] ?? null;
}

/** These tasks with their project, tags and people, open or done, in no particular order. */
export async function tasksByIds(db: Db, ids: string[]): Promise<TaskItem[]> {
  const rows: Omit<TaskItem, "tags" | "people">[] = [];
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    rows.push(...(await db.all<Omit<TaskItem, "tags" | "people">>(`${TASK_SELECT} WHERE t.deleted_at IS NULL AND t.id IN (${placeholders(chunk.length)})`, chunk)));
  }
  return withTags(db, rows);
}

/** Open tasks: on their own, or on a project that is still open. */
async function tasksWhere(db: Db, sql: string, params: Param[], order: string): Promise<TaskItem[]> {
  const today = todayInTz((await getSettings(db)).timezone);
  const rows = await db.all<Omit<TaskItem, "tags" | "people">>(
    `${TASK_SELECT}
     WHERE t.deleted_at IS NULL AND t.status != 'done' AND (t.project_id IS NULL OR (${OPEN_PROJECT}))
       AND (t.hide_until IS NULL OR t.hide_until <= '${today}') AND ${sql}
     ORDER BY ${order}`,
    params,
  );
  return withTags(db, rows);
}

/** How a list of tasks is narrowed. The shape is `taskFilterSchema` (schemas.ts); saved views store one. */
export type TaskFilter = TaskFilterInput;

/** The SQL for one filter, as conditions that must all hold. Used for the filter and for each of its alternatives. */
function filterConditions(f: TaskFilterInput, params: Param[], today: string): string[] {
  const where: string[] = [];
  /** One condition and the value it compares against. */
  const add = (sql: string, value: Param) => {
    where.push(sql);
    params.push(value);
  };
  if (f.areas?.length) {
    where.push(`${TASK_AREA} IN (${placeholders(f.areas.length)})`);
    params.push(...f.areas);
  }
  if (f.who === "mine") where.push(MINE);
  if (f.who === "theirs") where.push(WAITING);
  if (f.person_id) {
    // Anyone on the task counts. With "mine" or "theirs" it is about this person in particular:
    // "what am I waiting on from Sam" is tasks where Sam is the one being waited on.
    const role = f.who === "theirs" ? ` AND tp.waiting = 1` : f.who === "mine" ? ` AND tp.waiting = 0` : "";
    where.push(`EXISTS (SELECT 1 FROM task_people tp WHERE tp.task_id = t.id AND tp.person_id = ?${role})`);
    params.push(f.person_id);
  }
  if (f.project_id === "none") where.push(`t.project_id IS NULL`);
  else if (f.project_id) {
    where.push(`t.project_id = ?`);
    params.push(f.project_id);
  }
  for (const tag of f.tags ?? []) {
    where.push(`EXISTS (SELECT 1 FROM task_tags j JOIN tags g ON g.id = j.tag_id WHERE j.task_id = t.id AND g.name = ? COLLATE NOCASE)`);
    params.push(tag.replace(/^#/, ""));
  }
  if (f.due === "late") add(`t.due_date < ?`, today);
  if (f.due === "today") add(`t.due_date <= ?`, today);
  if (f.due === "week") add(`t.due_date <= ?`, addDays(today, 7));
  if (f.due === "dated") where.push(`t.due_date IS NOT NULL`);
  if (f.due === "none") where.push(`t.due_date IS NULL`);
  if (f.older_than_days !== undefined) add(`t.created_at <= ?`, isoDaysAgo(f.older_than_days));
  if (f.waiting_days !== undefined) add(`${WAITING} AND COALESCE(t.waiting_since, t.created_at) <= ?`, isoDaysAgo(f.waiting_days));
  if (f.has_email === true) where.push(`t.source_ref LIKE 'gmail:%'`);
  if (f.has_email === false) where.push(`(t.source_ref IS NULL OR t.source_ref NOT LIKE 'gmail:%')`);
  // Every word has to appear, in the title or the notes, in any order.
  for (const w of (f.text ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 6)) {
    where.push(`(t.title LIKE ? OR t.notes LIKE ?)`);
    params.push(`%${w}%`, `%${w}%`);
  }
  return where;
}

/**
 * The task list. With no filter: open tasks that are not hidden, soonest due first. Every
 * list of tasks on the site and every saved view comes through here.
 */
export async function listTasks(db: Db, f: TaskFilter = {}): Promise<TaskItem[]> {
  const today = todayInTz((await getSettings(db)).timezone);
  const params: Param[] = [];
  const where: string[] = [`t.deleted_at IS NULL`, `(t.project_id IS NULL OR p.archived_at IS NULL)`];
  const add = (sql: string, value: Param) => {
    where.push(sql);
    params.push(value);
  };
  const state = f.state ?? "open";
  if (state === "open") where.push(`t.status != 'done'`);
  else {
    where.push(state === "done" ? `(t.status = 'done' AND t.done_at >= ?)` : `(t.status != 'done' OR t.done_at >= ?)`);
    params.push(isoDaysAgo(f.done_within_days ?? 14));
  }
  // Hidden tasks stay out unless asked for. A finished task is never treated as hidden.
  const hidden = f.hidden ?? "exclude";
  if (hidden === "exclude") add(`(t.hide_until IS NULL OR t.hide_until <= ? OR t.status = 'done')`, today);
  if (hidden === "only") add(`(t.hide_until > ? AND t.status != 'done')`, today);
  where.push(...filterConditions(f, params, today));
  if (f.any?.length) {
    const alternatives = f.any.map((alt) => filterConditions(alt, params, today)).filter((c) => c.length);
    if (alternatives.length) where.push(`(${alternatives.map((c) => `(${c.join(" AND ")})`).join(" OR ")})`);
  }
  const rows = await db.all<Omit<TaskItem, "tags" | "people">>(
    `${TASK_SELECT} WHERE ${where.join(" AND ")}
     ORDER BY (t.status = 'done'), (t.due_date IS NULL), t.due_date, t.sort_order, t.created_at LIMIT 1000`,
    params,
  );
  return withTags(db, rows);
}

/** Everything that carries one tag: open tasks, notes and projects. */
export async function getTagView(db: Db, name: string, areas?: Area[]): Promise<{ name: string; tasks: TaskItem[]; notes: EntryView[]; projects: ProjectCard[] }> {
  const clean = name.replace(/^#/, "");
  const noteRows = await db.all<Entry>(
    `SELECT e.* FROM entries e WHERE e.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM entry_tags j JOIN tags g ON g.id = j.tag_id WHERE j.entry_id = e.id AND g.name = ? COLLATE NOCASE)
     ORDER BY e.occurred_at DESC LIMIT 200`,
    [clean],
  );
  return {
    name: clean,
    tasks: await listTasks(db, { tags: [clean], areas, state: "any", hidden: "include" }),
    notes: await attachEntryInfo(db, noteRows),
    projects: (await listProjects(db, { tag: clean, areas, sort: "priority" })).filter((p) => p.status !== "done"),
  };
}

export interface DueLists {
  projects: ProjectCard[];
  tasks: TaskItem[];
}

export async function overdue(db: Db, areas?: Area[], today?: string): Promise<DueLists> {
  const s = await getSettings(db);
  const t = today ?? todayInTz(s.timezone);
  const p1: Param[] = [t];
  const a1 = areaFilter(areas, p1);
  const p2: Param[] = [t];
  const a2 = areaFilter(areas, p2, TASK_AREA);
  return {
    projects: await projectsWhere(db, `${OPEN_PROJECT} AND p.due_date IS NOT NULL AND p.due_date < ?${a1}`, p1, "p.due_date"),
    tasks: await tasksWhere(db, `t.due_date IS NOT NULL AND t.due_date < ?${a2}`, p2, "t.due_date"),
  };
}

export async function dueSoon(db: Db, areas?: Area[], days?: number, today?: string): Promise<DueLists> {
  const s = await getSettings(db);
  const t = today ?? todayInTz(s.timezone);
  const end = addDays(t, days ?? s.due_soon_days);
  const p1: Param[] = [t, end];
  const a1 = areaFilter(areas, p1);
  const p2: Param[] = [t, end];
  const a2 = areaFilter(areas, p2, TASK_AREA);
  return {
    projects: await projectsWhere(db, `${OPEN_PROJECT} AND p.due_date >= ? AND p.due_date <= ?${a1}`, p1, "p.due_date"),
    tasks: await tasksWhere(db, `t.due_date >= ? AND t.due_date <= ?${a2}`, p2, "t.due_date"),
  };
}

export async function waitingOn(db: Db, areas?: Area[]): Promise<DueLists> {
  const p1: Param[] = [];
  const a1 = areaFilter(areas, p1);
  const p2: Param[] = [];
  const a2 = areaFilter(areas, p2, TASK_AREA);
  return {
    projects: await projectsWhere(
      db,
      `${OPEN_PROJECT} AND (p.status = 'waiting' OR TRIM(p.waiting_on) != '' OR p.waiting_on_person_id IS NOT NULL)${a1}`,
      p1,
      "p.last_activity_at ASC",
    ),
    tasks: await tasksWhere(db, `${WAITING}${a2}`, p2, "(t.due_date IS NULL), t.due_date, t.created_at"),
  };
}

export async function staleProjects(db: Db, areas?: Area[], settings?: Settings): Promise<ProjectCard[]> {
  const s = settings ?? (await getSettings(db));
  const params: Param[] = [isoDaysAgo(s.stale_days)];
  const a = areaFilter(areas, params);
  return projectsWhere(
    db,
    `p.archived_at IS NULL AND p.status IN ('active','waiting') AND p.last_activity_at < ?${a}`,
    params,
    "p.last_activity_at ASC",
  );
}

export async function latestDigest(db: Db): Promise<Digest | null> {
  return db.first<Digest>(`SELECT * FROM digests ORDER BY run_date DESC, created_at DESC LIMIT 1`);
}

export async function saveDigest(ctx: Ctx, input: unknown): Promise<Digest> {
  const data = digestSchema.parse(input);
  const s = await getSettings(ctx.db);
  const row: Digest = {
    id: newId("dig"),
    run_date: data.run_date ?? todayInTz(s.timezone),
    body: data.body,
    created_by: ctx.actor,
    created_at: nowIso(),
  };
  await insertRow(ctx.db, "digests", row as any);
  await recordAudit(ctx, "create", "digests", null, row as any);
  return row;
}

/** The owner's own open tasks (not waiting on anyone else), soonest due first. */
export async function myTasks(db: Db, areas?: Area[], limit = 300): Promise<TaskItem[]> {
  const params: Param[] = [];
  const a = areaFilter(areas, params, TASK_AREA);
  return tasksWhere(db, `${MINE}${a}`, params, `(t.due_date IS NULL), t.due_date, p.title, t.sort_order LIMIT ${Math.min(limit, 1000)}`);
}

/** How alive a project is: timeline entries per week, and how far through its tasks it is. */
export interface ProjectPulse {
  /** Entries logged in each of the last PULSE_WEEKS weeks, oldest first. The last one is this week. */
  weeks: number[];
  tasks_done: number;
  tasks_total: number;
}
export const PULSE_WEEKS = 12;

/** The pulse of every project, keyed by project id. */
export async function projectPulse(db: Db, now: Date = new Date()): Promise<Record<string, ProjectPulse>> {
  const out: Record<string, ProjectPulse> = {};
  const get = (id: string) => (out[id] ??= { weeks: Array(PULSE_WEEKS).fill(0), tasks_done: 0, tasks_total: 0 });
  const since = new Date(now.getTime() - PULSE_WEEKS * 7 * 86_400_000).toISOString();
  const entries = await db.all<{ project_id: string; occurred_at: string }>(
    `SELECT project_id, occurred_at FROM entries WHERE deleted_at IS NULL AND project_id IS NOT NULL AND occurred_at >= ?
     UNION ALL
     SELECT ep.project_id, e.occurred_at FROM entry_projects ep JOIN entries e ON e.id = ep.entry_id
     WHERE e.deleted_at IS NULL AND e.occurred_at >= ?`,
    [since, since],
  );
  for (const e of entries) {
    const weeksAgo = Math.floor((now.getTime() - Date.parse(e.occurred_at)) / (7 * 86_400_000));
    if (weeksAgo >= 0 && weeksAgo < PULSE_WEEKS) get(e.project_id).weeks[PULSE_WEEKS - 1 - weeksAgo]!++;
  }
  const tasks = await db.all<{ project_id: string; done: number; total: number }>(
    `SELECT project_id, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done, COUNT(*) AS total
     FROM tasks WHERE deleted_at IS NULL AND project_id IS NOT NULL GROUP BY project_id`,
  );
  for (const t of tasks) {
    const p = get(t.project_id);
    p.tasks_done = Number(t.done);
    p.tasks_total = Number(t.total);
  }
  return out;
}

export interface HomeData {
  today: string;
  settings: Settings;
  digest: Digest | null;
  /** The most recent day in the daily log. The dashboard shows it only while it is today's. */
  log: DailyLog | null;
  /** Every open project in the areas asked for. The desks sort these into your move and their move. */
  projects: ProjectCard[];
  /** The owner's own open tasks. */
  my_tasks: TaskItem[];
  /** Every open task with a due date that is not hidden, soonest first: all the dashboard lists. */
  dated_tasks: TaskItem[];
  /** Every open task that is not hidden. The dashboard hangs these on the meetings they belong to. */
  open_tasks: TaskItem[];
  /** The people he is about to meet, in the order of his next meeting with each. */
  people_next: PersonComingUp[];
  /** Every tag in use, most used first. */
  tags: TagCount[];
  /** The latest run of each automation, so the page can say when email was last checked. */
  runs: Run[];
  /** Standing 1:1s, soonest first. */
  one_on_ones: OneOnOneCard[];
  /** Calendar events from today through the next two weeks (empty until a calendar is connected). */
  calendar: CalendarEvent[];
  /** Which of his people each of those meetings is with. */
  calendar_people: CalendarEventPerson[];
  /** The Monday of the week the planner shows: this week, or next week on a weekend. */
  week_start: string;
  /** Time he set aside for tasks, from week_start through the next two weeks. */
  blocks: TimeBlockView[];
  /** His answers for sessions of his own time in that stretch: whether he did the work in each. */
  block_results: BlockResult[];
  /** The notes he wrote for those meetings (one per meeting; source_ref "calendar:<event id>"). */
  meeting_notes: EntryView[];
  /** True once at least one Google account is connected in Settings. */
  calendar_connected: boolean;
  /** Activity and task progress for each project, keyed by project id. */
  pulse: Record<string, ProjectPulse>;
  overdue: DueLists;
  due_soon: DueLists;
  waiting_on: DueLists;
  stale: ProjectCard[];
  recent: EntryView[];
}

/** The Monday of this week; on a Saturday or Sunday, the coming Monday. */
export function weekStart(today: string): string {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 Sunday
  return addDays(today, dow === 0 ? 1 : dow === 6 ? 2 : 1 - dow);
}

export async function getHome(db: Db, areas?: Area[]): Promise<HomeData> {
  const settings = await getSettings(db);
  const today = todayInTz(settings.timezone);
  const calendar = await listCalendarEvents(db, weekStart(today), addDays(today, 14), areas);
  return {
    today,
    settings,
    digest: await latestDigest(db),
    log: await latestDailyLog(db),
    projects: (await listProjects(db, { areas, sort: "priority" })).filter((p) => p.status !== "done"),
    my_tasks: await myTasks(db, areas),
    dated_tasks: await listTasks(db, { areas, due: "dated" }),
    open_tasks: await listTasks(db, { areas }),
    people_next: await peopleComingUp(db, today),
    tags: await listTags(db),
    runs: await latestRuns(db),
    one_on_ones: await listOneOnOnes(db, areas),
    calendar,
    calendar_people: await listCalendarEventPeople(db, weekStart(today), addDays(today, 14)),
    week_start: weekStart(today),
    blocks: await listTimeBlocks(db, weekStart(today), addDays(weekStart(today), 18)),
    block_results: await listBlockResults(db, weekStart(today), addDays(weekStart(today), 18)),
    meeting_notes: await meetingNotes(db, calendar.map((e) => e.id)),
    calendar_connected: (await listGoogleAccounts(db)).length > 0,
    pulse: await projectPulse(db),
    overdue: await overdue(db, areas, today),
    due_soon: await dueSoon(db, areas, settings.due_soon_days, today),
    waiting_on: await waitingOn(db, areas),
    stale: await staleProjects(db, areas, settings),
    recent: await listTimeline(db, { areas, limit: 15 }),
  };
}

export async function morningBriefData(db: Db) {
  const settings = await getSettings(db);
  const today = todayInTz(settings.timezone);
  const since = isoDaysAgo(1);
  const open = await tasksWhere(db, `1 = 1`, [], "(p.title IS NULL), p.title, t.sort_order");
  const byProject: Record<string, { project_id: string | null; project: string; tasks: { id: string; title: string; due_date: string | null; waiting_on: string | null; tags: string[] }[] }> = {};
  for (const t of open) {
    const g = (byProject[t.project_id ?? ""] ??= { project_id: t.project_id, project: t.project_title ?? "No project", tasks: [] });
    g.tasks.push({ id: t.id, title: t.title, due_date: t.due_date, waiting_on: t.person_name, tags: t.tags });
  }
  return {
    today,
    timezone: settings.timezone,
    // Today's and tomorrow's meetings, from the calendars connected in Settings.
    calendar: await listCalendarEvents(db, today, addDays(today, 1)),
    one_on_ones: (await listOneOnOnes(db)).filter((o) => o.next_expected && o.next_expected <= addDays(today, 1) && !o.next_is_estimate),
    overdue: await overdue(db, undefined, today),
    due_soon: await dueSoon(db, undefined, settings.due_soon_days, today),
    waiting_on: await waitingOn(db),
    stale: await staleProjects(db, undefined, settings),
    last_24h_entries: await entriesCreatedSince(db, since),
    last_24h_changes: await listAudit(db, { since, limit: 200 }),
    open_tasks_by_project: Object.values(byProject),
  };
}

export async function whatsChanged(db: Db, since: string): Promise<AuditView[]> {
  return listAudit(db, { since: new Date(since).toISOString(), limit: 500 });
}

export interface SearchResults {
  /** Open tasks, and ones finished in the last two weeks. */
  tasks: TaskItem[];
  projects: ProjectCard[];
  people: Person[];
  entries: EntryView[];
  /** Days in the daily log whose text matches, newest first. */
  logs: DailyLog[];
}

/**
 * Search across tasks, projects, people, entries and the daily log. Uses LIKE on purpose: D1 supports FTS5, but
 * `wrangler d1 export` cannot export databases with virtual tables, which would break backups.
 * Everything goes through this one function so it can be swapped later.
 */
export async function search(db: Db, q: string, areas?: Area[], limit = 20): Promise<SearchResults> {
  const words = q.trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length) return { tasks: [], projects: [], people: [], entries: [], logs: [] };
  const lim = Math.min(Math.max(limit, 1), 100);
  const build = (cols: string[]) => {
    const params: Param[] = [];
    const sql = words
      .map((w) => {
        cols.forEach(() => params.push(`%${w}%`));
        return `(${cols.map((c) => `${c} LIKE ?`).join(" OR ")})`;
      })
      .join(" AND ");
    return { sql, params };
  };
  const pq = build(["p.title", "p.summary", "p.next_step", "p.waiting_on", "p.notes", "p.slug"]);
  const pa = areaFilter(areas, pq.params);
  const projects = await projectsWhere(
    db,
    `p.archived_at IS NULL AND ${pq.sql}${pa}`,
    pq.params,
    `p.last_activity_at DESC LIMIT ${lim}`,
  );
  const tasks = (await listTasks(db, { text: words.join(" "), areas, state: "any", hidden: "include" })).slice(0, lim);
  const peq = build(["p.name", "p.aliases", "p.email", "p.role", "p.organization", "p.notes"]);
  const people = await db.all<Person>(
    `SELECT p.* FROM people p WHERE p.archived_at IS NULL AND ${peq.sql} ORDER BY p.name LIMIT ${lim}`,
    peq.params,
  );
  const eq = build(["e.title", "e.body"]);
  const ea = areas?.length
    ? ` AND (e.project_id IS NULL OR EXISTS (SELECT 1 FROM projects ap WHERE ap.id = e.project_id AND ap.area IN (${placeholders(areas.length)})))`
    : "";
  if (areas?.length) eq.params.push(...areas);
  const entryIds = await db.all<{ id: string }>(
    `SELECT e.id FROM entries e WHERE e.deleted_at IS NULL AND ${eq.sql}${ea} ORDER BY e.occurred_at DESC LIMIT ${lim}`,
    eq.params,
  );
  let entries: EntryView[] = [];
  if (entryIds.length) {
    const rows = await db.all<any>(
      `SELECT * FROM entries WHERE id IN (${placeholders(entryIds.length)}) ORDER BY occurred_at DESC`,
      entryIds.map((r) => r.id),
    );
    entries = await attachEntryInfo(db, rows);
  }
  // The daily log belongs to no desk, so it is searched whichever desk he is at.
  const logs = await searchDailyLogs(db, words, lim);
  return { tasks, projects, people, entries, logs };
}

// ---------- Fuzzy resolution (used by MCP; never guesses on writes) ----------

export type Resolved<T> = { status: "found"; item: T } | { status: "ambiguous"; candidates: T[] } | { status: "none" };

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function pick<T>(all: T[], ref: string, label: (x: T) => string): Resolved<T> {
  const n = norm(ref);
  if (!n) return { status: "none" };
  const exact = all.filter((x) => norm(label(x)) === n);
  if (exact.length === 1) return { status: "found", item: exact[0]! };
  if (exact.length > 1) return { status: "ambiguous", candidates: exact };
  const words = n.split(" ");
  const partial = all.filter((x) => {
    const l = norm(label(x));
    return words.every((w) => l.includes(w));
  });
  if (partial.length === 1) return { status: "found", item: partial[0]! };
  if (partial.length > 1) return { status: "ambiguous", candidates: partial.slice(0, 10) };
  return { status: "none" };
}

/** The other names a person goes by, as a list. */
export function aliasesOf(p: { aliases?: string | null }): string[] {
  return (p.aliases ?? "").split(",").map((a) => a.trim()).filter(Boolean);
}

/** Find a project by ID, slug or title words. */
export async function resolveProject(db: Db, ref: string): Promise<Resolved<Project>> {
  const r = ref.trim();
  const direct = await db.first<Project>(`SELECT * FROM projects WHERE id = ? OR slug = ?`, [r, r.toLowerCase()]);
  if (direct) return { status: "found", item: direct };
  const all = await db.all<Project>(`SELECT * FROM projects WHERE archived_at IS NULL`);
  return pick(all, r, (p) => p.title);
}

/** Find a person by ID, slug, email or name words. */
export async function resolvePerson(db: Db, ref: string): Promise<Resolved<Person>> {
  const r = ref.trim();
  const direct = await db.first<Person>(
    `SELECT * FROM people WHERE id = ? OR slug = ? OR (email != '' AND LOWER(email) = ?)`,
    [r, r.toLowerCase(), r.toLowerCase()],
  );
  if (direct) return { status: "found", item: direct };
  const all = await db.all<Person>(`SELECT * FROM people WHERE archived_at IS NULL`);
  // Another name they go by ("Nena" for Nina Wade) counts as the name itself.
  const alias = all.filter((p) => aliasesOf(p).some((a) => norm(a) === norm(r)));
  if (alias.length === 1) return { status: "found", item: alias[0]! };
  return pick(all, r, (p) => p.name);
}

/** Resolve or throw. Use for writes, so an ambiguous name never picks a record by guess. */
export async function requireProject(db: Db, ref: string): Promise<Project> {
  const r = await resolveProject(db, ref);
  if (r.status === "found") return r.item;
  if (r.status === "ambiguous")
    throw new AmbiguousError(
      `"${ref}" matches more than one project. Ask which one and pass its id.`,
      r.candidates.map((p) => ({ id: p.id, label: p.title, detail: `${p.area}, ${p.status}` })),
    );
  throw new NotFoundError(`No project matches "${ref}". Use list_projects or search to find it.`);
}

export async function requirePerson(db: Db, ref: string): Promise<Person> {
  const r = await resolvePerson(db, ref);
  if (r.status === "found") return r.item;
  if (r.status === "ambiguous")
    throw new AmbiguousError(
      `"${ref}" matches more than one person. Ask which one and pass their id.`,
      r.candidates.map((p) => ({ id: p.id, label: p.name, detail: [p.role, p.organization].filter(Boolean).join(", ") })),
    );
  throw new NotFoundError(`No person matches "${ref}". Use search to look for them, or create_person if they are new.`);
}
