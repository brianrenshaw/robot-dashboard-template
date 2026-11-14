// Tag.tsx
// Everything that carries one tag: its tasks, its notes and its projects. Tags are how the owner
// organizes, so this page is what a "project page" would be for most of his work. Adding a
// task here gives it the tag.

import { Link, useParams } from "react-router-dom";
import { useTagView } from "../api";
import { ProjectCard } from "../components/ProjectCard";
import { TaskAdd, TaskRow } from "../components/Tasks";
import { Timeline } from "../components/Timeline";
import { Empty, ErrorNote, Icon, Section, Spinner, Tile } from "../components/ui";

export function TagPage() {
  const { name = "" } = useParams();
  const { data, error, isLoading } = useTagView(name);
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorNote error={error} />;
  const open = data.tasks.filter((t) => t.status !== "done");
  const done = data.tasks.filter((t) => t.status === "done");
  return (
    <div className="mx-auto max-w-[860px] pt-4 md:pt-6">
      <Link to="/tasks" className="press -ml-2 inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-accent hover:bg-accent-soft">
        <Icon name="back" size={13} />
        Tasks
      </Link>
      <h1 className="display mt-2 text-[26px] md:text-[30px]">#{data.name}</h1>
      <p className="mt-1 text-[13px] text-muted">
        {open.length} open {open.length === 1 ? "task" : "tasks"} · {data.notes.length} {data.notes.length === 1 ? "note" : "notes"}
        {data.projects.length > 0 && ` · ${data.projects.length} ${data.projects.length === 1 ? "project" : "projects"}`}
      </p>

      <div className="mt-5 space-y-4">
        <Tile title="Tasks" icon="task" tone="ok" count={open.length}>
          <div className="px-1 pb-2">
            <TaskAdd defaults={{ tag: data.name }} placeholder={`Add a task tagged #${data.name}`} />
          </div>
          {open.map((t) => (
            <TaskRow key={t.id} t={t} showSpace hide={{ tag: data.name }} />
          ))}
          {!open.length && <Empty className="px-2">No open tasks with this tag.</Empty>}
        </Tile>

        {data.projects.length > 0 && (
          <Section id="tag-projects" title="Projects" count={data.projects.length}>
            <div className="grid gap-3 sm:grid-cols-2">
              {data.projects.map((p) => (
                <ProjectCard key={p.id} p={p} showSpace />
              ))}
            </div>
          </Section>
        )}

        <Section id="tag-notes" title="Notes" count={data.notes.length}>
          <Timeline entries={data.notes} showProject empty={`No notes with #${data.name} yet. Write #${data.name} anywhere in a note and it shows up here.`} />
        </Section>

        {done.length > 0 && (
          <Section id="tag-done" title="Finished lately" count={done.length} defaultOpen={false}>
            {done.map((t) => (
              <TaskRow key={t.id} t={t} showSpace hide={{ tag: data.name }} />
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}
