// ProjectCard.tsx: a project as a card, used on the board and on person pages.
// It answers one question at a glance: whose move is it, and what is the move.

import { Link } from "react-router-dom";
import type { ProjectCard as ProjectCardData } from "../api";
import { dueLabel } from "../lib/time";
import { Sigil } from "../spaces";
import { Avatar, AvatarStack, STATUS_LABEL } from "./ui";

export function ProjectCard({ p, showStatus = false, showSpace = false, dragging = false }: { p: ProjectCardData; showStatus?: boolean; showSpace?: boolean; dragging?: boolean }) {
  const due = dueLabel(p.due_date);
  const waiting = p.waiting_on || (p.waiting_on_person ? `Waiting on ${p.waiting_on_person.name}` : "");
  return (
    <Link to={`/projects/${p.id}`} draggable={false} className={`press block overflow-hidden rounded-2xl bg-surface p-3.5 ${dragging ? "shadow-3" : "lift shadow-1"}`}>
      {p.cover_url && <img src={p.cover_url} alt="" className="-mx-3.5 -mt-3.5 mb-3 h-28 w-[calc(100%+28px)] max-w-none object-cover" />}
      <div className="flex items-start gap-2">
        {showSpace && <Sigil scope={p.area} className="mt-[5px]" />}
        <h3 className="min-w-0 flex-1 font-medium leading-snug">{p.title}</h3>
        {p.priority === 1 && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" title="High priority" />}
      </div>
      {waiting ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-[13px] text-muted">
          {p.waiting_on_person && <Avatar person={p.waiting_on_person} size={16} />}
          <span className="line-clamp-2">{waiting}</span>
        </p>
      ) : (
        p.next_step && <p className="mt-1.5 line-clamp-2 text-[13px] text-muted">{p.next_step}</p>
      )}
      {(showStatus || due || p.open_task_count > 0 || p.people.length > 0) && (
        <div className="mt-3 flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-faint">
          {showStatus && <span>{STATUS_LABEL[p.status]}</span>}
          {due && <span className={due.tone === "late" ? "font-medium text-danger" : due.tone === "soon" ? "text-muted" : ""}>{due.tone === "late" ? due.text : `Due ${due.text}`}</span>}
          {p.open_task_count > 0 && <span>{p.open_task_count} open</span>}
          <span className="ml-auto">
            <AvatarStack people={p.people} max={3} />
          </span>
        </div>
      )}
    </Link>
  );
}
