// types.ts
// Row shapes for every table, plus the enums. Keep in sync with migrations/.

export const AREAS = ["work", "personal", "side_business"] as const;
export type Area = (typeof AREAS)[number];

export const PROJECT_STATUSES = ["idea", "active", "waiting", "paused", "done", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const ENTRY_KINDS = [
  "note",
  "email",
  "meeting",
  "call",
  "decision",
  "status_change",
  "task_done",
  "file",
  "digest",
] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export const ENTRY_SOURCES = ["web", "claude", "mcp", "import"] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

export const TASK_STATUSES = ["todo", "doing", "done"] as const;
/** The rows of the planning board. A task with none is in New (or Waiting, if he is waiting on someone). */
export const BOARD_ROWS = ["todo", "waiting", "back", "figure"] as const;
export type BoardRow = (typeof BOARD_ROWS)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const LINK_KINDS = ["doc", "sheet", "slides", "folder", "email", "site", "other"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const PROJECT_ROLES = ["owner", "collaborator", "stakeholder"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const QUEUE_KINDS = ["reply", "task", "follow_up", "heads_up"] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];

export const QUEUE_STATUSES = ["open", "done", "dismissed"] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

export const RELATIONSHIPS = ["direct", "manager", "peer", "other"] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

export const AGENDA_KINDS = ["discuss", "action"] as const;
export type AgendaKind = (typeof AGENDA_KINDS)[number];

export const AGENDA_STATUSES = ["open", "done", "dropped"] as const;
export type AgendaStatus = (typeof AGENDA_STATUSES)[number];

export const AUDIT_ACTIONS = ["create", "update", "archive", "restore", "delete_soft"] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface Project {
  id: string;
  title: string;
  slug: string;
  area: Area;
  status: ProjectStatus;
  priority: 1 | 2 | 3;
  summary: string;
  notes: string;
  next_step: string;
  waiting_on: string;
  waiting_on_person_id: string | null;
  start_date: string | null;
  due_date: string | null;
  color: string | null;
  cover_url: string | null;
  sort_order: number;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface Person {
  id: string;
  name: string;
  slug: string;
  email: string;
  /** Other names and spellings they go by ("Nena, Nini"), separated by commas. Used wherever a person is matched by name. */
  aliases: string;
  role: string;
  organization: string;
  area: Area | null;
  notes: string;
  avatar_url: string | null;
  last_contact_at: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

/**
 * One person on a task. People work like tags: a task can carry several, and being on it only
 * means it involves them. Two optional marks:
 *   waiting      he is waiting on them for it
 *   one_on_one   it is on the list for his next 1:1 with them (put there by him or his chatbot)
 */
export interface TaskPerson {
  id: string;
  name: string;
  waiting: boolean;
  one_on_one: boolean;
}

export interface ProjectPerson {
  project_id: string;
  person_id: string;
  role: ProjectRole;
}

export interface Entry {
  id: string;
  project_id: string | null;
  kind: EntryKind;
  title: string;
  body: string;
  url: string | null;
  source: EntrySource;
  source_ref: string | null;
  occurred_at: string;
  created_at: string;
  created_by: string;
  deleted_at: string | null;
}

export interface Task {
  id: string;
  /** Null for a task that stands on its own. */
  project_id: string | null;
  /** The desk, for a task with no project. A task on a project uses the project's desk. */
  area: Area | null;
  title: string;
  notes: string;
  /**
   * Only means something when the task has a person: "theirs" is the owner waiting on them,
   * "mine" is something he owes them.
   */
  side: "mine" | "theirs";
  // person_id and side describe the task's LEAD person only (someone he is waiting on, if any,
  // else the first person on it). Everyone on the task is in task_people (TaskPerson below).
  /** No longer used; always 0. (It once marked the lead person as "to discuss".) */
  discuss: number;
  /** Where it came from (an OmniFocus id, an email thread), so it is never added twice. */
  source_ref: string | null;
  /** A day (YYYY-MM-DD). Until then the task is left out of the ordinary lists. */
  hide_until: string | null;
  /** The row he put it in on the planning board. Null: not placed yet (New). */
  board: BoardRow | null;
  /** The calendar event it was added for (calendar_events.id). It shows in that meeting. */
  meeting_ref: string | null;
  /** When it started waiting on its person. */
  waiting_since: string | null;
  status: TaskStatus;
  due_date: string | null;
  person_id: string | null;
  sort_order: number;
  done_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Link {
  id: string;
  project_id: string;
  label: string;
  url: string;
  kind: LinkKind;
  pinned: number;
  created_at: string;
  deleted_at: string | null;
}

export interface Tag {
  id: string;
  name: string;
  created_at: string;
}

export interface Digest {
  id: string;
  run_date: string;
  body: string;
  created_by: string;
  created_at: string;
}

/**
 * One day in the daily log: a short record of what the owner worked on. His chatbot writes it; he
 * does not keep it himself. There is at most one for a day.
 */
export interface DailyLog {
  /** YYYY-MM-DD in his time zone. */
  day: string;
  /** The day written up at its end (markdown): meetings, mail he sent, tasks added and finished. */
  body: string;
  /** What he told his chatbot he did, one thing per line, in the order he said it. */
  notes: string;
  /** How many of those notes (from the first) the write-up already covers; the rest show beneath it. */
  notes_folded: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/**
 * Something an automation prepared for the owner: a drafted reply, a suggested task, a follow-up
 * to send, or a heads-up. Shown under "Needs you" until he marks it done or dismisses it.
 */
export interface QueueItem {
  id: string;
  kind: QueueKind;
  status: QueueStatus;
  area: Area | null;
  project_id: string | null;
  person_id: string | null;
  /** One line: what the owner needs to do. */
  title: string;
  /** Why it needs him, in a sentence or two. */
  summary: string;
  /** The reply or follow-up text that was drafted for him. */
  draft: string;
  /** For task suggestions: the task wording to add. Falls back to title. */
  task_title: string;
  due_date: string | null;
  url: string | null;
  /** "gmail:<thread id>" for email items. Used to open the thread and to avoid duplicates. */
  source_ref: string | null;
  /** Mailbox the thread lives in. Empty means the default account from Settings. */
  mail_account: string;
  /** Who it is from, when they are not a person record. */
  from_name: string;
  received_at: string | null;
  /** YYYY-MM-DD. Hidden from the queue until this day. */
  snoozed_until: string | null;
  /** The task created from this item, if the owner accepted it as a task. */
  task_id: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
  resolved_at: string | null;
  deleted_at: string | null;
}

/** A standing 1:1 with one person. */
export interface OneOnOne {
  person_id: string;
  relationship: Relationship;
  /** Days between meetings. 0 means no fixed rhythm. */
  cadence_days: number;
  /** YYYY-MM-DD of the next one, when it is known. Otherwise it is estimated from the rhythm. */
  next_at: string | null;
  /** Standing notes: their role and team, recurring topics. */
  notes: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

/** One line on the running list the owner keeps for a person. */
export interface AgendaItem {
  id: string;
  person_id: string;
  /** discuss: bring it up next time. action: something that came out of a meeting. */
  kind: AgendaKind;
  /** For actions: 'me' (the owner owes them), 'them' (they owe the owner), null (not sorted yet). */
  owner: "me" | "them" | null;
  title: string;
  notes: string;
  status: AgendaStatus;
  project_id: string | null;
  /** The meeting entry this came out of. */
  entry_id: string | null;
  due_date: string | null;
  url: string | null;
  /** "granola:<note id>:<n>" or "omnifocus:<task id>". Used to avoid duplicates. */
  source_ref: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
  closed_at: string | null;
  deleted_at: string | null;
}

/** One finished automation run, for example the email check. */
export interface Run {
  id: string;
  name: string;
  summary: string;
  ran_at: string;
  created_by: string;
}

export interface AuditRow {
  id: string;
  at: string;
  actor: string;
  action: AuditAction;
  table_name: string;
  row_id: string;
  before: string | null;
  after: string | null;
  undone_at: string | null;
  undone_by: string | null;
}

/** Time he set aside for a task, on his dashboard. */
export interface TimeBlock {
  id: string;
  task_id: string;
  /** YYYY-MM-DD in his time zone. */
  day: string;
  /** Minutes after midnight. */
  start_min: number;
  minutes: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** How one session of his own time went (owntime.ts). One row for a session on a day: the key is ref and day. */
export interface BlockResult {
  /** 'block:<time_blocks.id>' or 'calendar:<calendar_events.id>'. */
  ref: string;
  day: string;
  start_min: number;
  minutes: number;
  title: string;
  task_id: string | null;
  /** 1: he did the work in that time. 0: he did not (see `instead`). null: not said. */
  kept: number | null;
  /** What he did in that time instead, when he said. Only ever set with kept 0. */
  instead: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Settings {
  /** What he calls each row of the planning board. */
  board_names: Record<BoardRow, string>;
  stale_days: number;
  due_soon_days: number;
  timezone: string;
  /** Mailbox used for Superhuman links. Empty means the signed-in owner's email. */
  mail_account: string;
}

/** Small person reference attached to projects, entries and tasks. */
export interface PersonRef {
  id: string;
  name: string;
  slug: string;
  avatar_url: string | null;
  role?: ProjectRole;
}

/** Who is writing. "web", "mcp:claude", "mcp:grok", "script:seed" and so on. */
export interface Ctx {
  db: import("./db").Db;
  actor: string;
}
