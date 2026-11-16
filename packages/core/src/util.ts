// util.ts
// IDs, time helpers and slugs. No database access here.

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32, as used by ULID

export type IdPrefix = "prj" | "per" | "ent" | "tsk" | "lnk" | "tag" | "dig" | "aud" | "que" | "run" | "agn" | "viw" | "blk";

let lastTime = 0;
let lastRandom: number[] = [];

/** A sortable ULID-style ID with a readable prefix, for example prj_01JD3X... */
export function newId(prefix: IdPrefix): string {
  let time = Date.now();
  let random: number[];
  if (time <= lastTime) {
    // Same millisecond: increment the random part so IDs stay sortable and unique.
    time = lastTime;
    random = [...lastRandom];
    for (let i = random.length - 1; i >= 0; i--) {
      if (random[i]! < 31) {
        random[i]!++;
        break;
      }
      random[i] = 0;
    }
  } else {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    random = Array.from(bytes, (b) => b % 32);
  }
  lastTime = time;
  lastRandom = random;
  let t = "";
  let n = time;
  for (let i = 0; i < 10; i++) {
    t = ENCODING[n % 32] + t;
    n = Math.floor(n / 32);
  }
  return `${prefix}_${t}${random.map((r) => ENCODING[r]).join("")}`;
}

export const DEFAULT_TZ = "America/New_York";

export function nowIso(): string {
  return new Date().toISOString();
}

/** Today's date (YYYY-MM-DD) in the given timezone. */
export function todayInTz(tz: string = DEFAULT_TZ, at: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Add days to a YYYY-MM-DD date. */
export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Subtract days from an ISO timestamp. */
export function isoDaysAgo(days: number, from: Date = new Date()): string {
  return new Date(from.getTime() - days * 86_400_000).toISOString();
}

export function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "item";
}

/** Constant time string comparison for tokens. */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (text == null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
