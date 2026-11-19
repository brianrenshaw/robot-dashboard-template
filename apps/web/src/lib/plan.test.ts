import { describe, expect, it } from "vitest";
import { inOrder, isCopyOfBlock, layOut, meetingTitle, needsPlace, openTimes, orderBetween, projectForTitle, readWhen, rowOf } from "./plan";

const W = "2026-11-16"; // a Monday
const cur = { day: "2026-11-17", start: 9 * 60, minutes: 30 };

describe("the board", () => {
  it("puts a task he has not placed in New, or in Waiting when he is waiting on someone", () => {
    expect(rowOf({ board: null, people: [] })).toBe("new");
    expect(rowOf({ board: null, people: [{ id: "p", name: "Greta", waiting: true, one_on_one: false }] })).toBe("waiting");
    expect(rowOf({ board: "back", people: [{ id: "p", name: "Greta", waiting: true, one_on_one: false }] })).toBe("back");
  });

  it("leaves off a task that is in a project or already has time set aside", () => {
    const blocks = [{ task_id: "blocked", day: "2026-11-18" }, { task_id: "missed", day: "2026-11-16" }];
    const today = "2026-11-17";
    expect(needsPlace({ id: "loose", project_id: null }, blocks, today)).toBe(true);
    expect(needsPlace({ id: "in-project", project_id: "prj_1" }, blocks, today)).toBe(false);
    expect(needsPlace({ id: "blocked", project_id: null }, blocks, today)).toBe(false);
    // Yesterday's block came and went: the task is back on the board.
    expect(needsPlace({ id: "missed", project_id: null }, blocks, today)).toBe(true);
    // A block later today still counts.
    expect(needsPlace({ id: "missed", project_id: null }, blocks, "2026-11-16")).toBe(false);
  });

  it("orders a row and drops between two cards with one number", () => {
    const t = (id: string, o: number) => ({ id, sort_order: o, created_at: "2026-11-01" });
    expect(inOrder([t("b", 2), t("a", 1), t("c", 1.5)]).map((x) => x.id)).toEqual(["a", "c", "b"]);
    expect(orderBetween(1, 2)).toBe(1.5);
    expect(orderBetween(undefined, 4)).toBe(3);
    expect(orderBetween(4, undefined)).toBe(5);
  });
});

describe("open time", () => {
  const busy = (day: string) => (day === "2026-11-16" ? [{ start: 9 * 60 + 30, end: 11 * 60 }, { start: 15 * 60, end: 16 * 60 }] : []);
  const days = ["2026-11-16", "2026-11-17"];

  it("finds stretches that fit, leaving room around meetings, from now on", () => {
    expect(openTimes(days, busy, 45, { day: "2026-11-16", min: 8 * 60 + 20 })).toEqual([
      { day: "2026-11-16", start: 8 * 60 + 30 }, // 8:30 to 9:15 still ends before the 9:30 meeting
      { day: "2026-11-16", start: 11 * 60 + 15 },
      { day: "2026-11-16", start: 16 * 60 + 15 },
      { day: "2026-11-17", start: 8 * 60 },
    ]);
  });

  it("skips days that are past and stretches that are too short", () => {
    expect(openTimes(days, busy, 120, { day: "2026-11-17", min: 0 }, { n: 1 })).toEqual([{ day: "2026-11-17", start: 8 * 60 }]);
    expect(openTimes(["2026-11-16"], busy, 180, { day: "2026-11-16", min: 9 * 60 })).toEqual([{ day: "2026-11-16", start: 11 * 60 + 15 }]);
    expect(openTimes(["2026-11-16"], busy, 240, { day: "2026-11-16", min: 8 * 60 })).toEqual([]);
  });
});

describe("typing when", () => {
  const read = (s: string, today = W) => readWhen(s, cur, today, W);
  it("reads a day, a time and a length in any order", () => {
    expect(read("thu 9 45m")).toEqual({ day: "2026-11-19", start: 9 * 60, minutes: 45 });
    expect(read("1h fri 1:30pm")).toEqual({ day: "2026-11-20", start: 13 * 60 + 30, minutes: 60 });
    expect(read("tomorrow 10:15")).toEqual({ day: "2026-11-17", start: 10 * 60 + 15, minutes: 30 });
  });
  it("treats a bare 1 to 6 as the afternoon, and keeps what is not mentioned", () => {
    expect(read("2")).toEqual({ ...cur, start: 14 * 60 });
    expect(read("8")).toEqual({ ...cur, start: 8 * 60 });
    expect(read("90m")).toEqual({ ...cur, minutes: 90 });
    expect(read("1.5h")).toEqual({ ...cur, minutes: 90 });
    expect(read("")).toEqual(cur);
  });
  it("means this week's day while it is ahead, and next week's once it has passed", () => {
    expect(read("mon", "2026-11-18")).toMatchObject({ day: "2026-11-23" });
    expect(read("fri", "2026-11-18")).toMatchObject({ day: "2026-11-20" });
  });
});

describe("laying out a day", () => {
  it("puts overlapping things side by side and leaves the rest full width", () => {
    const out = layOut([
      { id: "a", start: 570, end: 615 },
      { id: "b", start: 570, end: 660 },
      { id: "c", start: 900, end: 960 },
    ]);
    const by = Object.fromEntries(out.map((o) => [o.id, [o.slot, o.of]]));
    expect(by).toEqual({ b: [0, 2], a: [1, 2], c: [0, 1] });
  });
});

describe("meeting titles", () => {
  it("drops his own name", () => {
    expect(meetingTitle("Alex Morgan and Aaron Moss")).toBe("Aaron Moss");
    expect(meetingTitle("Lena Van Dyke and Alex Morgan")).toBe("Lena Van Dyke");
    expect(meetingTitle("Ned and Alex 1:1")).toBe("Ned 1:1");
    expect(meetingTitle("Meeting - Alex and Jay")).toBe("Jay");
    expect(meetingTitle("Weekly plan")).toBe("Weekly plan");
    expect(meetingTitle("Alex")).toBe("Alex");
  });
});

describe("a block copied to his calendar", () => {
  const blocks = [{ day: "2026-11-17", start_min: 540, title: "Decide on Riley Grant's new contract" }];
  it("is recognised when it comes back from the calendar, and nothing else is", () => {
    expect(isCopyOfBlock({ day: "2026-11-17", start: 540, title: "Decide on Riley Grant’s new contract" }, blocks)).toBe(true);
    expect(isCopyOfBlock({ day: "2026-11-18", start: 540, title: "Decide on Riley Grant's new contract" }, blocks)).toBe(false);
    expect(isCopyOfBlock({ day: "2026-11-17", start: 600, title: "Decide on Riley Grant's new contract" }, blocks)).toBe(false);
    expect(isCopyOfBlock({ day: "2026-11-17", start: 540, title: "Weekly plan" }, blocks)).toBe(false);
  });
});

describe("which project a calendar entry is his time for", () => {
  const projects = [{ title: "Price and Fee Review Prep" }, { title: "Garden Shed Rebuild" }, { title: "Home Office" }, { title: "Reading Habit App" }, { title: "Reading Habit App Store listing" }];
  const of = (title: string, loose = true) => projectForTitle(title, projects, loose)?.title ?? null;

  it("is the project whose name the title is, give or take Work on and punctuation", () => {
    expect(of("Work on Price and Fee Review Prep", false)).toBe("Price and Fee Review Prep");
    expect(of("price & fee review prep")).toBe("Price and Fee Review Prep");
  });

  it("survives a rename: words added or left off at the end, for his own time only", () => {
    // The block made before the project was renamed.
    expect(of("Work on Price and Fee Review")).toBe("Price and Fee Review Prep");
    expect(of("Price and Fee Review Prep: draft the slides")).toBe("Price and Fee Review Prep");
    // A meeting with other people on it only counts by its exact name.
    expect(of("Work on Price and Fee Review", false)).toBeNull();
  });

  it("never guesses", () => {
    // Too short to stand for a project.
    expect(of("Personal")).toBeNull();
    expect(of("Garden Shed")).toBeNull();
    // Fits two projects.
    expect(of("Reading Habit App Store listing screenshots")).toBeNull();
    // Words in the middle are not a match.
    expect(of("Price planning and Fee Review")).toBeNull();
    // An exact name wins over a longer one.
    expect(of("Reading Habit App")).toBe("Reading Habit App");
  });
});
