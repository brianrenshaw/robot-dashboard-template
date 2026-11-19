// log.ts
// Reading a day of the daily log for the Log page's list: its title, the lines after it, the
// line a search matched, and the month grid the calendar button opens. Plain functions, tested
// beside this file. (The page asked for 2026-11-19 works like the Day One journal: a list of
// entries to tap, a Today button, a calendar of past days, and a search.)

import type { DailyLog } from "../api";

/** A line of the write-up without its markdown marks. */
export function plainLine(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every line of a day as plain text: the write-up, then what he said after it (or, with no write-up, his notes). */
export function logLines(log: Pick<DailyLog, "body" | "notes" | "notes_folded">): string[] {
  const notes = log.notes.split("\n").map((l) => l.trim()).filter(Boolean);
  const written = log.body.trim();
  const lines = written ? [...written.split("\n"), ...notes.slice(log.notes_folded ?? 0)] : notes;
  return lines.map(plainLine).filter(Boolean);
}

/** What stands for the day in the list: its first line, and the lines after it run together. */
export function logSummary(log: Pick<DailyLog, "body" | "notes" | "notes_folded">): { title: string; rest: string } {
  const [title = "", ...rest] = logLines(log);
  return { title, rest: rest.join(" · ").slice(0, 260) };
}

/** The words of a search, as typed. */
export const wordsOf = (q: string) => q.split(/\s+/).map((w) => w.trim()).filter(Boolean);

/** The line of a day that a search found: the first one with the most of the words in it. */
export function matchLine(log: Pick<DailyLog, "body" | "notes" | "notes_folded">, q: string): string {
  const words = wordsOf(q).map((w) => w.toLowerCase());
  if (!words.length) return "";
  let best = "";
  let most = 0;
  for (const line of logLines(log)) {
    const low = line.toLowerCase();
    const n = words.filter((w) => low.includes(w)).length;
    if (n > most) {
      most = n;
      best = line;
    }
  }
  return best;
}

/** A line cut into the parts a search matched and the parts between, for marking the matches. */
export function markParts(line: string, q: string): { text: string; hit: boolean }[] {
  const words = wordsOf(q).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return [{ text: line, hit: false }];
  const re = new RegExp(`(${words.join("|")})`, "gi");
  return line.split(re).filter(Boolean).map((text) => ({ text, hit: words.some((w) => new RegExp(`^${w}$`, "i").test(text)) }));
}

/** "2026-11" from a day. */
export const monthOf = (day: string) => day.slice(0, 7);

/** The month before or after. */
export function addMonths(month: string, n: number): string {
  const d = new Date(`${month}-15T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}

/** "November 2026". */
export function monthTitle(month: string): string {
  return new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
}

/** A month as weeks, Sunday first; null where the week belongs to another month. */
export function monthGrid(month: string): (string | null)[][] {
  const first = new Date(`${month}-01T12:00:00Z`);
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: first.getUTCDay() }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}
