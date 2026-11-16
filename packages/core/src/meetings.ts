// meetings.ts
// Tasks and a note for a meeting on his calendar (asked for 2026-11-16).
//
// A task is tied to a meeting by tasks.meeting_ref (the calendar event's id). A meeting's note
// is one ordinary entry, kind "meeting", with source_ref "calendar:<event id>": it is filed
// with the meeting's people and dated when the meeting starts, so it also shows on their
// pages, in Notes, and in that day's log. He adds to it during or after the meeting, on the
// dashboard or through his chatbot ("add a note to my 2 o'clock").

import type { Db } from "./db";
import { placeholders } from "./db";
import { addEntry, attachEntryInfo, updateEntry, type EntryView } from "./entries";
import { NotFoundError } from "./errors";
import { meetingNoteSchema } from "./schemas";
import type { Ctx, Entry } from "./types";

export const meetingRef = (eventId: string) => `calendar:${eventId}`;

/** The notes for these meetings, by event id. */
export async function meetingNotes(db: Db, eventIds: string[]): Promise<EntryView[]> {
  const out: Entry[] = [];
  for (let i = 0; i < eventIds.length; i += 90) {
    const chunk = eventIds.slice(i, i + 90).map(meetingRef);
    if (!chunk.length) continue;
    out.push(...(await db.all<Entry>(`SELECT * FROM entries WHERE deleted_at IS NULL AND source_ref IN (${placeholders(chunk.length)})`, chunk)));
  }
  return attachEntryInfo(db, out);
}

/** His people in a meeting: the 1:1 partner and anyone the calendar matched to one of his people. */
export async function meetingPeople(db: Db, eventId: string): Promise<string[]> {
  const rows = await db.all<{ person_id: string }>(
    `SELECT person_id FROM calendar_event_people WHERE event_id = ?
     UNION SELECT person_id FROM calendar_events WHERE id = ? AND person_id IS NOT NULL`,
    [eventId, eventId],
  );
  return rows.map((r) => r.person_id);
}

/**
 * Write a meeting's note: `body` replaces it, `add` adds a line to the end. The first write
 * files it, with the meeting's title, its people and its start time.
 */
export async function saveMeetingNote(ctx: Ctx, eventId: string, input: unknown): Promise<EntryView> {
  const { body, add } = meetingNoteSchema.parse(input);
  const event = await ctx.db.first<{ id: string; title: string; starts_at: string; person_id: string | null }>(
    `SELECT id, title, starts_at, person_id FROM calendar_events WHERE id = ?`,
    [eventId],
  );
  const existing = await ctx.db.first<Entry>(`SELECT * FROM entries WHERE source_ref = ? AND deleted_at IS NULL`, [meetingRef(eventId)]);
  if (existing) {
    const next = body !== undefined ? body : existing.body.trim() ? `${existing.body.trimEnd()}\n${add}` : add!;
    if (next === existing.body) return (await attachEntryInfo(ctx.db, [existing]))[0]!;
    return updateEntry(ctx, existing.id, { body: next });
  }
  if (!event) throw new NotFoundError("That meeting is not on the calendar the dashboard has. It may have passed or been cancelled.");
  const personIds = await meetingPeople(ctx.db, eventId);
  const { entry } = await addEntry(ctx, {
    kind: "meeting",
    title: event.title,
    body: body ?? add ?? "",
    person_ids: personIds,
    occurred_at: event.starts_at,
    source_ref: meetingRef(eventId),
  });
  return entry;
}
