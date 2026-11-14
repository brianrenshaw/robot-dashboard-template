// Tests for tasks that stand on their own, tags, and the tag view.
import { describe, expect, it } from "vitest";
import {
  addEntry, addTask, createPerson, createProject, getHome, getPersonDetail, getTagView, hashtags, listProjects, listTags, listTasks,
  stripHashtags, undoAudit, lastAuditBy, updateEntry, updateTask, waitingOn, whoseMove,
} from "../src";
import { ctx } from "./helpers";

describe("tasks without a project", () => {
  it("keeps a one-off task, a task waiting on someone, and a task on a project side by side", async () => {
    const c = ctx();
    const sam = await createPerson(c, { name: "Sam Fields", area: "work" });
    const pricing = await createProject(c, { title: "December 1 pricing meeting", area: "work" });

    const oneOff = await addTask(c, { title: "Renew the parking pass #admin", area: "personal" });
    const waiting = await addTask(c, { title: "Map the Hillside admissions process after acceptance", person_id: sam.id, due_date: "2026-12-05", tags: ["admissions", "Hillside"] });
    const onProject = await addTask(c, { title: "Pull last year's fee table", project_id: pricing.id, area: "personal" });

    expect(oneOff).toMatchObject({ title: "Renew the parking pass", project_id: null, area: "personal" });
    expect(waiting).toMatchObject({ project_id: null, area: "work" }); // work unless told otherwise
    expect(onProject.area).toBeNull(); // the project's desk wins

    const all = await listTasks(c.db);
    expect(all.map((t) => [t.title, t.project_title, t.project_area, t.person_name, t.tags])).toEqual([
      ["Map the Hillside admissions process after acceptance", null, "work", "Sam Fields", ["admissions", "Hillside"]],
      ["Renew the parking pass", null, "personal", null, ["admin"]],
      ["Pull last year's fee table", "December 1 pricing meeting", "work", null, []],
    ]);
    expect((await listTasks(c.db, { who: "mine" })).map((t) => t.title)).toEqual(["Renew the parking pass", "Pull last year's fee table"]);
    expect((await listTasks(c.db, { who: "theirs" })).map((t) => t.person_name)).toEqual(["Sam Fields"]);
    expect((await listTasks(c.db, { areas: ["personal"] })).map((t) => t.title)).toEqual(["Renew the parking pass"]);
    expect((await listTasks(c.db, { tags: ["hillside"] })).map((t) => t.id)).toEqual([waiting.id]);
    expect((await listTasks(c.db, { project_id: "none" })).length).toBe(2);

    // The same tasks reach the dashboard, the waiting list and the person's page.
    const home = await getHome(c.db);
    expect(home.my_tasks.map((t) => t.title)).toEqual(["Renew the parking pass", "Pull last year's fee table"]);
    expect((await waitingOn(c.db)).tasks.map((t) => t.title)).toEqual(["Map the Hillside admissions process after acceptance"]);
    expect((await getPersonDetail(c.db, sam.id))!.open_tasks.map((t) => [t.title, t.project_title])).toEqual([["Map the Hillside admissions process after acceptance", null]]);

    // Finishing a task with no project needs no timeline; a finished one drops off the list.
    await updateTask(c, oneOff.id, { status: "done" });
    expect((await listTasks(c.db)).map((t) => t.id)).not.toContain(oneOff.id);
    expect((await listTasks(c.db, { state: "any" })).at(-1)!.id).toBe(oneOff.id);
    const last = await lastAuditBy(c.db, "web");
    expect((await undoAudit(c, last!.id)).ok).toBe(true);
    expect((await listTasks(c.db)).map((t) => t.id)).toContain(oneOff.id);
  });

  it("moves a task on and off a project, and edits its tags and notes", async () => {
    const c = ctx();
    const p = await createProject(c, { title: "Garage", area: "personal" });
    const t = await addTask(c, { title: "Order shelving" });
    expect((await updateTask(c, t.id, { project_id: p.id })).area).toBeNull();
    expect((await listTasks(c.db))[0]!.project_area).toBe("personal");
    expect((await updateTask(c, t.id, { project_id: null })).area).toBe("personal"); // keeps the desk it was on
    await updateTask(c, t.id, { tags: ["home", "errand"], notes: "The 48 inch ones." });
    await updateTask(c, t.id, { title: "Order the shelving #weekend" });
    const [now] = await listTasks(c.db);
    expect(now).toMatchObject({ title: "Order the shelving", notes: "The 48 inch ones.", tags: ["errand", "home", "weekend"] });
    await updateTask(c, t.id, { tags: ["home"] });
    expect((await listTasks(c.db))[0]!.tags).toEqual(["home"]);
  });

  it("lets a project's tasks decide whose move it is", async () => {
    const c = ctx();
    const kai = await createPerson(c, { name: "Kai Hale" });
    const p = await createProject(c, { title: "Spring travel", area: "work" });
    const card = async () => (await listProjects(c.db, {})).find((x) => x.id === p.id)!;
    expect(whoseMove(await card())).toBe("yours"); // active, nothing on it yet
    const theirs = await addTask(c, { title: "Send the calendar", project_id: p.id, person_id: kai.id });
    expect(await card()).toMatchObject({ open_task_count: 1, waiting_task_count: 1 });
    expect(whoseMove(await card())).toBe("theirs");
    await addTask(c, { title: "Approve the budget", project_id: p.id });
    expect(whoseMove(await card())).toBe("yours");
    await updateTask(c, theirs.id, { status: "done" });
    expect(whoseMove(await card())).toBe("yours");
  });
});

describe("tags", () => {
  it("reads hashtags out of text", () => {
    expect(hashtags("Call the registrar #records and #Hillside-admissions, see issue #12 #records")).toEqual(["records", "Hillside-admissions", "12"]);
    expect(hashtags("email me at a#b.com or use C# daily")).toEqual([]);
    expect(stripHashtags("Call the registrar #records today")).toBe("Call the registrar today");
    expect(stripHashtags("#records")).toBe("#records"); // never leaves an empty title
  });

  it("gathers tasks, notes and projects under one tag", async () => {
    const c = ctx();
    await createProject(c, { title: "Pricing meeting", area: "work", tags: ["budget"] });
    await addTask(c, { title: "Model both fee options #budget" });
    await addTask(c, { title: "Unrelated" });
    const { entry } = await addEntry(c, { kind: "note", title: "Call with Peter", body: "He wants the #budget summary by Tuesday. Also #MBA." });
    expect(entry.tags).toEqual(["budget", "MBA"]);

    const view = await getTagView(c.db, "#Budget");
    expect([view.tasks.map((t) => t.title), view.notes.map((n) => n.title), view.projects.map((p) => p.title)]).toEqual([["Model both fee options"], ["Call with Peter"], ["Pricing meeting"]]);
    expect((await listTags(c.db)).map((t) => [t.name, t.tasks, t.notes, t.projects])).toEqual([["budget", 1, 1, 1], ["MBA", 0, 1, 0]]);
    expect((await getHome(c.db)).tags.map((t) => t.name)).toEqual(["budget", "MBA"]);

    // The tags on a note follow its text.
    expect((await updateEntry(c, entry.id, { body: "He wants the summary by Tuesday. #MBA" })).tags).toEqual(["MBA"]);
    expect((await getTagView(c.db, "budget")).notes).toEqual([]);
  });
});

describe("views, hiding and waiting", () => {
  it("hides a task until its day, but never loses it", async () => {
    const c = ctx();
    const later = await addTask(c, { title: "Plan the January retreat", hide_until: "2999-01-05" });
    const now = await addTask(c, { title: "Sign the agreement", hide_until: "2000-01-01" }); // the day has come
    expect((await listTasks(c.db)).map((t) => t.id)).toEqual([now.id]);
    expect((await getHome(c.db)).my_tasks.map((t) => t.id)).toEqual([now.id]);
    expect((await listTasks(c.db, { hidden: "include" })).length).toBe(2);
    expect((await listTasks(c.db, { hidden: "only" })).map((t) => t.id)).toEqual([later.id]);
    await updateTask(c, later.id, { hide_until: null });
    expect((await listTasks(c.db)).length).toBe(2);
  });

  it("knows how long he has been waiting, and restarts the clock when the person changes", async () => {
    const c = ctx();
    const sam = await createPerson(c, { name: "Sam Fields" });
    const kai = await createPerson(c, { name: "Kai Hale" });
    const t = await addTask(c, { title: "Process map", person_id: sam.id });
    expect(t.waiting_since).not.toBeNull();
    await c.db.run(`UPDATE tasks SET waiting_since = '2026-01-01T00:00:00.000Z', created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?`, [t.id]);
    expect((await listTasks(c.db, { waiting_days: 12 })).map((x) => x.id)).toEqual([t.id]);
    expect((await updateTask(c, t.id, { title: "Process map v2" })).waiting_since).toBe("2026-01-01T00:00:00.000Z"); // rewording does not restart it
    expect((await updateTask(c, t.id, { person_id: kai.id })).waiting_since! > "2026-11").toBe(true);
    expect((await updateTask(c, t.id, { side: "mine" })).waiting_since).toBeNull(); // he owes it now; nobody is being waited on
    expect(await listTasks(c.db, { waiting_days: 12 })).toEqual([]);
  });

  it("combines filters, takes alternatives, and saves the result as a view", async () => {
    const { createSavedView, deleteSavedView, listSavedViews, openSavedView, updateSavedView, weekReview, taskFilterSchema } = await import("../src");
    const c = ctx("mcp:claude");
    const sam = await createPerson(c, { name: "Sam Fields" });
    const old = await addTask(c, { title: "Old thing #budget" });
    await c.db.run(`UPDATE tasks SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?`, [old.id]);
    const mail = await addTask(c, { title: "Answer the registrar", source_ref: "gmail:18f0aa11", tags: ["records"] });
    const late = await addTask(c, { title: "Fee table #budget", due_date: "2000-01-01", person_id: sam.id });
    const fresh = await addTask(c, { title: "Brand new #budget", due_date: "2999-01-01" });
    const ids = async (f: object) => (await listTasks(c.db, taskFilterSchema.parse(f))).map((t) => t.id).sort();

    expect(await ids({ tags: ["budget"] })).toEqual([old.id, late.id, fresh.id].sort());
    expect(await ids({ tags: ["budget"], due: "late" })).toEqual([late.id]);
    expect(await ids({ tags: ["budget"], who: "mine", due: "dated" })).toEqual([fresh.id]);
    expect(await ids({ text: "registrar" })).toEqual([mail.id]);
    // "Everything older than 12 days, or that has an email tied to it."
    const either = { any: [{ older_than_days: 12 }, { has_email: true }] };
    expect(await ids(either)).toEqual([old.id, mail.id].sort());
    expect(await ids({ ...either, tags: ["budget"] })).toEqual([old.id]); // alternatives narrow within the rest
    expect(() => taskFilterSchema.parse({ colour: "red" })).toThrow(); // an unknown field is refused, not ignored

    const view = await createSavedView(c, { name: "Old or from email", filter: either });
    expect((await openSavedView(c.db, view.id)).tasks.map((t) => t.id).sort()).toEqual([old.id, mail.id].sort());
    await updateTask(c, old.id, { status: "done" });
    expect((await openSavedView(c.db, view.id)).tasks.map((t) => t.id)).toEqual([mail.id]); // a view is always current
    await updateSavedView(c, view.id, { name: "Stale", pinned: false });
    expect(await listSavedViews(c.db)).toMatchObject([{ name: "Stale", pinned: false, created_by: "mcp:claude" }]);
    await deleteSavedView(c, view.id);
    expect(await listSavedViews(c.db)).toEqual([]);

    const week = await weekReview(c.db);
    expect([week.done.map((t) => t.id), week.late.map((t) => t.id)]).toEqual([[old.id], [late.id]]);
  });
});

describe("a task that names a person", () => {
  const people = [
    { id: "nina", name: "Nina Wade" },
    { id: "jon", name: "Jon" },
    { id: "joeh", name: "Jon Harper" },
    { id: "norm", name: "Ned Chang" },
    { id: "kai", name: "Kai Hale" },
  ];
  it("finds the one person a title names, and never guesses", async () => {
    const { personNamedIn } = await import("../src");
    expect(personNamedIn("Identify $6,000 in flexible aid. Discuss with Nina.", people)).toEqual({ id: "nina" });
    expect(personNamedIn("Send Kai the enrollment numbers", people)).toEqual({ id: "kai" });
    expect(personNamedIn("Talk to Jon Harper about accreditation", people)).toEqual({ id: "joeh" });
    expect(personNamedIn("Check with Jon on the data", people)).toBeNull(); // two people go by Jon
    expect(personNamedIn("Kai to send Nina the report", people)).toBeNull(); // names two people
    expect(personNamedIn("Write down the norm for late papers", people)).toBeNull(); // not a name
    expect(personNamedIn("Renew the parking pass", people)).toBeNull();
  });

  it("puts that person on a task added without one, and lists it as his own", async () => {
    const c = ctx();
    const nina = await createPerson(c, { name: "Nina Wade", area: "work" });
    const kai = await createPerson(c, { name: "Kai Hale", area: "work" });

    const talk = await addTask(c, { title: "Identify the scholarship funds. Discuss with Nina." });
    const owe = await addTask(c, { title: "Send Kai the enrollment numbers" });
    const waiting = await addTask(c, { title: "Draft the Nina onboarding plan", person_id: kai.id }); // a person was given: left alone
    // A named person is tagged: it stays his own task, and nothing goes on a 1:1 list by itself.
    expect(talk).toMatchObject({ person_id: nina.id, side: "mine", waiting_since: null });
    expect(owe).toMatchObject({ person_id: kai.id, side: "mine" });
    expect(waiting).toMatchObject({ person_id: kai.id, side: "theirs" });
    const { getTaskItem: item } = await import("../src");
    expect((await item(c.db, talk.id))!.people).toEqual([{ id: nina.id, name: "Nina Wade", waiting: false, one_on_one: false }]);
    expect((await listTasks(c.db, { who: "mine" })).map((t) => t.id).sort()).toEqual([talk.id, owe.id].sort());

    // Moving it between the three lists on a person's page.
    // Onto Kai's 1:1 list, then marked as waiting on him, then the person taken off another.
    await updateTask(c, owe.id, { discuss: true });
    expect((await item(c.db, owe.id))!.people[0]).toMatchObject({ waiting: false, one_on_one: true });
    expect(await updateTask(c, owe.id, { side: "theirs" })).toMatchObject({ side: "theirs" });
    expect((await item(c.db, owe.id))!.people[0]).toMatchObject({ waiting: true, one_on_one: true }); // still on his 1:1 list
    expect(await updateTask(c, talk.id, { person_id: null })).toMatchObject({ person_id: null });
  });
});

describe("the dashboard is for looking: dated tasks, and people by next meeting", () => {
  it("lists only tasks with a due date, orders people by the next meeting, and plans the day", async () => {
    const { getSettings, peopleComingUp, storeCalendarEvents, todayInTz, addDays, workPlan } = await import("../src");
    const c = ctx();
    const tz = (await getSettings(c.db)).timezone;
    const today = todayInTz(tz);
    await createPerson(c, { name: "Nina Wade", area: "work", email: "nina@example.edu" });
    await createPerson(c, { name: "Kai Ellis", area: "work" });
    const norm = await createPerson(c, { name: "Ned Chang", area: "work" });

    const dated = await addTask(c, { title: "File the accreditation report", due_date: today });
    const undated = await addTask(c, { title: "Think through the course page app" });
    await addTask(c, { title: "Someday idea", due_date: addDays(today, 3), hide_until: addDays(today, 30) });
    await addTask(c, { title: "Identify the scholarship funds. Discuss with Nina." });
    await addTask(c, { title: "Send the fee table", person_id: norm.id }); // waiting on Ned, no meeting

    const at = (days: number, hour: number) => new Date(Date.now() + days * 86_400_000 + hour * 3_600_000).toISOString();
    await storeCalendarEvents(c, { email: "me@example.edu", area: "work" }, [
      { id: "a", summary: "Budget review", start: { dateTime: at(2, 0) }, end: { dateTime: at(2, 1) }, attendees: [{ email: "me@example.edu", self: true }, { email: "nina@example.edu" }, { email: "x@example.edu" }] },
      { id: "b", summary: "Lunch with Kai Ellis", start: { dateTime: at(1, 0) }, end: { dateTime: at(1, 1) } },
    ], tz);

    // The dashboard: only what has a due date and is not hidden.
    expect((await getHome(c.db)).dated_tasks.map((t) => t.id)).toEqual([dated.id]);

    // People: Kai (tomorrow) before Nina (the day after), then Ned, who has no meeting.
    const people = await peopleComingUp(c.db, today);
    expect(people.map((p) => [p.name, p.next?.title ?? null, p.discuss, p.theirs])).toEqual([
      ["Kai Ellis", "Lunch with Kai Ellis", 0, 0],
      ["Nina Wade", "Budget review", 0, 0], // tagged on a task, but nothing is on her 1:1 list until he puts it there
      ["Ned Chang", null, 0, 1],
    ]);

    // What the chatbot gets: due today first; the undated task only as an option; nothing hidden.
    const plan = await workPlan(c.db, "week");
    expect(plan.due_today.map((t) => t.id)).toEqual([dated.id]);
    expect(plan.no_due_date.map((t) => t.title)).toContain(undated.title);
    expect([...plan.late, ...plan.due_today, ...plan.due_this_week, ...plan.no_due_date].map((t) => t.title)).not.toContain("Someday idea");
    expect(plan.people.map((p) => p.name)).toEqual(["Kai Ellis", "Nina Wade"]);

    // A new sync replaces who each meeting is with.
    await storeCalendarEvents(c, { email: "me@example.edu", area: "work" }, [], tz);
    expect((await peopleComingUp(c.db, today)).filter((p) => p.next)).toEqual([]);
  });
});

describe("finding things exactly", () => {
  it("matches a person by another name they go by, and searches tasks", async () => {
    const { requirePerson, search, personNamedIn } = await import("../src");
    const c = ctx();
    const nina = await createPerson(c, { name: "Nina Wade", aliases: "Nena, Nini" });
    await createPerson(c, { name: "Nena Lee" });
    expect((await requirePerson(c.db, "Nini")).id).toBe(nina.id);
    // "Nena" is Nina's other name and Nena Lee's first name: two people, so no one is picked.
    expect(personNamedIn("Discuss the budget with Nena", [{ id: "a", name: "Nina Wade", aliases: "Nena" }, { id: "b", name: "Nena Lee" }])).toBeNull();
    expect(personNamedIn("Discuss the budget with Nini", [{ id: "a", name: "Nina Wade", aliases: "Nena, Nini" }])).toEqual({ id: "a" });

    const t = await addTask(c, { title: "Identify the scholarship funds", notes: "flexible financial aid" });
    expect((await search(c.db, "scholarship aid")).tasks.map((x) => x.id)).toEqual([t.id]);
    expect((await search(c.db, "Nini")).people.map((p) => p.id)).toEqual([nina.id]);
  });
});

describe("people on a task work like tags", () => {
  it("carries several people, marks who he is waiting on, and keeps a 1:1 list per person", async () => {
    const { peopleNamedIn, getTaskItem } = await import("../src");
    const who = [{ id: "j", name: "Jordan Ahn" }, { id: "d", name: "Dylan Brooks" }, { id: "k", name: "Kai Hale" }];
    expect(peopleNamedIn("Jordan to email Dylan about the worship courses", who)).toEqual([{ id: "j", waiting: true }, { id: "d", waiting: false }]);
    expect(peopleNamedIn("Talk to Kai and Dylan about fees", who)).toEqual([{ id: "k", waiting: false }, { id: "d", waiting: false }]);
    expect(peopleNamedIn("Kai and Dylan budget meeting", who)).toEqual([{ id: "k", waiting: false }, { id: "d", waiting: false }]);
    // Someone else who shares a first name with one of his people is not that person.
    expect(peopleNamedIn("Lunch with Kai Ellis", who)).toEqual([]);
    expect(peopleNamedIn("Dylan Moss meeting", who)).toEqual([]);
    expect(peopleNamedIn("Kai Ellis and Dylan on fees", who)).toEqual([{ id: "d", waiting: false }]); // only Dylan is his
    expect(peopleNamedIn("Send Kai the numbers", who)).toEqual([{ id: "k", waiting: false }]);

    const c = ctx();
    const jon = await createPerson(c, { name: "Jordan Ahn" });
    const dylan = await createPerson(c, { name: "Dylan Brooks" });
    const t = await addTask(c, { title: "Jordan to email Dylan about the worship courses" });
    expect(t).toMatchObject({ person_id: jon.id, side: "theirs" }); // the lead: waiting on Jordan
    expect((await getTaskItem(c.db, t.id))!.people).toEqual([
      { id: jon.id, name: "Jordan Ahn", waiting: true, one_on_one: false },
      { id: dylan.id, name: "Dylan Brooks", waiting: false, one_on_one: false },
    ]);
    // It is on both people's pages, but only Jordan is being waited on.
    expect((await listTasks(c.db, { person_id: dylan.id })).map((x) => x.id)).toEqual([t.id]);
    expect(await listTasks(c.db, { person_id: dylan.id, who: "theirs" })).toEqual([]);
    expect((await listTasks(c.db, { person_id: jon.id, who: "theirs" })).map((x) => x.id)).toEqual([t.id]);

    // A new list of people replaces the old one; the summary follows.
    // Put it on Dylan's 1:1 list as well: Jordan is still the one being waited on.
    await updateTask(c, t.id, { people: [{ person_id: jon.id, waiting: true }, { person_id: dylan.id, one_on_one: true }] });
    expect((await getTaskItem(c.db, t.id))!.people.map((p) => [p.name, p.waiting, p.one_on_one])).toEqual([["Jordan Ahn", true, false], ["Dylan Brooks", false, true]]);
    const { peopleComingUp, getSettings, todayInTz } = await import("../src");
    const up = await peopleComingUp(c.db, todayInTz((await getSettings(c.db)).timezone));
    expect(up.map((p) => [p.name, p.discuss, p.theirs])).toEqual([["Dylan Brooks", 1, 0], ["Jordan Ahn", 0, 1]]);

    // A new list of people replaces the old one; the summary follows.
    const u = await updateTask(c, t.id, { people: [{ person_id: dylan.id }] });
    expect(u).toMatchObject({ person_id: dylan.id, side: "mine", waiting_since: null });
    expect(await updateTask(c, t.id, { people: [] })).toMatchObject({ person_id: null });
  });
});
