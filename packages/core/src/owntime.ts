// owntime.ts
// Time the owner set aside for his own work, and whether he went through with it.
//
// He plans by time blocking. A session of his own time is either
//   - a block he made on the dashboard (time_blocks), or
//   - an event in his calendar with no other guests that names none of his people
//     ("Finalize contract", "Work on Pricing Review").
// Neither is a meeting, and the daily log must not call it one (2026-11-16: "if something was a
// time block it wasn't a meeting"). He also asked to "track over time how much I get done
// during time blocked sessions (like if I actually went through with it)". So each session
// can carry one answer, saved in block_results with a copy of the session, and blockTally()
// counts the answers over any stretch of days. An answer is one of three (2026-11-19: "if i
// got it done, didn't get it done... i should also have the freedom to say if i did not do it
// but did something else instead"):
//   he did the work            kept true
//   he did not get to it       kept false
//   he did something else      kept false, and `instead` says what
//
// A session is a block or entry ON A DAY: the record is keyed by ref and day. When he moves a
// block he did not get to onto another day, the day it was on keeps its answer and the moved
// session starts with none. An answered session whose block or entry has since gone (taken
// off, moved, or too far back for the calendar copy) is still listed, from the record: "it
// shouldn't be cleared on the dashboard".
//
// Nothing here decides for him. An answer is written only when he gives it (on the site, or
// to his chatbot at the end of the day).

import { recordAudit } from "./audit";
import { listTimeBlocks } from "./blocks";
import type { CalendarEvent } from "./calsync";
import type { Db } from "./db";
import { InputError, NotFoundError } from "./errors";
import { getRow, insertRow, updateRow } from "./rows";
import { getSettings } from "./settings";
import type { BlockResult, Ctx } from "./types";
import { nowIso } from "./util";

/** One session of his own time. */
export interface OwnTime {
  /** 'block:<id>' or 'calendar:<event id>': what to pass to saveBlockResult. */
  ref: string;
  day: string;
  /** Minutes after midnight, in his time zone. */
  start_min: number;
  minutes: number;
  title: string;
  /** Where he made it: on the dashboard, or in his calendar. */
  source: "dashboard" | "calendar";
  task_id: string | null;
  /** True when the block's task has been checked off. */
  task_done: boolean;
  /** Whether he did the work in that time. null: he has not said. */
  kept: boolean | null;
  /** What he did in that time instead, when he said ("" otherwise). Only with kept false. */
  instead: string;
  /** False when the block or calendar entry is gone or was moved to another day: only his answer remains. */
  live: boolean;
}

/** How a session went, in words: for the chatbot and for Activity. */
export function outcomeOf(o: { kept: boolean | number | null; instead?: string }): "did the work" | "did not get to it" | "did something else" | null {
  if (o.kept === null) return null;
  return o.kept === true || o.kept === 1 ? "did the work" : o.instead?.trim() ? "did something else" : "did not get to it";
}

/** A title reduced to what has to match: lower case, "&" as "and", no "work on", no punctuation. (The site's lib/plan.ts has the same rule.) */
export const plainTitle = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/^\s*work(ing)? on\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Minutes after midnight, in a time zone, for an ISO time. */
export function minuteOfDayIn(iso: string, tz: string): number {
  const [h, m] = new Date(iso).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).split(":");
  return (Number(h) % 24) * 60 + Number(m);
}

/**
 * The calendar events on these days that are his own time: timed, no other guests, and none
 * of his people in them. An event whose guests are not known yet (not synced since this was
 * added) is left as a meeting.
 */
export async function ownTimeEvents(db: Db, fromDay: string, toDay: string): Promise<CalendarEvent[]> {
  return db.all<CalendarEvent>(
    `SELECT c.* FROM calendar_events c
     WHERE c.day >= ? AND c.day <= ? AND c.all_day = 0 AND c.guests = 0 AND c.person_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM calendar_event_people x WHERE x.event_id = c.id)
     ORDER BY c.starts_at LIMIT 400`,
    [fromDay, toDay],
  );
}

/**
 * Every session of his own time from `fromDay` to `toDay` (inclusive), in order, with his
 * answer where he gave one. A block his chatbot copied to his calendar is listed once, as the
 * block. A session he answered for stays listed after its block or calendar event is gone,
 * or has been moved to another day (`live` false).
 */
export async function listOwnTime(db: Db, fromDay: string, toDay: string): Promise<OwnTime[]> {
  const { timezone } = await getSettings(db);
  const out = new Map<string, OwnTime>();
  const blocks = await listTimeBlocks(db, fromDay, toDay);
  for (const b of blocks) {
    out.set(`block:${b.id}|${b.day}`, { ref: `block:${b.id}`, day: b.day, start_min: b.start_min, minutes: b.minutes, title: b.title, source: "dashboard", task_id: b.task_id, task_done: b.status === "done", kept: null, instead: "", live: true });
  }
  for (const e of await ownTimeEvents(db, fromDay, toDay)) {
    const start = minuteOfDayIn(e.starts_at, timezone);
    const minutes = e.ends_at ? Math.max(5, Math.round((Date.parse(e.ends_at) - Date.parse(e.starts_at)) / 60_000)) : 30;
    const t = plainTitle(e.title);
    if (blocks.some((b) => b.day === e.day && Math.abs(b.start_min - start) <= 5 && plainTitle(b.title) === t)) continue;
    out.set(`calendar:${e.id}|${e.day}`, { ref: `calendar:${e.id}`, day: e.day, start_min: start, minutes, title: e.title, source: "calendar", task_id: null, task_done: false, kept: null, instead: "", live: true });
  }
  const results = await db.all<BlockResult>(`SELECT * FROM block_results WHERE day >= ? AND day <= ? ORDER BY day, start_min LIMIT 2000`, [fromDay, toDay]);
  for (const r of results) {
    const live = out.get(`${r.ref}|${r.day}`);
    const kept = r.kept === null ? null : r.kept === 1;
    if (live) {
      live.kept = kept;
      live.instead = r.instead;
    } else if (kept !== null) {
      out.set(`${r.ref}|${r.day}`, { ref: r.ref, day: r.day, start_min: r.start_min, minutes: r.minutes, title: r.title, source: r.ref.startsWith("block:") ? "dashboard" : "calendar", task_id: r.task_id, task_done: false, kept, instead: r.instead, live: false });
    }
  }
  return [...out.values()].sort((a, b) => a.day.localeCompare(b.day) || a.start_min - b.start_min);
}

/** The session a ref points at, as it stands now: a block on the dashboard, or a timed calendar event. */
async function sessionOf(db: Db, ref: string): Promise<Pick<BlockResult, "day" | "start_min" | "minutes" | "title" | "task_id"> | null> {
  const [kind, ...rest] = ref.split(":");
  const id = rest.join(":");
  if (!id || (kind !== "block" && kind !== "calendar")) throw new InputError(`"${ref}" is not a time block. Pass the ref the dashboard gave: block:<id> or calendar:<event id>.`);
  if (kind === "block") {
    return db.first(
      `SELECT b.day, b.start_min, b.minutes, t.title, b.task_id FROM time_blocks b JOIN tasks t ON t.id = b.task_id WHERE b.id = ? AND b.deleted_at IS NULL`,
      [id],
    );
  }
  const e = await db.first<CalendarEvent>(`SELECT * FROM calendar_events WHERE id = ? AND all_day = 0`, [id]);
  if (!e) return null;
  const { timezone } = await getSettings(db);
  return { day: e.day, start_min: minuteOfDayIn(e.starts_at, timezone), minutes: e.ends_at ? Math.max(5, Math.round((Date.parse(e.ends_at) - Date.parse(e.starts_at)) / 60_000)) : 30, title: e.title, task_id: null };
}

/** What he did instead, as one short line. */
const oneLine = (v: string) => v.replace(/\s+/g, " ").trim().slice(0, 200);

/**
 * Record how a session of his own time went. `kept` true: he did the work; false: he did not
 * (with `instead`, what he did in that time instead); null: take the answer back. Saying it
 * again replaces the answer. `instead` left out keeps what he said before; "" clears it.
 * Giving `instead` alone means he did not do what the time was for.
 *
 * The answer belongs to the session on its day. `day` is only needed for a session that is no
 * longer there (taken off, or moved to another day since): it says which day's answer to
 * change. Without it, the session as it stands now is meant, or else the newest record.
 */
export async function saveBlockResult(ctx: Ctx, input: { ref: string; kept?: boolean | null; instead?: string; day?: string }): Promise<BlockResult> {
  const ref = String(input.ref ?? "").trim();
  const said = input.instead === undefined ? undefined : oneLine(String(input.instead));
  if (input.kept === undefined && !said) throw new InputError("Say whether he did the work (kept true or false), or what he did instead.");
  const kept = input.kept === undefined ? 0 : input.kept === null ? null : input.kept ? 1 : 0;
  if (kept === 1 && said) throw new InputError("A block he did the work in has no \"instead\". Pass kept false with instead, or kept true alone.");
  const now = nowIso();
  const there = await sessionOf(ctx.db, ref);
  const day =
    input.day ??
    there?.day ??
    (await ctx.db.first<{ day: string }>(`SELECT day FROM block_results WHERE ref = ? ORDER BY day DESC LIMIT 1`, [ref]))?.day;
  // The session as it stands, when it is still on that day. Moved or gone: the record is all there is.
  const session = there && there.day === day ? there : null;
  let row = day ? await getRow<BlockResult>(ctx.db, "block_results", { ref, day }) : null;
  if (!row) {
    if (!session) throw new NotFoundError(`No time block ${ref}${input.day ? ` on ${input.day}` : ""}. It may have been taken off or moved, or be too far back for the calendar copy.`);
    // Made with no answer and then filled in, as two recorded changes, so the first answer can be undone.
    row = { ref, ...session, kept: null, instead: "", created_by: ctx.actor, created_at: now, updated_at: now };
    await insertRow(ctx.db, "block_results", row as any);
    await recordAudit(ctx, "create", "block_results", null, row as any);
  }
  // Keep the copy of the session current while its block or event is still there.
  const next: BlockResult = { ...row, ...(session ?? {}), kept, instead: kept === 0 ? said ?? row.instead : "", updated_at: now };
  if (next.kept === row.kept && next.instead === row.instead && next.start_min === row.start_min && next.minutes === row.minutes && next.title === row.title) return row;
  await updateRow(ctx.db, "block_results", row as any, next as any);
  await recordAudit(ctx, "update", "block_results", row as any, next as any);
  return next;
}

/** His answers for the sessions on these days: what the dashboard's week needs to mark each one. */
export async function listBlockResults(db: Db, fromDay: string, toDay: string): Promise<BlockResult[]> {
  return db.all<BlockResult>(`SELECT * FROM block_results WHERE day >= ? AND day <= ? AND kept IS NOT NULL ORDER BY day, start_min LIMIT 2000`, [fromDay, toDay]);
}

/** How his time blocks went over a stretch of days. Only sessions he answered for are counted. */
export interface BlockTally {
  from: string;
  to: string;
  /** Sessions he did the work in. */
  kept: number;
  /** Sessions he did not do the work in: the ones he did not get to, and the ones he did something else in. */
  not_kept: number;
  /** Of those, the sessions he did something else in. */
  something_else: number;
  minutes_kept: number;
  minutes_not_kept: number;
}

export async function blockTally(db: Db, fromDay: string, toDay: string): Promise<BlockTally> {
  const r = await db.first<{ k: number | null; n: number | null; e: number | null; mk: number | null; mn: number | null }>(
    `SELECT SUM(kept = 1) AS k, SUM(kept = 0) AS n, SUM(kept = 0 AND TRIM(instead) != '') AS e,
            SUM(CASE WHEN kept = 1 THEN minutes ELSE 0 END) AS mk, SUM(CASE WHEN kept = 0 THEN minutes ELSE 0 END) AS mn
     FROM block_results WHERE day >= ? AND day <= ? AND kept IS NOT NULL`,
    [fromDay, toDay],
  );
  return { from: fromDay, to: toDay, kept: r?.k ?? 0, not_kept: r?.n ?? 0, something_else: r?.e ?? 0, minutes_kept: r?.mk ?? 0, minutes_not_kept: r?.mn ?? 0 };
}
