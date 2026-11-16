import { describe, expect, it } from "vitest";
import { addTask, createPerson, getHome, meetingNotes, meetingPeople, saveMeetingNote, todayInTz, updateTask, weekStart } from "../src";
import { ctx } from "./helpers";

const EVENT = "alex@example.com:abc123";

async function withMeeting() {
  const c = ctx();
  const ned = await createPerson(c, { name: "Ned Chang" });
  const day = weekStart(todayInTz());
  await c.db.run(
    `INSERT INTO calendar_events (id, account, area, title, starts_at, ends_at, all_day, day, location, url, person_id) VALUES (?, 'alex@example.com', 'work', 'Ned and Alex 1:1', ?, ?, 0, ?, '', NULL, ?)`,
    [EVENT, `${day}T18:45:00.000Z`, `${day}T19:15:00.000Z`, day, ned.id],
  );
  return { c, ned, day };
}

describe("a meeting's tasks and note", () => {
  it("keeps one note per meeting, filed with its people and time, and adds to it", async () => {
    const { c, ned } = await withMeeting();
    const first = await saveMeetingNote(c, EVENT, { add: "Refund policy: confirmed, no refund after week one" });
    expect(first.kind).toBe("meeting");
    expect(first.title).toBe("Ned and Alex 1:1");
    expect(first.people.map((p) => p.id)).toEqual([ned.id]);
    expect(first.occurred_at).toContain("T18:45");
    await saveMeetingNote(c, EVENT, { add: "GPA fix goes to the provost" });
    const [note] = await meetingNotes(c.db, [EVENT]);
    expect(note!.body).toBe("Refund policy: confirmed, no refund after week one\nGPA fix goes to the provost");
    await saveMeetingNote(c, EVENT, { body: "Rewritten" });
    expect((await meetingNotes(c.db, [EVENT]))[0]!.body).toBe("Rewritten");
    expect((await getHome(c.db)).meeting_notes).toHaveLength(1);
  });

  it("will not start a note for a meeting the calendar does not have", async () => {
    const c = ctx();
    await expect(saveMeetingNote(c, "nope:1", { add: "x" })).rejects.toThrow(/not on the calendar/);
    await expect(saveMeetingNote(c, "nope:1", {})).rejects.toThrow();
  });

  it("ties a task to a meeting, and lets it go", async () => {
    const { c } = await withMeeting();
    const t = await addTask(c, { title: "Send Ned the price table", meeting_ref: EVENT });
    expect(t.meeting_ref).toBe(EVENT);
    expect((await getHome(c.db)).open_tasks.find((x) => x.id === t.id)?.meeting_ref).toBe(EVENT);
    expect((await updateTask(c, t.id, { meeting_ref: null })).meeting_ref).toBeNull();
  });

  it("knows who is in a meeting", async () => {
    const { c, ned } = await withMeeting();
    expect(await meetingPeople(c.db, EVENT)).toEqual([ned.id]);
    expect(await meetingPeople(c.db, "nope:1")).toEqual([]);
  });
});
