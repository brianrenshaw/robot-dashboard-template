// export.ts
// Full JSON export, the offline HTML snapshot, the markdown snapshot for the repo,
// and the iCalendar feed. All of them start from exportAll().

import { looseNotes } from "./daylog";
import type { Db } from "./db";
import type { AgendaItem, BlockResult, DailyLog, Digest, Entry, Link, OneOnOne, Person, Project, QueueItem, Run, Task } from "./types";
import { DEFAULT_TZ, nowIso } from "./util";

export const EXPORT_TABLES = [
  "projects",
  "people",
  "project_people",
  "entries",
  "entry_people",
  "entry_projects",
  "tasks",
  "links",
  "tags",
  "project_tags",
  "digests",
  "daily_logs",
  "block_results",
  "settings",
  "queue_items",
  "runs",
  "one_on_ones",
  "agenda_items",
] as const;

export interface ExportData {
  exported_at: string;
  tables: {
    projects: Project[];
    people: Person[];
    project_people: { project_id: string; person_id: string; role: string }[];
    entries: Entry[];
    entry_people: { entry_id: string; person_id: string }[];
    entry_projects: { entry_id: string; project_id: string }[];
    tasks: Task[];
    links: Link[];
    tags: { id: string; name: string; created_at: string }[];
    project_tags: { project_id: string; tag_id: string }[];
    digests: Digest[];
    daily_logs: DailyLog[];
    block_results: BlockResult[];
    settings: { key: string; value: string }[];
    queue_items: QueueItem[];
    runs: Run[];
    one_on_ones: OneOnOne[];
    agenda_items: AgendaItem[];
  };
}

/** Everything, including archived and soft deleted rows. The audit log is left out. */
export async function exportAll(db: Db): Promise<ExportData> {
  const tables: Record<string, unknown[]> = {};
  for (const t of EXPORT_TABLES) tables[t] = await db.all(`SELECT * FROM ${t}`);
  return { exported_at: nowIso(), tables: tables as ExportData["tables"] };
}

const AREA_LABEL: Record<string, string> = { work: "Work", personal: "Personal", side_business: "Side business" };
const STATUS_ORDER = ["active", "waiting", "idea", "paused", "done", "archived"];

/** Convenience view over an export: lookups used by the HTML, markdown and calendar outputs. */
function index(data: ExportData) {
  const t = data.tables;
  const people = new Map(t.people.map((p) => [p.id, p]));
  const projects = new Map(t.projects.map((p) => [p.id, p]));
  const entryPeople = new Map<string, string[]>();
  for (const r of t.entry_people) entryPeople.set(r.entry_id, [...(entryPeople.get(r.entry_id) ?? []), r.person_id]);
  const extraProjects = new Map<string, string[]>();
  for (const r of t.entry_projects) extraProjects.set(r.entry_id, [...(extraProjects.get(r.entry_id) ?? []), r.project_id]);
  const tagName = new Map(t.tags.map((x) => [x.id, x.name]));
  const projectTags = new Map<string, string[]>();
  for (const r of t.project_tags) projectTags.set(r.project_id, [...(projectTags.get(r.project_id) ?? []), tagName.get(r.tag_id) ?? ""]);
  const liveEntries = t.entries.filter((e) => !e.deleted_at).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const entriesFor = (projectId: string) =>
    liveEntries.filter((e) => e.project_id === projectId || (extraProjects.get(e.id) ?? []).includes(projectId));
  const entriesForPerson = (personId: string) => liveEntries.filter((e) => (entryPeople.get(e.id) ?? []).includes(personId));
  const peopleOn = (projectId: string) =>
    t.project_people
      .filter((r) => r.project_id === projectId)
      .map((r) => ({ person: people.get(r.person_id), role: r.role }))
      .filter((x): x is { person: Person; role: string } => !!x.person);
  const projectsOf = (personId: string) =>
    t.project_people
      .filter((r) => r.person_id === personId)
      .map((r) => ({ project: projects.get(r.project_id), role: r.role }))
      .filter((x): x is { project: Project; role: string } => !!x.project && !x.project.archived_at);
  const tasksFor = (projectId: string) =>
    t.tasks.filter((x) => x.project_id === projectId && !x.deleted_at).sort((a, b) => a.sort_order - b.sort_order);
  const linksFor = (projectId: string) => t.links.filter((x) => x.project_id === projectId && !x.deleted_at);
  return { people, projects, entryPeople, projectTags, entriesFor, entriesForPerson, peopleOn, projectsOf, tasksFor, linksFor };
}

function fmtDate(iso: string | null, tz: string): string {
  if (!iso) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
  }
  return new Date(iso).toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function oneLine(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

// ---------- Markdown snapshot (committed nightly by the backup job) ----------

/** Returns a map of file path (relative to snapshot/) to markdown content. */
export function snapshotFiles(data: ExportData, tz: string = DEFAULT_TZ): Record<string, string> {
  const ix = index(data);
  const t = data.tables;
  const files: Record<string, string> = {};
  const live = t.projects.filter((p) => !p.archived_at);
  const lines: string[] = [
    "# Project dashboard snapshot",
    "",
    `Generated ${fmtDate(data.exported_at, tz)}. This folder is rebuilt every night from the database. Do not edit it by hand.`,
    "",
  ];
  for (const area of ["work", "side_business", "personal"]) {
    const list = live
      .filter((p) => p.area === area)
      .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.title.localeCompare(b.title));
    if (!list.length) continue;
    lines.push(`## ${AREA_LABEL[area]}`, "", "| Project | Status | Next step | Due |", "| --- | --- | --- | --- |");
    for (const p of list) {
      lines.push(`| [${p.title}](projects/${p.slug}.md) | ${p.status} | ${oneLine(p.next_step).replace(/\|/g, "/")} | ${p.due_date ?? ""} |`);
    }
    lines.push("");
  }
  lines.push("## People", "");
  for (const p of t.people.filter((x) => !x.archived_at).sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`- [${p.name}](people/${p.slug}.md)${p.role ? `, ${p.role}` : ""}${p.organization ? `, ${p.organization}` : ""}`);
  }
  // The daily log, newest day first, in one file.
  const logged = (t.daily_logs ?? []).filter((l) => l.body.trim() || l.notes.trim()).sort((a, b) => b.day.localeCompare(a.day));
  if (logged.length) {
    lines.push("", "## Daily log", "", `[${logged.length} ${logged.length === 1 ? "day" : "days"}](log.md)`);
    const out: string[] = ["# Daily log", "", "What the owner worked on, day by day, newest first.", ""];
    for (const l of logged) {
      out.push(`## ${new Date(`${l.day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" })}`, "");
      if (l.body.trim()) out.push(l.body.trim(), "");
      // Notes the write-up already covers are not listed a second time.
      const said = looseNotes(l);
      if (said.length) out.push(...(l.body.trim() ? ["Also, in his words:", ""] : []), ...said.map((x) => `- ${x}`), "");
    }
    files["log.md"] = out.join("\n") + "\n";
  }
  files["index.md"] = lines.join("\n") + "\n";

  for (const p of t.projects) {
    const out: string[] = [`# ${p.title}`, ""];
    out.push(`- ID: ${p.id}`, `- Area: ${AREA_LABEL[p.area]}`, `- Status: ${p.status}${p.archived_at ? " (archived)" : ""}`, `- Priority: ${p.priority}`);
    if (p.due_date) out.push(`- Due: ${p.due_date}`);
    if (p.start_date) out.push(`- Started: ${p.start_date}`);
    const tags = ix.projectTags.get(p.id);
    if (tags?.length) out.push(`- Tags: ${tags.join(", ")}`);
    out.push(`- Last activity: ${fmtDate(p.last_activity_at, tz)}`, "");
    if (p.summary) out.push(p.summary, "");
    if (p.next_step) out.push(`**Next step:** ${p.next_step}`, "");
    if (p.waiting_on) out.push(`**Waiting on:** ${p.waiting_on}`, "");
    const people = ix.peopleOn(p.id);
    if (people.length) {
      out.push("## People", "");
      for (const { person, role } of people) out.push(`- [${person.name}](../people/${person.slug}.md) (${role})`);
      out.push("");
    }
    const tasks = ix.tasksFor(p.id);
    if (tasks.length) {
      out.push("## Tasks", "");
      for (const task of tasks) {
        const who = task.person_id ? ix.people.get(task.person_id)?.name : null;
        out.push(`- [${task.status === "done" ? "x" : " "}] ${task.title}${task.due_date ? ` (due ${task.due_date})` : ""}${who ? `, ${who}` : ""}`);
      }
      out.push("");
    }
    const links = ix.linksFor(p.id);
    if (links.length) {
      out.push("## Links", "");
      for (const l of links) out.push(`- [${l.label}](${l.url}) (${l.kind})`);
      out.push("");
    }
    if (p.notes.trim()) out.push("## Notes", "", p.notes.trim(), "");
    const entries = ix.entriesFor(p.id);
    if (entries.length) {
      out.push("## Timeline", "");
      for (const e of entries) {
        const who = (ix.entryPeople.get(e.id) ?? []).map((id) => ix.people.get(id)?.name).filter(Boolean);
        out.push(`### ${fmtDate(e.occurred_at, tz)}, ${e.kind}${e.title ? `: ${e.title}` : ""}`, "");
        if (who.length) out.push(`With ${who.join(", ")}.`, "");
        if (e.body.trim()) out.push(e.body.trim(), "");
        if (e.url) out.push(`Link: ${e.url}`, "");
        out.push(`_Written by ${e.created_by}_`, "");
      }
    }
    files[`projects/${p.slug}.md`] = out.join("\n") + "\n";
  }

  for (const person of t.people) {
    const out: string[] = [`# ${person.name}`, ""];
    out.push(`- ID: ${person.id}`);
    if (person.role) out.push(`- Role: ${person.role}`);
    if (person.organization) out.push(`- Organization: ${person.organization}`);
    if (person.email) out.push(`- Email: ${person.email}`);
    const entries = ix.entriesForPerson(person.id);
    if (entries[0]) out.push(`- Last talked: ${fmtDate(entries[0].occurred_at, tz)}`);
    out.push("");
    const projects = ix.projectsOf(person.id);
    if (projects.length) {
      out.push("## Projects", "");
      for (const { project, role } of projects) out.push(`- [${project.title}](../projects/${project.slug}.md) (${role}, ${project.status})`);
      out.push("");
    }
    if (person.notes.trim()) out.push("## Notes", "", person.notes.trim(), "");
    if (entries.length) {
      out.push("## Timeline", "");
      for (const e of entries.slice(0, 100)) {
        const proj = e.project_id ? ix.projects.get(e.project_id)?.title : null;
        out.push(`- ${fmtDate(e.occurred_at, tz)}, ${e.kind}${e.title ? `: ${oneLine(e.title)}` : ""}${proj ? ` (${proj})` : ""}`);
      }
      out.push("");
    }
    files[`people/${person.slug}.md`] = out.join("\n") + "\n";
  }
  return files;
}

// ---------- Offline HTML (one self contained file) ----------

function esc(s: string | null | undefined): string {
  return (s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function exportHtml(data: ExportData, tz: string = DEFAULT_TZ): string {
  const ix = index(data);
  const t = data.tables;
  const live = t.projects
    .filter((p) => !p.archived_at)
    .sort((a, b) => a.area.localeCompare(b.area) || STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.title.localeCompare(b.title));
  const projectHtml = live
    .map((p) => {
      const people = ix.peopleOn(p.id).map(({ person }) => esc(person.name)).join(", ");
      const tasks = ix.tasksFor(p.id)
        .map((x) => `<li class="${x.status === "done" ? "done" : ""}">${esc(x.title)}${x.due_date ? ` <span class="m">due ${esc(x.due_date)}</span>` : ""}</li>`)
        .join("");
      const links = ix.linksFor(p.id).map((l) => `<li><a href="${esc(l.url)}">${esc(l.label)}</a></li>`).join("");
      const entries = ix.entriesFor(p.id)
        .slice(0, 30)
        .map(
          (e) =>
            `<li><span class="m">${esc(fmtDate(e.occurred_at, tz))} · ${esc(e.kind)}</span> ${esc(e.title)}${e.body ? `<div class="b">${esc(e.body)}</div>` : ""}${e.url ? ` <a href="${esc(e.url)}">link</a>` : ""}</li>`,
        )
        .join("");
      return `<section id="${esc(p.slug)}"><h2>${esc(p.title)}</h2>
<p class="m">${esc(AREA_LABEL[p.area])} · ${esc(p.status)}${p.due_date ? ` · due ${esc(p.due_date)}` : ""}${people ? ` · ${people}` : ""}</p>
${p.next_step ? `<p><b>Next step:</b> ${esc(p.next_step)}</p>` : ""}${p.waiting_on ? `<p><b>Waiting on:</b> ${esc(p.waiting_on)}</p>` : ""}
${p.summary ? `<p>${esc(p.summary)}</p>` : ""}${tasks ? `<h3>Tasks</h3><ul>${tasks}</ul>` : ""}${links ? `<h3>Links</h3><ul>${links}</ul>` : ""}
${p.notes ? `<h3>Notes</h3><div class="b">${esc(p.notes)}</div>` : ""}${entries ? `<h3>Timeline</h3><ul class="tl">${entries}</ul>` : ""}</section>`;
    })
    .join("\n");
  const toc = live.map((p) => `<li><a href="#${esc(p.slug)}">${esc(p.title)}</a> <span class="m">${esc(p.status)}</span></li>`).join("");
  const people = t.people
    .filter((p) => !p.archived_at)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => `<li><b>${esc(p.name)}</b> <span class="m">${esc([p.role, p.organization, p.email].filter(Boolean).join(" · "))}</span></li>`)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Project dashboard snapshot</title><style>
:root{--bg:#fbfbfa;--fg:#1d1d1f;--m:#6e6e73;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#161618;--fg:#ececee;--m:#9a9aa0;--card:#1f1f22}}
body{background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Inter",system-ui,sans-serif;max-width:860px;margin:0 auto;padding:24px 16px}
section{background:var(--card);border-radius:12px;padding:16px 20px;margin:16px 0;box-shadow:0 1px 2px rgba(0,0,0,.06)}
h1{font-size:22px}h2{font-size:18px;margin:0 0 4px}h3{font-size:14px;margin:16px 0 4px;color:var(--m)}
.m{color:var(--m);font-size:13px}.b{white-space:pre-wrap}.done{text-decoration:line-through;color:var(--m)}
a{color:inherit}ul{padding-left:20px}.tl li{margin:6px 0}
</style></head><body><h1>Project dashboard snapshot</h1><p class="m">Exported ${esc(fmtDate(data.exported_at, tz))}</p>
<h3>Projects</h3><ul>${toc}</ul><h3>People</h3><ul>${people}</ul>${projectHtml}</body></html>`;
}

// ---------- iCalendar feed ----------

function icsEscape(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = " " + rest.slice(74);
  }
  out.push(rest);
  return out.join("\r\n");
}

function icsDate(ymd: string) {
  return ymd.replace(/-/g, "");
}

function nextDay(ymd: string) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** All-day events for open project and task due dates. appUrl is the main dashboard URL. */
export function buildIcs(
  items: { projects: Pick<Project, "id" | "title" | "due_date" | "next_step" | "updated_at">[]; tasks: (Pick<Task, "id" | "title" | "due_date" | "updated_at" | "project_id"> & { project_title: string | null })[] },
  appUrl: string,
): string {
  const stamp = nowIso().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//project-dashboard//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Project due dates",
    "X-PUBLISHED-TTL:PT1H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  ];
  const base = appUrl.replace(/\/$/, "");
  const ev = (uid: string, date: string, summary: string, url: string, description: string) => {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}@project-dashboard`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(date)}`,
      `DTEND;VALUE=DATE:${icsDate(nextDay(date))}`,
      fold(`SUMMARY:${icsEscape(summary)}`),
      fold(`URL:${url}`),
      fold(`DESCRIPTION:${icsEscape(description ? `${description}\n${url}` : url)}`),
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  };
  for (const p of items.projects) if (p.due_date) ev(p.id, p.due_date, `Due: ${p.title}`, `${base}/projects/${p.id}`, p.next_step ? `Next step: ${p.next_step}` : "");
  for (const t of items.tasks) if (t.due_date) ev(t.id, t.due_date, t.project_title ? `${t.title} (${t.project_title})` : t.title, t.project_id ? `${base}/projects/${t.project_id}` : `${base}/tasks`, "");
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

/** Fetch what the calendar needs and build the feed. */
export async function calendarFeed(db: Db, appUrl: string): Promise<string> {
  const projects = await db.all<Project>(
    `SELECT * FROM projects WHERE due_date IS NOT NULL AND archived_at IS NULL AND status NOT IN ('done','archived')`,
  );
  const tasks = await db.all<Task & { project_title: string | null }>(
    `SELECT t.*, p.title AS project_title FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
     WHERE t.due_date IS NOT NULL AND t.deleted_at IS NULL AND t.status != 'done' AND (t.project_id IS NULL OR p.archived_at IS NULL)`,
  );
  return buildIcs({ projects, tasks }, appUrl);
}
