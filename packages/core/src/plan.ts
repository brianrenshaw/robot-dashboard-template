// plan.ts
// Two read-only answers built from what is already stored:
//
//   peopleComingUp   the dashboard's People list: the people the owner is about to meet, in the
//                    order of his next meeting with each (any meeting, not only a 1:1), and
//                    whether anything is open between them. People with something open and
//                    no meeting in sight come after.
//   workPlan         what his chatbot gets when he asks "what should I work on today / this
//                    week?": late and due first, then meetings, then what he has waited on
//                    for a while, then his tasks with no date as optional extras.
//
// (peopleComingUp fed the old People card. The dashboard now works its lists out in
// apps/web/src/lib/ahead.ts; this is still what workPlan and the morning brief use.)
// Tasks hidden until a later day are in neither answer.

import type { Db } from "./db";
import { listCalendarEvents, type CalendarEvent } from "./calsync";
import { getSettings } from "./settings";
import type { Area } from "./types";
import { addDays, todayInTz } from "./util";
import { listTasks, type TaskItem } from "./views";

export interface PersonComingUp {
  id: string;
  name: string;
  avatar_url: string | null;
  area: Area | null;
  /** His next meeting with them in the next two weeks. Null when the calendar shows none. */
  next: { day: string; starts_at: string | null; title: string; one_on_one: boolean } | null;
  /** Open tasks with them on it: on the list for their next 1:1 (discuss), waiting on them (theirs), only tagged (mine). */
  discuss: number;
  theirs: number;
  mine: number;
}

export async function peopleComingUp(db: Db, today: string, days = 14): Promise<PersonComingUp[]> {
  const open = `k.status != 'done' AND k.deleted_at IS NULL AND (k.hide_until IS NULL OR k.hide_until <= ?)`;
  const on = (which: string) => `(SELECT COUNT(*) FROM task_people tp JOIN tasks k ON k.id = tp.task_id WHERE tp.person_id = p.id AND ${which} AND ${open})`;
  const people = await db.all<Omit<PersonComingUp, "next"> & { next_at: string | null }>(
    `SELECT p.id, p.name, p.avatar_url, p.area,
       ${on("tp.one_on_one = 1")}
         + (SELECT COUNT(*) FROM agenda_items a WHERE a.person_id = p.id AND a.kind = 'discuss' AND a.status = 'open' AND a.deleted_at IS NULL) AS discuss,
       ${on("tp.waiting = 1")} AS theirs,
       ${on("tp.waiting = 0 AND tp.one_on_one = 0")} AS mine,
       (SELECT o.next_at FROM one_on_ones o WHERE o.person_id = p.id AND o.archived_at IS NULL) AS next_at
     FROM people p WHERE p.archived_at IS NULL`,
    [today, today, today],
  );
  // Every meeting ahead with one of his people in it, soonest first. A meeting stays "next"
  // until an hour after it starts, so it does not vanish while he is in it.
  const meetings = await db.all<{ who: string; day: string; starts_at: string; all_day: number; title: string; one_on_one: string | null }>(
    `SELECT x.person_id AS who, c.day, c.starts_at, c.all_day, c.title, c.person_id AS one_on_one
     FROM (SELECT event_id, person_id FROM calendar_event_people
           UNION SELECT id, person_id FROM calendar_events WHERE person_id IS NOT NULL) x
     JOIN calendar_events c ON c.id = x.event_id
     WHERE c.day >= ? AND c.day <= ? AND (c.all_day = 1 OR c.starts_at >= ?)
     ORDER BY c.day, c.all_day DESC, c.starts_at`,
    [today, addDays(today, days), new Date(Date.now() - 3_600_000).toISOString()],
  );
  const next = new Map<string, PersonComingUp["next"]>();
  for (const m of meetings) {
    if (!next.has(m.who)) next.set(m.who, { day: m.day, starts_at: m.all_day ? null : m.starts_at, title: m.title, one_on_one: m.one_on_one === m.who });
  }
  const list = people
    .map(({ next_at, ...p }): PersonComingUp => ({
      ...p,
      discuss: Number(p.discuss),
      theirs: Number(p.theirs),
      mine: Number(p.mine),
      // Not on the calendar: a 1:1 date that was set by hand still counts.
      next: next.get(p.id) ?? (next_at && next_at >= today && next_at <= addDays(today, days) ? { day: next_at, starts_at: null, title: "1:1", one_on_one: true } : null),
    }))
    // Someone with nothing on their 1:1 list, nothing he is waiting on and no meeting ahead is left out.
    .filter((p) => p.next || p.discuss + p.theirs > 0);
  const when = (p: PersonComingUp) => (p.next ? `${p.next.day} ${p.next.starts_at ?? ""}` : "9999");
  return list.sort((a, b) => when(a).localeCompare(when(b)) || b.discuss + b.theirs - (a.discuss + a.theirs) || a.name.localeCompare(b.name));
}

export interface WorkPlan {
  today: string;
  horizon: "today" | "week";
  late: TaskItem[];
  due_today: TaskItem[];
  /** Due after today, within seven days. */
  due_this_week: TaskItem[];
  /** Meetings today (or through the week), in order. */
  meetings: CalendarEvent[];
  /** The people those meetings are with, and what is open with each. */
  people: PersonComingUp[];
  /** Waiting on someone for a week or more: worth a nudge. */
  waiting_a_while: TaskItem[];
  /** His own tasks with no due date: candidates, not commitments. */
  no_due_date: TaskItem[];
}

export async function workPlan(db: Db, horizon: "today" | "week" = "today"): Promise<WorkPlan> {
  const today = todayInTz((await getSettings(db)).timezone);
  const until = horizon === "today" ? today : addDays(today, 7);
  // listTasks leaves out anything hidden until a later day.
  const dated = await listTasks(db, { who: "mine", due: "dated" });
  return {
    today,
    horizon,
    late: dated.filter((t) => t.due_date! < today),
    due_today: dated.filter((t) => t.due_date === today),
    due_this_week: dated.filter((t) => t.due_date! > today && t.due_date! <= addDays(today, 7)),
    meetings: await listCalendarEvents(db, today, until),
    people: (await peopleComingUp(db, today, horizon === "today" ? 0 : 7)).filter((p) => p.next),
    waiting_a_while: await listTasks(db, { who: "theirs", waiting_days: 7 }),
    no_due_date: await listTasks(db, { who: "mine", due: "none" }),
  };
}
