import { describe, expect, it } from "vitest";
import { readDate, readQuickTask } from "./quickadd";

const people = [
  { id: "p1", name: "Sam Fields" },
  { id: "p2", name: "Kai Hale" },
  { id: "p3", name: "Jon Harper" },
  { id: "p4", name: "Jon" },
];
const FRI = "2026-11-13"; // a Friday

describe("typing a task in one line", () => {
  it("reads dates", () => {
    expect(readDate("today", FRI)).toBe("2026-11-13");
    expect(readDate("tomorrow", FRI)).toBe("2026-11-14");
    expect(readDate("fri", FRI)).toBe("2026-11-20"); // the next Friday, not today
    expect(readDate("monday", FRI)).toBe("2026-11-16");
    expect(readDate("12/5", FRI)).toBe("2026-12-05");
    expect(readDate("1/9", FRI)).toBe("2027-01-09"); // already past this year
    expect(readDate("dec 5", FRI)).toBe("2026-12-05");
    expect(readDate("12/5/27", FRI)).toBe("2027-12-05");
    expect(readDate("su", FRI)).toBeNull();
    expect(readDate("13/40", FRI)).toBeNull();
  });

  it("reads who and when, and leaves the rest alone", () => {
    expect(readQuickTask("Admissions process map @sam fri #admissions", people, FRI)).toEqual({ title: "Admissions process map #admissions", person: { id: "p1", name: "Sam Fields" }, people: [{ id: "p1", name: "Sam Fields" }], due: "2026-11-20" });
    expect(readQuickTask("Send the calendar by 12/5 @hale", people, FRI)).toEqual({ title: "Send the calendar", person: { id: "p2", name: "Kai Hale" }, people: [{ id: "p2", name: "Kai Hale" }], due: "2026-12-05" });
    // Several @names put several people on it.
    expect(readQuickTask("Budget draft @sam @hale", people, FRI).people.map((x) => x.id)).toEqual(["p1", "p2"]);
    expect(readQuickTask("Call Sun Life about the policy", people, FRI)).toMatchObject({ title: "Call Sun Life about the policy", people: [] }); // a day name mid-line is not a date
    expect(readQuickTask("Ask @jon about enrollment", people, FRI)).toMatchObject({ title: "Ask @jon about enrollment", people: [] }); // two Joes: not guessed
    expect(readQuickTask("Email pat@example.com tomorrow", people, FRI)).toMatchObject({ title: "Email pat@example.com", people: [], due: "2026-11-14" });
    expect(readQuickTask("Friday", people, FRI)).toMatchObject({ title: "Friday" }); // never eats the whole line
  });
});
