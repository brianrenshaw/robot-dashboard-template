import { describe, expect, it } from "vitest";
import { addTask, addTimeBlock, deleteTimeBlock, getHome, getSettings, listAudit, listTimeBlocks, undoAudit, updateSettings, updateTask, updateTimeBlock, weekStart } from "../src";
import { ctx } from "./helpers";

describe("the planning board", () => {
  it("puts a task in a row, and back in New", async () => {
    const c = ctx();
    const t = await addTask(c, { title: "Fix graduation GPA in the catalog" });
    expect(t.board).toBeNull();
    expect((await updateTask(c, t.id, { board: "back" })).board).toBe("back");
    expect((await updateTask(c, t.id, { board: null })).board).toBeNull();
    await expect(updateTask(c, t.id, { board: "someday" } as never)).rejects.toThrow();
    const [last] = await listAudit(c.db, { limit: 1 });
    expect(last!.summary).toContain("board row");
  });

  it("lets him rename the rows", async () => {
    const c = ctx();
    expect((await getSettings(c.db)).board_names.back).toBe("Back burner");
    const names = { todo: "Now", waiting: "Waiting", back: "Later", figure: "Think about" };
    expect((await updateSettings(c, { board_names: names })).board_names).toEqual(names);
  });
});

describe("time blocks", () => {
  it("adds, moves and takes off a block, and each can be undone", async () => {
    const c = ctx();
    const t = await addTask(c, { title: "Decide on Riley Grant's new contract" });
    const b = await addTimeBlock(c, { task_id: t.id, day: "2026-11-17", start_min: 9 * 60, minutes: 45 });
    let list = await listTimeBlocks(c.db, "2026-11-16", "2026-11-20");
    expect(list.map((x) => [x.title, x.day, x.start_min, x.minutes])).toEqual([["Decide on Riley Grant's new contract", "2026-11-17", 540, 45]]);

    await updateTimeBlock(c, b.id, { day: "2026-11-19", start_min: 10 * 60 });
    list = await listTimeBlocks(c.db, "2026-11-16", "2026-11-20");
    expect([list[0]!.day, list[0]!.start_min]).toEqual(["2026-11-19", 600]);

    await deleteTimeBlock(c, b.id);
    expect(await listTimeBlocks(c.db, "2026-11-16", "2026-11-20")).toEqual([]);
    const [del] = await listAudit(c.db, { limit: 1 });
    await undoAudit(c, del!.id);
    expect(await listTimeBlocks(c.db, "2026-11-16", "2026-11-20")).toHaveLength(1);
  });

  it("refuses a block for a task that is not there, or a nonsense time", async () => {
    const c = ctx();
    await expect(addTimeBlock(c, { task_id: "tsk_nope", day: "2026-11-17", start_min: 540, minutes: 30 })).rejects.toThrow();
    const t = await addTask(c, { title: "Something" });
    await expect(addTimeBlock(c, { task_id: t.id, day: "Tuesday", start_min: 540, minutes: 30 })).rejects.toThrow();
    await expect(addTimeBlock(c, { task_id: t.id, day: "2026-11-17", start_min: 540, minutes: 0 })).rejects.toThrow();
  });

  it("starts the week on Monday, and on a weekend shows the coming week", async () => {
    expect(weekStart("2026-11-18")).toBe("2026-11-16"); // Wednesday
    expect(weekStart("2026-11-16")).toBe("2026-11-16"); // Monday
    expect(weekStart("2026-11-15")).toBe("2026-11-16"); // Sunday
    expect(weekStart("2026-11-14")).toBe("2026-11-16"); // Saturday
    const home = await getHome(ctx().db);
    expect(home.week_start).toBe(weekStart(home.today));
    expect(home.blocks).toEqual([]);
  });
});
