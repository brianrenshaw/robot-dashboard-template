import { describe, expect, it } from "vitest";
import {
  addDays, addEntry, addTask, completeTask, createPerson, dayFacts, exportAll, getDailyLog, getHome, lastAuditBy,
  listAudit, listDailyLogs, logDays, logNames, logNotes, looseNotes, namesIn, saveDailyLog, search, setOneOnOne, snapshotFiles, storeCalendarEvents, todayInTz, undoAudit,
} from "../src";
import { ctx } from "./helpers";

const today = todayInTz();

describe("daily log", () => {
  it("keeps one log a day: notes are added to, the write-up is replaced", async () => {
    const c = ctx("mcp:claude");
    expect(await getDailyLog(c.db, today)).toBeNull();

    await saveDailyLog(c, { add: ["Finished the budget draft"] });
    await saveDailyLog(c, { add: ["- Talked with Tom\nabout hiring", "finished the budget draft"] });
    let log = (await getDailyLog(c.db, today))!;
    // A line break inside one thing is flattened, a list dash is dropped, a repeat is not added.
    expect(logNotes(log)).toEqual(["Finished the budget draft", "Talked with Tom about hiring"]);
    expect(log.body).toBe("");

    await saveDailyLog(c, { body: "A day of meetings.\n\n## Meetings\n- 9:00 Kai Hale (1:1)" });
    await saveDailyLog(c, { body: "Mostly budget.\n\n## Meetings\n- 9:00 Kai Hale (1:1)" });
    log = (await getDailyLog(c.db, today))!;
    expect(log.body.startsWith("Mostly budget.")).toBe(true);
    expect(logNotes(log)).toHaveLength(2); // writing the day up leaves his notes alone

    expect(await listDailyLogs(c.db)).toHaveLength(1);
    expect((await getHome(c.db)).log?.day).toBe(today);
  });

  it("says nothing twice: a write-up covers the notes there were, and only later ones show beside it", async () => {
    const c = ctx("mcp:claude");
    await saveDailyLog(c, { add: ["Finished the Grant contract proposal and sent it to Jordan"] });
    // Before the day is written up, his notes are the day.
    expect(looseNotes(await getDailyLog(c.db, today))).toHaveLength(1);

    // The write-up folds that note in with the email and the task about the same thing.
    await saveDailyLog(c, { body: "- **Grant contract**: finished the proposal and sent it to Jordan Ames" });
    let log = (await getDailyLog(c.db, today))!;
    expect(logNotes(log)).toHaveLength(1); // his words are kept
    expect(looseNotes(log)).toEqual([]); // and not listed a second time

    // Said after the write-up: it shows on its own until the day is written up again.
    await saveDailyLog(c, { add: ["Called the registrar"] });
    expect(looseNotes(await getDailyLog(c.db, today))).toEqual(["Called the registrar"]);
    // Saving the same write-up again covers nothing new.
    await saveDailyLog(c, { body: "- **Grant contract**: finished the proposal and sent it to Jordan Ames" });
    expect(looseNotes(await getDailyLog(c.db, today))).toEqual(["Called the registrar"]);

    // His answer to "anything else?" is saved with the write-up that now includes it.
    await saveDailyLog(c, { add: ["Reviewed the budget"], body: "- **Grant contract**: finished the proposal and sent it to Jordan Ames\n- **Registrar**: called\n- **Budget**: reviewed" });
    log = (await getDailyLog(c.db, today))!;
    expect(logNotes(log)).toHaveLength(3);
    expect(looseNotes(log)).toEqual([]);
    expect(snapshotFiles(await exportAll(c.db))["log.md"]).not.toContain("- Called the registrar");

    // Undoing that save goes back to the day as it stood: one note not yet in the write-up.
    expect((await undoAudit(c, (await lastAuditBy(c.db, "mcp:claude"))!.id)).ok).toBe(true);
    expect(looseNotes(await getDailyLog(c.db, today))).toEqual(["Called the registrar"]);
  });

  it("logs an earlier day, lists a range newest first, and refuses a day that has not happened", async () => {
    const c = ctx("mcp:claude");
    await saveDailyLog(c, { day: addDays(today, -2), add: ["Board prep"] });
    await saveDailyLog(c, { day: addDays(today, -1), body: "Pipeline report went out." });
    await saveDailyLog(c, { add: ["Today's thing"] });
    expect((await listDailyLogs(c.db)).map((l) => l.day)).toEqual([today, addDays(today, -1), addDays(today, -2)]);
    expect((await listDailyLogs(c.db, { from: addDays(today, -2), to: addDays(today, -1) })).map((l) => l.day)).toEqual([addDays(today, -1), addDays(today, -2)]);
    await expect(saveDailyLog(c, { day: addDays(today, 1), add: ["Too soon"] })).rejects.toThrow(/has not happened/);
    await expect(saveDailyLog(c, {})).rejects.toThrow();
  });

  it("is recorded in Activity and every write can be undone, the first one included", async () => {
    const c = ctx("mcp:claude");
    await saveDailyLog(c, { add: ["Wrote the newsletter"] });
    await saveDailyLog(c, { body: "Newsletter day." });
    const audit = await listAudit(c.db);
    expect(audit.map((a) => a.summary)).toEqual([
      `Claude wrote up the log for ${today}`,
      `Claude added a note to the log for ${today}`,
      `Claude started the log for ${today}`,
    ]);
    expect(audit[0]!.link).toBe("/log");

    // Undo the write-up: the note stays.
    expect((await undoAudit(c, (await lastAuditBy(c.db, "mcp:claude"))!.id)).ok).toBe(true);
    let log = (await getDailyLog(c.db, today))!;
    expect(log.body).toBe("");
    expect(logNotes(log)).toEqual(["Wrote the newsletter"]);
    // Undo the note too: the day reads as not logged.
    expect((await undoAudit(c, (await lastAuditBy(c.db, "mcp:claude"))!.id)).ok).toBe(true);
    expect(await getDailyLog(c.db, today)).toBeNull();
    expect(await listDailyLogs(c.db)).toHaveLength(0);
    // And it can be written again afterwards.
    await saveDailyLog(c, { add: ["Second try"] });
    log = (await getDailyLog(c.db, today))!;
    expect(logNotes(log)).toEqual(["Second try"]);
  });

  it("gathers what the dashboard saw that day: meetings and who with, tasks added and finished, notes filed", async () => {
    const c = ctx();
    const kai = await createPerson(c, { name: "Kai Hale", email: "kai@example.edu" });
    await setOneOnOne(c, kai.id, { relationship: "direct" });
    await createPerson(c, { name: "Nina Wade", email: "nina@example.edu" });
    const at = (hour: number) => new Date(`${today}T${String(hour).padStart(2, "0")}:00:00Z`);
    // Around midday UTC, which is the same day in New York.
    await storeCalendarEvents(c, { email: "alex@example.edu", area: "work" }, [
      { id: "e1", summary: "Kai and Alex 1:1", start: { dateTime: at(15).toISOString() }, end: { dateTime: at(16).toISOString() }, attendees: [{ email: "alex@example.edu", self: true }, { email: "kai@example.edu" }] },
      { id: "e2", summary: "Pipeline review", start: { dateTime: at(17).toISOString() }, end: { dateTime: at(18).toISOString() }, attendees: [{ email: "alex@example.edu", self: true }, { email: "nina@example.edu" }, { email: "kai@example.edu" }] },
      { id: "e3", summary: "Next week planning", start: { date: addDays(today, 3) } },
      // No one else on it: time he set aside for himself, which is not a meeting.
      { id: "e4", summary: "Finalize the contract", start: { dateTime: at(19).toISOString() }, end: { dateTime: at(20).toISOString() } },
    ], "America/New_York");

    const done = await addTask(c, { title: "Send the pipeline numbers" });
    await completeTask(c, done.id);
    await addTask(c, { title: "Nina to draft the MBA memo" });
    await addEntry(c, { kind: "meeting", title: "1:1 with Kai", person_ids: [kai.id], source_ref: "granola:abc" });

    const f = await dayFacts(c.db, today);
    expect(f.meetings_known).toBe(true);
    expect(f.meetings.map((m) => [m.title, m.with])).toEqual([
      ["Kai and Alex 1:1", ["Kai Hale"]],
      ["Pipeline review", ["Kai Hale", "Nina Wade"]],
    ]);
    expect(f.own_time.map((o) => [o.title, o.source, o.minutes, o.kept])).toEqual([["Finalize the contract", "calendar", 60, null]]);
    expect(f.tasks_added.map((t) => t.title).sort()).toEqual(["Nina to draft the MBA memo", "Send the pipeline numbers"]);
    expect(f.tasks_added.find((t) => t.title.startsWith("Nina"))!.people.map((p) => p.name)).toEqual(["Nina Wade"]);
    expect(f.tasks_finished.map((t) => t.title)).toEqual(["Send the pipeline numbers"]);
    expect(f.notes_filed.map((e) => e.title)).toEqual(["1:1 with Kai"]);

    // A day with nothing on it, too far back for the calendar copy.
    const old = await dayFacts(c.db, addDays(today, -20));
    expect(old.meetings_known).toBe(false);
    // The copy reaches back two weeks, so a day last week can still be logged with its meetings.
    expect((await dayFacts(c.db, addDays(today, -10))).meetings_known).toBe(true);
    expect(old.tasks_added).toHaveLength(0);
    expect(old.tasks_finished).toHaveLength(0);
  });

  it("is found by search and written into the nightly snapshot", async () => {
    const c = ctx("mcp:claude");
    await saveDailyLog(c, { day: addDays(today, -1), body: "Worked on the MBA pathway with Dylan." });
    await saveDailyLog(c, { add: ["Reviewed the pathway budget"] });
    expect((await search(c.db, "pathway")).logs.map((l) => l.day)).toEqual([today, addDays(today, -1)]);
    expect((await search(c.db, "pathway dylan")).logs.map((l) => l.day)).toEqual([addDays(today, -1)]);
    expect((await search(c.db, "nothing-like-this")).logs).toHaveLength(0);

    const files = snapshotFiles(await exportAll(c.db));
    expect(files["log.md"]).toContain("Worked on the MBA pathway with Dylan.");
    expect(files["log.md"]).toContain("- Reviewed the pathway budget");
    expect(files["index.md"]).toContain("(log.md)");
  });
});

describe("the log page's list, calendar and search", () => {
  it("lists the days that have a log, and keeps the days that have every word of a search", async () => {
    const c = ctx("mcp:claude");
    await saveDailyLog(c, { day: addDays(today, -3), body: "### Pricing Review\n\n- Finished the planner" });
    await saveDailyLog(c, { day: addDays(today, -1), add: ["Sent the Grant contract to Jordan Ames"] });
    await saveDailyLog(c, { body: "- **Grant contract**: Jordan approved it" });
    // A day whose only write was undone has nothing in it, and is not a logged day.
    await saveDailyLog(c, { day: addDays(today, -6), add: ["A slip"] });
    await undoAudit(c, (await lastAuditBy(c.db, "mcp:claude"))!.id);

    expect(await logDays(c.db)).toEqual([today, addDays(today, -1), addDays(today, -3)]);
    expect((await listDailyLogs(c.db, { q: "grant" })).map((l) => l.day)).toEqual([today, addDays(today, -1)]);
    expect((await listDailyLogs(c.db, { q: "grant  ames" })).map((l) => l.day)).toEqual([addDays(today, -1)]);
    expect(await listDailyLogs(c.db, { q: "nowhere" })).toEqual([]);
  });
});

describe("the same work under the same name each day", () => {
  it("reads the names a write-up uses: its headings and the bold words its lines open with", () => {
    expect(namesIn("Mostly the contract.\n\n## Pricing Review\n\n* Finished the planner\n* Asked Ned for the **PDFs**\n\n- **Grant contract**: sent to Jordan\n- **Team Hub:** sent to the deans\n### pricing review")).toEqual([
      "Pricing Review",
      "Grant contract",
      "Team Hub",
    ]);
  });

  it("gives the names used over a stretch of days, with the days each was used on", async () => {
    const c = ctx("mcp:claude");
    await saveDailyLog(c, { day: addDays(today, -2), body: "### Discounts and Harbor plan\n\n* Categorized the funds\n\n### Northfield Institute\n\n* Sent the agreement" });
    await saveDailyLog(c, { day: addDays(today, -1), body: "## Customer Pricing Comparison Tool\n\n* Rebuilt the comparison\n\n### Northfield Institute\n\n* Confirmed the language" });
    await saveDailyLog(c, { body: "### Northfield Institute\n\n* Today is not part of what came before" });
    expect(await logNames(c.db, addDays(today, -14), addDays(today, -1))).toEqual([
      { name: "Customer Pricing Comparison Tool", days: [addDays(today, -1)] },
      { name: "Northfield Institute", days: [addDays(today, -1), addDays(today, -2)] },
      { name: "Discounts and Harbor plan", days: [addDays(today, -2)] },
    ]);
  });
});

describe("logging a conversation on an earlier day", () => {
  it("puts one line in that day's log and the detail on the person's page, both on that day", async () => {
    const c = ctx("mcp:claude");
    const friday = addDays(today, -1);
    const ross = await createPerson(c, { name: "Dana Ross" });
    await saveDailyLog(c, { day: friday, add: ["Updated Dr. Ross on the MBA pathway"] });
    await addEntry(c, { kind: "meeting", title: "Update to Dr. Ross on the MBA pathway", body: "Memo nearly done.\nHe wants it at the January meeting.", person_ids: [ross.id], occurred_at: `${friday}T17:00:00Z` });
    // Someone not on the dashboard: the note is filed with no one on it.
    await addEntry(c, { kind: "note", title: "Talked with the registrar", occurred_at: `${friday}T19:00:00Z` });

    expect(logNotes(await getDailyLog(c.db, friday))).toEqual(["Updated Dr. Ross on the MBA pathway"]);
    expect(await getDailyLog(c.db, today)).toBeNull();
    const f = await dayFacts(c.db, friday);
    expect(f.notes_filed.map((e) => [e.title, e.people.map((p) => p.name)])).toEqual([
      ["Update to Dr. Ross on the MBA pathway", ["Dana Ross"]],
      ["Talked with the registrar", []],
    ]);
  });
});
