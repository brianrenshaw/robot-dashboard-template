// oneonones.ts
// 1:1 meetings. The owner meets regularly with each direct report, with his manager and with a few
// peers. For each of those people the dashboard keeps:
//   - the rhythm (every 14 days, say) and when the next one is;
//   - a running list of things to discuss next time (agenda_items);
//   - what they owe him and what he owes them. Those are ordinary tasks with the person on
//     them (tasks.ts), so there is one list per person, not two. The counts here read tasks;
//   - the meetings themselves, which are ordinary timeline entries of kind "meeting" with that
//     one person on them. Granola fills those in (granola.ts).
// This mirrors how he kept it in OmniFocus: one list per person, "waiting" items for what they
// owe, and a note about where each item came from.

import { recordAudit } from "./audit";
import type { Db, Param } from "./db";
import { placeholders } from "./db";
import { NotFoundError } from "./errors";
import { changedKeys, insertRow, updateRow } from "./rows";
import { agendaCreateSchema, agendaUpdateSchema, oneOnOneSchema } from "./schemas";
import { getSettings } from "./settings";
import { attachEntryInfo, type EntryView } from "./entries";
import type { AgendaItem, Area, Ctx, Entry, OneOnOne, Person } from "./types";
import { addDays, newId, nowIso, todayInTz } from "./util";

/** A 1:1 at a glance, for the dashboard and the People page. */
export interface OneOnOneCard extends OneOnOne {
  name: string;
  slug: string;
  role: string;
  avatar_url: string | null;
  area: Area | null;
  /** When they last met (the newest meeting entry with just this person). */
  last_met_at: string | null;
  /**
   * The next meeting's day. From the calendar when it is connected; otherwise the date someone
   * set if it is still ahead; otherwise worked out from the rhythm.
   */
  next_expected: string | null;
  /** True when next_expected is a guess from the rhythm, not from the calendar or a set date. */
  next_is_estimate: boolean;
  /** The exact start time, when the next meeting is on the calendar. */
  next_starts_at: string | null;
  /** Open items on the list. */
  discuss: number;
  theirs: number;
  mine: number;
  unsorted: number;
}

export interface OneOnOneDetail extends OneOnOneCard {
  /** Open items, then items closed in the last 30 days. */
  agenda: AgendaItem[];
  /** Past meetings with just this person, newest first. */
  sessions: EntryView[];
}

/** A meeting entry counts as a 1:1 session when this person is the only person on it. */
const SESSION = `e.kind = 'meeting' AND e.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM entry_people x WHERE x.entry_id = e.id AND x.person_id = p.id)
  AND (SELECT COUNT(*) FROM entry_people y WHERE y.entry_id = e.id) = 1`;

async function mustPerson(db: Db, id: string): Promise<Person> {
  const p = await db.first<Person>(`SELECT * FROM people WHERE id = ?`, [id]);
  if (!p) throw new NotFoundError(`No person with id ${id}`);
  return p;
}

export async function getOneOnOneRow(db: Db, personId: string): Promise<OneOnOne | null> {
  return db.first<OneOnOne>(`SELECT * FROM one_on_ones WHERE person_id = ?`, [personId]);
}

/** Start a 1:1 with a person, or change its rhythm, next date, relationship or notes. */
export async function setOneOnOne(ctx: Ctx, personId: string, input: unknown = {}): Promise<OneOnOne> {
  const patch = oneOnOneSchema.parse(input ?? {});
  await mustPerson(ctx.db, personId);
  const before = await getOneOnOneRow(ctx.db, personId);
  const now = nowIso();
  if (!before) {
    const row: OneOnOne = {
      person_id: personId,
      relationship: patch.relationship ?? "direct",
      cadence_days: patch.cadence_days ?? 0, // no set rhythm: the next date comes from the calendar
      next_at: patch.next_at ?? null,
      notes: patch.notes ?? "",
      created_at: now,
      updated_at: now,
      archived_at: null,
    };
    await insertRow(ctx.db, "one_on_ones", row as any);
    await recordAudit(ctx, "create", "one_on_ones", null, row as any);
    return row;
  }
  const next = { ...before, ...patch, archived_at: null } as OneOnOne;
  if (!changedKeys(before as any, next as any).length) return before;
  next.updated_at = now;
  await updateRow(ctx.db, "one_on_ones", before as any, next as any);
  await recordAudit(ctx, before.archived_at ? "restore" : "update", "one_on_ones", before as any, next as any);
  return next;
}

/** Stop the 1:1 with a person. Their list and past meetings are kept. */
export async function endOneOnOne(ctx: Ctx, personId: string): Promise<void> {
  const before = await getOneOnOneRow(ctx.db, personId);
  if (!before || before.archived_at) return;
  const next = { ...before, archived_at: nowIso(), updated_at: nowIso() };
  await updateRow(ctx.db, "one_on_ones", before as any, next);
  await recordAudit(ctx, "archive", "one_on_ones", before as any, next);
}

/**
 * Add a line to a person's list. With a source_ref (an item that came from Granola or
 * OmniFocus), adding it again returns the existing line instead of a duplicate.
 */
export async function addAgendaItem(ctx: Ctx, input: unknown): Promise<{ item: AgendaItem; duplicate: boolean }> {
  const data = agendaCreateSchema.parse(input);
  await mustPerson(ctx.db, data.person_id);
  if (data.source_ref) {
    const existing = await ctx.db.first<AgendaItem>(
      `SELECT * FROM agenda_items WHERE source_ref = ? AND person_id = ? ORDER BY created_at LIMIT 1`,
      [data.source_ref, data.person_id],
    );
    if (existing) return { item: existing, duplicate: true };
  }
  const now = nowIso();
  const row: AgendaItem = {
    id: newId("agn"),
    ...data,
    owner: data.kind === "discuss" ? null : data.owner,
    created_at: now,
    created_by: ctx.actor,
    updated_at: now,
    closed_at: data.status === "open" ? null : now,
    deleted_at: null,
  };
  await insertRow(ctx.db, "agenda_items", row as any);
  await recordAudit(ctx, "create", "agenda_items", null, row as any);
  return { item: row, duplicate: false };
}

/** Change a line: check it off, drop it, reopen it, reword it, or say whose it is. */
export async function updateAgendaItem(ctx: Ctx, id: string, input: unknown): Promise<AgendaItem> {
  const patch = agendaUpdateSchema.parse(input);
  const before = await ctx.db.first<AgendaItem>(`SELECT * FROM agenda_items WHERE id = ?`, [id]);
  if (!before || before.deleted_at) throw new NotFoundError(`No agenda item with id ${id}`);
  const now = nowIso();
  const next = { ...before, ...patch } as AgendaItem;
  // Saying whose it is makes it an action; a thing to discuss has no owner.
  if (patch.owner) next.kind = "action";
  if (next.kind === "discuss") next.owner = null;
  if (patch.status && patch.status !== before.status) next.closed_at = patch.status === "open" ? null : now;
  if (!changedKeys(before as any, next as any).length) return before;
  next.updated_at = now;
  await updateRow(ctx.db, "agenda_items", before as any, next as any);
  await recordAudit(ctx, "update", "agenda_items", before as any, next as any);
  return next;
}

export async function deleteAgendaItem(ctx: Ctx, id: string): Promise<void> {
  const before = await ctx.db.first<AgendaItem>(`SELECT * FROM agenda_items WHERE id = ?`, [id]);
  if (!before || before.deleted_at) return;
  const next = { ...before, deleted_at: nowIso() };
  await updateRow(ctx.db, "agenda_items", before as any, next);
  await recordAudit(ctx, "delete_soft", "agenda_items", before as any, next);
}

type CardRow = OneOnOne & Pick<Person, "name" | "slug" | "role" | "avatar_url" | "area"> & {
  last_met_at: string | null;
  /** The next calendar event with this person, as "day|start time". */
  next_event: string | null;
  discuss: number;
  theirs: number;
  mine: number;
  unsorted: number;
};

function toCard({ next_event, ...r }: CardRow, today: string): OneOnOneCard {
  const lastDay = r.last_met_at ? r.last_met_at.slice(0, 10) : null;
  const [eventDay, eventStart] = next_event ? next_event.split("|") : [];
  let next = eventDay ?? (r.next_at && r.next_at >= today ? r.next_at : null);
  let estimate = false;
  if (!next && r.cadence_days > 0 && lastDay) {
    // Step forward from the last meeting in whole rhythms until the date is not in the past.
    next = addDays(lastDay, r.cadence_days);
    while (next < today) next = addDays(next, r.cadence_days);
    estimate = true;
  }
  return {
    ...r,
    discuss: Number(r.discuss),
    theirs: Number(r.theirs),
    mine: Number(r.mine),
    unsorted: Number(r.unsorted),
    next_expected: next,
    next_is_estimate: estimate,
    next_starts_at: eventStart ?? null,
  };
}

/** Open tasks with this person on them: waiting on them ("theirs"), on their 1:1 list ("discuss"), or only tagged ("mine"). */
const TASKS = (side: "mine" | "theirs" | "discuss") =>
  `(SELECT COUNT(*) FROM task_people tp JOIN tasks k ON k.id = tp.task_id
     WHERE tp.person_id = p.id AND ${side === "theirs" ? "tp.waiting = 1" : side === "discuss" ? "tp.one_on_one = 1" : "tp.waiting = 0 AND tp.one_on_one = 0"} AND k.status != 'done' AND k.deleted_at IS NULL)`;

const COUNT = (where: string) =>
  `(SELECT COUNT(*) FROM agenda_items a WHERE a.person_id = p.id AND a.status = 'open' AND a.deleted_at IS NULL AND ${where})`;

async function cards(db: Db, where: string, params: Param[]): Promise<OneOnOneCard[]> {
  const today = todayInTz((await getSettings(db)).timezone);
  const rows = await db.all<CardRow>(
    `SELECT o.*, p.name, p.slug, p.role, p.avatar_url, p.area,
       (SELECT MAX(e.occurred_at) FROM entries e WHERE ${SESSION}) AS last_met_at,
       (SELECT c.day || '|' || c.starts_at FROM calendar_events c WHERE c.person_id = p.id AND c.day >= ? AND (c.all_day = 1 OR c.starts_at >= ?)
         ORDER BY c.starts_at LIMIT 1) AS next_event,
       ${COUNT("a.kind = 'discuss'")} + ${TASKS("discuss")} AS discuss,
       ${TASKS("theirs")} AS theirs,
       ${TASKS("mine")} AS mine,
       ${COUNT("a.kind = 'action' AND a.owner IS NULL")} AS unsorted
     FROM one_on_ones o JOIN people p ON p.id = o.person_id
     WHERE o.archived_at IS NULL AND p.archived_at IS NULL AND ${where}`,
    // A meeting stays "next" until an hour after it starts, so it does not vanish mid-meeting.
    [today, new Date(Date.now() - 3_600_000).toISOString(), ...params],
  );
  // Soonest next meeting first; people with no date at the end.
  return rows
    .map((r) => toCard(r, today))
    .sort((a, b) => (a.next_expected ?? "9999").localeCompare(b.next_expected ?? "9999") || a.name.localeCompare(b.name));
}

/** Every standing 1:1, soonest first. A person with no area shows on every desk. */
export async function listOneOnOnes(db: Db, areas?: Area[]): Promise<OneOnOneCard[]> {
  if (!areas?.length) return cards(db, "1 = 1", []);
  return cards(db, `(p.area IS NULL OR p.area IN (${placeholders(areas.length)}))`, [...areas]);
}

/** One person's 1:1: the card, their whole list, and the past meetings. Null if they have none. */
export async function getOneOnOne(db: Db, personId: string): Promise<OneOnOneDetail | null> {
  const [card] = await cards(db, "o.person_id = ?", [personId]);
  if (!card) return null;
  const agenda = await db.all<AgendaItem>(
    `SELECT * FROM agenda_items WHERE person_id = ? AND deleted_at IS NULL AND (status = 'open' OR closed_at >= ?)
     ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, created_at DESC`,
    [personId, new Date(Date.now() - 30 * 86_400_000).toISOString()],
  );
  const rows = await db.all<Entry>(
    `SELECT e.* FROM entries e JOIN people p ON p.id = ? WHERE ${SESSION} ORDER BY e.occurred_at DESC LIMIT 30`,
    [personId],
  );
  return { ...card, agenda, sessions: await attachEntryInfo(db, rows) };
}
