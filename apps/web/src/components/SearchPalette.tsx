// SearchPalette.tsx: Cmd+K search across tasks, projects, people, timeline entries and the daily log.
// It searches the desk you are at; one tap widens it to everywhere.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSearch } from "../api";
import { fmtDayLong, fmtTime } from "../lib/time";
import { logPreview } from "./DayLog";
import { Sigil, useScope } from "../spaces";
import { Avatar, Icon, Panel, STATUS_LABEL } from "./ui";

export function SearchPalette({ onClose }: { onClose: () => void }) {
  const { scope, space, param } = useScope();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [everywhere, setEverywhere] = useState(scope === "all");
  const [index, setIndex] = useState(0);
  const nav = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const { data, isFetching } = useSearch(debounced, everywhere ? "" : param);

  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 150);
    return () => clearTimeout(t);
  }, [q]);

  const items = useMemo(() => {
    if (!data) return [];
    return [
      ...data.tasks.map((t) => ({ key: t.id, to: t.person_id ? `/people/${t.person_id}` : t.project_id ? `/projects/${t.project_id}` : "/tasks", kind: "task" as const, t })),
      ...data.projects.map((p) => ({ key: p.id, to: `/projects/${p.id}`, kind: "project" as const, p })),
      ...data.people.map((p) => ({ key: p.id, to: `/people/${p.id}`, kind: "person" as const, p })),
      ...data.entries.map((e) => ({ key: e.id, to: e.project_id ? `/projects/${e.project_id}` : e.people[0] ? `/people/${e.people[0].id}` : "/", kind: "entry" as const, e })),
      ...(data.logs ?? []).map((l) => ({ key: `log-${l.day}`, to: `/log#${l.day}`, kind: "log" as const, l })),
    ];
  }, [data]);

  useEffect(() => setIndex(0), [debounced, everywhere]);

  const go = (to: string) => {
    onClose();
    nav(to);
  };

  return (
    <Panel onClose={onClose} label="Search">
      <div className="flex items-center gap-2.5 px-4 shadow-[inset_0_-1px_0_var(--line)]">
        <Icon name="search" className="text-faint" />
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && items[index]) {
              go(items[index]!.to);
            } else if (e.key === "Tab" && scope !== "all") {
              e.preventDefault();
              setEverywhere((v) => !v);
            }
          }}
          placeholder={everywhere ? "Search everything" : `Search ${space.label}`}
          aria-label="Search"
          className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-faint"
        />
        {scope !== "all" && (
          <button type="button" onClick={() => setEverywhere(!everywhere)} className="press flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-field px-2.5 text-[12px] font-medium text-muted hover:bg-field-hover hover:text-fg">
            <Sigil scope={everywhere ? "all" : scope} size={9} />
            {everywhere ? "Everywhere" : space.label}
          </button>
        )}
      </div>
      <div className="max-h-[56vh] overflow-y-auto p-1.5">
        {!q && <p className="px-3 py-7 text-center text-[13px] text-faint">Tasks, people, projects, notes and the log.</p>}
        {q && data && !items.length && !isFetching && (
          <p className="px-3 py-7 text-center text-[13px] text-faint">
            Nothing matches “{q}”{everywhere ? "." : ` in ${space.label}.`}
          </p>
        )}
        {items.map((it, i) => (
          <button
            key={it.key}
            type="button"
            onMouseEnter={() => setIndex(i)}
            onClick={() => go(it.to)}
            className={`press flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left ${i === index ? "bg-field" : ""}`}
          >
            {it.kind === "task" && (
              <>
                <Icon name="task" className="text-faint" />
                <span className={`min-w-0 flex-1 truncate ${it.t.status === "done" ? "text-faint line-through" : "font-medium"}`}>{it.t.title}</span>
                <span className="truncate text-[12px] text-faint">{it.t.person_name ?? it.t.project_title ?? "Task"}</span>
              </>
            )}
            {it.kind === "project" && (
              <>
                <Sigil scope={it.p.area} />
                <span className="min-w-0 flex-1 truncate font-medium">{it.p.title}</span>
                <span className="text-[12px] text-faint">{STATUS_LABEL[it.p.status]}</span>
              </>
            )}
            {it.kind === "person" && (
              <>
                <Avatar person={it.p} size={22} />
                <span className="min-w-0 flex-1 truncate font-medium">{it.p.name}</span>
                <span className="truncate text-[12px] text-faint">{it.p.role}</span>
              </>
            )}
            {it.kind === "entry" && (
              <>
                <Icon name={it.e.kind} className="text-faint" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{it.e.title || it.e.body.slice(0, 80)}</span>
                  <span className="block truncate text-[12px] text-faint">
                    {it.e.project_title ?? "No project"} · {fmtTime(it.e.occurred_at)}
                  </span>
                </span>
              </>
            )}
            {it.kind === "log" && (
              <>
                <Icon name="digest" className="text-faint" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{logPreview(it.l)}</span>
                  <span className="block truncate text-[12px] text-faint">Log · {fmtDayLong(it.l.day)}</span>
                </span>
              </>
            )}
          </button>
        ))}
      </div>
    </Panel>
  );
}
