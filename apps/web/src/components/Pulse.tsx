// Pulse.tsx
// A project as one row that can be read at a glance: whose move it is, what the move is, how
// alive it has been (a heat strip, one cell per week for twelve weeks), how far through its
// tasks it is, and when it is due. This replaced the kanban board: a column says only what
// state a project is in, while this shows which ones are moving and which have gone quiet.

import { Link } from "react-router-dom";
import { whoseMove } from "@pd/core/derived";
import type { ProjectCard, ProjectPulse } from "../api";
import { ago, dueLabel } from "../lib/time";
import { Sigil } from "../spaces";
import { Avatar, AvatarStack, Chip } from "./ui";

const EMPTY: ProjectPulse = { weeks: Array(12).fill(0), tasks_done: 0, tasks_total: 0 };

/** Twelve cells, oldest on the left. 0, 1, 2-3, 4+ entries in a week. */
export function Heat({ weeks, title, wide = false }: { weeks: number[]; title?: string; wide?: boolean }) {
  const total = weeks.reduce((a, b) => a + b, 0);
  return (
    <span className={`heat ${wide ? "heat-wide" : ""}`} title={title ?? `${total} ${total === 1 ? "entry" : "entries"} in the last ${weeks.length} weeks`} aria-hidden>
      {weeks.map((n, i) => (
        <i key={i} data-l={n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : 3} />
      ))}
    </span>
  );
}

export function StatusChip({ p }: { p: ProjectCard }) {
  const move = whoseMove(p);
  if (p.status === "done") return <Chip tone="ok">Done</Chip>;
  if (move === "theirs") return <Chip tone="wait">Waiting</Chip>;
  if (move === "parked") return <Chip tone="idle">{p.status === "idea" ? "Idea" : "Paused"}</Chip>;
  if (move === "closed") return <Chip tone="idle">Archived</Chip>;
  return <Chip tone="accent">Your move</Chip>;
}

/** Column headings for the full rows on the Projects page. Widths match PulseRow. */
export function PulseHeader() {
  return (
    <div className="hidden items-center gap-4 px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-faint lg:flex">
      <span className="flex-1">Project</span>
      <span className="w-20">People</span>
      <span className="w-[130px]">Last 12 weeks</span>
      <span className="w-24">Tasks</span>
      <span className="w-16">Active</span>
      <span className="w-16 text-right">Due</span>
    </div>
  );
}

/**
 * One project. `compact` is the dashboard form (activity, tasks, due). The full form on the
 * Projects page adds the people on it and when it last moved.
 */
export function PulseRow({ p, pulse = EMPTY, showSpace = false, compact = false }: { p: ProjectCard; pulse?: ProjectPulse; showSpace?: boolean; compact?: boolean }) {
  const due = dueLabel(p.due_date);
  const waiting = p.waiting_on || (p.waiting_on_person ? `Waiting on ${p.waiting_on_person.name}` : "");
  const theirs = whoseMove(p) === "theirs";
  const pct = pulse.tasks_total ? Math.round((pulse.tasks_done / pulse.tasks_total) * 100) : 0;
  return (
    <Link to={`/projects/${p.id}`} data-tint={showSpace ? p.area : undefined} className="press flex min-h-11 items-center gap-4 rounded-xl px-2 py-2 hover:bg-field">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          {showSpace && <Sigil scope={p.area} size={9} />}
          <span className="truncate font-medium">{p.title}</span>
          {p.priority === 1 && <span className="size-1.5 shrink-0 rounded-full bg-late" title="High priority" />}
        </span>
        {/* A second line only when there is something to say; an empty one repeated down the list is noise. */}
        {(theirs || p.next_step) && (
          <span className="mt-0.5 flex items-center gap-1.5 truncate text-[13px] text-muted">
            {theirs && p.waiting_on_person && <Avatar person={p.waiting_on_person} size={16} />}
            <span className="truncate">{theirs ? waiting || "Waiting" : p.next_step}</span>
          </span>
        )}
      </span>
      {!compact && (
        <span className="hidden w-20 shrink-0 lg:block">
          <AvatarStack people={p.people} max={3} />
        </span>
      )}
      <span className={`hidden shrink-0 sm:block ${compact ? "" : "lg:w-[130px]"}`}>
        <Heat weeks={pulse.weeks} wide={!compact} />
      </span>
      <span className={`hidden shrink-0 md:block ${compact ? "w-20" : "w-24"}`} title={pulse.tasks_total ? `${pulse.tasks_done} of ${pulse.tasks_total} tasks done` : "No tasks"}>
        {pulse.tasks_total > 0 ? (
          <>
            <span className="bar block">
              <i style={{ width: `${pct}%` }} />
            </span>
            <span className="tabular mt-1 block text-[11px] text-faint">
              {pulse.tasks_done}/{pulse.tasks_total} tasks
            </span>
          </>
        ) : null}
      </span>
      {!compact && <span className="tabular hidden w-16 shrink-0 text-[12px] text-muted lg:block">{ago(p.last_activity_at)}</span>}
      <span className="w-16 shrink-0 text-right">
        {due && <Chip tone={due.tone === "late" ? "late" : due.tone === "soon" ? "soon" : "idle"}>{due.text}</Chip>}
      </span>
    </Link>
  );
}
