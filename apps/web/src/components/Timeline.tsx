// Timeline.tsx
// What happened, newest first. Shared by the desks, project pages and person pages.
//
// Entries are grouped by when they happened (Today, Yesterday, Last week, October ...). Each
// group folds away, and each entry is one line until it is clicked: then it opens in place to
// show the full text, the people, and the links back to the email or document. The newest
// groups start open; older ones start folded so a long history stays short on the page.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, toast, useWrite, type EntryKind, type EntryView } from "../api";
import { linkProps, useMailLinks } from "../lib/mail";
import { fmtTime, fmtWhen, periodOf } from "../lib/time";
import { Sigil } from "../spaces";
import { ENTRY_KIND_OPTIONS } from "./Capture";
import { Picker } from "./fields";
import { Avatar, Chevron, Collapse, Empty, HeaderAction, Icon, Markdown, actorLabel } from "./ui";

const KIND_NAME: Record<string, string> = {
  note: "Note",
  email: "Email",
  meeting: "Meeting",
  call: "Call",
  decision: "Decision",
  status_change: "Status",
  task_done: "Done",
  file: "File",
  digest: "Digest",
};
const MINOR = new Set(["status_change", "task_done"]);

/** First line of the body as plain text, for the one-line preview. */
function preview(body: string): string {
  return body
    .replace(/[#>*_`~[\]]/g, "")
    .replace(/\(https?:[^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

export function Timeline({ entries, showProject = false, empty = "Nothing here yet.", openFirst = false }: { entries: EntryView[]; showProject?: boolean; empty?: string; /** Start with the newest entry open (used for past 1:1s, where the last one is the point). */ openFirst?: boolean }) {
  const [kind, setKind] = useState<EntryKind | "">("");
  // Whether every entry is open, plus the ones the owner toggled by hand since.
  const [allOpen, setAllOpen] = useState(false);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [groupToggled, setGroupToggled] = useState<Record<string, boolean>>({});

  const kinds = useMemo(() => [...new Set(entries.map((e) => e.kind))], [entries]);
  const list = kind ? entries.filter((e) => e.kind === kind) : entries;
  const groups = useMemo(() => {
    const out: { label: string; rows: EntryView[]; openByDefault: boolean }[] = [];
    for (const e of list) {
      const label = periodOf(e.occurred_at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.rows.push(e);
      else out.push({ label, rows: [e], openByDefault: false });
    }
    // The newest groups start open, until about a dozen entries are showing.
    let shown = 0;
    for (const g of out) {
      g.openByDefault = shown < 12;
      shown += g.rows.length;
    }
    return out;
  }, [list]);

  if (!entries.length) return <Empty>{empty}</Empty>;
  const filterOptions = [
    { value: "" as const, label: "Everything" },
    ...[...ENTRY_KIND_OPTIONS, { value: "status_change" as EntryKind, label: "Status changes" }, { value: "task_done" as EntryKind, label: "Completed tasks" }].filter((o) => kinds.includes(o.value)),
  ];
  const expandable = list.some((e) => !MINOR.has(e.kind));

  return (
    <div>
      {(kinds.length > 1 || expandable) && (
        <div className="mb-1 flex items-center gap-1">
          {kinds.length > 1 && <Picker label="Show" variant="pill" value={kind} onChange={setKind} options={filterOptions} />}
          <span className="ml-auto" />
          {expandable && (
            <HeaderAction
              onClick={() => {
                setAllOpen(!allOpen);
                setToggled({});
                if (!allOpen) setGroupToggled(Object.fromEntries(groups.map((g) => [g.label, true])));
              }}
            >
              {allOpen ? "Collapse all" : "Expand all"}
            </HeaderAction>
          )}
        </div>
      )}
      {groups.map((g) => {
        const open = groupToggled[g.label] ?? g.openByDefault;
        return (
          <div key={g.label}>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setGroupToggled({ ...groupToggled, [g.label]: !open })}
              className="press -ml-2 mt-2 flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-faint hover:bg-field hover:text-fg"
            >
              <Chevron open={open} size={10} />
              {g.label}
              <span className="tabular font-normal">{g.rows.length}</span>
            </button>
            <Collapse open={open}>
              <ol>
                {g.rows.map((e) => (
                  <EntryRow key={e.id} entry={e} showProject={showProject} open={toggled[e.id] ?? (allOpen || (openFirst && e.id === list[0]?.id))} onToggle={(v) => setToggled({ ...toggled, [e.id]: v })} />
                ))}
              </ol>
            </Collapse>
          </div>
        );
      })}
    </div>
  );
}

function EntryRow({ entry: e, showProject, open, onToggle }: { entry: EntryView; showProject: boolean; open: boolean; onToggle: (open: boolean) => void }) {
  const del = useWrite(() => api.post(`/api/entries/${e.id}/delete`));
  const links = useMailLinks()(e);

  if (MINOR.has(e.kind)) {
    return (
      <li className="flex min-h-8 items-center gap-3 px-2 text-[13px] text-muted">
        <span className="flex size-7 shrink-0 items-center justify-center text-faint">
          <Icon name={e.kind} size={13} />
        </span>
        <span className="min-w-0 flex-1 truncate">
          {e.kind === "task_done" ? `Completed “${e.title}”` : e.title}
          {showProject && e.project_title && <span className="text-faint"> · {e.project_title}</span>}
        </span>
        <span className="tabular shrink-0 text-[12px] text-faint">{fmtWhen(e.occurred_at)}</span>
      </li>
    );
  }

  const first = e.body ? preview(e.body) : "";
  return (
    <li className={`rounded-2xl transition-[background-color,box-shadow] duration-200 ${open ? "my-1 bg-surface shadow-1" : ""}`}>
      <button type="button" aria-expanded={open} onClick={() => onToggle(!open)} className={`press flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left ${open ? "" : "hover:bg-field"}`}>
        <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-muted ${open ? "bg-accent-soft text-accent" : "bg-field"}`}>
          <Icon name={e.kind} size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">
            <span className="font-medium">{e.title || <span className="text-faint">{KIND_NAME[e.kind]}</span>}</span>
            {!open && first && <span className="text-muted"> · {first}</span>}
          </span>
          {showProject && e.project_title && !open && (
            <span className="mt-0.5 flex items-center gap-1.5 truncate text-[12px] text-faint">
              {e.project_area && <Sigil scope={e.project_area} size={8} />}
              {e.project_title}
            </span>
          )}
        </span>
        {!open && e.people.length > 0 && (
          <span className="hidden shrink-0 -space-x-1 sm:flex">
            {e.people.slice(0, 3).map((p) => (
              <Avatar key={p.id} person={p} size={18} />
            ))}
          </span>
        )}
        <span className="tabular shrink-0 text-[12px] text-faint">{fmtWhen(e.occurred_at)}</span>
        <Chevron open={open} size={10} className="text-faint" />
      </button>
      <Collapse open={open}>
        <div className="pb-3 pl-12 pr-4">
          {e.body && <Markdown className="max-w-[70ch] text-sm">{e.body}</Markdown>}
          <div className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-faint ${e.body ? "mt-3" : ""}`}>
            <span>
              {KIND_NAME[e.kind]} · {fmtTime(e.occurred_at)}
              {e.created_by !== "web" && ` · logged by ${actorLabel(e.created_by)}`}
            </span>
            {showProject && e.project_id && (
              <Link to={`/projects/${e.project_id}`} className="press inline-flex items-center gap-1.5 hover:text-fg">
                {e.project_area && <Sigil scope={e.project_area} size={8} />}
                {e.project_title}
              </Link>
            )}
            {e.people.map((p) => (
              <Link key={p.id} to={`/people/${p.id}`} className="press inline-flex items-center gap-1.5 hover:text-fg">
                <Avatar person={p} size={16} />
                {p.name}
              </Link>
            ))}
            {links?.superhuman && (
              <a {...linkProps(links.superhuman)} className="press inline-flex items-center gap-1 font-medium text-accent hover:brightness-110">
                <Icon name="email" size={12} />
                Open in Superhuman
              </a>
            )}
            {links ? (
              <a {...linkProps(links.gmail)} className="press hover:text-fg">
                Gmail
              </a>
            ) : (
              e.url && (
                <a href={e.url} target="_blank" rel="noreferrer" className="press inline-flex items-center gap-1 hover:text-fg">
                  <Icon name="external" size={12} />
                  {e.url.includes("granola") ? "Open in Granola" : "Open source"}
                </a>
              )
            )}
            <button
              type="button"
              onClick={() => del.mutate(undefined, { onSuccess: () => toast({ text: "Entry deleted.", undo: true }) })}
              className="press ml-auto rounded-md px-1 hover:text-danger"
            >
              Delete
            </button>
          </div>
        </div>
      </Collapse>
    </li>
  );
}
