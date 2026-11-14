// Project.tsx: one project. Everything is edited in place.
// At the top, whose move it is: the next step on your side, what you are waiting for on theirs.
// Below, Tasks, Timeline and Notes each fold away and stay the way they were left.
// Opening a project, adding an entry and completing a task are cared-for moments.

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api, toast, useProject, useUpdateProject, useUpdateTask, useWrite, type LinkKind, type ProjectDetail, type ProjectRole } from "../api";
import { EntryComposer } from "../components/Capture";
import { DatePicker, Editable, Field, PeoplePicker, PersonPicker, Picker, TextInput } from "../components/fields";
import { Timeline } from "../components/Timeline";
import { Button, Card, Check, Collapse, Empty, ErrorNote, HeaderAction, Icon, IconButton, PersonChip, STATUS_LABEL, Section, Spinner } from "../components/ui";
import { ago, dueLabel } from "../lib/time";
import { AREA_LABEL, DESKS, Sigil, basePath, useScope } from "../spaces";

const STATUS_OPTIONS = (["idea", "active", "waiting", "paused", "done", "archived"] as const).map((s) => ({ value: s, label: STATUS_LABEL[s] }));
const PRIORITY_OPTIONS = [
  { value: 1 as const, label: "High priority" },
  { value: 2 as const, label: "Normal priority" },
  { value: 3 as const, label: "Low priority" },
];

export function ProjectPage() {
  const { id = "" } = useParams();
  const { data: p, error, isLoading } = useProject(id);
  const { setScope } = useScope();
  // Stand at this project's desk, so the page wears its color.
  useEffect(() => {
    if (p) setScope(p.area);
  }, [p?.area]);
  if (isLoading) return <Spinner />;
  if (error || !p) return <ErrorNote error={error ?? new Error("Project not found.")} />;
  return <ProjectView p={p} />;
}

function ProjectView({ p }: { p: ProjectDetail }) {
  const update = useUpdateProject(p.id);
  const save = (patch: Parameters<typeof update.mutate>[0]) => update.mutate(patch);
  const archive = useWrite(() => api.post(`/api/projects/${p.id}/${p.archived_at ? "restore" : "archive"}`));
  const due = dueLabel(p.due_date);
  const openTasks = p.tasks.filter((t) => t.status !== "done").length;

  return (
    <div className="mx-auto max-w-[1040px] pt-5 md:pt-8">
      <Link to={`${basePath(p.area)}/projects`} className="press -ml-2 inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-accent hover:bg-accent-soft">
        <Icon name="back" size={13} />
        {AREA_LABEL[p.area]}
      </Link>

      {p.archived_at && (
        <div className="mt-3 flex items-center justify-between rounded-2xl bg-field px-4 py-2.5 text-[13px]">
          <span className="text-muted">This project is archived.</span>
          <Button size="sm" onClick={() => archive.mutate(undefined)}>
            Restore
          </Button>
        </div>
      )}

      <header className="mt-2">
        <Editable label="title" value={p.title} onSave={(title) => title && save({ title })} className="display text-[24px] md:text-[30px]" />
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Picker label="Status" variant="pill" value={p.status} onChange={(status) => save({ status })} options={STATUS_OPTIONS} />
          <Picker label="Priority" variant="pill" value={p.priority} onChange={(priority) => save({ priority })} options={PRIORITY_OPTIONS} />
          <DatePicker label="Due date" variant="pill" prefix="Due" placeholder="No date" value={p.due_date} onChange={(due_date) => save({ due_date })} tone={due?.tone === "late" ? "late" : null} />
          <Picker label="Desk" variant="pill" value={p.area} onChange={(area) => save({ area })} options={DESKS.map((d) => ({ value: d.id, label: d.label, icon: <Sigil scope={d.id} /> }))} />
          <span className="ml-1.5 text-[12px] text-faint">Active {ago(p.last_activity_at)}</span>
        </div>
      </header>

      <div className="mt-8 grid gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1fr)_288px]">
        <div className="min-w-0 space-y-4">
          <Tasks p={p} openCount={openTasks} />
          <Notes p={p} onSave={(notes) => save({ notes })} />
          {/* What has happened on it. Folded away until wanted: most projects are just tasks and notes. */}
          <Section id="project-history" title="History" count={p.timeline.length} defaultOpen={false}>
            <EntryComposer projectId={p.id} />
            <div className="mt-2">
              <Timeline entries={p.timeline} empty="Nothing logged yet. Log a note, email or meeting above, or ask your chatbot to file one here." />
            </div>
          </Section>
        </div>

        <aside className="space-y-4">
          <People p={p} />
          <Links p={p} />
          <Section id="project-about" title="About">
            <div className="space-y-4">
              <Field label="Summary">
                <Editable label="summary" value={p.summary} onSave={(summary) => save({ summary })} multiline placeholder="One or two sentences on what this is" className="text-sm" />
              </Field>
              <Field label="Tags">
                <Editable
                  label="tags"
                  value={p.tags.join(", ")}
                  onSave={(v) => save({ tags: v.split(",").map((t) => t.trim()).filter(Boolean) })}
                  placeholder="Separated by commas"
                  className="text-sm"
                />
              </Field>
              {!p.archived_at && (
                <Button size="sm" variant="ghost" className="-ml-3" onClick={() => archive.mutate(undefined, { onSuccess: () => toast({ text: "Project archived.", undo: true }) })}>
                  Archive project
                </Button>
              )}
            </div>
          </Section>
        </aside>
      </div>
    </div>
  );
}

// ---------- tasks ----------

function Tasks({ p, openCount }: { p: ProjectDetail; openCount: number }) {
  const [title, setTitle] = useState("");
  const [showDone, setShowDone] = useState(false);
  const add = useWrite((v: { title: string }) => api.post("/api/tasks", { project_id: p.id, title: v.title }));
  const reorder = useWrite((ids: string[]) => api.post("/api/tasks/reorder", { ids }));
  const open = p.tasks.filter((t) => t.status !== "done");
  const done = p.tasks.filter((t) => t.status === "done");
  const [order, setOrder] = useState<string[] | null>(null);
  const ids = order ?? open.map((t) => t.id);
  const byId = new Map(p.tasks.map((t) => [t.id, t]));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    setOrder(next);
    reorder.mutate(next, { onSettled: () => setOrder(null) });
  };
  const submit = () => {
    if (!title.trim()) return;
    add.mutate({ title: title.trim() });
    setTitle("");
  };

  return (
    <Section id="project-tasks" title="Tasks" count={openCount} right={done.length ? <HeaderAction onClick={() => setShowDone(!showDone)}>{showDone ? "Hide done" : `Show ${done.length} done`}</HeaderAction> : null}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {ids.map((id) => {
            const t = byId.get(id);
            return t ? <TaskRow key={id} t={t} projectId={p.id} sortable /> : null;
          })}
        </SortableContext>
      </DndContext>
      <Collapse open={showDone}>{done.map((t) => <TaskRow key={t.id} t={t} projectId={p.id} />)}</Collapse>
      <div className="mt-1.5">
        <TextInput value={title} onChange={(e) => setTitle(e.target.value)} onEnter={submit} placeholder="Add a task" aria-label="Add a task" />
      </div>
    </Section>
  );
}

function TaskRow({ t, projectId, sortable = false }: { t: ProjectDetail["tasks"][number]; projectId: string; sortable?: boolean }) {
  const update = useUpdateTask(projectId);
  const del = useWrite(() => api.post(`/api/tasks/${t.id}/delete`));
  const s = useSortable({ id: t.id, disabled: !sortable });
  const done = t.status === "done";
  const due = dueLabel(t.due_date);
  const [open, setOpen] = useState(false);
  return (
    <div ref={s.setNodeRef} style={{ transform: CSS.Transform.toString(s.transform), transition: s.transition, opacity: s.isDragging ? 0.5 : 1 }} className={`group rounded-xl ${open ? "bg-field" : "hover:bg-field"}`}>
      <div className="flex min-h-10 items-center gap-3 pl-2 pr-1">
        <Check checked={done} onChange={() => update.mutate({ id: t.id, status: done ? "todo" : "done" })} label={`Mark ${t.title} ${done ? "not done" : "done"}`} />
        <div className={`min-w-0 flex-1 text-sm transition-colors duration-200 ${done ? "text-faint line-through" : ""}`}>
          <Editable label="task" value={t.title} onSave={(title) => title && update.mutate({ id: t.id, title })} />
        </div>
        {t.person && <span className="hidden shrink-0 text-[12px] text-muted sm:inline">{t.person.name}</span>}
        {due && <span className={`tabular shrink-0 text-[12px] ${due.tone === "late" && !done ? "font-medium text-danger" : "text-faint"}`}>{due.text}</span>}
        <IconButton icon="more" label="Task details" size={28} aria-expanded={open} onClick={() => setOpen(!open)} className="opacity-70 group-hover:opacity-100 [@media(hover:none)]:opacity-100" />
        {sortable && (
          <span {...s.attributes} {...s.listeners} className="flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-faint opacity-0 hover:bg-field group-hover:opacity-100 [@media(hover:none)]:opacity-60" aria-label="Drag to reorder">
            <Icon name="drag" size={14} />
          </span>
        )}
      </div>
      <Collapse open={open}>
        <div className="flex flex-wrap items-center gap-1.5 pb-2.5 pl-[38px] pr-2 pt-0.5">
          <DatePicker label="Task due date" variant="pill" prefix="Due" value={t.due_date} onChange={(due_date) => update.mutate({ id: t.id, due_date })} />
          <PersonPicker label="Whose move" variant="pill" value={t.person_id} onChange={(person_id) => update.mutate({ id: t.id, person_id })} noneLabel="Mine" />
          <Button size="sm" variant="danger" className="ml-auto" onClick={() => del.mutate(undefined, { onSuccess: () => toast({ text: "Task deleted.", undo: true }) })}>
            Delete
          </Button>
        </div>
      </Collapse>
    </div>
  );
}

// ---------- people ----------

const ROLE_OPTIONS: { value: ProjectRole; label: string }[] = [
  { value: "collaborator", label: "Collaborator" },
  { value: "owner", label: "Owner" },
  { value: "stakeholder", label: "Stakeholder" },
];

function People({ p }: { p: ProjectDetail }) {
  const [adding, setAdding] = useState(false);
  const [role, setRole] = useState<ProjectRole>("collaborator");
  const link = useWrite((v: { person_id: string; role: ProjectRole }) => api.post(`/api/projects/${p.id}/people`, v));
  const unlink = useWrite((personId: string) => api.del(`/api/projects/${p.id}/people/${personId}`));
  return (
    <Section id="project-people" title="People" count={p.people.length} right={<HeaderAction onClick={() => setAdding(!adding)}>{adding ? "Done" : "Add"}</HeaderAction>}>
      <div className="flex flex-wrap gap-1.5">
        {p.people.map((x) => (
          <PersonChip key={x.id} person={x} onRemove={adding ? () => unlink.mutate(x.id) : undefined} />
        ))}
        {!p.people.length && !adding && <Empty>No one linked yet.</Empty>}
      </div>
      <Collapse open={adding}>
        <div className="space-y-1.5 pt-2.5">
          <PeoplePicker single value={[]} exclude={p.people.map((x) => x.id)} onChange={(v) => v[0] && link.mutate({ person_id: v[0].id, role })} placeholder="Find or add a person" />
          <Picker label="Role" value={role} onChange={setRole} options={ROLE_OPTIONS} />
        </div>
      </Collapse>
    </Section>
  );
}

// ---------- links ----------

function guessKind(url: string): LinkKind {
  if (/docs\.google\.com\/document/.test(url)) return "doc";
  if (/docs\.google\.com\/spreadsheets/.test(url)) return "sheet";
  if (/docs\.google\.com\/presentation/.test(url)) return "slides";
  if (/drive\.google\.com\/drive\/folders/.test(url)) return "folder";
  if (/mail\.google\.com|mail\.superhuman\.com/.test(url)) return "email";
  return url ? "site" : "other";
}

function Links({ p }: { p: ProjectDetail }) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const add = useWrite((v: Record<string, unknown>) => api.post("/api/links", v));
  const del = useWrite((id: string) => api.post(`/api/links/${id}/delete`));
  const submit = () => {
    if (!url.trim()) return;
    add.mutate({ project_id: p.id, url: url.trim(), label: label.trim() || url.trim().replace(/^https?:\/\//, "").slice(0, 60), kind: guessKind(url) });
    setLabel("");
    setUrl("");
    setAdding(false);
  };
  return (
    <Section id="project-links" title="Links" count={p.links.length} right={<HeaderAction onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "Add"}</HeaderAction>}>
      <ul>
        {p.links.map((l) => (
          <li key={l.id} className="group -mx-2 flex min-h-9 items-center gap-2.5 rounded-xl px-2 hover:bg-field">
            <Icon name={l.kind} size={15} className="text-faint" />
            <a href={l.url} target="_blank" rel="noreferrer" className="press min-w-0 flex-1 truncate py-1.5 text-sm hover:text-accent">
              {l.label}
            </a>
            <IconButton icon="x" label={`Remove ${l.label}`} size={26} onClick={() => del.mutate(l.id, { onSuccess: () => toast({ text: "Link removed.", undo: true }) })} className="opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-60" />
          </li>
        ))}
        {!p.links.length && !adding && <Empty>Pin docs, sheets and folders here.</Empty>}
      </ul>
      <Collapse open={adding}>
        <div className="space-y-1.5 pt-2">
          <TextInput value={url} onChange={(e) => setUrl(e.target.value)} onEnter={submit} placeholder="Paste a link" aria-label="Link address" inputMode="url" />
          <TextInput value={label} onChange={(e) => setLabel(e.target.value)} onEnter={submit} placeholder="Name it (optional)" aria-label="Link name" />
          <div className="flex justify-end pt-1">
            <Button size="sm" variant="primary" onClick={submit} disabled={!url.trim()}>
              Pin link
            </Button>
          </div>
        </div>
      </Collapse>
    </Section>
  );
}

// ---------- notes ----------

function Notes({ p, onSave }: { p: ProjectDetail; onSave: (notes: string) => void }) {
  // Click the notes to write. They save when you click away.
  return (
    <Section id="project-notes" title="Notes">
      <Card className="p-4">
        <Editable label="notes" value={p.notes} onSave={onSave} multiline markdown placeholder="Click here to write. Background, thinking, decisions." className="max-w-[70ch]" />
      </Card>
    </Section>
  );
}
