// Capture.tsx
// Adding things. Press N (or the Add button) for the panel: log something that happened, or
// add a task, a project or a person. New things land on the desk you are standing at.
// EntryComposer is the same "log something" form, used inline on project and person pages.
// Adding is one of the cared-for moments: one field to start, the rest appears when wanted.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, toast, useWrite, type Area, type EntryKind, type Person, type PersonRef, type Project } from "../api";
import { DESKS, Sigil, useScope } from "../spaces";
import { DatePicker, Field, PeoplePicker, PersonPicker, Picker, ProjectPicker, Segmented, TextArea, TextInput } from "./fields";
import { Button, Collapse, Icon, Panel } from "./ui";

export const ENTRY_KIND_OPTIONS: { value: EntryKind; label: string }[] = [
  { value: "note", label: "Note" },
  { value: "email", label: "Email" },
  { value: "meeting", label: "Meeting" },
  { value: "call", label: "Call" },
  { value: "decision", label: "Decision" },
  { value: "file", label: "File" },
];
const KIND_MENU = ENTRY_KIND_OPTIONS.map((o) => ({ ...o, icon: <Icon name={o.value} size={15} className="text-muted" /> }));

type Mode = "entry" | "task" | "project" | "person";

export function Capture({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("task");
  return (
    <Panel onClose={onClose} label="Add">
      <div className="p-3 pb-0">
        <Segmented
          label="What to add"
          className="flex w-full"
          value={mode}
          onChange={setMode}
          options={[
            { value: "task", label: "Task" },
            { value: "entry", label: "Note" },
            { value: "project", label: "Project" },
            { value: "person", label: "Person" },
          ]}
        />
      </div>
      <div className="p-3">
        {mode === "entry" && <EntryComposer startOpen showProject onDone={onClose} onCancel={onClose} />}
        {mode === "task" && <NewTask onClose={onClose} />}
        {mode === "project" && <NewProject onClose={onClose} />}
        {mode === "person" && <NewPerson onClose={onClose} />}
      </div>
    </Panel>
  );
}

/**
 * Log something that happened: pick a kind, say what, and save. Starts as one line; focusing
 * it opens the details (notes, people, a link back to the source).
 */
export function EntryComposer({
  projectId,
  person,
  onDone,
  onCancel,
  startOpen = false,
  showProject = false,
}: {
  projectId?: string;
  person?: PersonRef;
  onDone?: () => void;
  onCancel?: () => void;
  startOpen?: boolean;
  showProject?: boolean;
}) {
  const [kind, setKind] = useState<EntryKind>("note");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [people, setPeople] = useState<PersonRef[]>(person ? [person] : []);
  const [project, setProject] = useState(projectId ?? "");
  const [open, setOpen] = useState(startOpen);
  const save = useWrite((v: Record<string, unknown>) => api.post("/api/entries", v));

  const canSave = !!(title.trim() || body.trim()) && !save.isPending;
  const reset = () => {
    setTitle("");
    setBody("");
    setUrl("");
    setPeople(person ? [person] : []);
  };
  const submit = () => {
    if (!canSave) return;
    save.mutate(
      { project_id: project || null, kind, title: title.trim(), body: body.trim(), url: url.trim() || null, person_ids: people.map((p) => p.id) },
      {
        onSuccess: () => {
          reset();
          if (!startOpen) setOpen(false);
          onDone?.();
        },
      },
    );
  };

  return (
    <div className={startOpen ? "" : `rounded-2xl p-1.5 transition-[background-color,box-shadow] duration-200 ${open ? "bg-surface shadow-1" : "bg-transparent"}`}>
      <div className="flex items-center gap-1.5">
        <Picker label="Kind" variant="pill" value={kind} onChange={setKind} options={KIND_MENU} className="min-h-9 shrink-0" />
        <TextInput
          value={title}
          autoFocus={startOpen}
          onFocus={() => setOpen(true)}
          onChange={(e) => setTitle(e.target.value)}
          onEnter={submit}
          placeholder={startOpen ? "What happened?" : "Log a note, email, meeting or decision"}
          aria-label="Title"
        />
      </div>
      <Collapse open={open}>
        <div className="space-y-1.5 pt-1.5">
          <TextArea value={body} onChange={(e) => setBody(e.target.value)} onSubmit={submit} minRows={3} placeholder="Details. Markdown works." aria-label="Details" />
          {showProject && <ProjectPicker value={project} onChange={setProject} />}
          <PeoplePicker value={people} onChange={setPeople} placeholder="Who was involved?" />
          <TextInput value={url} onChange={(e) => setUrl(e.target.value)} onEnter={submit} placeholder="Link to the email, doc or event" aria-label="Link" inputMode="url" />
          <div className="flex items-center justify-end gap-1.5 pt-1.5">
            <Button
              variant="ghost"
              onClick={() => {
                reset();
                if (onCancel) onCancel();
                else setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" disabled={!canSave} onClick={submit}>
              {save.isPending ? "Adding…" : "Add to timeline"}
            </Button>
          </div>
        </div>
      </Collapse>
    </div>
  );
}

function Actions({ label, disabled, onSubmit, onClose }: { label: string; disabled: boolean; onSubmit: () => void; onClose: () => void }) {
  return (
    <div className="flex justify-end gap-1.5 pt-1.5">
      <Button variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button variant="primary" disabled={disabled} onClick={onSubmit}>
        {label}
      </Button>
    </div>
  );
}

function NewTask({ onClose }: { onClose: () => void }) {
  const { scope } = useScope();
  const [title, setTitle] = useState("");
  const [project, setProject] = useState("");
  const [due, setDue] = useState<string | null>(null);
  const [who, setWho] = useState<string | null>(null);
  const save = useWrite((v: Record<string, unknown>) => api.post("/api/tasks", v));
  const ok = !!title.trim() && !save.isPending;
  const submit = () =>
    ok &&
    save.mutate(
      { title: title.trim(), project_id: project || null, due_date: due, person_id: who, area: scope === "all" ? null : scope },
      {
        onSuccess: () => {
          toast({ text: who ? "Added. It shows under Waiting on." : "Task added." });
          onClose();
        },
      },
    );
  return (
    <div className="space-y-3">
      <TextInput autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onEnter={submit} placeholder="What needs doing? Type #tag to tag it." aria-label="Task" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Waiting on">
          <PersonPicker label="Waiting on" value={who} onChange={setWho} noneLabel="No one, it is mine" />
        </Field>
        <Field label="Due">
          <DatePicker label="Due date" value={due} onChange={setDue} />
        </Field>
      </div>
      <Field label="Project (optional)">
        <ProjectPicker value={project} onChange={setProject} />
      </Field>
      <Actions label="Add task" disabled={!ok} onSubmit={submit} onClose={onClose} />
    </div>
  );
}

function NewProject({ onClose }: { onClose: () => void }) {
  const { scope } = useScope();
  const [title, setTitle] = useState("");
  const [area, setArea] = useState<Area>(scope === "all" ? "work" : scope);
  const [next, setNext] = useState("");
  const nav = useNavigate();
  const save = useWrite((v: { title: string; area: Area; next_step: string }) => api.post<Project>("/api/projects", v));
  const ok = !!title.trim() && !save.isPending;
  const submit = () =>
    ok &&
    save.mutate(
      { title: title.trim(), area, next_step: next.trim() },
      {
        onSuccess: (p) => {
          onClose();
          nav(`/projects/${p.id}`);
        },
      },
    );
  return (
    <div className="space-y-3">
      <TextInput autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onEnter={submit} placeholder="Project name" aria-label="Project name" />
      <Field label="Desk">
        <Picker label="Desk" value={area} onChange={setArea} options={DESKS.map((d) => ({ value: d.id, label: d.label, icon: <Sigil scope={d.id} /> }))} />
      </Field>
      <Field label="First step">
        <TextInput value={next} onChange={(e) => setNext(e.target.value)} onEnter={submit} placeholder="The next concrete thing to do" />
      </Field>
      <Actions label="Create project" disabled={!ok} onSubmit={submit} onClose={onClose} />
    </div>
  );
}

function NewPerson({ onClose }: { onClose: () => void }) {
  const { scope } = useScope();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [org, setOrg] = useState("");
  const [email, setEmail] = useState("");
  const nav = useNavigate();
  const save = useWrite((v: Record<string, unknown>) => api.post<Person>("/api/people", v));
  const ok = !!name.trim() && !save.isPending;
  const submit = () =>
    ok &&
    save.mutate(
      { name: name.trim(), role, organization: org, email: email.trim(), area: scope === "all" ? null : scope },
      {
        onSuccess: (p) => {
          onClose();
          nav(`/people/${p.id}`);
        },
      },
    );
  return (
    <div className="space-y-3">
      <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} onEnter={submit} placeholder="Name" aria-label="Name" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Role">
          <TextInput value={role} onChange={(e) => setRole(e.target.value)} onEnter={submit} />
        </Field>
        <Field label="Organization">
          <TextInput value={org} onChange={(e) => setOrg(e.target.value)} onEnter={submit} />
        </Field>
      </div>
      <Field label="Email">
        <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} onEnter={submit} placeholder="Used to match their emails to them" />
      </Field>
      <Actions label="Add person" disabled={!ok} onSubmit={submit} onClose={onClose} />
    </div>
  );
}
