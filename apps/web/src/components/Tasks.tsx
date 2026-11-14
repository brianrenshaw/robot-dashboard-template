// Tasks.tsx
// The pieces every task list is built from. A task is one line; a person (it is waiting on
// them), a due date, tags, a project and notes are all optional and all edited in place:
// click the title to reword it, click a row's arrow for the rest. No edit buttons.
//
//   TaskAdd    the "Add a task" line. Type #tag to tag it; the pills under it set who it is
//              waiting on and when it is due.
// People on a task work like tags: any number of them, and being on it only means it involves
// them. Each can carry two marks: he is waiting on them, and it is on the list for his next
// 1:1 with them.
//   TaskRow    one task: check it off, reword it, open it for notes, tags, person, date, project.
//   TagChip    a tag, which opens everything carrying that tag.

import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAddTask, useAllPeople, useDeleteTask, useEditTask, type Area, type TaskItem, type TaskPerson } from "../api";
import { readQuickTask } from "../lib/quickadd";
import { dueLabel, fmtDay, todayYmd } from "../lib/time";
import { Sigil } from "../spaces";
import { DatePicker, Editable, PersonPicker, ProjectPicker, TextInput } from "./fields";
import { Avatar, Check, Chevron, Chip, Collapse, IconButton } from "./ui";

/** A tag. Clicking it opens the tag's page: every task, note and project that carries it. */
export function TagChip({ name, count, active = false }: { name: string; count?: number; active?: boolean }) {
  return (
    <Link
      to={`/tag/${encodeURIComponent(name)}`}
      onClick={(e) => e.stopPropagation()}
      className={`press inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] font-medium ${active ? "bg-accent text-on-accent" : "bg-accent-soft text-accent hover:brightness-95"}`}
    >
      #{name}
      {count !== undefined && <span className="tabular opacity-70">{count}</span>}
    </Link>
  );
}

/**
 * The line for adding a task. Enter saves it. The whole task can be typed: "@sam" sets who
 * it is waiting on, a date at the end ("fri", "12/5") sets when it is due, "#tag" tags it
 * (lib/quickadd.ts). What was understood shows under the line as it is typed, and the pills
 * there can set the same things by hand. `defaults` pre-fills what the page already knows: a
 * person's page adds tasks for that person, a tag's page adds tasks with that tag.
 */
export function TaskAdd({ defaults = {}, placeholder = "Add a task. Try: Send the report @sam fri #budget", area }: { defaults?: { person_id?: string; side?: "mine" | "theirs"; discuss?: boolean; project_id?: string; tag?: string }; placeholder?: string; area?: Area | null }) {
  const add = useAddTask();
  const { data: people } = useAllPeople();
  const [title, setTitle] = useState("");
  const [who, setWho] = useState<string | null>(null);
  const [due, setDue] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  // What the typed line says. A pill set by hand wins over it.
  const read = readQuickTask(title, defaults.person_id ? [] : people ?? []);
  const person = defaults.person_id ?? who ?? read.person?.id ?? null;
  const date = due ?? read.due ?? null;
  const submit = () => {
    if (!read.title.trim() || add.isPending) return;
    // Several @names: all of them go on the task, as people he is waiting on.
    const several = !defaults.person_id && !who && read.people.length > 1 ? read.people.map((p) => ({ person_id: p.id, waiting: true })) : undefined;
    add.mutate({ title: read.title.trim(), person_id: several ? undefined : person, people: several, side: defaults.side ?? "theirs", discuss: defaults.discuss, due_date: date, project_id: defaults.project_id ?? null, area: area ?? null, tags: defaults.tag ? [defaults.tag] : undefined });
    setTitle("");
    setDue(null);
    setWho(null);
  };
  const showMore = focused || !!title || !!due || !!who;
  return (
    <div onFocus={() => setFocused(true)} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setFocused(false)}>
      <TextInput value={title} onChange={(e) => setTitle(e.target.value)} onEnter={submit} placeholder={placeholder} aria-label="New task" />
      <Collapse open={showMore}>
        <div className="flex flex-wrap items-center gap-1.5 pt-2">
          {!defaults.person_id && <PersonPicker label="Waiting on" variant="pill" prefix="Waiting on" value={person} onChange={setWho} noneLabel="No one, it is mine" />}
          <DatePicker label="Due date" variant="pill" prefix="Due" placeholder="No date" value={date} onChange={setDue} />
          <span className="text-[12px] text-faint">Enter to add</span>
        </div>
      </Collapse>
    </div>
  );
}

/**
 * One task. `hide` leaves out what the surrounding page already says (a person, by id; the
 * project; the tag whose page this is). Everyone else on the task shows as a small pill.
 * `aside` is an extra control at the end of the row (a person's page uses it to move a task on
 * or off their 1:1 list).
 * `dense` is for a task listed under a heading that leads (a person's name on the Tasks page):
 * a shorter row and a lighter title, so the heading reads first.
 */
export function TaskRow({ t, showSpace = false, hide = {}, dense = false, aside }: { t: TaskItem; showSpace?: boolean; hide?: { person?: string | boolean; project?: boolean; tag?: string }; dense?: boolean; aside?: ReactNode }) {
  const edit = useEditTask();
  const del = useDeleteTask();
  const [open, setOpen] = useState(false);
  const done = t.status === "done";
  const tags = hide.tag ? t.tags.filter((x) => x.toLowerCase() !== hide.tag!.toLowerCase()) : t.tags;
  const project = !hide.project && !!t.project_title;
  const shownPeople = hide.person === true ? [] : t.people.filter((p) => p.id !== hide.person);
  const setPeople = (people: Pick<TaskPerson, "id" | "waiting" | "one_on_one">[]) => edit.mutate({ id: t.id, people: people.map((p) => ({ person_id: p.id, waiting: p.waiting, one_on_one: p.one_on_one })) });
  const change = (id: string, marks: Partial<Pick<TaskPerson, "waiting" | "one_on_one">>) => setPeople(t.people.map((x) => (x.id === id ? { ...x, ...marks } : x)));
  // On a person's own page their pill is hidden, so a plain word says he is waiting on them.
  const waitingOnHidden = typeof hide.person === "string" && !!t.people.find((p) => p.id === hide.person)?.waiting;
  const toggle = (on: boolean) => `press inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-medium ${on ? "bg-accent-soft text-accent" : "bg-field text-muted hover:text-fg"}`;
  const due = dueLabel(t.due_date);
  const hidden = !done && !!t.hide_until && t.hide_until > todayYmd();
  // How long he has been waiting on the person, in days.
  const waited = !done && t.person_id && t.side !== "mine" ? Math.floor((Date.now() - Date.parse(t.waiting_since ?? t.created_at)) / 86_400_000) : null;
  return (
    <div className={`rounded-xl ${open ? "bg-field" : "hover:bg-field"} ${hidden && !open ? "opacity-55" : ""}`}>
      <div className={`flex items-center gap-2.5 px-2 ${dense ? "min-h-9" : "min-h-11"}`}>
        <Check checked={done} label={`Mark ${t.title} ${done ? "not done" : "done"}`} onChange={() => edit.mutate({ id: t.id, status: done ? "todo" : "done" })} />
        <div className={`min-w-0 flex-1 ${dense ? "py-1" : "py-1.5"} transition-colors duration-200 ${done ? "text-faint line-through" : ""}`}>
          <Editable label="task" value={t.title} onSave={(title) => title && edit.mutate({ id: t.id, title })} className={`text-[14px] ${dense ? "" : "font-medium"}`} />
          {(tags.length > 0 || project) && (
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              {showSpace && <Sigil scope={t.project_area} size={8} />}
              {project && (
                <Link to={`/projects/${t.project_id}`} className="press truncate text-[12px] text-muted hover:text-accent">
                  {t.project_title}
                </Link>
              )}
              {tags.map((tag) => (
                <TagChip key={tag} name={tag} />
              ))}
            </div>
          )}
        </div>
        {shownPeople.slice(0, 3).map((p) => (
          // Violet when he is waiting on them; plain when they are only tagged.
          <Link
            key={p.id}
            to={`/people/${p.id}`}
            title={p.waiting ? `Waiting on ${p.name}` : p.name}
            className={`press flex shrink-0 items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-0.5 text-[12px] font-medium sm:pr-2 ${p.waiting ? "bg-[color-mix(in_srgb,var(--wait)_13%,transparent)] text-[var(--wait)]" : "bg-field text-muted"}`}
          >
            <Avatar person={p} size={20} />
            {/* On a phone the face alone says who; the title needs the room. */}
            <span className="max-w-28 truncate max-sm:hidden">{p.name.split(" ")[0]}</span>
          </Link>
        ))}
        {waitingOnHidden && !done && <Chip tone="wait">Waiting</Chip>}
        {waited !== null && waited >= 1 && (
          <span className={`tabular shrink-0 text-[12px] max-sm:hidden ${waited >= 14 ? "font-semibold text-late" : waited >= 7 ? "font-medium text-[var(--soon)]" : "text-faint"}`} title={`Waiting ${waited} ${waited === 1 ? "day" : "days"}`}>
            {waited}d
          </span>
        )}
        {hidden && <Chip tone="idle" title="Hidden from your lists until then">Hidden until {fmtDay(t.hide_until)}</Chip>}
        {due && !done && <Chip tone={due.tone === "late" ? "late" : due.tone === "soon" ? "soon" : "idle"}>{due.text}</Chip>}
        {aside}
        <button type="button" aria-label={open ? "Close details" : "Open details"} aria-expanded={open} onClick={() => setOpen(!open)} className="press flex size-8 shrink-0 items-center justify-center rounded-lg text-faint hover:bg-surface hover:text-fg">
          <Chevron open={open} />
        </button>
      </div>
      <Collapse open={open}>
        {open && (
          <div className="space-y-2.5 px-2 pb-3 pl-[38px]">
            <Editable label="notes" value={t.notes} onSave={(notes) => edit.mutate({ id: t.id, notes })} multiline markdown placeholder="Click to add notes" className="text-[13px]" />
            <div className="flex flex-wrap items-center gap-1.5">
              <DatePicker label="Due date" variant="pill" prefix="Due" placeholder="No date" value={t.due_date} onChange={(due_date) => edit.mutate({ id: t.id, due_date })} tone={due?.tone === "late" ? "late" : null} />
              <DatePicker label="Hide until" variant="pill" prefix="Hide until" placeholder="Not hidden" icon="clock" value={t.hide_until} onChange={(hide_until) => edit.mutate({ id: t.id, hide_until })} futureOnly />
              <ProjectPicker label="Project" variant="pill" value={t.project_id ?? ""} onChange={(id) => edit.mutate({ id: t.id, project_id: id || null })} placeholder="No project" />
            </div>
            {/* The people on it, like tags. Each can be marked as someone he is waiting on, and as on their 1:1 list. */}
            <div className="space-y-1.5">
              {t.people.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-1.5">
                  <Avatar person={p} size={20} />
                  <Link to={`/people/${p.id}`} className="press mr-1 text-[13px] font-medium hover:text-accent">
                    {p.name}
                  </Link>
                  <button type="button" aria-pressed={p.waiting} onClick={() => change(p.id, { waiting: !p.waiting })} className={toggle(p.waiting)}>
                    Waiting on
                  </button>
                  <button type="button" aria-pressed={p.one_on_one} onClick={() => change(p.id, { one_on_one: !p.one_on_one })} className={toggle(p.one_on_one)}>
                    On 1:1 list
                  </button>
                  <IconButton icon="x" label={`Take ${p.name} off this task`} size={24} onClick={() => setPeople(t.people.filter((x) => x.id !== p.id))} />
                </div>
              ))}
              <PersonPicker
                label="Add a person"
                variant="pill"
                value={null}
                onChange={(id) => id && !t.people.some((x) => x.id === id) && setPeople([...t.people, { id, waiting: false, one_on_one: false }])}
                noneLabel="Add a person"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-[12px] text-muted">Tags</span>
              <div className="min-w-0 flex-1">
                <Editable
                  label="tags"
                  value={t.tags.join(", ")}
                  onSave={(v) => edit.mutate({ id: t.id, tags: v.split(/[,\s]+/).map((x) => x.replace(/^#/, "").trim()).filter(Boolean) })}
                  placeholder="Click to add tags, separated by commas"
                  className="text-[13px]"
                />
              </div>
              <button type="button" onClick={() => del.mutate(t.id)} className="press rounded-lg px-2 py-1 text-[12px] font-medium text-danger hover:bg-surface">
                Delete
              </button>
            </div>
          </div>
        )}
      </Collapse>
    </div>
  );
}
