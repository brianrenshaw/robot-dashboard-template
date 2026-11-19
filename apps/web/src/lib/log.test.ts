import { describe, expect, it } from "vitest";
import { addMonths, logLines, logSummary, markParts, matchLine, monthGrid, monthTitle } from "./log";

const day = {
  body: "## Pricing Review\n\n* Rebuilt the comparison around three customers\n* Added **Acme** to it\n\n- **Grant contract**: sent the proposal to [Jordan](https://example.com)",
  notes: "Rebuilt the comparison\nCalled Ned about the refund",
  notes_folded: 1,
};

describe("a day of the log, for the list", () => {
  it("reads as plain lines: the write-up, then only what he said after it", () => {
    expect(logLines(day)).toEqual([
      "Pricing Review",
      "Rebuilt the comparison around three customers",
      "Added Acme to it",
      "Grant contract: sent the proposal to Jordan",
      "Called Ned about the refund",
    ]);
    // A day with no write-up is simply his notes.
    expect(logLines({ body: "", notes: "Wrote the newsletter", notes_folded: 0 })).toEqual(["Wrote the newsletter"]);
  });

  it("is titled by its first line", () => {
    expect(logSummary(day)).toEqual({ title: "Pricing Review", rest: "Rebuilt the comparison around three customers · Added Acme to it · Grant contract: sent the proposal to Jordan · Called Ned about the refund" });
    expect(logSummary({ body: "", notes: "", notes_folded: 0 })).toEqual({ title: "", rest: "" });
  });

  it("shows the line a search found, with the words marked", () => {
    expect(matchLine(day, "grant proposal")).toBe("Grant contract: sent the proposal to Jordan");
    expect(matchLine(day, "nothing here")).toBe("");
    expect(markParts("Sent the proposal to Jordan", "proposal jordan")).toEqual([
      { text: "Sent the ", hit: false },
      { text: "proposal", hit: true },
      { text: " to ", hit: false },
      { text: "Jordan", hit: true },
    ]);
    // A character that means something in a pattern is only a character.
    expect(markParts("a (b) c", "(b)").filter((p) => p.hit).map((p) => p.text)).toEqual(["(b)"]);
  });
});

describe("the calendar of logged days", () => {
  it("lays a month out in weeks, Sunday first", () => {
    const nov = monthGrid("2026-11");
    expect(nov[0]).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
    expect(nov).toHaveLength(5);
    expect(nov[4]!.filter(Boolean)).toEqual(["2026-11-29", "2026-11-30"]);
    // February 2027 starts on a Monday.
    expect(monthGrid("2027-02")[0]![0]).toBeNull();
    expect(monthGrid("2027-02")[0]![1]).toBe("2027-02-01");
  });

  it("steps across a year", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(monthTitle("2026-11")).toBe("November 2026");
  });
});
