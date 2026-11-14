// Tasks.tsx
// The task list: the main working page. Most of what the owner tracks is a single task, not a
// project, so this is where things go.
//
// Top to bottom: his views (buttons that each apply a filter: a few built in, then the ones he
// saved, like OmniFocus perspectives), the filter bar (everything in it combines), the line to
// add a task, then the tasks, split into his and what he is waiting on by person.
//
// A view is configured right here: set the filters, press Save view, name it. Open a saved
// view, change the filters, and Update view keeps the change; click its name to rename it.
// The filter lives in the address (?f=...), so a filtered list can be bookmarked.
// /view/<id> opens a saved view. The server does
// the filtering (listTasks in packages/core), so a saved view and this page always agree.

import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { isMine } from "@pd/core/derived";
import { useDeleteView, useHome, useSaveView, useTaskSearch, useUpdateView, useViews, type TaskFilter, type TaskItem } from "../api";
import { Editable, PersonPicker, Picker, Segmented, TextInput } from "../components/fields";
import { PageHeader } from "../components/Shell";
import { useSidebarDocked } from "../components/Sidebar";
import { TaskAdd, TaskRow } from "../components/Tasks";
import { Avatar, Button, Collapse, Empty, ErrorNote, Icon, Section, Spinner, Tile } from "../components/ui";
import { BUILT_IN } from "../lib/views";
import { useScope } from "../spaces";

const DUE = [
  { value: "", label: "Any time" },
  { value: "late", label: "Late" },
  { value: "today", label: "Due today" },
  { value: "week", label: "Due this week" },
  { value: "dated", label: "Has a date" },
  { value: "none", label: "No date" },
];

const AGE = [
  { value: 0, label: "Any age" },
  { value: 7, label: "Added a week ago or more" },
  { value: 14, label: "Added two weeks ago or more" },
  { value: 30, label: "Added a month ago or more" },
];
const WAIT = [
  { value: 0, label: "Waiting any time" },
  { value: 7, label: "Waiting a week or more" },
  { value: 14, label: "Waiting two weeks or more" },
];

/** Drop empty fields, so two filters that mean the same thing compare equal. */
function tidy(f: TaskFilter): TaskFilter {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && !v.length))) as TaskFilter;
}
const same = (a: TaskFilter, b: TaskFilter) => JSON.stringify(tidy(a), Object.keys(tidy(a)).sort()) === JSON.stringify(tidy(b), Object.keys(tidy(b)).sort());

export function Tasks() {
  const { scope, space } = useScope();
  const { id } = useParams();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const views = useViews();
  const { data: home } = useHome();
  const saveView = useSaveView();
  const deleteView = useDeleteView();
  const updateView = useUpdateView();
  const [naming, setNaming] = useState<string | null>(null);
  const docked = useSidebarDocked();
  // The filter bar stays folded until he opens it (or arrives by a filtered link).
  const [showFilter, setShowFilter] = useState(() => !!params.get("f"));

  const saved = id ? views.data?.find((v) => v.id === id) : undefined;
  let fromLink: TaskFilter | null = null;
  try {
    fromLink = params.get("f") ? (JSON.parse(params.get("f")!) as TaskFilter) : null;
  } catch {
    fromLink = null; // a mangled link falls back to the plain list
  }
  const filter: TaskFilter = tidy(fromLink ?? saved?.filter ?? {});
  const all = scope === "all";
  // On a desk, only that desk's tasks, unless the view itself names desks.
  const query: TaskFilter = { ...filter, areas: filter.areas ?? (all ? undefined : [scope]), state: filter.state ?? "any" };
  const { data, error, isLoading } = useTaskSearch(query);

  const setFilter = (next: TaskFilter) => {
    const clean = tidy(next);
    setParams(Object.keys(clean).length ? { f: JSON.stringify(clean) } : {}, { replace: true });
  };
  const patch = (p: Partial<TaskFilter>) => setFilter({ ...filter, ...p });
  const filtering = Object.keys(filter).length > 0;
  const active = (f: TaskFilter) => filtering && same(filter, f);
  const title = saved ? saved.name : all ? "Tasks" : space.label;

  if (isLoading && !data) return <Spinner />;
  if (error || !data) return <ErrorNote error={error} />;
  const open = data.filter((t) => t.status !== "done");
  const done = data.filter((t) => t.status === "done");
  const mine = open.filter(isMine);
  const theirs = open.filter((t) => !isMine(t));
  // Waiting-on tasks, grouped by the person. Whoever has been waited on longest comes first.
  // A task waiting on two people is listed under each of them.
  const byPerson = new Map<string, TaskItem[]>();
  const nameOf = new Map<string, string>();
  for (const t of theirs) {
    for (const p of t.people.filter((x) => x.waiting)) {
      byPerson.set(p.id, [...(byPerson.get(p.id) ?? []), t]);
      nameOf.set(p.id, p.name);
    }
  }
  const since = (t: TaskItem) => t.waiting_since ?? t.created_at;
  const groups = [...byPerson.entries()]
    .map(([id, g]) => ({ id, name: nameOf.get(id) ?? "?", tasks: g.sort((a, b) => since(a).localeCompare(since(b))) }))
    .sort((a, b) => since(a.tasks[0]!).localeCompare(since(b.tasks[0]!)));
  const tags = (home?.tags ?? []).filter((t) => t.tasks > 0 || filter.tags?.some((x) => x.toLowerCase() === t.name.toLowerCase()));
  const viewButton = (on: boolean) => `press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium ${on ? "bg-accent text-on-accent" : "bg-surface text-fg shadow-1 hover:bg-raised"}`;

  return (
    <>
      <PageHeader
        tinted={!all}
        title={saved && !fromLink ? <Editable label="view name" value={saved.name} onSave={(name) => name.trim() && updateView.mutate({ id: saved.id, name: name.trim() })} /> : title}
        summary={`${mine.length} yours · ${theirs.length} waiting on others${filtering ? " · filtered" : ""}`}
        right={
          saved && !fromLink ? (
            <Button
              variant="ghost"
              onClick={() => {
                deleteView.mutate(saved.id);
                nav("/tasks");
              }}
            >
              Remove this view
            </Button>
          ) : undefined
        }
      />
      <div className="mx-auto max-w-[900px] space-y-4">
        {/* Views: one click each. Left out while the sidebar is docked, since it lists them too. */}
        <div className={`flex flex-wrap items-center gap-1.5 ${docked ? "hidden" : ""}`}>
          <Link to="/tasks" className={viewButton(!filtering && !id)}>
            Everything
          </Link>
          {BUILT_IN.map((v) => (
            <button key={v.name} type="button" className={viewButton(!id && active(v.filter))} onClick={() => (id ? nav(`/tasks?f=${encodeURIComponent(JSON.stringify(v.filter))}`) : setFilter(v.filter))}>
              {v.name}
            </button>
          ))}
          {(views.data ?? [])
            .filter((v) => v.pinned || v.id === id)
            .map((v) => (
              <Link key={v.id} to={`/view/${v.id}`} className={viewButton(v.id === id && !fromLink)}>
                <Icon name="decision" size={12} />
                {v.name}
              </Link>
            ))}
        </div>

        {/* Filters, folded away until asked for: he mostly asks his chatbot. Everything chosen here combines. */}
        <div className="flex items-center gap-2 px-1">
          <button type="button" aria-expanded={showFilter} onClick={() => setShowFilter(!showFilter)} className={`press inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium ${showFilter ? "bg-accent-soft text-accent" : "text-muted hover:bg-field hover:text-fg"}`}>
            <Icon name="decision" size={12} />
            {showFilter ? "Hide filters" : filtering ? "Filtered" : "Filter"}
          </button>
          {filtering && !showFilter && (
            <button type="button" onClick={() => (id ? nav("/tasks") : setFilter({}))} className="press rounded-lg px-2 py-1 text-[12px] font-medium text-faint hover:bg-field hover:text-fg">
              Clear
            </button>
          )}
        </div>
        <Collapse open={showFilter}>
        <Tile>
          <div className="flex flex-wrap items-center gap-1.5 p-3">
            <Segmented
              label="Whose"
              value={filter.who ?? "all"}
              onChange={(who) => patch({ who: who === "all" ? undefined : who })}
              options={[
                { value: "all", label: "All" },
                { value: "mine", label: "Mine" },
                { value: "theirs", label: "Waiting on" },
              ]}
            />
            <Picker label="Due" variant="pill" value={filter.due ?? ""} onChange={(due) => patch({ due: (due || undefined) as TaskFilter["due"] })} options={DUE} />
            <PersonPicker label="Person" variant="pill" prefix="Person" value={filter.person_id ?? null} onChange={(p) => patch({ person_id: p ?? undefined })} noneLabel="Anyone" />
            <Picker label="Age" variant="pill" value={filter.older_than_days ?? 0} onChange={(n) => patch({ older_than_days: n || undefined })} options={AGE.some((a) => a.value === (filter.older_than_days ?? 0)) ? AGE : [...AGE, { value: filter.older_than_days!, label: `Added ${filter.older_than_days} days ago or more` }]} />
            <Picker label="Waiting" variant="pill" value={filter.waiting_days ?? 0} onChange={(n) => patch({ waiting_days: n || undefined })} options={WAIT.some((a) => a.value === (filter.waiting_days ?? 0)) ? WAIT : [...WAIT, { value: filter.waiting_days!, label: `Waiting ${filter.waiting_days} days or more` }]} />
            <button type="button" aria-pressed={filter.hidden === "include"} onClick={() => patch({ hidden: filter.hidden === "include" ? undefined : "include" })} className={`press inline-flex h-8 items-center rounded-full px-3 text-[13px] font-medium ${filter.hidden === "include" ? "bg-accent-soft text-accent" : "bg-field text-muted hover:text-fg"}`}>
              Show hidden
            </button>
            <button type="button" aria-pressed={filter.has_email === true} onClick={() => patch({ has_email: filter.has_email === true ? undefined : true })} className={`press inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium ${filter.has_email === true ? "bg-accent-soft text-accent" : "bg-field text-muted hover:text-fg"}`}>
              <Icon name="email" size={13} />
              From email
            </button>
            <span className="flex-1" />
            {filtering &&
              (naming === null ? (
                <>
                  <Button size="sm" variant="ghost" onClick={() => (id ? nav("/tasks") : setFilter({}))}>
                    Clear
                  </Button>
                  {/* A saved view whose filters were changed: keep the change, or save it as another view. */}
                  {saved && fromLink && !same(filter, saved.filter) && (
                    <Button size="sm" variant="tonal" disabled={updateView.isPending} onClick={() => updateView.mutate({ id: saved.id, filter }, { onSuccess: () => nav(`/view/${saved.id}`, { replace: true }) })}>
                      Update “{saved.name}”
                    </Button>
                  )}
                  {!(saved && !fromLink) && (
                    <Button size="sm" variant={saved ? "ghost" : "tonal"} onClick={() => setNaming("")}>
                      {saved ? "Save as new view" : "Save view"}
                    </Button>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-1.5">
                  <div className="w-44">
                    <TextInput
                      autoFocus
                      value={naming}
                      onChange={(e) => setNaming(e.target.value)}
                      placeholder="Name this view"
                      aria-label="View name"
                      onEnter={() => naming.trim() && saveView.mutate({ name: naming.trim(), filter }, { onSuccess: (v) => (setNaming(null), nav(`/view/${v.id}`)) })}
                    />
                  </div>
                  <Button size="sm" variant="primary" disabled={!naming.trim() || saveView.isPending} onClick={() => saveView.mutate({ name: naming.trim(), filter }, { onSuccess: (v) => (setNaming(null), nav(`/view/${v.id}`)) })}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setNaming(null)}>
                    Cancel
                  </Button>
                </div>
              ))}
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 px-3 pb-3">
              {tags.map((t) => {
                const on = !!filter.tags?.some((x) => x.toLowerCase() === t.name.toLowerCase());
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => patch({ tags: on ? filter.tags!.filter((x) => x.toLowerCase() !== t.name.toLowerCase()) : [...(filter.tags ?? []), t.name] })}
                    className={`press inline-flex h-6 items-center gap-1 rounded-full px-2 text-[12px] font-medium ${on ? "bg-accent text-on-accent" : "bg-accent-soft text-accent hover:brightness-95"}`}
                  >
                    #{t.name}
                    <span className="tabular opacity-70">{t.tasks}</span>
                  </button>
                );
              })}
            </div>
          )}
          {(filter.any || filter.has_email === false || filter.text) && (
            <p className="px-3 pb-3 text-[12px] text-muted">Also: {describe(filter)}</p>
          )}
        </Tile>
        </Collapse>

        <Tile>
          <div className="p-3">
            <TaskAdd area={all ? null : scope} />
          </div>
        </Tile>

        {filter.who !== "theirs" && (
          <Tile title="Yours" icon="task" tone="ok" count={mine.length}>
            {mine.map((t) => (
              <TaskRow key={t.id} t={t} showSpace={all} />
            ))}
            {!mine.length && <Empty className="px-2">{filtering ? "Nothing of yours matches." : "Nothing of yours is open. Add a task above, or tell your chatbot to put one here."}</Empty>}
          </Tile>
        )}

        {filter.who !== "mine" && (
          <Tile title="Waiting on" icon="clock" tone="wait" count={theirs.length}>
            {/* One block per person: the face and name lead, their tasks sit beneath (indented
                under the name on a wide screen, full width on a phone). */}
            {groups.map((g, i) => (
              <div key={g.id} className={`px-2 py-3 ${i ? "shadow-[inset_0_1px_0_var(--line)]" : "pt-1"}`}>
                <Link to={`/people/${g.id}`} className="press flex w-fit items-center gap-3 text-[14px] font-semibold hover:text-accent">
                  <Avatar person={{ name: g.name }} size={28} />
                  {g.name}
                </Link>
                <div className="-mx-2 mt-1 sm:ml-8">
                  {g.tasks.map((t) => (
                    <TaskRow key={t.id} t={t} showSpace={all} hide={{ person: g.id }} dense />
                  ))}
                </div>
              </div>
            ))}
            {!theirs.length && <Empty className="px-2">{filtering ? "Nothing you are waiting on matches." : "You are not waiting on anyone. To hand something off, add a task with @name."}</Empty>}
          </Tile>
        )}

        {done.length > 0 && (
          <Section id="tasks-done" title="Finished lately" count={done.length} defaultOpen={false}>
            {done.map((t) => (
              <TaskRow key={t.id} t={t} showSpace={all} />
            ))}
          </Section>
        )}
      </div>
    </>
  );
}

/** The parts of a filter the bar has no control for (they came in through a link), in words. */
function describe(f: TaskFilter): string {
  const one = (x: TaskFilter): string[] => [
    ...(x.older_than_days !== undefined && x !== f ? [`added ${x.older_than_days} or more days ago`] : []),
    ...(x.waiting_days !== undefined && x !== f ? [`waiting ${x.waiting_days} or more days`] : []),
    ...(x.has_email === true && x !== f ? ["came from an email"] : x.has_email === false ? ["did not come from an email"] : []),
    ...(x.text ? [`mentions “${x.text}”`] : []),
    ...(x.tags?.length && x !== f ? [x.tags.map((t) => `#${t}`).join(" ")] : []),
    ...(x.due && x !== f ? [DUE.find((d) => d.value === x.due)!.label.toLowerCase()] : []),
    ...(x.who && x !== f ? [x.who === "mine" ? "mine" : "waiting on someone"] : []),
  ];
  const parts = one(f);
  if (f.any?.length) parts.push(`any of: ${f.any.map((a) => one(a).join(" and ") || "anything").join("; or ")}`);
  return parts.join(", ");
}
