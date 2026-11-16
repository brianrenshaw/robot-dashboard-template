// schemas.ts
// Zod schemas for every write. The API and MCP Workers validate input with these,
// so a new field only needs to be added here (plus a migration and the UI).

import { z } from "zod";
import {
  AREAS,
  BOARD_ROWS,
  ENTRY_KINDS,
  ENTRY_SOURCES,
  LINK_KINDS,
  PROJECT_ROLES,
  AGENDA_KINDS,
  AGENDA_STATUSES,
  PROJECT_STATUSES,
  RELATIONSHIPS,
  QUEUE_KINDS,
  QUEUE_STATUSES,
  TASK_STATUSES,
} from "./types";

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date")
  .nullable();
const isoTime = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "Use an ISO 8601 date or time");
const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #4a7bd0")
  .nullable();
const url = z.string().trim().min(1).max(2000);

export const areaSchema = z.enum(AREAS);
export const projectStatusSchema = z.enum(PROJECT_STATUSES);
export const entryKindSchema = z.enum(ENTRY_KINDS);
export const taskStatusSchema = z.enum(TASK_STATUSES);
export const linkKindSchema = z.enum(LINK_KINDS);
export const projectRoleSchema = z.enum(PROJECT_ROLES);

export const projectCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  area: areaSchema,
  status: projectStatusSchema.default("active"),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
  summary: z.string().max(1000).default(""),
  notes: z.string().max(100_000).default(""),
  next_step: z.string().max(1000).default(""),
  waiting_on: z.string().max(1000).default(""),
  waiting_on_person_id: z.string().nullable().default(null),
  start_date: ymd.default(null),
  due_date: ymd.default(null),
  color: hexColor.default(null),
  cover_url: url.nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(50)).optional(),
});
export type ProjectCreate = z.input<typeof projectCreateSchema>;

export const projectUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    slug: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80),
    area: areaSchema,
    status: projectStatusSchema,
    priority: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    summary: z.string().max(1000),
    notes: z.string().max(100_000),
    next_step: z.string().max(1000),
    waiting_on: z.string().max(1000),
    waiting_on_person_id: z.string().nullable(),
    start_date: ymd,
    due_date: ymd,
    color: hexColor,
    cover_url: url.nullable(),
    sort_order: z.number(),
    tags: z.array(z.string().trim().min(1).max(50)),
  })
  .partial()
  .strict();
export type ProjectUpdate = z.infer<typeof projectUpdateSchema>;

export const personCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().max(320).default(""),
  aliases: z.string().max(300).default(""),
  role: z.string().max(200).default(""),
  organization: z.string().max(200).default(""),
  area: areaSchema.nullable().default(null),
  notes: z.string().max(100_000).default(""),
  avatar_url: url.nullable().default(null),
});
export type PersonCreate = z.input<typeof personCreateSchema>;

export const personUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z.string().max(320),
    aliases: z.string().max(300),
    role: z.string().max(200),
    organization: z.string().max(200),
    area: areaSchema.nullable(),
    notes: z.string().max(100_000),
    avatar_url: url.nullable(),
  })
  .partial()
  .strict();
export type PersonUpdate = z.infer<typeof personUpdateSchema>;

export const entryCreateSchema = z.object({
  project_id: z.string().nullable().default(null),
  extra_project_ids: z.array(z.string()).default([]),
  person_ids: z.array(z.string()).default([]),
  kind: entryKindSchema.default("note"),
  title: z.string().max(500).default(""),
  body: z.string().max(100_000).default(""),
  url: url.nullable().default(null),
  source: z.enum(ENTRY_SOURCES).default("web"),
  source_ref: z.string().max(500).nullable().default(null),
  occurred_at: isoTime.optional(),
});
export type EntryCreate = z.input<typeof entryCreateSchema>;

export const entryUpdateSchema = z
  .object({
    project_id: z.string().nullable(),
    kind: entryKindSchema,
    title: z.string().max(500),
    body: z.string().max(100_000),
    url: url.nullable(),
    occurred_at: isoTime,
    person_ids: z.array(z.string()),
  })
  .partial()
  .strict();
export type EntryUpdate = z.infer<typeof entryUpdateSchema>;

export const taskCreateSchema = z.object({
  /** Optional: most tasks stand on their own. */
  project_id: z.string().min(1).nullable().default(null),
  /** The desk for a task with no project. Ignored when there is a project. */
  area: areaSchema.nullable().default(null),
  title: z.string().trim().min(1).max(500),
  notes: z.string().max(20_000).default(""),
  status: taskStatusSchema.default("todo"),
  due_date: ymd.default(null),
  /** The person it involves. Empty means it is simply the owner's own. */
  person_id: z.string().nullable().default(null),
  /** With a person: "theirs" (the default) is waiting on them, "mine" is owed to them. */
  side: z.enum(["mine", "theirs"]).default("theirs"),
  /** With person_id: put it on the list for the next 1:1 with them. */
  discuss: z.boolean().default(false),
  /** Everyone on the task, each with the two optional marks. When given, person_id / side / discuss are ignored. */
  people: z.array(z.object({ person_id: z.string().min(1), waiting: z.boolean().default(false), one_on_one: z.boolean().default(false) })).max(12).optional(),
  source_ref: z.string().max(500).nullable().default(null),
  /** Leave it out of the ordinary lists until this day. */
  hide_until: ymd.default(null),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  /** The calendar event it is for: it then shows in that meeting. */
  meeting_ref: z.string().min(1).max(300).nullable().default(null),
});
export type TaskCreate = z.input<typeof taskCreateSchema>;

export const taskUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    notes: z.string().max(20_000),
    status: taskStatusSchema,
    due_date: ymd,
    person_id: z.string().nullable(),
    side: z.enum(["mine", "theirs"]),
    discuss: z.boolean(),
    /** The full new list of people on the task. */
    people: z.array(z.object({ person_id: z.string().min(1), waiting: z.boolean().default(false), one_on_one: z.boolean().default(false) })).max(12),
    hide_until: ymd,
    project_id: z.string().min(1).nullable(),
    area: areaSchema.nullable(),
    sort_order: z.number(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20),
    /** The row on the planning board; null puts it back in New. */
    board: z.enum(BOARD_ROWS).nullable(),
    meeting_ref: z.string().min(1).max(300).nullable(),
  })
  .partial()
  .strict();
export type TaskUpdate = z.infer<typeof taskUpdateSchema>;

export const reorderSchema = z.object({
  ids: z.array(z.string()).min(1).max(1000),
});

export const projectReorderSchema = z.object({
  ids: z.array(z.string()).min(1).max(1000),
  status: projectStatusSchema.optional(),
});

export const linkCreateSchema = z.object({
  project_id: z.string().min(1),
  label: z.string().trim().min(1).max(300),
  url,
  kind: linkKindSchema.default("other"),
  pinned: z.boolean().default(true),
});
export type LinkCreate = z.input<typeof linkCreateSchema>;

export const linkUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(300),
    url,
    kind: linkKindSchema,
    pinned: z.boolean(),
  })
  .partial()
  .strict();
export type LinkUpdate = z.infer<typeof linkUpdateSchema>;

export const projectPersonSchema = z.object({
  person_id: z.string().min(1),
  role: projectRoleSchema.default("collaborator"),
});

export const digestSchema = z.object({
  run_date: ymd.unwrap().optional(),
  body: z.string().min(1).max(100_000),
});

/**
 * A write to the daily log. `body` is the day written up and replaces what was written before;
 * `add` is one or more things he said he did, added to the day's notes. `day` defaults to today.
 */
export const dailyLogSaveSchema = z
  .object({
    day: ymd.unwrap().optional(),
    body: z.string().max(20_000).optional(),
    add: z.array(z.string().trim().min(1).max(500)).max(30).optional(),
  })
  .strict()
  .refine((d) => d.body !== undefined || (d.add?.length ?? 0) > 0, "Pass body, add, or both");

const mailbox = z.union([z.literal(""), z.string().email().max(320)]);

export const queueCreateSchema = z.object({
  kind: z.enum(QUEUE_KINDS),
  area: areaSchema.nullable().default(null),
  project_id: z.string().nullable().default(null),
  person_id: z.string().nullable().default(null),
  title: z.string().trim().min(1).max(300),
  summary: z.string().max(4000).default(""),
  draft: z.string().max(20_000).default(""),
  task_title: z.string().max(500).default(""),
  due_date: ymd.default(null),
  url: url.nullable().default(null),
  source_ref: z.string().max(500).nullable().default(null),
  mail_account: mailbox.default(""),
  from_name: z.string().max(200).default(""),
  received_at: isoTime.nullable().default(null),
});
export type QueueCreate = z.input<typeof queueCreateSchema>;

export const queueUpdateSchema = z
  .object({
    status: z.enum(QUEUE_STATUSES),
    snoozed_until: ymd,
    area: areaSchema.nullable(),
    project_id: z.string().nullable(),
    person_id: z.string().nullable(),
    title: z.string().trim().min(1).max(300),
    summary: z.string().max(4000),
    draft: z.string().max(20_000),
    task_title: z.string().max(500),
    due_date: ymd,
    url: url.nullable(),
  })
  .partial()
  .strict();
export type QueueUpdate = z.infer<typeof queueUpdateSchema>;

/** Turning a queue item into a task. Everything is optional: the item's own values are the defaults. */
export const queueAcceptSchema = z
  .object({
    project_id: z.string().min(1),
    title: z.string().trim().min(1).max(500),
    due_date: ymd,
  })
  .partial()
  .strict();

export const oneOnOneSchema = z
  .object({
    relationship: z.enum(RELATIONSHIPS),
    cadence_days: z.number().int().min(0).max(365),
    next_at: ymd,
    notes: z.string().max(20_000),
  })
  .partial()
  .strict();

const agendaOwner = z.enum(["me", "them"]).nullable();

export const agendaCreateSchema = z.object({
  person_id: z.string().min(1),
  kind: z.enum(AGENDA_KINDS).default("discuss"),
  owner: agendaOwner.default(null),
  title: z.string().trim().min(1).max(500),
  notes: z.string().max(10_000).default(""),
  status: z.enum(AGENDA_STATUSES).default("open"),
  project_id: z.string().nullable().default(null),
  entry_id: z.string().nullable().default(null),
  due_date: ymd.default(null),
  url: url.nullable().default(null),
  source_ref: z.string().max(500).nullable().default(null),
});
export type AgendaCreate = z.input<typeof agendaCreateSchema>;

export const agendaUpdateSchema = z
  .object({
    kind: z.enum(AGENDA_KINDS),
    owner: agendaOwner,
    title: z.string().trim().min(1).max(500),
    notes: z.string().max(10_000),
    status: z.enum(AGENDA_STATUSES),
    project_id: z.string().nullable(),
    due_date: ymd,
  })
  .partial()
  .strict();

export const runSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and dashes, for example email-check"),
  summary: z.string().max(1000).default(""),
});

const rowName = z.string().trim().min(1).max(40);
export const settingsUpdateSchema = z
  .object({
    board_names: z.object({ todo: rowName, waiting: rowName, back: rowName, figure: rowName }),
    stale_days: z.number().int().min(1).max(365),
    due_soon_days: z.number().int().min(1).max(90),
    timezone: z.string().min(1).max(100),
    mail_account: mailbox,
  })
  .partial()
  .strict();

/** Turn a ZodError into one readable sentence. */
export function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => `${i.path.length ? i.path.join(".") + ": " : ""}${i.message}`)
    .join("; ");
}

// ---------- task filters and saved views ----------

const taskFilterBase = z.object({
  areas: z.array(areaSchema).optional(),
  /** Every one of these tags must be on the task. */
  tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  /** "mine" is his own (including what he owes someone); "theirs" is waiting on someone. */
  who: z.enum(["mine", "theirs"]).optional(),
  /** Only tasks with this person on them. */
  person_id: z.string().optional(),
  /** A project id, or "none" for tasks with no project. */
  project_id: z.string().optional(),
  /** late: past its date. today, week: due by then (late ones included). dated / none: has a due date or not. */
  due: z.enum(["late", "today", "week", "dated", "none"]).optional(),
  /** Added at least this many days ago. */
  older_than_days: z.number().int().min(0).max(3650).optional(),
  /** Waiting on someone for at least this many days. */
  waiting_days: z.number().int().min(0).max(3650).optional(),
  /** Came from an email (its source is a mail thread). */
  has_email: z.boolean().optional(),
  /** Words that must appear in the title or the notes. */
  text: z.string().trim().max(100).optional(),
  /** Tasks hidden until a later day: left out (the default), included, or shown alone. */
  hidden: z.enum(["exclude", "include", "only"]).optional(),
  /** open (the default), done (finished within done_within_days), or any. */
  state: z.enum(["open", "done", "any"]).optional(),
  done_within_days: z.number().int().min(1).max(365).optional(),
});
/** `any` holds alternatives: a task matches if it fits at least one of them, as well as everything else. */
export const taskFilterSchema = taskFilterBase.extend({ any: z.array(taskFilterBase).max(6).optional() }).strict();
export type TaskFilterInput = z.infer<typeof taskFilterSchema>;

export const viewCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  filter: taskFilterSchema,
  pinned: z.boolean().default(true),
});
export const viewUpdateSchema = z.object({ name: z.string().trim().min(1).max(80), filter: taskFilterSchema, pinned: z.boolean() }).partial().strict();

/** A block of time for a task: a day, a start (minutes after midnight) and a length. */
export const timeBlockSchema = z.object({
  task_id: z.string().min(1),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "day must be YYYY-MM-DD"),
  start_min: z.number().int().min(0).max(24 * 60 - 5),
  minutes: z.number().int().min(5).max(12 * 60),
});
export const timeBlockUpdateSchema = timeBlockSchema.omit({ task_id: true }).partial().strict();

/** A meeting's note: replace it (body) or add a line to it (add). */
export const meetingNoteSchema = z
  .object({ body: z.string().max(100_000).optional(), add: z.string().trim().min(1).max(10_000).optional() })
  .strict()
  .refine((v) => v.body !== undefined || v.add !== undefined, "Give body or add");
