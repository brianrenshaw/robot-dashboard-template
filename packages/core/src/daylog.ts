// daylog.ts
// The daily log: a short, casual record of what the owner worked on each day. He does not keep it
// himself ("I'm not going to keep it throughout the day"). His chatbot does:
//
//   - Any time, he can say "log that I finished the budget draft". That is one line added to
//     the day's `notes` (saveDailyLog with `add`). Notes are only ever added to.
//   - At the end of the day the chatbot writes the day up: the meetings he had and who they
//     were with, the mail he sent, the tasks he added and finished. That is the day's `body`
//     (saveDailyLog with `body`), and saving it again replaces it. His notes are left alone.
//
// One row per day, keyed by the day. dayFacts() is what the dashboard itself knows about a
// day (meetings, tasks, notes filed); the chatbot adds what only it can see (mail, meeting
// notes) from its own connections. The site never reads mail.

import { recordAudit } from "./audit";
import type { CalendarEvent } from "./calsync";
import type { Db } from "./db";
import { listTimeline, type EntryView } from "./entries";
import { InputError } from "./errors";
import { getRow, insertRow, updateRow } from "./rows";
import { dailyLogSaveSchema } from "./schemas";
import { getSettings } from "./settings";
import type { Ctx, DailyLog } from "./types";
import { addDays, nowIso, todayInTz } from "./util";
import { tasksByIds, type TaskItem } from "./views";

/** A row that has nothing in it counts as no log (that is what undoing the first write leaves). */
const HAS_CONTENT = `(TRIM(body) != '' OR TRIM(notes) != '')`;

/** The things he said he did that day, as a list. */
export function logNotes(log: Pick<DailyLog, "notes"> | null | undefined): string[] {
  return (log?.notes ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
}

/** The log for one day, or null when nothing was logged. */
export async function getDailyLog(db: Db, day: string): Promise<DailyLog | null> {
  return db.first<DailyLog>(`SELECT * FROM daily_logs WHERE day = ? AND ${HAS_CONTENT}`, [day]);
}

/** Logged days, newest first. `from` and `to` are days (YYYY-MM-DD), both included. */
export async function listDailyLogs(db: Db, f: { from?: string; to?: string; limit?: number } = {}): Promise<DailyLog[]> {
  const where = [HAS_CONTENT];
  const params: string[] = [];
  if (f.from) {
    where.push(`day >= ?`);
    params.push(f.from);
  }
  if (f.to) {
    where.push(`day <= ?`);
    params.push(f.to);
  }
  const limit = Math.min(Math.max(f.limit ?? 60, 1), 400);
  return db.all<DailyLog>(`SELECT * FROM daily_logs WHERE ${where.join(" AND ")} ORDER BY day DESC LIMIT ${limit}`, params);
}

/** The most recent logged day. */
export async function latestDailyLog(db: Db): Promise<DailyLog | null> {
  return (await listDailyLogs(db, { limit: 1 }))[0] ?? null;
}

/** Logged days whose text has every one of the words, newest first. Used by search(). */
export async function searchDailyLogs(db: Db, words: string[], limit = 20): Promise<DailyLog[]> {
  if (!words.length) return [];
  const params: string[] = [];
  const sql = words
    .map((w) => {
      params.push(`%${w}%`, `%${w}%`);
      return `(body LIKE ? OR notes LIKE ?)`;
    })
    .join(" AND ");
  return db.all<DailyLog>(`SELECT * FROM daily_logs WHERE ${HAS_CONTENT} AND ${sql} ORDER BY day DESC LIMIT ${Math.min(Math.max(limit, 1), 100)}`, params);
}

/**
 * Write to a day's log. `body` replaces the written-up day; `add` puts more lines on his notes
 * (a line already there is not added twice). The day defaults to today in his time zone.
 */
export async function saveDailyLog(ctx: Ctx, input: unknown): Promise<DailyLog> {
  const data = dailyLogSaveSchema.parse(input);
  const today = todayInTz((await getSettings(ctx.db)).timezone);
  const day = data.day ?? today;
  if (day > today) throw new InputError(`${day} has not happened yet. The log is for today or a day before it.`);

  let row = await getRow<DailyLog>(ctx.db, "daily_logs", { day });
  if (!row) {
    // The day's row is made empty and then filled in, as two recorded changes, so that the
    // first thing written to a day can be undone like any other.
    const now = nowIso();
    row = { day, body: "", notes: "", created_by: ctx.actor, created_at: now, updated_at: now };
    await insertRow(ctx.db, "daily_logs", row as any);
    await recordAudit(ctx, "create", "daily_logs", null, row as any);
  }

  const after: DailyLog = { ...row };
  if (data.body !== undefined) after.body = data.body.trim();
  if (data.add?.length) {
    const lines = logNotes(row);
    for (const raw of data.add) {
      // One thing per line: a line break or a leading list dash would break the list apart.
      const line = raw.replace(/\s+/g, " ").replace(/^[-*•]\s+/, "").trim();
      if (line && !lines.some((l) => l.toLowerCase() === line.toLowerCase())) lines.push(line);
    }
    after.notes = lines.join("\n");
  }
  if (after.body === row.body && after.notes === row.notes) return row;
  after.updated_at = nowIso();
  await updateRow(ctx.db, "daily_logs", row as any, { body: after.body, notes: after.notes, updated_at: after.updated_at });
  await recordAudit(ctx, "update", "daily_logs", row as any, after as any);
  return after;
}

/** What the dashboard itself saw on one day. */
export interface DayFacts {
  day: string;
  /**
   * False when the day is too far back for the calendar copy (it keeps from about a day ago
   * onward). The saved log is then the record of that day's meetings.
   */
  meetings_known: boolean;
  /** That day's meetings, in order, with which of his people each was with. */
  meetings: (CalendarEvent & { with: string[] })[];
  /** Tasks put on the dashboard that day (by him or by a chatbot), still there. */
  tasks_added: TaskItem[];
  /** Tasks checked off that day. */
  tasks_finished: TaskItem[];
  /** Notes, meetings, calls, decisions and emails filed for that day. */
  notes_filed: EntryView[];
}

/**
 * Meetings, tasks added, tasks finished and notes filed on one day in his time zone. Read
 * only; it is the dashboard's half of the day, for the chatbot to write the log from.
 */
export async function dayFacts(db: Db, day: string): Promise<DayFacts> {
  const { timezone } = await getSettings(db);
  const today = todayInTz(timezone);
  // A day in his time zone falls inside this wider stretch of UTC; each row is then checked
  // against the day itself, which stays right across a daylight-saving change.
  const from = `${addDays(day, -1)}T00:00:00.000Z`;
  const to = `${addDays(day, 2)}T00:00:00.000Z`;
  const onDay = (iso: string | null) => !!iso && todayInTz(timezone, new Date(iso)) === day;

  const stamps = await db.all<{ id: string; created_at: string; done_at: string | null; status: string }>(
    `SELECT id, created_at, done_at, status FROM tasks
     WHERE deleted_at IS NULL AND ((created_at >= ? AND created_at < ?) OR (done_at >= ? AND done_at < ?))
     ORDER BY created_at LIMIT 400`,
    [from, to, from, to],
  );
  const added = stamps.filter((t) => onDay(t.created_at)).map((t) => t.id);
  const finished = stamps.filter((t) => t.status === "done" && onDay(t.done_at)).map((t) => t.id);
  const items = new Map((await tasksByIds(db, [...new Set([...added, ...finished])])).map((t) => [t.id, t]));
  const pick = (ids: string[]) => ids.map((id) => items.get(id)).filter((t): t is TaskItem => !!t);

  const events = await db.all<CalendarEvent>(`SELECT * FROM calendar_events WHERE day = ? ORDER BY all_day DESC, starts_at LIMIT 100`, [day]);
  const guests = await db.all<{ event_id: string; name: string }>(
    `SELECT x.event_id, pe.name
     FROM (SELECT event_id, person_id FROM calendar_event_people
           UNION SELECT id, person_id FROM calendar_events WHERE person_id IS NOT NULL) x
     JOIN calendar_events c ON c.id = x.event_id
     JOIN people pe ON pe.id = x.person_id
     WHERE c.day = ? ORDER BY pe.name`,
    [day],
  );
  const withThem = new Map<string, string[]>();
  for (const g of guests) withThem.set(g.event_id, [...(withThem.get(g.event_id) ?? []), g.name]);

  const filed = await listTimeline(db, { kinds: ["note", "meeting", "call", "decision", "email"], since: from, before: to, limit: 100 });

  return {
    day,
    meetings_known: day >= addDays(today, -1),
    meetings: events.map((e) => ({ ...e, with: withThem.get(e.id) ?? [] })),
    tasks_added: pick(added),
    tasks_finished: pick(finished),
    notes_filed: filed.filter((e) => onDay(e.occurred_at)).reverse(),
  };
}
