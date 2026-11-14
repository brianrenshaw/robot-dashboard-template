// quickadd.ts
// Reading a task typed as one line: "Admissions process map @sam fri #admissions".
//   @name   who it is waiting on. It has to match exactly one person (by first name, last
//           name or the start of their full name); otherwise it is left in the text.
//           Several @names put several people on the task.
//   a date  at the END of the line only, so "Call Sun Life" is not read as Sunday: today,
//           tomorrow, a weekday (fri, friday), or a date (12/5, 12/5/27, dec 5).
//   #tag    is handled by the server, which lifts hashtags out of the title.
// Nothing here guesses silently: the add line shows what it understood as it is typed.

import { addDaysYmd, todayYmd, weekdayOf } from "./time";

export interface QuickTask {
  title: string;
  /** The first @name, for the pill under the add line. */
  person?: { id: string; name: string };
  /** Every @name that matched one person, in the order typed. */
  people: { id: string; name: string }[];
  due?: string;
}

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A date word or phrase, as YYYY-MM-DD. Dates with no year mean the next time that day comes. */
export function readDate(text: string, today = todayYmd()): string | null {
  const t = text.trim().toLowerCase();
  if (t === "today") return today;
  if (t === "tomorrow" || t === "tmrw") return addDaysYmd(today, 1);
  const day = DAYS.findIndex((d) => t.length >= 3 && d.startsWith(t));
  if (day >= 0) return addDaysYmd(today, (day - weekdayOf(today) + 7) % 7 || 7);
  let month = 0;
  let date = 0;
  let year = 0;
  const slash = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(t);
  const named = /^([a-z]{3,9})\.? (\d{1,2})$/.exec(t);
  if (slash) [month, date, year] = [Number(slash[1]), Number(slash[2]), Number(slash[3] ?? 0)];
  else if (named && MONTHS.some((m) => named[1]!.startsWith(m))) [month, date] = [MONTHS.findIndex((m) => named[1]!.startsWith(m)) + 1, Number(named[2])];
  else return null;
  if (month < 1 || month > 12 || date < 1 || date > 31) return null;
  if (year && year < 100) year += 2000;
  const make = (y: number) => `${y}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
  const thisYear = Number(today.slice(0, 4));
  if (year) return make(year);
  return make(thisYear) >= today ? make(thisYear) : make(thisYear + 1);
}

export function readQuickTask(line: string, people: { id: string; name: string }[], today = todayYmd()): QuickTask {
  let text = line.trim();
  const out: QuickTask = { title: text, people: [] };
  // @name, as many as are typed. One that matches no one, or more than one person, stays in the text.
  text = text
    .replace(/(^|\s)@([\p{L}][\p{L}'-]*)/gu, (whole, space: string, name: string) => {
      const want = name.toLowerCase();
      const hits = people.filter((p) => p.name.toLowerCase().split(/\s+/).some((part) => part === want) || p.name.toLowerCase().replace(/\s+/g, "").startsWith(want));
      if (hits.length !== 1) return whole;
      if (!out.people.some((p) => p.id === hits[0]!.id)) out.people.push({ id: hits[0]!.id, name: hits[0]!.name });
      return space;
    })
    .replace(/\s{2,}/g, " ")
    .trim();
  if (out.people[0]) out.person = out.people[0];
  // A date at the end, ignoring any #tags after it. Try the last two words ("dec 5"), then the last one.
  const tags = /(\s+#\S+)+$/.exec(text)?.[0] ?? "";
  const body = text.slice(0, text.length - tags.length);
  const words = body.split(/\s+/);
  for (const take of [2, 1]) {
    if (words.length <= take) continue;
    const due = readDate(words.slice(-take).join(" "), today);
    if (due) {
      out.due = due;
      text = words.slice(0, -take).join(" ").replace(/\s+(by|on|due)$/i, "") + tags;
      break;
    }
  }
  out.title = text.trim();
  return out;
}
