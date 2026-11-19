import { describe, expect, it } from "vitest";
import {
  addDays, addTask, addTimeBlock, blockTally, createPerson, dayFacts, deleteTimeBlock, getHome, lastAuditBy, listAudit, listOwnTime,
  minuteOfDayIn, outcomeOf, saveBlockResult, storeCalendarEvents, todayInTz, undoAudit,
} from "../src";
import { ctx } from "./helpers";

const TZ = "America/New_York";
const today = todayInTz(TZ);
/** An hour of today in UTC that is the same day in New York. */
const at = (hour: number, min = 0) => new Date(`${today}T${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}:00Z`).toISOString();

describe("time he set aside for himself", () => {
  it("is his blocks and the calendar entries with no one else on them, not his meetings", async () => {
    const c = ctx();
    await createPerson(c, { name: "Kit Ellis" });
    const task = await addTask(c, { title: "Draft the MBA memo" });
    const start = minuteOfDayIn(at(16), TZ);
    const block = await addTimeBlock(c, { task_id: task.id, day: today, start_min: start, minutes: 60 });
    await storeCalendarEvents(c, { email: "alex@example.edu", area: "work" }, [
      { id: "solo", summary: "Finalize the contract", start: { dateTime: at(14) }, end: { dateTime: at(14, 45) } },
      { id: "mtg", summary: "Cabinet", start: { dateTime: at(15) }, end: { dateTime: at(16) }, attendees: [{ email: "alex@example.edu", self: true }, { email: "someone@example.edu" }] },
      // His chatbot's copy of the block on his calendar: the same session, listed once.
      { id: "copy", summary: "Draft the MBA memo", start: { dateTime: at(16) }, end: { dateTime: at(17) } },
      // No guests, but the title names one of his people: a meeting with him.
      { id: "lunch", summary: "Lunch with Kit Ellis", start: { dateTime: at(17) }, end: { dateTime: at(18) } },
      // A room is not a guest.
      { id: "room", summary: "Write the report", start: { dateTime: at(18) }, end: { dateTime: at(19) }, attendees: [{ email: "alex@example.edu", self: true }, { email: "room-1@example.edu", resource: true }] },
      { id: "allday", summary: "Conference", start: { date: today } },
    ], TZ);

    const own = await listOwnTime(c.db, today, today);
    expect(own.map((o) => [o.title, o.source, o.minutes])).toEqual([
      ["Finalize the contract", "calendar", 45],
      ["Draft the MBA memo", "dashboard", 60],
      ["Write the report", "calendar", 60],
    ]);
    expect(own[1]!.ref).toBe(`block:${block.id}`);

    const f = await dayFacts(c.db, today);
    // The calendar copy of his block is his own time too, so it is not among the meetings.
    expect(f.meetings.map((m) => m.title).sort()).toEqual(["Cabinet", "Conference", "Lunch with Kit Ellis"]);
    expect(f.own_time).toHaveLength(3);
  });

  it("an event synced before guests were counted stays a meeting", async () => {
    const c = ctx();
    await c.db.run(
      `INSERT INTO calendar_events (id, account, area, title, starts_at, ends_at, all_day, day, location, url, person_id) VALUES ('a:old', 'a', 'work', 'Old sync', ?, ?, 0, ?, '', NULL, NULL)`,
      [at(15), at(16), today],
    );
    expect(await listOwnTime(c.db, today, today)).toEqual([]);
    expect((await dayFacts(c.db, today)).meetings.map((m) => m.title)).toEqual(["Old sync"]);
  });

  it("keeps his answer, counts it over time, and still has it after the block or event is gone", async () => {
    const c = ctx();
    const task = await addTask(c, { title: "Draft the MBA memo" });
    const block = await addTimeBlock(c, { task_id: task.id, day: today, start_min: 9 * 60, minutes: 90 });
    await storeCalendarEvents(c, { email: "alex@example.edu", area: "work" }, [
      { id: "solo", summary: "Finalize the contract", start: { dateTime: at(15) }, end: { dateTime: at(15, 30) } },
    ], TZ);

    await saveBlockResult(c, { ref: `block:${block.id}`, kept: true });
    await saveBlockResult(c, { ref: "calendar:alex@example.edu:solo", kept: false });
    expect((await listOwnTime(c.db, today, today)).map((o) => o.kept).sort()).toEqual([false, true]);
    expect(await blockTally(c.db, addDays(today, -27), today)).toMatchObject({ kept: 1, not_kept: 1, minutes_kept: 90, minutes_not_kept: 30 });
    expect((await getHome(c.db)).block_results.map((r) => r.ref).sort()).toEqual(["block:" + block.id, "calendar:alex@example.edu:solo"].sort());

    // He changes his mind: the answer is replaced, not counted twice.
    await saveBlockResult(c, { ref: "calendar:alex@example.edu:solo", kept: true });
    expect(await blockTally(c.db, today, today)).toMatchObject({ kept: 2, not_kept: 0 });
    expect((await listAudit(c.db))[0]!.summary).toBe(`You marked the time set aside for “Finalize the contract” on ${today} as used`);

    // Undo puts the earlier answer back.
    expect((await undoAudit(c, (await lastAuditBy(c.db, "web"))!.id)).ok).toBe(true);
    expect(await blockTally(c.db, today, today)).toMatchObject({ kept: 1, not_kept: 1 });

    // The calendar copy moves on and the block is taken off: what he said still stands.
    await storeCalendarEvents(c, { email: "alex@example.edu", area: "work" }, [], TZ);
    await deleteTimeBlock(c, block.id);
    expect((await listOwnTime(c.db, today, today)).map((o) => [o.title, o.kept])).toEqual([["Draft the MBA memo", true], ["Finalize the contract", false]]);

    // Taking an answer back leaves it uncounted. Something that is not a block is refused.
    await saveBlockResult(c, { ref: `block:${block.id}`, kept: null });
    expect(await blockTally(c.db, today, today)).toMatchObject({ kept: 0, not_kept: 1 });
    await expect(saveBlockResult(c, { ref: "block:blk_nope", kept: true })).rejects.toThrow(/No time block/);
    await expect(saveBlockResult(c, { ref: "the pricing thing", kept: true })).rejects.toThrow(/not a time block/);
  });

  it("has three answers: he did the work, he did not get to it, or he did something else", async () => {
    const c = ctx();
    await storeCalendarEvents(c, { email: "alex@example.edu", area: "work" }, [
      { id: "news", summary: "Customer newsletter", start: { dateTime: at(14) }, end: { dateTime: at(15) } },
      { id: "reply", summary: "Reply to Colin", start: { dateTime: at(15) }, end: { dateTime: at(15, 30) } },
      { id: "report", summary: "Goals report", start: { dateTime: at(16) }, end: { dateTime: at(17) } },
    ], TZ);
    const ref = (id: string) => `calendar:alex@example.edu:${id}`;

    await saveBlockResult(c, { ref: ref("news"), kept: false, instead: "  Budget\n analysis " });
    await saveBlockResult(c, { ref: ref("reply"), kept: false });
    await saveBlockResult(c, { ref: ref("report"), kept: true });
    const own = await listOwnTime(c.db, today, today);
    expect(own.map((o) => [o.title, outcomeOf(o), o.instead])).toEqual([
      ["Customer newsletter", "did something else", "Budget analysis"],
      ["Reply to Colin", "did not get to it", ""],
      ["Goals report", "did the work", ""],
    ]);
    // Something else is still time that did not go to what it was for; it is counted apart as well.
    expect(await blockTally(c.db, today, today)).toMatchObject({ kept: 1, not_kept: 2, something_else: 1 });
    expect((await listAudit(c.db)).find((a) => a.summary.includes("something else"))!.summary).toBe(
      `You said the time set aside for “Customer newsletter” on ${today} went to something else: Budget analysis`,
    );
    expect((await getHome(c.db)).block_results.find((r) => r.ref === ref("news"))!.instead).toBe("Budget analysis");

    // Saying only what he did instead means he did not do what the time was for.
    await saveBlockResult(c, { ref: ref("reply"), instead: "Northfield questions" });
    // Marking it not done again, without saying more, keeps what he said he did.
    await saveBlockResult(c, { ref: ref("news"), kept: false });
    expect((await listOwnTime(c.db, today, today)).map((o) => o.instead)).toEqual(["Budget analysis", "Northfield questions", ""]);
    // "" takes the "instead" away; doing the work after all clears it too.
    await saveBlockResult(c, { ref: ref("reply"), kept: false, instead: "" });
    await saveBlockResult(c, { ref: ref("news"), kept: true });
    expect((await listOwnTime(c.db, today, today)).map((o) => [outcomeOf(o), o.instead])).toEqual([["did the work", ""], ["did not get to it", ""], ["did the work", ""]]);
    await expect(saveBlockResult(c, { ref: ref("report"), kept: true, instead: "email" })).rejects.toThrow(/no "instead"/);
    await expect(saveBlockResult(c, { ref: ref("report") })).rejects.toThrow(/Say whether/);
  });

  it("keeps the answer on the day it was for when the block is moved to another day", async () => {
    const c = ctx();
    const yesterday = addDays(today, -1);
    const on = (day: string, hour: number, min = 0) => new Date(`${day}T${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}:00Z`).toISOString();
    const sync = (day: string) =>
      storeCalendarEvents(c, { email: "alex@example.edu", area: "work" }, [{ id: "news", summary: "Customer newsletter", start: { dateTime: on(day, 15) }, end: { dateTime: on(day, 16) } }], TZ);
    const ref = "calendar:alex@example.edu:news";

    await sync(yesterday);
    await saveBlockResult(c, { ref, kept: false, instead: "Budget analysis" });
    // He did not get to it, so he drags the same calendar entry to today.
    await sync(today);

    // Yesterday still says what happened; today's session has no answer yet.
    expect((await listOwnTime(c.db, yesterday, today)).map((o) => [o.day, outcomeOf(o), o.live])).toEqual([
      [yesterday, "did something else", false],
      [today, null, true],
    ]);
    // The dashboard draws yesterday's from the answer's own copy.
    expect((await getHome(c.db)).block_results.map((r) => [r.day, r.title, r.minutes])).toEqual([[yesterday, "Customer newsletter", 60]]);

    // Answering today's is a second record, not a change to yesterday's.
    await saveBlockResult(c, { ref, kept: true });
    expect((await listOwnTime(c.db, yesterday, today)).map((o) => [o.day, outcomeOf(o)])).toEqual([[yesterday, "did something else"], [today, "did the work"]]);
    expect(await blockTally(c.db, yesterday, today)).toMatchObject({ kept: 1, not_kept: 1, something_else: 1 });

    // Yesterday's can still be changed, by naming the day.
    await saveBlockResult(c, { ref, day: yesterday, kept: false, instead: "" });
    expect((await listOwnTime(c.db, yesterday, yesterday)).map((o) => outcomeOf(o))).toEqual(["did not get to it"]);
    await expect(saveBlockResult(c, { ref, day: addDays(today, -5), kept: true })).rejects.toThrow(/No time block/);

    // Undo puts yesterday's answer back, with a key of two parts.
    expect((await undoAudit(c, (await lastAuditBy(c.db, "web"))!.id)).ok).toBe(true);
    expect((await listOwnTime(c.db, yesterday, yesterday)).map((o) => o.instead)).toEqual(["Budget analysis"]);
  });
});
