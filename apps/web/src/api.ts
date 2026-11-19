// api.ts
// The only place the frontend talks to the server. Types come from @pd/core so the
// frontend and API always agree on shapes.

import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AuditView,
  HomeData,
  Link,
  PersonCard,
  PersonDetail,
  Project,
  ProjectCard,
  ProjectDetail,
  SearchResults,
  Settings,
  Task,
  EntryView,
  Run,
  AgendaItem,
  OneOnOne,
  OneOnOneCard,
  OneOnOneDetail,
  ProjectPulse,
  CalendarEvent,
  GoogleAccount,
  SecretInfo,
  SyncReport,
  TaskItem,
  Area,
  SavedView,
  TaskFilterInput,
  DailyLog,
  TimeBlock,
  TimeBlockView,
  BoardRow,
  BlockResult,
  BlockTally,
} from "@pd/core";
import { useScope } from "./spaces";

export type {
  AuditView, HomeData, Link, PersonCard, PersonDetail, Project, ProjectCard, ProjectDetail,
  SearchResults, Settings, Task, EntryView, Run, AgendaItem, OneOnOne, OneOnOneCard, OneOnOneDetail, ProjectPulse, CalendarEvent, GoogleAccount, SecretInfo, SyncReport,
};
export type { SavedView, DailyLog, TimeBlock, TimeBlockView, BoardRow, BlockResult, BlockTally };
/** How a task list is narrowed. See `taskFilterSchema` in packages/core/src/schemas.ts. */
export type TaskFilter = TaskFilterInput;
export type { Person, Area, ProjectStatus, EntryKind, TaskStatus, LinkKind, ProjectRole, PersonRef, TaskItem, TaskPerson, PersonComingUp } from "@pd/core";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public candidates?: { id: string; label: string }[],
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  if (res.status === 401 || res.status === 403) {
    // Access session expired. A full reload sends the browser through the Access login.
    if (!sessionStorageFlag()) window.location.reload();
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    throw new ApiError((data as any)?.error ?? `Request failed (${res.status})`, res.status, (data as any)?.candidates);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 200) };
  }
}

/** Avoid reload loops if Access keeps refusing. */
function sessionStorageFlag(): boolean {
  try {
    if (sessionStorage.getItem("pd-reloaded")) return true;
    sessionStorage.setItem("pd-reloaded", "1");
    setTimeout(() => sessionStorage.removeItem("pd-reloaded"), 10_000);
  } catch {
    return true;
  }
  return false;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  put: <T>(path: string, body: unknown = {}) => request<T>("PUT", path, body),
  post: <T>(path: string, body: unknown = {}) => request<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 },
  },
});

// ---------- queries ----------

/**
 * Everything the desks show, for all three areas in one request. Each desk filters this down
 * to its own area (lib/desk.ts), so walking between desks never waits on the network.
 */
export function useHome() {
  return useQuery({ queryKey: ["home"], queryFn: () => api.get<HomeData>(`/api/home`) });
}

/** Recent timeline entries for the desk you are at. */
export function useRecentEntries(enabled = true) {
  const { param } = useScope();
  return useQuery({ queryKey: ["entries", param], queryFn: () => api.get<EntryView[]>(`/api/entries?areas=${param}&limit=40`), enabled });
}

export interface ProjectQuery {
  status?: string[];
  person?: string;
  tag?: string;
  archived?: boolean;
  q?: string;
}

export function useProjects(f: ProjectQuery = {}) {
  const { param } = useScope();
  const qs = new URLSearchParams({ areas: param });
  if (f.status?.length) qs.set("status", f.status.join(","));
  if (f.person) qs.set("person", f.person);
  if (f.tag) qs.set("tag", f.tag);
  if (f.archived) qs.set("archived", "1");
  if (f.q) qs.set("q", f.q);
  return useQuery({ queryKey: ["projects", qs.toString()], queryFn: () => api.get<ProjectCard[]>(`/api/projects?${qs}`) });
}

/** All open projects on every desk, for pickers. */
export function useAllProjects() {
  return useQuery({ queryKey: ["projects", "all"], queryFn: () => api.get<ProjectCard[]>(`/api/projects?sort=title`) });
}

export function useProject(id: string) {
  return useQuery({ queryKey: ["project", id], queryFn: () => api.get<ProjectDetail>(`/api/projects/${id}`) });
}

export function usePeople() {
  const { param } = useScope();
  return useQuery({ queryKey: ["people", param], queryFn: () => api.get<PersonCard[]>(`/api/people?areas=${param}`) });
}

/** Everyone, for pickers. */
export function useAllPeople() {
  return useQuery({ queryKey: ["people", "all"], queryFn: () => api.get<PersonCard[]>(`/api/people`) });
}

/** A person shows everything you have with them, across all desks. */
export function usePerson(id: string) {
  return useQuery({ queryKey: ["person", id], queryFn: () => api.get<PersonDetail>(`/api/people/${id}`) });
}

/** Notes of every kind (notes, meetings, calls, decisions, filed emails), newest first. */
export function useNotes(areas: string) {
  return useQuery({ queryKey: ["notes", areas], queryFn: () => api.get<EntryView[]>(`/api/entries?kind=note,meeting,call,decision,email,file&areas=${areas}&limit=200`) });
}

/** The task list for one desk (areas = "work") or everywhere (areas = ""), with the ones finished lately. */
/** Every task with one person on it: the open ones, and the ones checked off in the last two weeks. */
export function usePersonTasks(personId: string) {
  return useQuery({ queryKey: ["tasks", "person", personId], queryFn: () => api.get<TaskItem[]>(`/api/tasks?person=${personId}&done=1`) });
}

/** The tasks matching a filter. The server does the filtering, so a saved view and the page agree. */
export function useTaskSearch(filter: TaskFilter) {
  const key = JSON.stringify(filter);
  return useQuery({ queryKey: ["tasks", "search", key], queryFn: () => api.post<TaskItem[]>(`/api/tasks/search`, filter), placeholderData: (prev) => prev });
}

/** Saved views (perspectives): named filters pinned to the Tasks page. */
export function useViews() {
  return useQuery({ queryKey: ["views"], queryFn: () => api.get<SavedView[]>(`/api/views`) });
}
export function useSaveView() {
  return useWrite((v: { name: string; filter: TaskFilter }) => api.post<SavedView>("/api/views", v), undefined, (v) => toast({ text: `Saved the view “${v.name}”. It is pinned to the top of Tasks.` }));
}
/** Rename a saved view, or replace its filter with the one on screen. */
export function useUpdateView() {
  return useWrite(({ id, ...patch }: { id: string; name?: string; filter?: TaskFilter }) => api.patch<SavedView>(`/api/views/${id}`, patch), undefined, (v) => toast({ text: `Updated the view “${v.name}”.` }));
}
export function useDeleteView() {
  return useWrite((id: string) => api.post(`/api/views/${id}/delete`), undefined, () => toast({ text: "View removed. Its tasks are untouched.", undo: true }));
}

/** Everything that carries one tag. */
export function useTagView(name: string) {
  return useQuery({ queryKey: ["tag", name], queryFn: () => api.get<TagView>(`/api/tags/${encodeURIComponent(name)}`) });
}
export interface TagView {
  name: string;
  tasks: TaskItem[];
  notes: EntryView[];
  projects: ProjectCard[];
}

export interface NewTask {
  title: string;
  person_id?: string | null;
  /** With person_id: "theirs" (he is waiting on them, the default) or "mine" (they are only tagged). */
  side?: "mine" | "theirs";
  /** With person_id: put it on the list for the next 1:1 with them. */
  discuss?: boolean;
  /** Several people at once. When given, person_id / side / discuss are not used. */
  people?: { person_id: string; waiting?: boolean; one_on_one?: boolean }[];
  hide_until?: string | null;
  due_date?: string | null;
  project_id?: string | null;
  area?: Area | null;
  tags?: string[];
  /** The calendar event it is for: it then shows in that meeting. */
  meeting_ref?: string | null;
}
/** Add a task. Only the title is needed. */
export function useAddTask() {
  return useWrite((v: NewTask) => api.post<Task>("/api/tasks", v));
}

/** Change a task from a list (check it off, reword it, retag it). The list updates at once. */
export function useEditTask() {
  return useWrite(
    ({ id, ...patch }: { id: string } & Partial<Pick<Task, "title" | "notes" | "status" | "due_date" | "person_id" | "side" | "project_id" | "hide_until" | "board" | "sort_order">> & { tags?: string[]; people?: { person_id: string; waiting?: boolean; one_on_one?: boolean }[] }) => api.patch<Task>(`/api/tasks/${id}`, patch),
    ({ id, tags, people, ...patch }, qc) => {
      // Shown at once. People already on the task keep their names; a newly added one shows
      // when the list reloads a moment later.
      const marks = people && new Map(people.map((p) => [p.person_id, p]));
      const apply = (t: TaskItem): TaskItem =>
        t.id === id
          ? { ...t, ...patch, ...(tags ? { tags } : {}), ...(marks ? { people: t.people.filter((p) => marks.has(p.id)).map((p) => ({ ...p, waiting: !!marks.get(p.id)!.waiting, one_on_one: !!marks.get(p.id)!.one_on_one })) } : {}) }
          : t;
      qc.setQueriesData<TaskItem[]>({ queryKey: ["tasks"] }, (old) =>
        Array.isArray(old) ? old.map(apply) : old,
      );
      // The dashboard's lines come from the home data.
      qc.setQueryData<HomeData>(["home"], (old) => (old ? { ...old, open_tasks: old.open_tasks.map(apply) } : old));
      qc.setQueriesData<TagView>({ queryKey: ["tag"] }, (old) => (old ? { ...old, tasks: old.tasks.map(apply) } : old));
    },
  );
}

// ---------- the planner: time blocks and the board's row names ----------

type BlockDraft = { task_id: string; day: string; start_min: number; minutes: number; title: string; area: Area };
const patchBlocks = (qc: ReturnType<typeof useQueryClient>, f: (b: TimeBlockView[]) => TimeBlockView[]) =>
  qc.setQueryData<HomeData>(["home"], (old) => (old ? { ...old, blocks: f(old.blocks) } : old));

/** Set aside time for a task. It shows on the week at once. */
export function useAddBlock() {
  return useWrite(
    ({ title: _t, area: _a, ...v }: BlockDraft) => api.post<TimeBlock>("/api/blocks", v),
    (v, qc) => patchBlocks(qc, (bs) => [...bs, { ...v, id: `new-${Date.now()}`, status: "todo", created_by: "", created_at: "", updated_at: "", deleted_at: null }]),
  );
}
/** Move a block, or change its length. */
export function useMoveBlock() {
  return useWrite(
    ({ id, ...v }: { id: string; day?: string; start_min?: number; minutes?: number }) => api.patch<TimeBlock>(`/api/blocks/${id}`, v),
    ({ id, ...v }, qc) => patchBlocks(qc, (bs) => bs.map((b) => (b.id === id ? { ...b, ...v } : b))),
  );
}
/** Take a block off the week. */
export function useDeleteBlock() {
  return useWrite(
    (id: string) => api.post(`/api/blocks/${id}/delete`),
    (id, qc) => patchBlocks(qc, (bs) => bs.filter((b) => b.id !== id)),
  );
}
/**
 * Say whether he did the work in a session of his own time. `ref` is block:<id> for a block on
 * the dashboard, calendar:<event id> for a calendar entry by himself. null takes the answer back.
 */
/**
 * How a session of his own time went: he did the work (kept true), he did not get to it (kept
 * false), he did something else (kept false with `instead`), or the answer taken back (null).
 * The answer belongs to the session on its day, so the day goes with the ref.
 */
export function useSaveBlockResult() {
  return useWrite(
    (v: { ref: string; day: string; kept: boolean | null; instead?: string }) => api.put<BlockResult>("/api/blocks/result", v),
    (v, qc) =>
      qc.setQueryData<HomeData>(["home"], (old) => {
        if (!old) return old;
        const same = (r: BlockResult) => r.ref === v.ref && r.day === v.day;
        const rest = old.block_results.filter((r) => !same(r));
        const was = old.block_results.find(same);
        const row: BlockResult = { start_min: 0, minutes: 0, title: "", task_id: null, created_by: "", created_at: "", updated_at: "", ...was, ref: v.ref, day: v.day, kept: v.kept ? 1 : 0, instead: v.kept === false ? v.instead ?? was?.instead ?? "" : "" };
        return { ...old, block_results: v.kept === null ? rest : [...rest, row] };
      }),
  );
}
/** How his time blocks went over the last `days` days: the ones he answered for. */
export function useBlockTally(days = 28) {
  return useQuery({ queryKey: ["block-tally", days], queryFn: () => api.get<BlockTally>(`/api/blocks/tally?days=${days}`) });
}
/** Write a meeting's note: body replaces it, add puts a line on the end. */
export function useSaveMeetingNote() {
  return useWrite(
    ({ eventId, ...v }: { eventId: string; body?: string; add?: string }) => api.put<EntryView>(`/api/meetings/${encodeURIComponent(eventId)}/note`, v),
    ({ eventId, body }, qc) =>
      body !== undefined &&
      qc.setQueryData<HomeData>(["home"], (old) => (old ? { ...old, meeting_notes: old.meeting_notes.map((n) => (n.source_ref === `calendar:${eventId}` ? { ...n, body } : n)) } : old)),
  );
}

/** Change settings (the board's row names). */
export function useSaveSettings() {
  return useWrite(
    (patch: Partial<Settings>) => api.patch<Settings>("/api/settings", patch),
    (patch, qc) => qc.setQueryData<Settings>(["settings"], (old) => (old ? { ...old, ...patch } : old)),
  );
}

export function useDeleteTask() {
  return useWrite((id: string) => api.post(`/api/tasks/${id}/delete`), undefined, () => toast({ text: "Task deleted.", undo: true }));
}

/** The daily log, newest day first. The chatbot writes it; the site only reads it. */
/** Logged days, newest first. `q` keeps the days whose text has every word. */
export function useDailyLog(limit = 30, q = "") {
  return useQuery({ queryKey: ["log", limit, q], queryFn: () => api.get<DailyLog[]>(`/api/log?limit=${limit}${q ? `&q=${encodeURIComponent(q)}` : ""}`), placeholderData: (prev) => prev });
}
/** Every day that has a log, newest first: what the Log page's calendar marks. */
export function useLogDays() {
  return useQuery({ queryKey: ["log-days"], queryFn: () => api.get<string[]>(`/api/log/days`) });
}
/** One day of the log, for a day the list has not loaded. null when nothing was logged. */
export function useLogDay(day: string | null, enabled = true) {
  return useQuery({ queryKey: ["log-day", day], queryFn: () => api.get<DailyLog | null>(`/api/log/${day}`), enabled: !!day && enabled });
}

export function useAudit(limit = 150) {
  return useQuery({ queryKey: ["audit", limit], queryFn: () => api.get<AuditView[]>(`/api/audit?limit=${limit}`) });
}

export function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>(`/api/settings`) });
}

export interface Me {
  email: string;
  mcp_url: string | null;
  calendar_url: string | null;
  mcp_token_masked: string | null;
  ics_token_masked: string | null;
}
export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>(`/api/me`), staleTime: 300_000 });
}

/** Everything Settings shows about the outside services the site reads. Never a key or a token. */
export interface ConnectionsInfo {
  /** False when the Worker has no CONNECTIONS_KEY secret, so nothing can be saved yet. */
  ready: boolean;
  /** The address to list on the Google sign-in client. */
  redirect_uri: string;
  secrets: SecretInfo[];
  google: GoogleAccount[];
}
export function useConnections() {
  return useQuery({ queryKey: ["connections"], queryFn: () => api.get<ConnectionsInfo>(`/api/connections`) });
}

export function useTags() {
  return useQuery({ queryKey: ["tags"], queryFn: () => api.get<{ id: string; name: string; count: number }[]>(`/api/tags`) });
}

/** Search one desk (areas = "work") or everywhere (areas = ""). */
export function useSearch(q: string, areas: string) {
  return useQuery({
    queryKey: ["search", q, areas],
    queryFn: () => api.get<SearchResults>(`/api/search?q=${encodeURIComponent(q)}&areas=${areas}`),
    enabled: q.trim().length > 0,
    staleTime: 5_000,
  });
}

// ---------- toasts ----------

export interface ToastMessage {
  text: string;
  tone?: "error" | "info";
  /** Show an Undo button that reverses the last change made on the website. */
  undo?: boolean;
}

/** Show a short message at the bottom of the screen (components/ui.tsx renders it). */
export function toast(message: ToastMessage) {
  window.dispatchEvent(new CustomEvent<ToastMessage>("pd-toast", { detail: message }));
}

/** Reverse the most recent change made on the website. Used by the toast's Undo button. */
export function useUndoLast() {
  return useWrite(() => api.post("/api/audit/undo-last"));
}

// ---------- mutations ----------

/**
 * Wrap a write. After it settles, every cached query is refreshed, because one write can
 * change several views (a task change touches the project, Today and Activity).
 * Pass `optimistic` to update the cache immediately for instant feedback.
 */
export function useWrite<V, R = unknown>(
  fn: (vars: V) => Promise<R>,
  optimistic?: (vars: V, qc: ReturnType<typeof useQueryClient>) => void,
  /** Runs after the server confirms, even if the row that started the write has left the screen. */
  onDone?: (result: R, vars: V) => void,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onMutate: async (vars: V) => {
      if (!optimistic) return;
      await qc.cancelQueries();
      optimistic(vars, qc);
    },
    onSuccess: (result, vars) => onDone?.(result, vars),
    onError: (err) => toast({ text: err instanceof Error ? err.message : String(err), tone: "error" }),
    onSettled: () => qc.invalidateQueries(),
  });
}

/** Optimistically patch a project wherever it appears in the cache. */
export function patchProjectInCache(qc: ReturnType<typeof useQueryClient>, id: string, patch: Partial<Project>) {
  qc.setQueryData<ProjectDetail>(["project", id], (old) => (old ? { ...old, ...patch } : old));
  qc.setQueriesData<ProjectCard[]>({ queryKey: ["projects"] }, (old) =>
    Array.isArray(old) ? old.map((p) => (p.id === id ? { ...p, ...patch } : p)) : old,
  );
}

export function useUpdateProject(id: string) {
  return useWrite(
    (patch: Partial<Project> & { tags?: string[] }) => api.patch<Project>(`/api/projects/${id}`, patch),
    (patch, qc) => {
      const { tags: _tags, ...rest } = patch;
      patchProjectInCache(qc, id, rest);
    },
  );
}

export function useUpdateTask(projectId?: string) {
  return useWrite(
    ({ id, ...patch }: { id: string } & Partial<Task>) => api.patch<Task>(`/api/tasks/${id}`, patch),
    ({ id, ...patch }, qc) => {
      if (!projectId) return;
      qc.setQueryData<ProjectDetail>(["project", projectId], (old) =>
        old ? { ...old, tasks: old.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) } : old,
      );
    },
  );
}

// ---------- 1:1s ----------

/** Start a 1:1 with someone, or change its rhythm, next date, relationship or standing notes. */
export function useSetOneOnOne(personId: string) {
  return useWrite((patch: Partial<Pick<OneOnOne, "relationship" | "cadence_days" | "next_at" | "notes">>) => api.put<OneOnOne>(`/api/one-on-ones/${personId}`, patch));
}

