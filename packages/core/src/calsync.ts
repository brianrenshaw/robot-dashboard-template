// calsync.ts
// Keeping a copy of the owner's calendars. The main Worker fetches the next few weeks of events
// from Google Calendar for each connected account (it holds the tokens); this file decides what
// to keep and stores it. It never calls the network itself, so it can be tested with made-up
// events.
//
// calendar_events is a cache of an outside source, not the owner's own data: each sync replaces
// that account's rows, and nothing here is written to the audit log. The dashboard uses it for
// today's meetings, the two-week strip, and the real date and time of each 1:1.
// An event counts as a 1:1 with someone when they are the only other guest and the owner has a
// standing 1:1 with them, or when the title reads like "Kai and Alex 1:1".
// Separately, calendar_event_people records which of his people are in each meeting (any
// meeting, not only a 1:1), so the dashboard can order people by his next meeting with them.

import type { Db, Param } from "./db";
import { placeholders } from "./db";
import { markGoogleSync } from "./connections";
import { updatePerson } from "./people";
import { peopleNamedIn } from "./tasks";
import type { Area, Ctx } from "./types";
import { todayInTz } from "./util";

/** The parts of a Google Calendar event this app uses (Calendar API v3, events.list). */
export interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  eventType?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email?: string; displayName?: string; self?: boolean; responseStatus?: string; resource?: boolean }[];
}

export interface CalendarEvent {
  id: string;
  account: string;
  area: Area;
  title: string;
  starts_at: string;
  ends_at: string | null;
  all_day: number;
  /** YYYY-MM-DD in the owner's time zone. */
  day: string;
  location: string;
  url: string | null;
  /** Set when the event is a 1:1 with this person. */
  person_id: string | null;
}

const ONE_ON_ONE = /\b1\s*[:\-]\s*1\b|\bone[ -]on[ -]one\b/i;
/** A meeting with more guests than this is a crowd, not a meeting "with" each of them. */
const SMALL_MEETING = 8;
const COLS = ["id", "account", "area", "title", "starts_at", "ends_at", "all_day", "day", "location", "url", "person_id"] as const;

/** Replace one account's cached events with what Google just returned. Returns how many were kept. */
export async function storeCalendarEvents(ctx: Ctx, account: { email: string; area: Area }, events: GoogleEvent[], timezone: string): Promise<number> {
  // Who the owner has 1:1s with, by email and by first name.
  const partners = await ctx.db.all<{ id: string; name: string; email: string }>(
    `SELECT p.id, p.name, p.email FROM people p JOIN one_on_ones o ON o.person_id = p.id WHERE o.archived_at IS NULL AND p.archived_at IS NULL`,
  );
  const byEmail = new Map(partners.filter((p) => p.email).map((p) => [p.email.toLowerCase(), p.id]));
  const firstNames = new Map<string, string[]>();
  for (const p of partners) {
    const f = p.name.split(/\s+/)[0]!.toLowerCase();
    firstNames.set(f, [...(firstNames.get(f) ?? []), p.id]);
  }

  // Everyone he keeps on the dashboard, to see which of them are in each meeting.
  const everyone = await ctx.db.all<{ id: string; name: string; email: string; aliases: string }>(`SELECT id, name, email, aliases FROM people WHERE archived_at IS NULL`);
  const anyEmail = new Map(everyone.filter((p) => p.email).map((p) => [p.email.toLowerCase(), p.id]));
  const byName = new Map<string, string[]>();
  for (const p of everyone) {
    for (const n of [p.name, ...p.aliases.split(",")].map((x) => x.trim().toLowerCase()).filter(Boolean)) byName.set(n, [...(byName.get(n) ?? []), p.id]);
  }
  // A guest matched by name whose address is not on file yet: remember it, so the next match is exact.
  const learned = new Map<string, string>();

  const rows: CalendarEvent[] = [];
  const links: [string, string][] = []; // event id, person id
  for (const e of events) {
    if (e.status === "cancelled" || e.eventType === "workingLocation") continue;
    const me = e.attendees?.find((a) => a.self);
    if (me?.responseStatus === "declined") continue;
    const start = e.start?.dateTime ?? e.start?.date;
    if (!start) continue;
    const allDay = !e.start?.dateTime;
    const title = (e.summary ?? "").trim() || "Busy";
    const others = (e.attendees ?? []).filter((a) => !a.self && !a.resource && a.email).map((a) => a.email!.toLowerCase());

    let personId: string | null = null;
    if (others.length === 1) personId = byEmail.get(others[0]!) ?? null;
    if (!personId && ONE_ON_ONE.test(title) && others.length <= 1) {
      // "Kai and Alex 1:1": use the first name, if exactly one 1:1 partner has it.
      const first = /^\s*([A-Za-z][\w'-]*)\s+(?:and|&|\/|x|<>)\s/i.exec(title)?.[1]?.toLowerCase();
      const matches = first ? firstNames.get(first) ?? [] : [];
      if (matches.length === 1) personId = matches[0]!;
    }

    // Which of his people this meeting is with: the 1:1 partner, guests matched by email or by
    // their exact name (small meetings only), and a person the title names.
    const withThem = new Set<string>();
    if (personId) withThem.add(personId);
    const guests = (e.attendees ?? []).filter((a) => !a.self && !a.resource);
    if (guests.length <= SMALL_MEETING) {
      for (const g of guests) {
        const named = g.displayName ? byName.get(g.displayName.trim().toLowerCase()) ?? [] : [];
        const known = g.email ? anyEmail.get(g.email.toLowerCase()) : undefined;
        const id = known ?? (named.length === 1 ? named[0] : undefined);
        if (id) withThem.add(id);
        if (id && !known && g.email && !everyone.find((p) => p.id === id)?.email) learned.set(id, g.email.toLowerCase());
      }
    }
    for (const p of peopleNamedIn(title, everyone)) withThem.add(p.id);
    for (const id of withThem) links.push([`${account.email}:${e.id}`, id]);

    rows.push({
      id: `${account.email}:${e.id}`,
      account: account.email,
      area: account.area,
      title,
      starts_at: allDay ? `${start}T00:00:00.000Z` : new Date(start).toISOString(),
      ends_at: e.end?.dateTime ? new Date(e.end.dateTime).toISOString() : null,
      all_day: allDay ? 1 : 0,
      day: allDay ? start : todayInTz(timezone, new Date(start)),
      location: (e.location ?? "").slice(0, 300),
      url: e.htmlLink ?? null,
      person_id: personId,
    });
  }

  await ctx.db.run(`DELETE FROM calendar_events WHERE account = ?`, [account.email]);
  // A few rows per statement: D1 allows 100 bound values in one statement.
  const per = Math.floor(99 / COLS.length);
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    const params: Param[] = chunk.flatMap((r) => COLS.map((c) => r[c] as Param));
    await ctx.db.run(`INSERT OR REPLACE INTO calendar_events (${COLS.join(", ")}) VALUES ${chunk.map(() => `(${placeholders(COLS.length)})`).join(", ")}`, params);
  }
  // Save the addresses learned from guest lists (an ordinary, audited change to the person).
  for (const [id, email] of learned) await updatePerson(ctx, id, { email });
  // The same for who each meeting is with. (Event ids start with the account's address.)
  const prefix = `${account.email}:`;
  await ctx.db.run(`DELETE FROM calendar_event_people WHERE substr(event_id, 1, ?) = ?`, [prefix.length, prefix]);
  for (let i = 0; i < links.length; i += 45) {
    const chunk = links.slice(i, i + 45);
    await ctx.db.run(`INSERT OR IGNORE INTO calendar_event_people (event_id, person_id) VALUES ${chunk.map(() => "(?, ?)").join(", ")}`, chunk.flat());
  }
  await markGoogleSync(ctx.db, account.email, "calendar");
  return rows.length;
}

/** Events from `fromDay` to `toDay` (YYYY-MM-DD, inclusive), in order. */
export async function listCalendarEvents(db: Db, fromDay: string, toDay: string, areas?: Area[]): Promise<CalendarEvent[]> {
  const params: Param[] = [fromDay, toDay];
  let area = "";
  if (areas?.length) {
    area = ` AND area IN (${placeholders(areas.length)})`;
    params.push(...areas);
  }
  return db.all<CalendarEvent>(`SELECT * FROM calendar_events WHERE day >= ? AND day <= ?${area} ORDER BY day, all_day DESC, starts_at LIMIT 400`, params);
}
