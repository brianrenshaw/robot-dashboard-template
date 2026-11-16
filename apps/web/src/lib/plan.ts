// plan.ts
// The planner's arithmetic, kept apart from the page so it can be tested. No server calls.
//
// The owner plans by time blocking, after Cal Newport: meetings are fixed, the open time between
// them gets a job, and what needs doing sits on a board of rows he moves things between.
//
//   rowOf        which row of the board a task is in
//   openTimes    the next stretches of a week that fit a block of a given length
//   readWhen     "thu 9 45m", "tomorrow 1:30pm 1h", "fri 2": the one-line way to set a block
//   layOut       side-by-side placement for things on a day that overlap

import type { TaskItem } from "../api";

export type Row = "new" | "todo" | "waiting" | "back" | "figure";
export const ROWS: Exclude<Row, "new">[] = ["todo", "waiting", "back", "figure"];

/** The row a task is in. One he has not placed waits in New, unless he is waiting on someone for it. */
export function rowOf(t: Pick<TaskItem, "board" | "people">): Row {
  if (t.board) return t.board;
  return t.people.some((p) => p.waiting) ? "waiting" : "new";
}

/** Tasks in a row, in his order. */
export function inOrder<T extends Pick<TaskItem, "sort_order" | "created_at">>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
}

/** The order number for a task dropped between two others (either may be missing). One write, no renumbering. */
export function orderBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 0;
  if (before === undefined) return after! - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}

/** Something that takes time on a day, in minutes after midnight. */
export interface Span {
  start: number;
  end: number;
}

/** The first `n` stretches that fit `len` minutes, from `now` on, leaving `gap` minutes either side of anything. */
export function openTimes(
  days: string[],
  busy: (day: string) => Span[],
  len: number,
  now: { day: string; min: number },
  opts: { from?: number; to?: number; gap?: number; n?: number } = {},
): { day: string; start: number }[] {
  const { from = 8 * 60, to = 17 * 60, gap = 10, n = 4 } = opts;
  const out: { day: string; start: number }[] = [];
  for (const day of days) {
    if (day < now.day) continue;
    let t = day === now.day ? Math.max(from, Math.ceil((now.min + gap) / 15) * 15) : from;
    const spans = [...busy(day)].sort((a, b) => a.start - b.start);
    for (const s of [...spans, { start: to + gap, end: to + gap }]) {
      if (s.start - gap - t >= len) {
        out.push({ day, start: t });
        if (out.length >= n) return out;
      }
      t = Math.max(t, Math.ceil((s.end + gap) / 15) * 15);
    }
  }
  return out;
}

/** The weekday names a typed line can use, by day of the week (0 Sunday). */
const DAY_WORDS: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};
const dow = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay();
const plusDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export interface When {
  day: string;
  start: number;
  minutes: number;
}

/**
 * Read a typed line ("thu 9 45m", "tomorrow 1:30pm 1h", "fri 2", "90m") on top of what is
 * already set. Whatever the line does not mention stays as it was. A bare hour from 1 to 6
 * means the afternoon. A weekday means the next one from `weekStart` on (this week's, while
 * it is ahead), and "today" and "tomorrow" count from `today`.
 */
export function readWhen(text: string, cur: When, today: string, weekStart: string): When {
  const r = { ...cur };
  let s = ` ${text.toLowerCase().replace(/[,·]/g, " ")} `;
  s = s.replace(/\s([a-z]+)(?=\s)/g, (all, w: string) => {
    if (w === "today") r.day = today;
    else if (w === "tomorrow" || w === "tmrw") r.day = plusDays(today, 1);
    else if (w in DAY_WORDS) {
      const from = today > weekStart ? today : weekStart;
      r.day = plusDays(from, (DAY_WORDS[w]! - dow(from) + 7) % 7);
    } else return all;
    return " ";
  });
  s = s.replace(/\s(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?\s*(?:(\d+)\s*m(?:in)?s?)?(?=\s)/g, (_, h: string, mm?: string) => {
    r.minutes = Math.round(parseFloat(h) * 60 + (mm ? Number(mm) : 0));
    return " ";
  });
  s = s.replace(/\s(\d+)\s*m(?:in(?:ute)?s?)?(?=\s)/g, (_, mm: string) => {
    r.minutes = Number(mm);
    return " ";
  });
  const t = s.match(/\s(\d{1,2})(?::?(\d{2}))?\s*(am|pm|a|p)?(?=\s)/);
  if (t) {
    let h = Number(t[1]);
    const mm = t[2] ? Number(t[2]) : 0;
    if (t[3]) {
      if (t[3][0] === "p" && h < 12) h += 12;
      if (t[3][0] === "a" && h === 12) h = 0;
    } else if (h >= 1 && h <= 6) h += 12;
    if (h < 24 && mm < 60) r.start = h * 60 + mm;
  }
  r.minutes = Math.max(15, Math.min(240, Math.round(r.minutes / 5) * 5));
  return r;
}

/** Side-by-side placement for things on one day that overlap: each gets a slot out of `of`. */
export function layOut<T extends Span>(items: T[]): (T & { slot: number; of: number })[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: (T & { slot: number; of: number })[] = [];
  let group: (T & { slot: number; of: number })[] = [];
  let groupEnd = -1;
  const close = () => {
    const of = Math.max(1, ...group.map((g) => g.slot + 1));
    for (const g of group) g.of = of;
    group = [];
  };
  for (const it of sorted) {
    if (it.start >= groupEnd && group.length) close();
    const used = new Set(group.filter((g) => g.end > it.start).map((g) => g.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    const placed = { ...it, slot, of: 1 };
    group.push(placed);
    out.push(placed);
    groupEnd = Math.max(groupEnd, it.end);
  }
  if (group.length) close();
  return out;
}

/**
 * A meeting's title without the owner's own name, which says nothing on his own dashboard:
 * "Alex Morgan and Aaron Moss" is "Aaron Moss", "Ned and Alex 1:1" is "Ned 1:1",
 * "Meeting - Alex and Jay" is "Jay". A title that is only his name is left alone.
 */
export function meetingTitle(title: string): string {
  const t = title
    .replace(/\bAlex(\s+Morgan)?\s+(and|&|with|\/)\s+/i, "")
    .replace(/\s+(and|&|with|\/)\s+Alex(\s+Morgan)?\b/i, "")
    .replace(/^\s*meeting\s*[-:]\s*/i, "")
    .trim();
  return t || title;
}

/**
 * True when a calendar event is his chatbot's copy of one of his blocks: same day, a start
 * within five minutes, and the task's title. The week then shows the block once, not twice.
 */
export function isCopyOfBlock(e: { day: string; start: number; title: string }, blocks: { day: string; start_min: number; title: string }[]): boolean {
  const t = plainTitle(e.title);
  return blocks.some((b) => b.day === e.day && Math.abs(b.start_min - e.start) <= 5 && plainTitle(b.title) === t);
}

/** A title reduced to what has to match: lower case, no "work on", no punctuation. */
export const plainTitle = (s: string) => s.toLowerCase().replace(/^\s*work(ing)? on\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();

/** "45 min", "1 h", "1 h 30 min". */
export const lengthText = (n: number) => (n < 60 ? `${n} min` : n % 60 ? `${Math.floor(n / 60)} h ${n % 60} min` : `${n / 60} h`);
/** "9:30 AM" from minutes after midnight. */
export const clockText = (min: number) => `${Math.floor(min / 60) % 12 || 12}:${String(min % 60).padStart(2, "0")} ${min < 720 ? "AM" : "PM"}`;
