// Projects.tsx: every project on a desk, as one plain list.
//
// A project is only a name for something with several tasks. So a row is the title, how many
// tasks are open on it (only when there are some), and its due date (only when it has one).
// Dated projects come first, soonest at the top; the rest follow in A to Z order. Paused and
// finished ones are marked with one quiet word.
//
// This page used to be a "pulse list" with columns for people, twelve weeks of activity and
// task progress, grouped by whose move it was, with a bar of filters. The owner's projects carry
// almost no tasks, so every column was empty. components/Pulse.tsx still has that row if the
// projects ever fill up; do not bring it back for an empty list.

import { useState } from "react";
import { Link } from "react-router-dom";
import { useProjects, type ProjectCard } from "../api";
import { PageHeader } from "../components/Shell";
import { Chip, Empty, ErrorNote, Spinner } from "../components/ui";
import { dueLabel } from "../lib/time";
import { Sigil, useScope } from "../spaces";

/** One quiet word for a project that is not simply active. */
function state(p: ProjectCard): string {
  if (p.archived_at) return "Archived";
  if (p.status === "done") return "Done";
  if (p.status === "paused") return "Paused";
  if (p.status === "idea") return "Idea";
  if (p.status === "waiting") return "Waiting";
  return "";
}

export function Projects() {
  const { scope, space } = useScope();
  const [archived, setArchived] = useState(false);
  const { data, error, isLoading } = useProjects({ status: [], person: "", tag: "", archived });
  const all = scope === "all";
  const rows = [...(data ?? [])].sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || a.title.localeCompare(b.title));

  return (
    <>
      <PageHeader tinted={!all} title={all ? "All projects" : space.label} summary={data ? `${data.length} ${data.length === 1 ? "project" : "projects"}${all ? " across your desks" : ""}` : " "} />
      <div className="mx-auto max-w-[820px]">
        {isLoading ? (
          <Spinner />
        ) : error || !data ? (
          <ErrorNote error={error} />
        ) : !rows.length ? (
          <Empty>No projects here. Ask your chatbot to start one, or press N.</Empty>
        ) : (
          <div className="tile p-2">
            {rows.map((p) => {
              const due = dueLabel(p.due_date);
              const word = state(p);
              return (
                <Link key={p.id} to={`/projects/${p.id}`} className="press flex min-h-11 items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-field">
                  {all && <Sigil scope={p.area} size={9} />}
                  <span className={`min-w-0 flex-1 truncate text-[14px] font-medium ${word === "Done" || word === "Archived" ? "text-faint" : ""}`}>{p.title}</span>
                  {p.open_task_count > 0 && (
                    <span className="tabular shrink-0 text-[12px] text-faint">
                      {p.open_task_count} {p.open_task_count === 1 ? "task" : "tasks"}
                    </span>
                  )}
                  {word && <span className="shrink-0 text-[12px] text-faint">{word}</span>}
                  {due && p.status !== "done" && <Chip tone={due.tone === "late" ? "late" : due.tone === "soon" ? "soon" : "idle"}>{due.text}</Chip>}
                </Link>
              );
            })}
          </div>
        )}
        <button type="button" aria-pressed={archived} onClick={() => setArchived(!archived)} className="press mt-3 rounded-lg px-2 py-1 text-[12px] font-medium text-faint hover:bg-field hover:text-fg">
          {archived ? "Hide archived projects" : "Show archived projects"}
        </button>
      </div>
    </>
  );
}
