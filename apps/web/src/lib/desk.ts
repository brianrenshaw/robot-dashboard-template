// desk.ts
// Turns the home data into what a desk shows: your move on one side, their move on the other.
// One request (useHome) covers every area; each desk filters it to its own area here, so
// walking between desks never waits on the network. No server calls in this file.

import { isMine, whoseMove } from "@pd/core/derived";
import type { Area, CalendarEvent, HomeData, OneOnOneCard, PersonComingUp, ProjectCard, TaskItem } from "../api";
import { addDaysYmd } from "./time";
import type { Scope } from "../spaces";

/** Something with a date on your side: an overdue or soon-due project or task. */
export type ClockItem =
  | { kind: "project"; id: string; date: string; late: boolean; project: ProjectCard }
  | { kind: "task"; id: string; date: string; late: boolean; task: TaskItem };

/** One thing someone else owes: a project waiting on them, or a task assigned to them. */
export type OwedItem =
  | { kind: "project"; id: string; since: string; project: ProjectCard }
  | { kind: "task"; id: string; since: string; task: TaskItem };

export interface TheirGroup {
  key: string;
  /** Null for projects that are waiting but name no one. */
  person: { id: string; name: string; avatar_url?: string | null } | null;
  items: OwedItem[];
}

export interface DeskModel {
  /** Everything of yours that is overdue or due soon, oldest first. Used for counts and the Today panels. */
  clock: ClockItem[];
  /** Active projects where the next move is yours, most urgent first, with your open tasks on each. */
  next: { project: ProjectCard; tasks: TaskItem[]; late: boolean }[];
  /** Dated things of yours on projects that are not in `next` (a task on a project that is waiting on someone). */
  also: ClockItem[];
  /** Grouped by the person who has the next move. */
  theirs: TheirGroup[];
  /** Active or waiting projects with no activity for a while. */
  quiet: ProjectCard[];
  /** Ideas and paused projects. */
  parked: ProjectCard[];
  /** Standing 1:1s for this desk, soonest first. */
  oneOnOnes: OneOnOneCard[];
  /** Who he is waiting on the most: tasks waiting on them and projects waiting on them. */
  owedBy: { id: string; name: string; avatar_url?: string | null; count: number; oldestDays: number }[];
  /** Everything with a date in the next two weeks (plus anything late), in order. */
  upcoming: UpcomingItem[];
  /** Meetings on this desk's calendars, today through the next two weeks. */
  events: CalendarEvent[];
  /** Open tasks on this desk that have a due date, soonest first. The only tasks the dashboard lists. */
  dated: TaskItem[];
  /** Open projects on this desk that have a due date, soonest first. */
  datedProjects: ProjectCard[];
  /** The people he is about to meet, in the order of his next meeting with each. */
  people: PersonComingUp[];
  /** The owner's own open tasks on this desk. */
  myTasks: number;
  counts: { yours: number; theirs: number; late: number; projects: number };
}

/** One dated thing on the "Coming up" tile. */
export interface UpcomingItem {
  key: string;
  date: string;
  kind: "task" | "project" | "one_on_one";
  title: string;
  sub: string;
  to: string;
  late: boolean;
  /** A 1:1 date worked out from the rhythm, not one that was set. */
  estimate?: boolean;
  /** For a 1:1: the person, and the exact start time when it is on the calendar. */
  personId?: string;
  startsAt?: string | null;
}

export function deskModel(h: HomeData, scope: Scope): DeskModel {
  const inScope = (a: Area | null | undefined) => scope === "all" || a === scope;
  const projects = h.projects.filter((p) => inScope(p.area));

  const clock: ClockItem[] = [];
  const seen = new Set<string>();
  const addProject = (p: ProjectCard, late: boolean) => {
    if (!inScope(p.area) || !p.due_date || seen.has(p.id)) return;
    seen.add(p.id);
    clock.push({ kind: "project", id: p.id, date: p.due_date, late, project: p });
  };
  const addTask = (t: TaskItem, late: boolean) => {
    // A dated task that belongs to someone else is their move, not yours.
    if (!inScope(t.project_area) || !t.due_date || !isMine(t) || seen.has(t.id)) return;
    seen.add(t.id);
    clock.push({ kind: "task", id: t.id, date: t.due_date, late, task: t });
  };
  h.overdue.projects.forEach((p) => addProject(p, true));
  h.overdue.tasks.forEach((t) => addTask(t, true));
  h.due_soon.projects.forEach((p) => addProject(p, false));
  h.due_soon.tasks.forEach((t) => addTask(t, false));
  clock.sort((a, b) => a.date.localeCompare(b.date));

  const tasksByProject = new Map<string, TaskItem[]>();
  for (const t of h.my_tasks) if (t.project_id) tasksByProject.set(t.project_id, [...(tasksByProject.get(t.project_id) ?? []), t]);
  // The soonest date on each project (its own due date or one of its tasks), and whether it is late.
  const soonest = new Map<string, { date: string; late: boolean }>();
  for (const c of clock) {
    const pid = c.kind === "project" ? c.project.id : c.task.project_id;
    if (!pid) continue; // a task on its own belongs to no project
    const cur = soonest.get(pid);
    if (!cur || c.date < cur.date) soonest.set(pid, { date: c.date, late: c.late || !!cur?.late });
    else if (c.late) cur.late = true;
  }
  const rank = (p: ProjectCard) => soonest.get(p.id)?.date ?? `9999-${p.priority}-${p.next_step ? 0 : 1}`;
  const next = projects
    .filter((p) => whoseMove(p) === "yours")
    .sort((a, b) => rank(a).localeCompare(rank(b)))
    .map((project) => ({ project, tasks: tasksByProject.get(project.id) ?? [], late: !!soonest.get(project.id)?.late }));
  const inNext = new Set(next.map((n) => n.project.id));
  const also = clock.filter((c) => !inNext.has((c.kind === "project" ? c.project.id : c.task.project_id) ?? ""));

  const groups = new Map<string, TheirGroup>();
  const group = (key: string, person: TheirGroup["person"]) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, person, items: [] }));
    return g;
  };
  for (const p of h.waiting_on.projects) {
    if (!inScope(p.area)) continue;
    const who = p.waiting_on_person;
    group(who ? who.id : "none", who).items.push({ kind: "project", id: p.id, since: p.last_activity_at, project: p });
  }
  for (const t of h.waiting_on.tasks) {
    if (!inScope(t.project_area) || !t.person_id) continue;
    group(t.person_id, { id: t.person_id, name: t.person_name ?? "Someone" }).items.push({ kind: "task", id: t.id, since: t.updated_at, task: t });
  }
  // People first, longest wait first; the "no one in particular" group last.
  const oldest = (g: TheirGroup) => g.items.reduce((m, i) => (i.since < m ? i.since : m), "9999");
  const theirs = [...groups.values()].sort((a, b) => (a.person ? 0 : 1) - (b.person ? 0 : 1) || oldest(a).localeCompare(oldest(b)));

  const oneOnOnes = h.one_on_ones.filter((o) => scope === "all" || o.area === null || o.area === scope);

  // Who owes what, across tasks, projects and 1:1 lists.
  const owedMap = new Map<string, DeskModel["owedBy"][number]>();
  const days = (iso: string) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000));
  for (const g of theirs) {
    if (!g.person) continue;
    owedMap.set(g.person.id, { id: g.person.id, name: g.person.name, avatar_url: g.person.avatar_url, count: g.items.length, oldestDays: days(oldest(g)) });
  }
  // (What a 1:1 partner owes is a task like any other now, so it is already counted above.)
  const owedBy = [...owedMap.values()].sort((a, b) => b.count - a.count || b.oldestDays - a.oldestDays);

  const horizon = addDaysYmd(h.today, 14);
  const upcoming: UpcomingItem[] = [
    ...clock.map((c): UpcomingItem =>
      c.kind === "task"
        ? { key: c.id, date: c.date, kind: "task", title: c.task.title, sub: c.task.project_title ?? (c.task.tags.length ? c.task.tags.map((t) => `#${t}`).join(" ") : "Task"), to: c.task.project_id ? `/projects/${c.task.project_id}` : "/tasks", late: c.late }
        : { key: c.id, date: c.date, kind: "project", title: c.project.title, sub: "Project due", to: `/projects/${c.project.id}`, late: c.late },
    ),
    ...oneOnOnes
      .filter((o) => o.next_expected && o.next_expected <= horizon)
      .map((o): UpcomingItem => {
        const open = o.discuss + o.theirs + o.mine + o.unsorted;
        return { key: `1on1-${o.person_id}`, date: o.next_expected!, kind: "one_on_one", title: `1:1 with ${o.name}`, sub: open ? `${open} on the list` : "Nothing on the list yet", to: `/people/${o.person_id}`, late: false, estimate: o.next_is_estimate, personId: o.person_id, startsAt: o.next_starts_at };
      }),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const owed = theirs.reduce((n, g) => n + g.items.length, 0);
  return {
    clock,
    next,
    also,
    theirs,
    quiet: h.stale.filter((p) => inScope(p.area)),
    parked: projects.filter((p) => whoseMove(p) === "parked"),
    oneOnOnes,
    owedBy,
    upcoming,
    events: h.calendar.filter((e) => inScope(e.area)),
    dated: h.dated_tasks.filter((t) => inScope(t.project_area)),
    datedProjects: projects.filter((p) => p.due_date && p.status !== "done").sort((a, b) => a.due_date!.localeCompare(b.due_date!)),
    people: h.people_next.filter((p) => scope === "all" || p.area === null || p.area === scope),
    myTasks: h.my_tasks.filter((t) => inScope(t.project_area)).length,
    counts: {
      yours: next.length + also.length,
      theirs: owed,
      late: clock.filter((c) => c.late).length,
      projects: projects.length,
    },
  };
}

/** "3 need you", "1 needs you". */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
