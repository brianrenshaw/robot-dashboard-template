// omnifocus.ts
// Bringing the owner's 1:1 lists in from an OmniFocus export (the JSON file his export script
// writes). OmniFocus stays his task manager; this copies across the part the dashboard tracks:
// who he has 1:1s with, and the running list for each person.
//
// How his OmniFocus is laid out, and what this does with it:
//   - A folder "1:1s" with a project per person, "1:1 · Kai Hale". Each becomes a standing 1:1.
//     The project's note (role, rhythm, team, recurring topics) becomes the 1:1's notes.
//   - Tags under "People" (Leadership, Peers, Directs ...) say how he relates to each person.
//   - The agenda for a person is every open task with their tag, wherever it lives. A task also
//     tagged "Waiting", or worded "Kai: do the thing", is something they owe him. The rest are
//     things to discuss.
//   - "Prep: Kai 1:1" tasks are reminders, not agenda, and are skipped.
// It can be run again with a newer export: each task is matched by its OmniFocus id, new ones
// are added, and ones finished in OmniFocus are checked off here. It never reopens or deletes.

import { addAgendaItem, getOneOnOneRow, setOneOnOne, updateAgendaItem } from "./oneonones";
import { createPerson, updatePerson } from "./people";
import { addTask, updateTask } from "./tasks";
import type { Ctx, Person, Relationship } from "./types";

interface OfTask {
  id: string;
  name: string;
  note?: string | null;
  status?: string;
  completed?: boolean;
  tags?: (string | { name: string })[];
  dueDate?: string | null;
  completionDate?: string | null;
  children?: OfTask[];
}
interface OfProject {
  name: string;
  note?: string | null;
  status?: string;
  tasks?: OfTask[];
}
interface OfFolder {
  name: string;
  folders?: OfFolder[];
  projects?: OfProject[];
}
interface OfTag {
  name: string;
  children?: OfTag[];
}
export interface OmniFocusExport {
  folders?: OfFolder[];
  topLevelProjects?: OfProject[];
  inbox?: OfTask[];
  tags?: OfTag[];
}

const GROUP_RELATIONSHIP: Record<string, Relationship> = { directs: "direct", leadership: "manager", peers: "peer" };
const ONE_ON_ONE_PROJECT = /^1\s*[:\-]\s*1\s*[·:\-–—]\s*(.+)$/;

function tagNames(t: OfTask): string[] {
  return (t.tags ?? []).map((x) => (typeof x === "string" ? x : x.name));
}
function isClosed(t: OfTask): "done" | "dropped" | null {
  if (t.status === "Dropped") return "dropped";
  if (t.completed || t.status === "Completed") return "done";
  return null;
}
function flatten(tasks: OfTask[] | undefined): OfTask[] {
  return (tasks ?? []).flatMap((t) => [t, ...flatten(t.children)]);
}
/** "every other Thursday" is 14, "weekly" 7, "monthly" 30. No rhythm named is 0. */
function cadenceFrom(note: string): number {
  if (/no recurring/i.test(note)) return 0;
  if (/every other|biweekly|bi-weekly|every two weeks/i.test(note)) return 14;
  if (/monthly|every month/i.test(note)) return 30;
  if (/weekly|every week/i.test(note)) return 7;
  return 0; // no rhythm named: meetings are set as they come
}
function firstLink(note: string): string | null {
  return /(https:\/\/notes\.granola\.ai\/\S+|https:\/\/mail\.superhuman\.com\/\S+|https?:\/\/\S+)/.exec(note)?.[1]?.replace(/[).,]+$/, "") ?? null;
}

export interface OmniFocusImportResult {
  people_added: number;
  one_on_ones: number;
  items_added: number;
  items_closed: number;
}

export async function importOmniFocus(ctx: Ctx, data: OmniFocusExport): Promise<OmniFocusImportResult> {
  const result: OmniFocusImportResult = { people_added: 0, one_on_ones: 0, items_added: 0, items_closed: 0 };

  // Person tag -> how the owner relates to them, from the group the tag sits under.
  const relationship = new Map<string, Relationship>();
  const walkTags = (tags: OfTag[] | undefined, group: string) => {
    for (const t of tags ?? []) {
      if (group) relationship.set(t.name.toLowerCase(), GROUP_RELATIONSHIP[group] ?? "other");
      walkTags(t.children, t.name.toLowerCase() === "people" ? "" : group || t.name.toLowerCase());
    }
  };
  for (const root of data.tags ?? []) if (root.name.toLowerCase() === "people") for (const g of root.children ?? []) walkTags(g.children, g.name.toLowerCase());

  const allProjects: OfProject[] = [...(data.topLevelProjects ?? [])];
  const walkFolders = (fs: OfFolder[] | undefined) => {
    for (const f of fs ?? []) {
      allProjects.push(...(f.projects ?? []));
      walkFolders(f.folders);
    }
  };
  walkFolders(data.folders);

  const everyone = await ctx.db.all<Person>(`SELECT * FROM people WHERE archived_at IS NULL`);
  const byName = new Map(everyone.map((p) => [p.name.toLowerCase(), p]));

  // 1. A standing 1:1 for each "1:1 · Name" project.
  const partners = new Map<string, Person>();
  for (const proj of allProjects) {
    const name = ONE_ON_ONE_PROJECT.exec(proj.name)?.[1]?.trim();
    if (!name || proj.status === "Dropped") continue;
    const note = (proj.note ?? "").trim();
    const role = note.split("\n")[0]?.trim().slice(0, 190) ?? "";
    let person = byName.get(name.toLowerCase());
    if (!person) {
      person = await createPerson(ctx, { name, role, area: "work" });
      byName.set(name.toLowerCase(), person);
      result.people_added++;
    }
    partners.set(name.toLowerCase(), person);
    const existing = await getOneOnOneRow(ctx.db, person.id);
    // The first time, take their role from OmniFocus, where the owner keeps it current.
    if (!existing && role && person.role !== role) {
      person = await updatePerson(ctx, person.id, { role });
      partners.set(name.toLowerCase(), person);
    }
    if (!existing) result.one_on_ones++;
    await setOneOnOne(ctx, person.id, {
      relationship: relationship.get(name.toLowerCase()) ?? "direct",
      // Keep a rhythm or notes he has since changed here; only fill them in the first time.
      ...(existing ? {} : { cadence_days: cadenceFrom(note), notes: note }),
    });
  }

  // 2. Every task tagged with one of those people goes on that person's list.
  const sources: { task: OfTask; inOwnProject: string | null }[] = [];
  for (const proj of allProjects) {
    const own = ONE_ON_ONE_PROJECT.exec(proj.name)?.[1]?.trim().toLowerCase() ?? null;
    for (const t of flatten(proj.tasks)) sources.push({ task: t, inOwnProject: own });
  }
  for (const t of flatten(data.inbox)) sources.push({ task: t, inOwnProject: null });

  for (const { task, inOwnProject } of sources) {
    if (/^prep:.*1\s*[:\-]\s*1/i.test(task.name)) continue; // "Prep: Kai 1:1" reminders
    const tags = tagNames(task).map((x) => x.toLowerCase());
    const who = new Set(tags.filter((x) => partners.has(x)));
    if (inOwnProject && partners.has(inOwnProject)) who.add(inOwnProject);
    if (!who.size) continue;
    const closed = isClosed(task);
    // History is only kept for tasks that lived in the person's own 1:1 project.
    if (closed && !inOwnProject) continue;
    const note = (task.note ?? "").trim();
    for (const key of who) {
      const person = partners.get(key)!;
      const first = person.name.split(/\s+/)[0]!;
      const prefix = new RegExp(`^${first}\\s*(?::|\\bto\\b)\\s*`, "i");
      const theirs = tags.includes("waiting") || prefix.test(task.name);
      const title = task.name.replace(new RegExp(`^${first}\\s*:\\s*`, "i"), "").trim();
      const cleaned = title.charAt(0).toUpperCase() + title.slice(1);
      const ref = `omnifocus:${task.id}`;
      if (theirs) {
        // Something they owe him is a task waiting on them.
        const already = await ctx.db.first<{ id: string; status: string }>(`SELECT id, status FROM tasks WHERE source_ref = ? AND person_id = ?`, [ref, person.id]);
        if (!already) {
          await addTask(ctx, { title: cleaned, notes: note, person_id: person.id, side: "theirs", area: person.area, status: closed ? "done" : "todo", due_date: task.dueDate ? task.dueDate.slice(0, 10) : null, source_ref: ref });
          result.items_added++;
        } else if (closed && already.status !== "done") {
          await updateTask(ctx, already.id, { status: "done" });
          result.items_closed++;
        }
        continue;
      }
      const { item, duplicate } = await addAgendaItem(ctx, {
        person_id: person.id,
        kind: "discuss",
        owner: null,
        title: cleaned,
        notes: note,
        status: closed ?? "open",
        due_date: task.dueDate ? task.dueDate.slice(0, 10) : null,
        url: firstLink(note),
        source_ref: ref,
      });
      if (!duplicate) result.items_added++;
      else if (closed && item.status === "open") {
        await updateAgendaItem(ctx, item.id, { status: closed });
        result.items_closed++;
      }
    }
  }
  return result;
}
