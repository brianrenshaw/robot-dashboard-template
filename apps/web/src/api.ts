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
} from "@pd/core";
import { useScope } from "./spaces";

export type {
  AuditView, HomeData, Link, PersonCard, PersonDetail, Project, ProjectCard, ProjectDetail,
  SearchResults, Settings, Task, EntryView, Run, AgendaItem, OneOnOne, OneOnOneCard, OneOnOneDetail, ProjectPulse, CalendarEvent, GoogleAccount, SecretInfo, SyncReport,
};
export type { SavedView };
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
}
/** Add a task. Only the title is needed. */
export function useAddTask() {
  return useWrite((v: NewTask) => api.post<Task>("/api/tasks", v));
}

/** Change a task from a list (check it off, reword it, retag it). The list updates at once. */
export function useEditTask() {
  return useWrite(
    ({ id, ...patch }: { id: string } & Partial<Pick<Task, "title" | "notes" | "status" | "due_date" | "person_id" | "side" | "project_id" | "hide_until">> & { tags?: string[]; people?: { person_id: string; waiting?: boolean; one_on_one?: boolean }[] }) => api.patch<Task>(`/api/tasks/${id}`, patch),
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
      qc.setQueriesData<TagView>({ queryKey: ["tag"] }, (old) => (old ? { ...old, tasks: old.tasks.map(apply) } : old));
    },
  );
}

export function useDeleteTask() {
  return useWrite((id: string) => api.post(`/api/tasks/${id}/delete`), undefined, () => toast({ text: "Task deleted.", undo: true }));
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

