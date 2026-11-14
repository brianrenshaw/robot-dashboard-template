import { describe, expect, it } from "vitest";
import { addDays, isDueSoon, isOverdue, isProjectWaiting, isStale, isTaskWaiting, todayInTz, whoseMove } from "../src";

const now = new Date("2026-11-13T15:00:00Z");

describe("derived rules", () => {
  it("marks active or waiting projects stale after stale_days without activity", () => {
    const old = "2026-10-20T00:00:00.000Z";
    const fresh = "2026-11-10T00:00:00.000Z";
    expect(isStale({ status: "active", archived_at: null, last_activity_at: old }, { stale_days: 14 }, now)).toBe(true);
    expect(isStale({ status: "waiting", archived_at: null, last_activity_at: old }, { stale_days: 14 }, now)).toBe(true);
    expect(isStale({ status: "active", archived_at: null, last_activity_at: fresh }, { stale_days: 14 }, now)).toBe(false);
    expect(isStale({ status: "paused", archived_at: null, last_activity_at: old }, { stale_days: 14 }, now)).toBe(false);
    expect(isStale({ status: "active", archived_at: old, last_activity_at: old }, { stale_days: 14 }, now)).toBe(false);
  });

  it("computes overdue and due soon from YYYY-MM-DD dates", () => {
    const today = "2026-11-13";
    expect(isOverdue("2026-11-12", false, today)).toBe(true);
    expect(isOverdue("2026-11-13", false, today)).toBe(false);
    expect(isOverdue("2026-11-01", true, today)).toBe(false);
    expect(isOverdue(null, false, today)).toBe(false);
    expect(isDueSoon("2026-11-13", false, today, { due_soon_days: 7 })).toBe(true);
    expect(isDueSoon("2026-11-20", false, today, { due_soon_days: 7 })).toBe(true);
    expect(isDueSoon("2026-11-21", false, today, { due_soon_days: 7 })).toBe(false);
    expect(isDueSoon("2026-11-12", false, today, { due_soon_days: 7 })).toBe(false);
  });

  it("decides whose move a project is", () => {
    const base = { archived_at: null, waiting_on: "", waiting_on_person_id: null };
    expect(whoseMove({ ...base, status: "active" })).toBe("yours");
    expect(whoseMove({ ...base, status: "waiting" })).toBe("theirs");
    expect(whoseMove({ ...base, status: "active", waiting_on: "Budget numbers from Peter" })).toBe("theirs");
    expect(whoseMove({ ...base, status: "active", waiting_on_person_id: "per_1" })).toBe("theirs");
    expect(whoseMove({ ...base, status: "idea" })).toBe("parked");
    expect(whoseMove({ ...base, status: "paused" })).toBe("parked");
    expect(whoseMove({ ...base, status: "done" })).toBe("closed");
    expect(whoseMove({ ...base, status: "active", archived_at: "2026-11-01T00:00:00.000Z" })).toBe("closed");
  });

  it("treats waiting status, waiting_on text and assigned tasks as waiting", () => {
    expect(isProjectWaiting({ status: "waiting", archived_at: null, waiting_on: "" })).toBe(true);
    expect(isProjectWaiting({ status: "active", archived_at: null, waiting_on: "Mark's reply" })).toBe(true);
    expect(isProjectWaiting({ status: "done", archived_at: null, waiting_on: "x" })).toBe(false);
    expect(isTaskWaiting({ status: "todo", person_id: "per_1", deleted_at: null })).toBe(true);
    expect(isTaskWaiting({ status: "done", person_id: "per_1", deleted_at: null })).toBe(false);
    expect(isTaskWaiting({ status: "todo", person_id: null, deleted_at: null })).toBe(false);
  });

  it("uses Eastern time for today", () => {
    // 03:00 UTC on Nov 14 is still Nov 13 in Eastern time.
    expect(todayInTz("America/New_York", new Date("2026-11-14T03:00:00Z"))).toBe("2026-11-13");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });
});
