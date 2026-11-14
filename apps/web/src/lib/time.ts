// time.ts: every date and time shown on screen is formatted here, in Eastern time.

const TZ = "America/New_York";

export function todayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** The YYYY-MM-DD day an ISO time falls on, in Eastern time. */
export function ymdOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round((Date.parse(`${toYmd}T12:00:00Z`) - Date.parse(`${fromYmd}T12:00:00Z`)) / 86_400_000);
}

/** 0 is Sunday. */
export function weekdayOf(ymd: string): number {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay();
}

export function longToday(): string {
  return new Date().toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" });
}

/** "Nov 20", with the year only when it is not this year. */
export function fmtDay(ymd: string | null | undefined): string {
  if (!ymd) return "";
  const d = new Date(`${ymd}T12:00:00Z`);
  const thisYear = todayYmd().slice(0, 4) === ymd.slice(0, 4);
  return d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", ...(thisYear ? {} : { year: "numeric" }) });
}

export function fmtWeekday(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long" });
}

export function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
}

/** Minutes past midnight, in Eastern time, for an ISO time. Used to place meetings on the day bar. */
export function minuteOfDay(iso: string): number {
  const [h, m] = new Date(iso).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).split(":");
  return Number(h) * 60 + Number(m);
}

/** "in 25 min", "in 2 h", "in 1 h 30 min" for a time later today. */
export function untilLabel(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((Date.parse(iso) - now) / 60_000));
  if (mins < 60) return `in ${mins} min`;
  return mins % 60 ? `in ${Math.floor(mins / 60)} h ${mins % 60} min` : `in ${mins / 60} h`;
}

/** A meeting's time range: "8:30 – 9:00 AM", or just the start when there is no end. */
export function fmtRange(startIso: string, endIso: string | null): string {
  if (!endIso) return fmtClock(startIso);
  const a = fmtClock(startIso);
  const b = fmtClock(endIso);
  // Drop the first AM/PM when both are the same half of the day.
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`;
}

/** "Nov 12, 3:10 PM" */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const sameYear = ymdOf(iso).slice(0, 4) === todayYmd().slice(0, 4);
  return d.toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), hour: "numeric", minute: "2-digit" });
}

/** A short "when" for a timeline row: "3:10 PM" today, "Tue" this week, otherwise "Nov 4". */
export function fmtWhen(iso: string): string {
  const day = ymdOf(iso);
  const diff = daysBetween(day, todayYmd());
  if (diff <= 0) return fmtClock(iso);
  if (diff < 7) return new Date(iso).toLocaleDateString("en-US", { timeZone: TZ, weekday: "short" });
  return fmtDay(day);
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  if (d < 30) return `${d}d ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

/** Whole days since an ISO time, for "waiting 6 days". */
export function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000));
}

export type DueTone = "late" | "soon" | "normal";

/** "Today", "Tomorrow", "Fri", "Nov 20", or "3d late". */
export function dueLabel(ymd: string | null): { text: string; tone: DueTone } | null {
  if (!ymd) return null;
  const diff = daysBetween(todayYmd(), ymd);
  if (diff < 0) return { text: `${-diff}d late`, tone: "late" };
  if (diff === 0) return { text: "Today", tone: "soon" };
  if (diff === 1) return { text: "Tomorrow", tone: "soon" };
  if (diff < 7) return { text: fmtWeekday(ymd).slice(0, 3), tone: "soon" };
  return { text: fmtDay(ymd), tone: "normal" };
}

/**
 * The heading a timeline entry falls under: Today, This week, Last week, Earlier this month,
 * then month names.
 */
export function periodOf(iso: string): string {
  const today = todayYmd();
  const day = ymdOf(iso);
  const diff = daysBetween(day, today);
  if (diff <= 0) return "Today";
  const sinceMonday = (weekdayOf(today) + 6) % 7;
  if (diff <= sinceMonday) return "This week";
  if (diff <= sinceMonday + 7) return "Last week";
  if (day.slice(0, 7) === today.slice(0, 7)) return "Earlier this month";
  const d = new Date(`${day}T12:00:00Z`);
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return d.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", ...(sameYear ? {} : { year: "numeric" }) });
}

/** "Thu, Nov 19" */
export function fmtDayLong(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

/** "today", "tomorrow", "in 6 days", "3 days ago" */
export function relDay(ymd: string): string {
  const d = daysBetween(todayYmd(), ymd);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  return d > 0 ? `in ${d} days` : `${-d} days ago`;
}
