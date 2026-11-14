// tasks.ts: tasks, and links (pinned resources on a project).
//
// A task is the basic thing the owner tracks: one line. Everything else on it is optional:
//   - people      any number of them, like tags (the task_people table). Being on a task
//                 only means it involves them. Two optional marks per person: `waiting` (he
//                 is waiting on them for it) and `one_on_one` (it is on the list for his next
//                 1:1 with them). No people: simply his own.
//   - person_id, side   a summary of the task's LEAD person (someone he is waiting on, if
//                 any, else the first person on it), kept in step here on every write. The
//                 lists that ask "is this mine, or am I waiting?" read it. Do not write these
//                 directly. (`discuss` is no longer used and stays 0.)
// A task added with no people whose title names some of his people gets them put on it
// (peopleNamedIn below).
//   - due_date    a deadline.
//   - tags        how he finds it again (see tags.ts). #hashtags typed in the title become tags.
//   - project_id  only when the task is part of something with several tasks.
//   - notes       free text under it.

import { recordAudit } from "./audit";
import { NotFoundError } from "./errors";
import { changedKeys, deleteJoinRow, insertRow, updateRow } from "./rows";
import { linkCreateSchema, linkUpdateSchema, taskCreateSchema, taskUpdateSchema } from "./schemas";
import { touchProjects } from "./touch";
import type { Ctx, Link, Task } from "./types";
import { newId, nowIso } from "./util";
import { addEntry, sourceForActor } from "./entries";
import { hashtags, setItemTags, stripHashtags } from "./tags";

async function mustProject(ctx: Ctx, id: string) {
  const p = await ctx.db.first(`SELECT id FROM projects WHERE id = ?`, [id]);
  if (!p) throw new NotFoundError(`No project with id ${id}`);
}

async function mustPerson(ctx: Ctx, id: string | null | undefined) {
  if (!id) return;
  const p = await ctx.db.first(`SELECT id FROM people WHERE id = ?`, [id]);
  if (!p) throw new NotFoundError(`No person with id ${id}`);
}

const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "Jordan to email Dylan", "Kai: send the report", "Sam will confirm": the first person has the next step. */
const THEY_DO = /^\s*(?:to|will|is going to|needs to|should|:|-)\s/i;

type Named = { id: string; name: string; aliases?: string | null };

/**
 * The people a task's title names, to be tagged on it. It never guesses: a full name wins over
 * a first name, a first name (or other name) that two people share names no one, and a first
 * name followed by a different surname ("Kai Ellis" when his Kai is Kai Hale) names no
 * one. Names must be capitalized as written ("Ned", not "the norm").
 * `waiting` is set for the one case the wording makes plain, a title that opens with the
 * person who has the next step:
 *   "Jordan to email Dylan about X"   tagged Jordan (waiting on him) and Dylan
 *   "Identify the funds. Discuss with Nina."   tagged Nina
 * Nothing here puts a task on a 1:1 list; only the owner or his chatbot do that.
 */
export function peopleNamedIn(title: string, people: Named[]): { id: string; waiting: boolean }[] {
  const found: { id: string; at: number; end: number }[] = [];
  let rest = title;
  const take = (id: string, m: RegExpExecArray) => {
    if (!found.some((f) => f.id === id)) found.push({ id, at: m.index, end: m.index + m[0].length });
    // Blank it out (same length, so positions hold) and it is not read twice.
    rest = rest.slice(0, m.index) + " ".repeat(m[0].length) + rest.slice(m.index + m[0].length);
  };
  // Every name a person goes by: their name, and the other spellings saved for them ("Nena").
  const names = people.flatMap((p) => [p.name, ...(p.aliases ?? "").split(",")].map((n) => ({ id: p.id, name: n.trim() })).filter((n) => n.name));
  // Full names first, longest first, so "Jon Harper" is not also read as the person named "Jon".
  for (const p of [...names].sort((x, y) => y.name.length - x.name.length)) {
    // A one-word name ("Jon") is handled with the first names below, where sharing it counts.
    if (!/\s/.test(p.name)) continue;
    const m = new RegExp(`(?<![\\p{L}])${esc(p.name)}(?![\\p{L}])`, "u").exec(rest);
    if (m) take(p.id, m);
  }
  // Then first names (and one-word other names), in what is left.
  const byFirst = new Map<string, string[]>();
  for (const p of names) {
    const first = p.name.split(/\s+/)[0] ?? "";
    if (first.length >= 3 && !(byFirst.get(first) ?? []).includes(p.id)) byFirst.set(first, [...(byFirst.get(first) ?? []), p.id]);
  }
  for (const [first, ids] of byFirst) {
    const m = new RegExp(`(?<![\\p{L}])${esc(first)}(?![\\p{L}])`, "u").exec(rest);
    if (!m || ids.length !== 1) continue; // a name two people share names no one
    // "Kai Ellis" is not Kai Hale, and "Aaron Moss" is not Aaron Wells: a first name
    // followed by some other capitalized word is somebody else's full name. (His own people's
    // full names were already taken above.)
    if (/^\s+\p{Lu}[\p{L}'-]+/u.test(rest.slice(m.index + m[0].length))) continue;
    take(ids[0]!, m);
  }
  if (!found.length) return [];
  found.sort((x, y) => x.at - y.at);
  // "Jordan to ...": the title opens with a person who has the next step.
  const opener = found[0]!;
  const theyDo = !title.slice(0, opener.at).trim() && THEY_DO.test(title.slice(opener.end));
  return found.map((f, i) => ({ id: f.id, waiting: theyDo && i === 0 }));
}

/** The one person a title names, when it names exactly one. (For callers that want a single answer.) */
export function personNamedIn(title: string, people: Named[]): { id: string } | null {
  const all = peopleNamedIn(title, people);
  return all.length === 1 ? { id: all[0]!.id } : null;
}

async function peopleNamedInTitle(ctx: Ctx, title: string) {
  return peopleNamedIn(title, await ctx.db.all<{ id: string; name: string; aliases: string }>(`SELECT id, name, aliases FROM people WHERE archived_at IS NULL`, []));
}

// ---------- the people on a task ----------

type OnTask = { person_id: string; waiting: boolean; one_on_one: boolean };

/** The people on a task, in the order they were put on it. */
export async function taskPeople(db: Ctx["db"], taskId: string): Promise<OnTask[]> {
  const rows = await db.all<{ person_id: string; waiting: number; one_on_one: number }>(`SELECT person_id, waiting, one_on_one FROM task_people WHERE task_id = ? ORDER BY rowid`, [taskId]);
  return rows.map((r) => ({ person_id: r.person_id, waiting: !!r.waiting, one_on_one: !!r.one_on_one }));
}

/** One entry per person; the first one given for a person wins. */
function tidyPeople(list: { person_id: string; waiting?: boolean; one_on_one?: boolean }[]): OnTask[] {
  const seen = new Set<string>();
  return list.filter((p) => !seen.has(p.person_id) && seen.add(p.person_id)).map((p) => ({ person_id: p.person_id, waiting: !!p.waiting, one_on_one: !!p.one_on_one }));
}

/** The summary columns for a set of people: the lead person, and whether he is waiting on them. */
function leadOf(people: OnTask[]): { person_id: string | null; side: "mine" | "theirs" | null } {
  const lead = people.find((p) => p.waiting) ?? people[0];
  if (!lead) return { person_id: null, side: null };
  return { person_id: lead.person_id, side: lead.waiting ? "theirs" : "mine" };
}

const same = (a: OnTask, b: OnTask) => a.person_id === b.person_id && a.waiting === b.waiting && a.one_on_one === b.one_on_one;

/** Make the people on a task exactly `want`. Each row put on or taken off is in the audit log. */
async function writeTaskPeople(ctx: Ctx, taskId: string, want: OnTask[]): Promise<void> {
  const have = await taskPeople(ctx.db, taskId);
  const row = (p: OnTask) => ({ task_id: taskId, person_id: p.person_id, waiting: p.waiting ? 1 : 0, one_on_one: p.one_on_one ? 1 : 0 });
  for (const h of have) {
    if (want.some((w) => same(w, h))) continue;
    await deleteJoinRow(ctx.db, "task_people", row(h));
    await recordAudit(ctx, "delete_soft", "task_people", row(h), null);
  }
  for (const w of want) {
    if (have.some((h) => same(h, w))) continue;
    await insertRow(ctx.db, "task_people", row(w), true);
    await recordAudit(ctx, "create", "task_people", null, row(w));
  }
}

export async function getTask(ctx: Pick<Ctx, "db">, id: string): Promise<Task | null> {
  return ctx.db.first<Task>(`SELECT * FROM tasks WHERE id = ?`, [id]);
}

/** The task that came from this source (an email thread, an OmniFocus id), if there is one. */
export async function taskBySource(db: Ctx["db"], sourceRef: string): Promise<Task | null> {
  return db.first<Task>(`SELECT * FROM tasks WHERE source_ref = ? ORDER BY created_at LIMIT 1`, [sourceRef]);
}

export async function addTask(ctx: Ctx, input: unknown): Promise<Task> {
  const { tags, discuss: asked, people: given, ...data } = taskCreateSchema.parse(input);
  // Something that came from elsewhere (OmniFocus, an email) is only ever added once.
  if (data.source_ref) {
    const existing = await taskBySource(ctx.db, data.source_ref);
    if (existing) return existing;
  }
  if (data.project_id) await mustProject(ctx, data.project_id);
  // Who is on it: the list given; or the one person given the short way (person_id, with side
  // "theirs" meaning he is waiting on them and `discuss` meaning it goes on their 1:1 list);
  // or, when no one was given, the people the title names.
  const people: OnTask[] = given
    ? tidyPeople(given)
    : data.person_id
      ? [{ person_id: data.person_id, waiting: !asked && data.side === "theirs", one_on_one: asked }]
      : (await peopleNamedInTitle(ctx, data.title)).map((p) => ({ person_id: p.id, waiting: p.waiting, one_on_one: false }));
  for (const p of people) await mustPerson(ctx, p.person_id);
  const lead = leadOf(people);
  data.person_id = lead.person_id;
  if (lead.side) data.side = lead.side;
  // Tasks on a project are ordered within it; the ones on their own share one order.
  const max = await ctx.db.first<{ m: number | null }>(
    data.project_id ? `SELECT MAX(sort_order) AS m FROM tasks WHERE project_id = ? AND deleted_at IS NULL` : `SELECT MAX(sort_order) AS m FROM tasks WHERE project_id IS NULL AND deleted_at IS NULL`,
    data.project_id ? [data.project_id] : [],
  );
  const now = nowIso();
  const typed = hashtags(data.title);
  const row: Task = {
    id: newId("tsk"),
    ...data,
    discuss: 0,
    title: typed.length ? stripHashtags(data.title) : data.title,
    area: data.project_id ? null : data.area ?? "work",
    waiting_since: data.person_id && data.side === "theirs" ? now : null,
    sort_order: (max?.m ?? -1) + 1,
    done_at: data.status === "done" ? now : null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  await insertRow(ctx.db, "tasks", row as any);
  await recordAudit(ctx, "create", "tasks", null, row as any);
  if (people.length) await writeTaskPeople(ctx, row.id, people);
  const allTags = [...(tags ?? []), ...typed];
  if (allTags.length) await setItemTags(ctx, "task", row.id, allTags);
  await touchProjects(ctx.db, [row.project_id]);
  return row;
}

export async function updateTask(ctx: Ctx, id: string, input: unknown): Promise<Task> {
  const { tags, discuss, people: given, ...patch } = taskUpdateSchema.parse(input);
  const before = await getTask(ctx, id);
  if (!before) throw new NotFoundError(`No task with id ${id}`);
  if (patch.person_id !== undefined) await mustPerson(ctx, patch.person_id);
  if (patch.project_id) await mustProject(ctx, patch.project_id);
  const now = nowIso();
  const next = { ...before, ...patch } as Task;
  // Who is on it. `people` is the full new list. The short fields change the lead person
  // only: person_id swaps them (null takes them off), side says whether he is waiting on
  // them, discuss puts it on (or takes it off) their 1:1 list.
  const current = await taskPeople(ctx.db, id);
  let people = current;
  if (given) people = tidyPeople(given);
  else if (patch.person_id !== undefined || patch.side !== undefined || discuss !== undefined) {
    const who = patch.person_id !== undefined ? patch.person_id : before.person_id;
    const was = current.find((p) => p.person_id === before.person_id);
    people = current.filter((p) => p.person_id !== before.person_id && p.person_id !== who);
    if (who) people.unshift({ person_id: who, waiting: patch.side ? patch.side === "theirs" : was?.waiting ?? true, one_on_one: discuss ?? was?.one_on_one ?? false });
  }
  if (given) for (const p of people) await mustPerson(ctx, p.person_id);
  const lead = leadOf(people);
  next.person_id = lead.person_id;
  next.side = lead.side ?? before.side;
  next.discuss = 0;
  // Hashtags typed into a reworded title are added to the tags the task already has.
  const typed = patch.title ? hashtags(patch.title) : [];
  if (typed.length) next.title = stripHashtags(patch.title!);
  // A task on a project takes the project's desk; one taken off a project needs a desk of its own.
  if (next.project_id) next.area = null;
  else if (!next.area) next.area = (before.project_id ? (await ctx.db.first<{ area: Task["area"] }>(`SELECT area FROM projects WHERE id = ?`, [before.project_id]))?.area : null) ?? "work";
  // The clock on "waiting for 12 days" starts when the task starts waiting on that person.
  const waits = (t: Task) => !!t.person_id && t.side === "theirs";
  if (!waits(next)) next.waiting_since = null;
  else if (!waits(before) || before.person_id !== next.person_id) next.waiting_since = now;
  if (patch.status === "done" && before.status !== "done") next.done_at = now;
  if (patch.status && patch.status !== "done") next.done_at = null;
  if (tags || typed.length) {
    const current = tags ?? (await ctx.db.all<{ name: string }>(`SELECT t.name FROM task_tags j JOIN tags t ON t.id = j.tag_id WHERE j.task_id = ?`, [id])).map((t) => t.name);
    await setItemTags(ctx, "task", id, [...current, ...typed]);
  }
  const peopleChanged = JSON.stringify(people) !== JSON.stringify(current);
  if (peopleChanged) await writeTaskPeople(ctx, id, people);
  const changed = changedKeys(before as any, next as any);
  if (!changed.length) return before;
  next.updated_at = now;
  await updateRow(ctx.db, "tasks", before as any, next as any);
  await recordAudit(ctx, "update", "tasks", before as any, next as any);
  if (!changed.every((k) => k === "sort_order")) await touchProjects(ctx.db, [before.project_id, next.project_id]);
  // Finishing a task on a project leaves a line on that project's timeline.
  if (patch.status === "done" && before.status !== "done" && before.project_id) {
    await addEntry(ctx, {
      project_id: before.project_id,
      kind: "task_done",
      title: before.title,
      person_ids: people.map((p) => p.person_id),
      source: sourceForActor(ctx.actor),
    });
  }
  return next;
}

export async function completeTask(ctx: Ctx, id: string): Promise<Task> {
  return updateTask(ctx, id, { status: "done" });
}

export async function deleteTask(ctx: Ctx, id: string): Promise<void> {
  const before = await getTask(ctx, id);
  if (!before) throw new NotFoundError(`No task with id ${id}`);
  if (before.deleted_at) return;
  const next = { ...before, deleted_at: nowIso() };
  await updateRow(ctx.db, "tasks", before as any, next);
  await recordAudit(ctx, "delete_soft", "tasks", before as any, next);
  await touchProjects(ctx.db, [before.project_id]);
}

/** Set task order to match this list of IDs. */
export async function reorderTasks(ctx: Ctx, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i++) {
    const t = await getTask(ctx, ids[i]!);
    if (!t) throw new NotFoundError(`No task with id ${ids[i]}`);
    if (t.sort_order !== i) await updateTask(ctx, t.id, { sort_order: i });
  }
}

export async function addLink(ctx: Ctx, input: unknown): Promise<Link> {
  const data = linkCreateSchema.parse(input);
  await mustProject(ctx, data.project_id);
  const row: Link = { id: newId("lnk"), ...data, pinned: data.pinned ? 1 : 0, created_at: nowIso(), deleted_at: null };
  await insertRow(ctx.db, "links", row as any);
  await recordAudit(ctx, "create", "links", null, row as any);
  await touchProjects(ctx.db, [row.project_id]);
  return row;
}

export async function updateLink(ctx: Ctx, id: string, input: unknown): Promise<Link> {
  const patch = linkUpdateSchema.parse(input);
  const before = await ctx.db.first<Link>(`SELECT * FROM links WHERE id = ?`, [id]);
  if (!before) throw new NotFoundError(`No link with id ${id}`);
  const next = { ...before, ...patch, pinned: patch.pinned === undefined ? before.pinned : patch.pinned ? 1 : 0 } as Link;
  if (!changedKeys(before as any, next as any).length) return before;
  await updateRow(ctx.db, "links", before as any, next as any);
  await recordAudit(ctx, "update", "links", before as any, next as any);
  return next;
}

export async function deleteLink(ctx: Ctx, id: string): Promise<void> {
  const before = await ctx.db.first<Link>(`SELECT * FROM links WHERE id = ?`, [id]);
  if (!before) throw new NotFoundError(`No link with id ${id}`);
  if (before.deleted_at) return;
  const next = { ...before, deleted_at: nowIso() };
  await updateRow(ctx.db, "links", before as any, next);
  await recordAudit(ctx, "delete_soft", "links", before as any, next);
}
