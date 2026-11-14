import { describe, expect, it } from "vitest";
import {
  addEntry, addTask, archiveProject, completeTask, createPerson, createProject, getHome,
  getPersonDetail, getProjectDetail, lastAuditBy, linkPersonToProject, listAudit, listProjects,
  listPeople, requireProject, resolveProject, search, undoAudit, updateProject, AmbiguousError,
  calendarFeed, exportAll, snapshotFiles, exportHtml, staleProjects, waitingOn, unlinkPersonFromProject,
} from "../src";
import { ctx } from "./helpers";
import type { Ctx } from "../src";

/** The same database, written to as the website instead of as an AI. */

describe("audit log", () => {
  it("records every write and can undo an update", async () => {
    const c = ctx();
    const p = await createProject(c, { title: "Garage Storage", area: "personal" });
    await updateProject(c, p.id, { next_step: "Order shelving" });
    let audit = await listAudit(c.db);
    expect(audit.map((a) => a.action)).toEqual(["update", "create"]);
    expect(audit[0]!.summary).toContain("next step");
    const undone = await undoAudit(c, audit[0]!.id);
    expect(undone.ok).toBe(true);
    const after = await getProjectDetail(c.db, p.id);
    expect(after!.next_step).toBe("");
    audit = await listAudit(c.db);
    expect(audit[0]!.actor).toBe("undo:web");
    expect((await undoAudit(c, audit[1]!.id)).ok).toBe(false); // already undone
  });

  it("only reverts the fields the undone change touched", async () => {
    const c = ctx();
    const p = await createProject(c, { title: "Decor", area: "side_business" });
    await updateProject(c, p.id, { next_step: "Ship beta" });
    await updateProject(c, p.id, { summary: "Photo framing app" });
    const [, nextStepChange] = await listAudit(c.db);
    await undoAudit(c, nextStepChange!.id);
    const d = await getProjectDetail(c.db, p.id);
    expect(d!.next_step).toBe("");
    expect(d!.summary).toBe("Photo framing app");
  });

  it("undoing a create soft deletes or archives, never hard deletes", async () => {
    const c = ctx("mcp:claude");
    const p = await createProject(c, { title: "Sorter", area: "side_business" });
    const { entry } = await addEntry(c, { project_id: p.id, kind: "note", title: "Idea" });
    const last = await lastAuditBy(c.db, "mcp:claude");
    expect(last!.row_id).toBe(entry.id);
    await undoAudit(c, last!.id);
    const row = await c.db.first<any>(`SELECT * FROM entries WHERE id = ?`, [entry.id]);
    expect(row.deleted_at).not.toBeNull();
    const audit = await listAudit(c.db, { limit: 1 });
    await undoAudit(c, (await listAudit(c.db)).find((a) => a.table_name === "projects")!.id);
    const proj = await c.db.first<any>(`SELECT * FROM projects WHERE id = ?`, [p.id]);
    expect(proj.archived_at).not.toBeNull();
    expect(audit.length).toBe(1);
  });

  it("can undo unlinking a person", async () => {
    const c = ctx();
    const p = await createProject(c, { title: "Pricing Restructuring", area: "work" });
    const per = await createPerson(c, { name: "Mark Hayes" });
    await linkPersonToProject(c, p.id, per.id, "collaborator");
    await unlinkPersonFromProject(c, p.id, per.id);
    expect((await getProjectDetail(c.db, p.id))!.people).toHaveLength(0);
    await undoAudit(c, (await listAudit(c.db, { limit: 1 }))[0]!.id);
    expect((await getProjectDetail(c.db, p.id))!.people).toHaveLength(1);
  });

  it("describes AI writes in plain language", async () => {
    const c = ctx("mcp:claude");
    const p = await createProject(c, { title: "Pricing Restructuring", area: "work" });
    await addEntry(c, { project_id: p.id, kind: "email", title: "Re: modules" });
    const [top] = await listAudit(c.db);
    expect(top!.summary).toBe("Claude added an email (“Re: modules”) to Pricing Restructuring");
  });
});

describe("projects, people and entries", () => {
  it("a status change writes a status_change entry", async () => {
    const c = ctx();
    const p = await createProject(c, { title: "MBA Pathways", area: "work" });
    await updateProject(c, p.id, { status: "waiting" });
    const d = await getProjectDetail(c.db, p.id);
    expect(d!.timeline[0]!.kind).toBe("status_change");
    expect(d!.timeline[0]!.title).toBe("Active → Waiting");
  });

  it("an entry with two people shows on the project and both person pages", async () => {
    const c = ctx("mcp:claude");
    const p = await createProject(c, { title: "Planning Offsite", area: "work" });
    const a = await createPerson(c, { name: "Dylan Brooks" });
    const b = await createPerson(c, { name: "Peter Aldin" });
    await addEntry(c, { project_id: p.id, kind: "meeting", title: "Planning", person_ids: [a.id, b.id], occurred_at: "2026-11-12T15:00:00Z" });
    const proj = await getProjectDetail(c.db, p.id);
    expect(proj!.timeline[0]!.people.map((x) => x.name).sort()).toEqual(["Dylan Brooks", "Peter Aldin"]);
    expect(proj!.timeline[0]!.created_by).toBe("mcp:claude");
    expect(proj!.timeline[0]!.source).toBe("mcp");
    for (const id of [a.id, b.id]) {
      const d = await getPersonDetail(c.db, id);
      expect(d!.timeline).toHaveLength(1);
      expect(d!.last_talked_at).toBe("2026-11-12T15:00:00.000Z");
    }
  });

  it("dedupes entries by source_ref", async () => {
    const c = ctx("mcp:claude");
    const first = await addEntry(c, { kind: "email", title: "Thread", source_ref: "gmail:abc" });
    const second = await addEntry(c, { kind: "email", title: "Thread again", source_ref: "gmail:abc" });
    expect(second.duplicate).toBe(true);
    expect(second.entry.id).toBe(first.entry.id);
  });

  it("completing a task adds a task_done entry", async () => {
    const c = ctx();
    const p = await createProject(c, { title: "Front Bed", area: "personal" });
    const t = await addTask(c, { project_id: p.id, title: "Buy mulch" });
    await completeTask(c, t.id);
    const d = await getProjectDetail(c.db, p.id);
    expect(d!.tasks[0]!.status).toBe("done");
    expect(d!.timeline.some((e) => e.kind === "task_done" && e.title === "Buy mulch")).toBe(true);
  });

  it("filters by area and person", async () => {
    const c = ctx();
    const w = await createProject(c, { title: "Work thing", area: "work" });
    await createProject(c, { title: "Home thing", area: "personal" });
    const per = await createPerson(c, { name: "Jon" });
    await linkPersonToProject(c, w.id, per.id);
    expect((await listProjects(c.db, { areas: ["work"] })).map((p) => p.title)).toEqual(["Work thing"]);
    expect((await listProjects(c.db, { person: per.id })).map((p) => p.title)).toEqual(["Work thing"]);
    expect((await listPeople(c.db, { areas: ["personal"] })).map((p) => p.name)).toEqual(["Jon"]); // no area set
    await archiveProject(c, w.id);
    expect((await listProjects(c.db)).map((p) => p.title)).toEqual(["Home thing"]);
  });

  it("fuzzy resolution returns candidates instead of guessing", async () => {
    const c = ctx();
    await createProject(c, { title: "Decor", area: "side_business" });
    await createProject(c, { title: "Decor Marketing", area: "side_business" });
    const r = await resolveProject(c.db, "decor");
    expect(r.status).toBe("found"); // exact title wins
    await expect(requireProject(c.db, "dec")).rejects.toBeInstanceOf(AmbiguousError);
    const byWords = await resolveProject(c.db, "marketing decor");
    expect(byWords.status).toBe("found");
  });

  it("home, stale, waiting and search work together", async () => {
    const c = ctx();
    const p = await createProject(c, { title: "Enrollment Reports", area: "work", waiting_on: "Jon's data pull" });
    await c.db.run(`UPDATE projects SET last_activity_at = '2026-01-01T00:00:00.000Z' WHERE id = ?`, [p.id]);
    expect((await staleProjects(c.db)).map((x) => x.id)).toEqual([p.id]);
    expect((await waitingOn(c.db)).projects.map((x) => x.id)).toEqual([p.id]);
    const home = await getHome(c.db, ["work"]);
    expect(home.stale).toHaveLength(1);
    expect((await getHome(c.db, ["personal"])).stale).toHaveLength(0);
    const s = await search(c.db, "enrollment data");
    expect(s.projects).toHaveLength(1);
  });

  it("exports JSON, markdown, HTML and a calendar feed", async () => {
    const c = ctx();
    const p = await createProject(c, { title: "Pricing, Fees; Budget", area: "work", due_date: "2026-12-04" });
    await addTask(c, { project_id: p.id, title: "Draft numbers", due_date: "2026-11-20" });
    const data = await exportAll(c.db);
    expect(data.tables.projects).toHaveLength(1);
    const files = snapshotFiles(data);
    expect(Object.keys(files)).toContain(`projects/${p.slug}.md`);
    expect(exportHtml(data)).toContain("Pricing, Fees; Budget");
    const ics = await calendarFeed(c.db, "https://example.workers.dev");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261204");
    expect(ics).toContain(String.raw`SUMMARY:Due: Pricing\, Fees\; Budget`);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });
});

describe("board moves", () => {
  it("describes a drag between columns as a move", async () => {
    const { reorderProjects } = await import("../src");
    const c = ctx();
    const p = await createProject(c, { title: "Trailhead", area: "side_business", status: "idea" });
    await reorderProjects(c, [p.id], "waiting");
    const rows = await listAudit(c.db);
    expect(rows.find((r) => r.table_name === "projects" && r.action === "update")!.summary).toBe("You moved Trailhead to waiting");
  });
});

describe("1:1s", () => {
  it("keeps a list per person and works out the next meeting from the rhythm", async () => {
    const { addAgendaItem, getOneOnOne, listOneOnOnes, setOneOnOne, updateAgendaItem } = await import("../src");
    const c = ctx();
    const kai = await createPerson(c, { name: "Kai Hale", area: "work" });
    await setOneOnOne(c, kai.id, { cadence_days: 14 });
    await addEntry(c, { kind: "meeting", title: "Kai and Alex 1:1", person_ids: [kai.id], occurred_at: "2026-11-05T13:30:00Z" });
    const topic = await addAgendaItem(c, { person_id: kai.id, title: "Preview Day numbers" });
    // What they owe him and what he owes them are tasks with the person on them: one list, not two.
    const { addTask: add, updateTask: change } = await import("../src");
    const owed = await add(c, { person_id: kai.id, title: "Forward the application to PDS", source_ref: "omnifocus:abc" });
    expect((await add(c, { person_id: kai.id, title: "again", source_ref: "omnifocus:abc" })).id).toBe(owed.id); // never added twice
    await addAgendaItem(c, { person_id: kai.id, kind: "action", title: "Not sorted yet" });

    const [card] = await listOneOnOnes(c.db, ["work"]);
    expect(card).toMatchObject({ name: "Kai Hale", discuss: 1, theirs: 1, mine: 0, unsorted: 1, next_is_estimate: true });
    expect(card!.last_met_at).toBe("2026-11-05T13:30:00.000Z");
    expect(card!.next_expected! >= card!.last_met_at!.slice(0, 10)).toBe(true);
    expect(await listOneOnOnes(c.db, ["personal"])).toHaveLength(0);

    await updateAgendaItem(c, topic.item.id, { status: "done" });
    await change(c, owed.id, { side: "mine" }); // it turns out Alex owes this one
    const detail = (await getOneOnOne(c.db, kai.id))!;
    expect(detail.sessions.map((s) => s.title)).toEqual(["Kai and Alex 1:1"]);
    expect(detail.agenda.filter((a) => a.status === "open")).toHaveLength(1);
    expect((await getPersonDetail(c.db, kai.id))!.one_on_one).toMatchObject({ mine: 1, theirs: 0 });
    expect((await getHome(c.db)).my_tasks.map((t) => t.title)).toEqual(["Forward the application to PDS"]); // what he owes someone is his to do
  });

  it("imports 1:1 lists from an OmniFocus export and can be run again", async () => {
    const { getOneOnOne, importOmniFocus, listOneOnOnes } = await import("../src");
    const c = ctx("import:omnifocus");
    const peter = await createPerson(c, { name: "Peter Aldin", role: "President" });
    const task = (id: string, name: string, tags: string[] = [], extra: object = {}) => ({ id, name, note: "", status: "Available", completed: false, tags, children: [], ...extra });
    const data = {
      tags: [{ name: "People", children: [{ name: "Leadership", children: [{ name: "Peter Aldin" }] }, { name: "Directs", children: [{ name: "Kai Hale" }] }] }, { name: "Waiting" }],
      inbox: [],
      folders: [{
        name: "Work",
        projects: [{ name: "Miscellaneous", tasks: [task("t5", "Jim Park finished the certificate", ["Peter Aldin"]), task("t6", "Old one", ["Peter Aldin"], { completed: true })] }],
        folders: [{ name: "1:1s", projects: [
          { name: "1:1 · Kai Hale", note: "Director of Admissions, Northfield\n1:1: every other Thursday 8:30", tasks: [
            task("t1", "Prep: Kai 1:1", ["Kai Hale"]),
            task("t2", "Kai: forward the application to PDS", ["Kai Hale", "Waiting"], { note: "From Oct 8 1:1. https://notes.granola.ai/d/abc" }),
            task("t3", "Ask about spring travel", ["Kai Hale"]),
            task("t4", "Finished thing", ["Kai Hale"], { completed: true, status: "Completed" }),
          ] },
          { name: "1:1 · Peter Aldin", note: "President (Alex's supervisor)", tasks: [] },
        ] }],
      }],
    };
    expect(await importOmniFocus(c, data)).toEqual({ people_added: 1, one_on_ones: 2, items_added: 4, items_closed: 0 });
    const cards = await listOneOnOnes(c.db);
    const kai = cards.find((x) => x.name === "Kai Hale")!;
    expect(kai).toMatchObject({ relationship: "direct", cadence_days: 14, role: "Director of Admissions, Northfield", discuss: 1, theirs: 1 });
    expect(cards.find((x) => x.person_id === peter.id)).toMatchObject({ relationship: "manager", discuss: 1 });
    const list = (await getOneOnOne(c.db, kai.person_id))!.agenda;
    expect(list.some((a) => a.title.startsWith("Prep"))).toBe(false);
    // "Kai: forward the application", tagged Waiting, is a task waiting on Kai.
    const { listTasks } = await import("../src");
    expect(await listTasks(c.db, { person_id: kai.person_id, who: "theirs" })).toMatchObject([{ title: "Forward the application to PDS", person_name: "Kai Hale", source_ref: "omnifocus:t2" }]);

    // A newer export: one task finished in OmniFocus, nothing duplicated.
    data.folders[0]!.folders[0]!.projects[0]!.tasks[2]!.completed = true;
    expect(await importOmniFocus(c, data)).toEqual({ people_added: 0, one_on_ones: 0, items_added: 0, items_closed: 1 });
  });

  it("measures each project's pulse", async () => {
    const { projectPulse, PULSE_WEEKS } = await import("../src");
    const c = ctx();
    const p = await createProject(c, { title: "Enrollment Reports", area: "work" });
    const now = new Date("2026-11-13T15:00:00Z");
    await addEntry(c, { project_id: p.id, kind: "note", title: "this week", occurred_at: "2026-11-12T15:00:00Z" });
    await addEntry(c, { project_id: p.id, kind: "note", title: "three weeks ago", occurred_at: "2026-10-22T15:00:00Z" });
    const t = await addTask(c, { project_id: p.id, title: "One" });
    await addTask(c, { project_id: p.id, title: "Two" });
    await completeTask(c, t.id); // also logs a task_done entry now, outside the test window
    const pulse = (await projectPulse(c.db, now))[p.id]!;
    expect(pulse.weeks).toHaveLength(PULSE_WEEKS);
    expect(pulse.weeks[PULSE_WEEKS - 1]).toBe(1);
    expect(pulse.weeks[PULSE_WEEKS - 4]).toBe(1);
    expect([pulse.tasks_done, pulse.tasks_total]).toEqual([1, 2]);
  });
});

describe("oauth key-value store", () => {
  it("gets, lists by prefix with metadata, expires and deletes", async () => {
    const { dbKv } = await import("../src");
    const kv = dbKv(ctx().db);
    await kv.put("grant:u:1", JSON.stringify({ a: 1 }), { metadata: { c: "x" } });
    await kv.put("grant:u:2", "{}", { expirationTtl: 600 });
    await kv.put("client:abc", "{}");
    await kv.put("token:old", "1", { expiration: 1 });
    expect(await kv.get("grant:u:1", { type: "json" })).toEqual({ a: 1 });
    expect(await kv.get("token:old")).toBeNull();
    const page = await kv.list({ prefix: "grant:u:", limit: 1 });
    expect(page.keys).toEqual([{ name: "grant:u:1", metadata: { c: "x" } }]);
    expect(page.list_complete).toBe(false);
    const next = await kv.list({ prefix: "grant:u:", limit: 1, cursor: page.cursor });
    expect(next.keys[0]!.name).toBe("grant:u:2");
    expect(next.list_complete).toBe(true);
    await kv.delete("grant:u:1");
    expect(await kv.get("grant:u:1")).toBeNull();
  });
});

describe("email links", () => {
  it("builds Superhuman and Gmail links from a source_ref or a Gmail link", async () => {
    const { mailLinks, mailThreadId } = await import("../src");
    expect(mailThreadId({ source_ref: "gmail:1a13ac066450e2b6", url: null })).toBe("1a13ac066450e2b6");
    // The decimal "thread-f" id in Gmail links is the same thread in hex.
    expect(mailThreadId({ source_ref: null, url: "https://mail.google.com/mail/?authuser=b@x.edu#all/thread-f:1879034612996432566" })).toBe("1a13ac066450e2b6");
    expect(mailThreadId({ source_ref: "gcal:abc", url: "https://docs.google.com/x" })).toBeNull();
    const links = mailLinks({ source_ref: "gmail:1a13ac066450e2b6", url: null }, "alex@example.edu");
    expect(links!.superhuman).toBe("https://mail.superhuman.com/alex@example.edu/thread/1a13ac066450e2b6");
    expect(links!.superhuman_app).toBe("superhuman://alex@example.edu/thread/1a13ac066450e2b6");
    expect(links!.gmail).toContain("#all/1a13ac066450e2b6");
  });
});
