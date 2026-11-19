// Planner.tsx
// The dashboard's planner: his week (or one day) as time blocks, and the board under it.
//
// The owner plans by time blocking, after Cal Newport (asked for 2026-11-15). Meetings come from his
// Google Calendar and are fixed; the open time between them gets a job. What needs doing sits
// on a board of rows he moves things between himself:
//   New            the first row: everything he has not placed waits here (it was a side
//                  drawer until he asked for it to be a row like the others, 2026-11-16)
//   To do, Waiting to hear back, Back burner, To figure out
//                  rows he can rename. Each row opens and closes; cards wrap four across.
//                  A task he is waiting on someone for starts in Waiting by itself.
// Drag a card onto the week (or click it) and a small panel asks when and for how long: type
// it ("thu 9 45m") or tap a length and one of the open times; the block is previewed on the
// calendar as it changes. Blocks are saved on the dashboard; the site never writes his calendar.
// The board holds only what still needs a place: a task in a project, or one with time already
// set aside, is left off unless he asks for everything (2026-11-16: seeing them there as well
// was "a bunch of noise"). A blocked task is on the calendar; a project's tasks are in the project.
// A calendar entry named after a project ("Work on Pricing Review") is his own block
// for that project: clicking it lists the project's tasks to check off.
// Clicking a meeting opens a panel for it: who it is with, tasks for it (and, for a 1:1, that
// person's 1:1 list) to check off, a line to add a task for it, and its note, one per meeting.
// Time he set aside for himself (a block here, or a calendar entry with no one else on it) is
// not a meeting, and is drawn as his own time. Once it has begun, its panel asks "Did you get
// to it?", and the answer is kept (block_results) so he can see over time whether he goes
// through with his blocks. There are three answers, and each looks different on the week
// (2026-11-19: "we need some different identifications if i got it done, didn't get it done
// or not... i should also have the freedom to say if i did not do it but did something else"):
//   Yes              solid, with a check
//   No               an outline, with a cross
//   Something else   an outline, with an arrow and what he did instead
// and one that has begun with no answer yet carries an open ring. A session he answered for
// stays on the week after its block is taken off or its calendar entry is moved or deleted.
// The arithmetic (rows, open times, reading a typed line, overlaps) is in lib/plan.ts.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  useAddBlock, useAddTask, useDeleteBlock, useEditTask, useSaveBlockResult, useSaveMeetingNote, useMoveBlock, useSaveSettings, useSettings,
  type BlockResult, type BoardRow, type HomeData, type ProjectCard, type TaskItem,
} from "../api";
import { linkProps, useMailLinks } from "../lib/mail";
import { ROWS, clockText, inOrder, isCopyOfBlock, layOut, lengthText, meetingTitle, needsPlace, openTimes, orderBetween, projectForTitle, readWhen, rowOf, type Row, type When } from "../lib/plan";
import { addDaysYmd, dueLabel, fmtWeekday, minuteOfDay } from "../lib/time";
import { Sigil, usePref, type Scope } from "../spaces";
import { TextArea, TextInput } from "./fields";
import { Icon } from "./ui";

const LENGTHS = [15, 30, 45, 60, 90, 120];
const DEFAULT_NAMES: Record<BoardRow, string> = { todo: "To do", waiting: "Waiting to hear back", back: "Back burner", figure: "To figure out" };

/**
 * Something on the week that is not a block of an open task: a calendar entry, or (`session`
 * set) a session of his own time that only has its panel's question: a block whose task is
 * checked off, or one he answered for whose block or calendar entry has since gone.
 */
interface Ev { id: string; day: string; start: number; end: number; title: string; url: string | null; project: ProjectCard | null; area: string; oneOnOne: string | null; location: string; guests: number | null; session?: string }
/** How a session of his own time went. "open": it has begun and he has not said. */
type Outcome = "kept" | "skipped" | "swapped" | "open" | null;
const OUTCOME_TEXT: Record<Exclude<Outcome, null>, string> = { kept: "You did the work", skipped: "You did not get to it", swapped: "You did something else", open: "Did you get to it?" };
interface Draft extends When { taskId: string; blockId?: string; cal?: Ev }

/** Redraw once a minute, so the now-line and the open times stay true. */
function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}
const short = (ymd: string) => fmtWeekday(ymd).slice(0, 3);
const first = (name: string) => name.split(" ")[0];

export function Planner({ data, scope }: { data: HomeData; scope: Scope }) {
  const now = useNow();
  const today = data.today;
  const nowMin = minuteOfDay(new Date(now).toISOString());
  const days = useMemo(() => Array.from({ length: 5 }, (_, i) => addDaysYmd(data.week_start, i)), [data.week_start]);
  const inScope = (a: string | null | undefined) => scope === "all" || a === scope;
  const narrow = typeof window !== "undefined" && window.innerWidth < 640;
  const [view, setView] = usePref<"week" | "day">("plan-view", narrow ? "day" : "week");
  const [shown, setShown] = useState(days.includes(today) ? today : days[0]!);
  const [boardShown, setBoardShown] = usePref("plan-board", true);
  const [everything, setEverything] = usePref("plan-everything", false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [meeting, setMeeting] = useState<Ev | null>(null);
  const [gone, setGone] = useState<{ id: string; title: string } | null>(null);
  const { data: settings } = useSettings();
  const names = settings?.board_names ?? DEFAULT_NAMES;

  const edit = useEditTask();
  const addBlock = useAddBlock();
  const moveBlock = useMoveBlock();
  const delBlock = useDeleteBlock();
  const saveResult = useSaveBlockResult();

  // ---------- what is on the page ----------
  const tasks = data.open_tasks.filter((t) => inScope(t.project_area));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const blocks = data.blocks.filter((b) => inScope(b.area) && days.includes(b.day));
  // A block his chatbot copied to his calendar comes back with the calendar; it is shown once, as the block.
  const events: Ev[] = data.calendar
    .filter((e) => inScope(e.area) && !e.all_day && days.includes(e.day))
    .map((e) => {
      const start = minuteOfDay(e.starts_at);
      return { id: e.id, day: e.day, start, end: e.ends_at ? Math.max(start + 15, minuteOfDay(e.ends_at)) : start + 30, title: meetingTitle(e.title), url: e.url, project: projectForTitle(e.title, data.projects, e.guests === 0 && !e.person_id), area: e.area, oneOnOne: e.person_id, location: e.location, guests: e.guests };
    })
    .filter((e) => !isCopyOfBlock(e, data.blocks));
  const allDay = data.calendar.filter((e) => inScope(e.area) && e.all_day && days.includes(e.day));
  const blockOf = (id: string) => blocks.find((b) => b.task_id === id);
  const peopleIn = (eventId: string) => data.calendar_people.filter((x) => x.event_id === eventId).map((x) => ({ id: x.person_id, name: x.name }));
  const noteFor = (eventId: string) => data.meeting_notes.find((n) => n.source_ref === `calendar:${eventId}`);
  /** What a meeting carries: tasks added for it, and for a 1:1 that person's 1:1 list. */
  const tasksFor = (e: Ev) => tasks.filter((t) => t.meeting_ref === e.id || (!!e.oneOnOne && t.people.some((p) => p.id === e.oneOnOne && p.one_on_one)));
  /** His own calendar block for a task's project this week, if he made one. */
  const calOf = (t: TaskItem) => (t.project_id ? events.find((e) => e.project?.id === t.project_id) : undefined);
  /** His answer for a session of his own time on a day, if he gave one. */
  const resultOf = (ref: string, day: string): BlockResult | undefined => data.block_results.find((x) => x.ref === ref && x.day === day);
  const begun = (day: string, start: number) => day < today || (day === today && start <= nowMin);
  /** How a session went; "open" once it has begun with no answer. */
  const outcomeOf = (ref: string, day: string, start: number): Outcome => {
    const r = resultOf(ref, day);
    if (!r) return begun(day, start) ? "open" : null;
    return r.kept === 1 ? "kept" : r.instead.trim() ? "swapped" : "skipped";
  };
  const projectTasks = (e: Ev) => (e.project ? tasks.filter((t) => t.project_id === e.project!.id) : []);
  /** A calendar entry that is his own time: his project's block, or one with no one else on it. */
  const isOwn = (e: Ev) => !!e.session || projectTasks(e).length > 0 || (e.guests === 0 && !e.oneOnOne && peopleIn(e.id).length === 0);
  const refOf = (e: Ev) => e.session ?? `calendar:${e.id}`;
  // Sessions he answered for whose block or calendar entry is no longer on that day (taken
  // off, moved, deleted): drawn from his answer's own copy, so the week keeps them.
  const liveRefs = new Set([...data.blocks.map((b) => `block:${b.id}|${b.day}`), ...data.calendar.map((e) => `calendar:${e.id}|${e.day}`)]);
  const past: Ev[] = data.block_results
    .filter((r) => days.includes(r.day) && !liveRefs.has(`${r.ref}|${r.day}`) && inScope("work"))
    .map((r) => ({ id: `was:${r.ref}|${r.day}`, day: r.day, start: r.start_min, end: r.start_min + Math.max(15, r.minutes), title: meetingTitle(r.title), url: null, project: null, area: "work", oneOnOne: null, location: "", guests: 0, session: r.ref }));
  // The board: what still needs a place. Project tasks and ones with time set aside are left off.
  const placed = tasks.filter((t) => !needsPlace(t, data.blocks, today));
  const rows: Record<Row, TaskItem[]> = { new: [], todo: [], waiting: [], back: [], figure: [] };
  for (const t of inOrder(everything ? tasks : tasks.filter((x) => !placed.includes(x)))) rows[rowOf(t)].push(t);

  const START = Math.min(8 * 60, ...[...events, ...past].map((e) => Math.floor(e.start / 60) * 60), ...blocks.map((b) => Math.floor(b.start_min / 60) * 60));
  const END = Math.max(17 * 60, ...[...events, ...past].map((e) => Math.ceil(e.end / 60) * 60), ...blocks.map((b) => Math.ceil((b.start_min + b.minutes) / 60) * 60));
  const HOUR = view === "day" ? 56 : 34;
  const busy = (day: string, exceptBlock?: string) => [
    ...events.filter((e) => e.day === day).map((e) => ({ start: e.start, end: e.end })),
    ...blocks.filter((b) => b.day === day && b.id !== exceptBlock).map((b) => ({ start: b.start_min, end: b.start_min + b.minutes })),
  ];
  const dayOrder = view === "day" ? [shown, ...days.filter((d) => d !== shown)] : days;
  const opens = (minutes: number, exceptBlock?: string, n = 4) => openTimes(dayOrder, (d) => busy(d, exceptBlock), minutes, { day: today, min: nowMin }, { n });
  const clashWith = (d: Draft) => {
    const e = events.find((x) => x.day === d.day && x.start < d.start + d.minutes && x.end > d.start);
    if (e) return e.title;
    const b = blocks.find((x) => x.id !== d.blockId && x.day === d.day && x.start_min < d.start + d.minutes && x.start_min + x.minutes > d.start);
    return b ? b.title : null;
  };

  // ---------- opening the panel ----------
  /** The panel for a task: its block if it has one, its project's calendar block, or the next open time. */
  const openFor = (id: string) => {
    const b = blockOf(id);
    if (b) return setDraft({ taskId: id, blockId: b.id, day: b.day, start: b.start_min, minutes: b.minutes });
    const t = byId.get(id);
    const cal = t && calOf(t);
    if (cal) return setDraft({ taskId: id, cal, day: cal.day, start: cal.start, minutes: cal.end - cal.start });
    const f = opens(30, undefined, 1)[0] ?? { day: dayOrder[0]!, start: 9 * 60 };
    setDraft({ taskId: id, day: f.day, start: f.start, minutes: 30 });
  };
  useEffect(() => {
    if (draft && view === "day" && draft.day !== shown && days.includes(draft.day)) setShown(draft.day);
  }, [draft, view, shown, days]);

  const commit = () => {
    if (!draft) return;
    const t = byId.get(draft.taskId);
    if (draft.cal || !t) return setDraft(null);
    if (draft.blockId) moveBlock.mutate({ id: draft.blockId, day: draft.day, start_min: draft.start, minutes: draft.minutes });
    else addBlock.mutate({ task_id: t.id, day: draft.day, start_min: draft.start, minutes: draft.minutes, title: t.title, area: t.project_area });
    setDraft(null);
  };
  const markDone = (t: TaskItem) => {
    setDraft(null);
    edit.mutate({ id: t.id, status: "done" });
    setGone({ id: t.id, title: t.title });
  };
  const moveTo = (id: string, row: Row, index = 0) => {
    const list = rows[row].filter((x) => x.id !== id);
    const before = list[index - 1]?.sort_order;
    const after = list[index]?.sort_order;
    // New is "not placed": no row. (A task he is waiting on someone for still shows in Waiting.)
    edit.mutate({ id, board: row === "new" ? null : row, sort_order: orderBetween(before, after) });
  };

  // ---------- dragging ----------
  const dragRef = useRef<{ id: string; el: HTMLElement; x0: number; y0: number; dx: number; dy: number; ghost: HTMLElement | null; openT?: number } | null>(null);
  // Each row registers how to open itself, so a card dragged onto a closed row can open it.
  const rowOpeners = useRef(new Map<string, () => void>());
  const live = useRef({ moveTo, openFor, setDraft, rows, blockOf, START, HOUR, setRowOpen: (k: string) => rowOpeners.current.get(k)?.() });
  live.current = { ...live.current, moveTo, openFor, setDraft, rows, blockOf, START, HOUR };
  useEffect(() => {
    const inside = (el: Element, x: number, y: number) => { const r = el.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
    const colAt = (x: number, y: number) => [...document.querySelectorAll<HTMLElement>(".plan-col")].find((c) => inside(c, x, y));
    const stackAt = (x: number, y: number) =>
      [...document.querySelectorAll<HTMLElement>(".plan-row")].find((c) => inside(c, x, y))?.querySelector<HTMLElement>(".plan-stack");
    const indexIn = (stack: HTMLElement, x: number, y: number, id: string) =>
      [...stack.querySelectorAll<HTMLElement>("[data-card]")].filter((c) => c.dataset.card !== id).findIndex((c) => {
        const r = c.getBoundingClientRect();
        return y < r.top || (y <= r.bottom && x < r.left + r.width / 2);
      });
    const clear = () => document.querySelectorAll(".is-over,.ins-before,.ins-after").forEach((c) => c.classList.remove("is-over", "ins-before", "ins-after"));

    const down = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (e.button !== 0 || target.closest("[data-rename],[data-toggle],button,a")) return;
      const el = target.closest<HTMLElement>("[data-card]");
      if (!el) return;
      const r = el.getBoundingClientRect();
      dragRef.current = { id: el.dataset.card!, el, x0: e.clientX, y0: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, ghost: null };
    };
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.ghost) {
        if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return;
        d.ghost = d.el.cloneNode(true) as HTMLElement;
        d.ghost.classList.add("plan-ghost");
        d.ghost.style.width = `${Math.min(240, d.el.offsetWidth)}px`;
        document.body.appendChild(d.ghost);
        d.el.style.visibility = "hidden";
        document.body.classList.add("plan-dragging");
      }
      d.ghost.style.left = `${e.clientX - d.dx}px`;
      d.ghost.style.top = `${e.clientY - d.dy}px`;
      clear();
      const col = colAt(e.clientX, e.clientY);
      if (col) return col.classList.add("is-over");
      const stack = stackAt(e.clientX, e.clientY);
      if (!stack) return;
      const row = stack.closest<HTMLElement>(".plan-row");
      (row ?? stack).classList.add("is-over");
      if (row && !row.classList.contains("open")) {
        window.clearTimeout(d.openT);
        const k = row.dataset.row!;
        d.openT = window.setTimeout(() => dragRef.current && live.current.setRowOpen(k), 450);
      }
      const others = [...stack.querySelectorAll<HTMLElement>("[data-card]")].filter((c) => c.dataset.card !== d.id);
      if (!others.length) return;
      const i = indexIn(stack, e.clientX, e.clientY, d.id);
      if (i < 0) others[others.length - 1]!.classList.add("ins-after");
      else others[i]!.classList.add("ins-before");
    };
    const up = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      window.clearTimeout(d.openT);
      clear();
      document.body.classList.remove("plan-dragging");
      if (!d.ghost) {
        // A click, not a drag: ask when.
        return live.current.openFor(d.id);
      }
      d.ghost.remove();
      d.el.style.visibility = "";
      const L = live.current;
      const col = colAt(e.clientX, e.clientY);
      if (col) {
        // The block starts where the top of the card was let go, to the quarter hour.
        const r = col.getBoundingClientRect();
        const b = L.blockOf(d.id);
        const minutes = b?.minutes ?? 30;
        const start = Math.max(0, Math.min(24 * 60 - minutes, L.START + Math.round(((e.clientY - d.dy - r.top) / L.HOUR) * 4) * 15));
        return L.setDraft({ taskId: d.id, blockId: b?.id, day: col.dataset.day!, start, minutes });
      }
      const stack = stackAt(e.clientX, e.clientY);
      if (!stack) return;
      const row = (stack.closest<HTMLElement>(".plan-row")?.dataset.row ?? "new") as Row;
      const i = indexIn(stack, e.clientX, e.clientY, d.id);
      L.moveTo(d.id, row, i < 0 ? L.rows[row].filter((x) => x.id !== d.id).length : i);
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    };
  }, []);

  // ---------- drawing ----------
  const cols = view === "day" ? [shown] : days;
  const y = (min: number) => ((min - START) / 60) * HOUR;
  const height = ((END - START) / 60) * HOUR;
  const ownCal = (e: Ev) => projectTasks(e).length > 0;
  /** The mark a session of his own time wears, and the line under its title when he did something else. */
  const badge = (o: Outcome) => o && <i className="plan-st" aria-hidden>{o === "kept" ? "✓" : o === "skipped" ? "✕" : o === "swapped" ? "→" : ""}</i>;
  const sayOutcome = (o: Outcome, instead?: string) => (o ? `${OUTCOME_TEXT[o]}${o === "swapped" && instead ? `: ${instead}` : ""}` : undefined);

  const card = (t: TaskItem) => {
    const b = blockOf(t.id);
    const cal = !b ? calOf(t) : undefined;
    const due = dueLabel(t.due_date);
    return (
      <Card key={t.id} t={t} onDone={() => markDone(t)}>
        {scope === "all" && <Sigil scope={t.project_area} size={8} />}
        {t.people.length > 0 && <span>{t.people.map((p) => first(p.name)).join(", ")}</span>}
        {t.project_title && <span className="faint">{t.project_title}</span>}
        {due && <span className={due.tone === "late" ? "late" : due.tone === "soon" ? "soon" : "faint"}>{due.text}</span>}
        {t.meeting_ref && events.find((e) => e.id === t.meeting_ref) && (
          <span className="faint">for {events.find((e) => e.id === t.meeting_ref)!.title}, {short(events.find((e) => e.id === t.meeting_ref)!.day)}</span>
        )}
        {(b || cal) && <span className="when">{short(b ? b.day : cal!.day)} {clockText(b ? b.start_min : cal!.start).replace(/ [AP]M$/, "")}</span>}
      </Card>
    );
  };

  return (
    <div className="plan">
      <div className="plan-tools">
        <div className="plan-seg" role="group" aria-label="Show">
          {(["week", "day"] as const).map((v) => (
            <button key={v} type="button" className="press" aria-pressed={view === v} onClick={() => { setDraft(null); setView(v); }}>
              {v === "week" ? "Week" : "Day"}
            </button>
          ))}
        </div>
      </div>

      <div className={`plan-main${view === "day" ? " dayview" : ""}`}>
        <div className="plan-pinned">
          <div className="plan-weekscroll">
            <div className={`plan-week${view === "day" ? " day" : ""}`} style={{ gridTemplateColumns: `40px repeat(${cols.length}, minmax(${view === "day" ? 0 : 130}px, 1fr))` }}>
              <div />
              {view === "day" ? (
                <div className="plan-daypick" role="group" aria-label="Day">
                  {days.map((d) => (
                    <button key={d} type="button" className="press" aria-pressed={d === shown} onClick={() => { setDraft(null); setShown(d); }}>
                      {d === today ? "Today" : short(d)}
                      <span>{Number(d.slice(8))}</span>
                    </button>
                  ))}
                </div>
              ) : (
                days.map((d) => (
                  <div key={d} className={`plan-dayhead${d === today ? " today" : ""}`}>
                    <button type="button" title={`Show ${fmtWeekday(d)} on its own`} onClick={() => { setShown(d); setView("day"); }}>
                      <span className="wd">{short(d)}</span>
                      <span className="num">{Number(d.slice(8))}</span>
                    </button>
                    {allDay.filter((e) => e.day === d).map((e) => (
                      <small key={e.id} title={e.title}>{e.title}</small>
                    ))}
                  </div>
                ))
              )}
              <div className="plan-hours" style={{ height }}>
                {Array.from({ length: (END - START) / 60 }, (_, i) => (
                  <i key={i} style={{ top: i * HOUR }}>
                    {((START / 60 + i) % 12) || 12}
                    {START / 60 + i < 12 ? "a" : "p"}
                  </i>
                ))}
              </div>
              {cols.map((day) => {
                const items = layOut([
                  ...[...events, ...past].filter((e) => e.day === day).map((e) => ({ kind: "ev" as const, id: e.id, start: e.start, end: e.end, e })),
                  ...blocks.filter((b) => b.day === day).map((b) => ({ kind: "blk" as const, id: b.id, start: b.start_min, end: b.start_min + b.minutes, b })),
                ]);
                return (
                  <div key={day} className={`plan-col${day === today ? " today" : ""}`} data-day={day} style={{ height, ["--hour" as string]: `${HOUR}px` }}>
                    {items.map((it) => {
                      // Each meeting and block wears its desk's color: tinted for a meeting, solid for his own time.
                      const area = it.kind === "blk" ? it.b.area : it.e.area;
                      const style = { ["--desk" as string]: `var(--space-${area})`, top: y(it.start), height: Math.max(18, ((it.end - it.start) / 60) * HOUR - 2), left: `calc(${(it.slot / it.of) * 100}% + 3px)`, width: `calc(${100 / it.of}% - 6px)` };
                      const tall = style.height > 32;
                      if (it.kind === "blk") {
                        const b = it.b;
                        const o = b.id.startsWith("new-") ? null : outcomeOf(`block:${b.id}`, b.day, b.start_min);
                        const instead = resultOf(`block:${b.id}`, b.day)?.instead;
                        // A block whose task is checked off has nothing left to move: it opens only the question.
                        const open = () =>
                          byId.has(b.task_id)
                            ? setDraft({ taskId: b.task_id, blockId: b.id, day: b.day, start: b.start_min, minutes: b.minutes })
                            : (setDraft(null), setMeeting({ id: `blk:${b.id}`, day: b.day, start: b.start_min, end: b.start_min + b.minutes, title: b.title, url: null, project: null, area: b.area, oneOnOne: null, location: "", guests: 0, session: `block:${b.id}` }));
                        return (
                          <button key={b.id} type="button" data-ev={byId.has(b.task_id) ? undefined : `blk:${b.id}`} className={`plan-blk${draft?.blockId === b.id ? " editing" : ""}${b.status === "done" ? " done" : ""}${o ? ` ${o}` : ""}`} style={style} title={sayOutcome(o, instead)} onClick={open}>
                            <b>{b.title}</b>
                            {tall && (o === "swapped" && instead ? <small className="inst">→ {instead}</small> : <small>{clockText(b.start_min).replace(/ [AP]M$/, "")}–{clockText(b.start_min + b.minutes)}</small>)}
                            {badge(o)}
                          </button>
                        );
                      }
                      const e = it.e;
                      if (isOwn(e)) {
                        // His own time: his block for a project (it opens the project's tasks), or an entry with no one else on it.
                        const o = outcomeOf(refOf(e), e.day, e.start);
                        const instead = resultOf(refOf(e), e.day)?.instead;
                        return (
                          <button key={e.id} type="button" data-ev={e.id} className={`plan-ev mine${draft?.cal?.id === e.id || meeting?.id === e.id ? " lit" : ""}${o ? ` ${o}` : ""}`} style={style} title={sayOutcome(o, instead)} onClick={() => { setDraft(null); setMeeting(e); }}>
                            <b>{e.title}</b>
                            {tall && (o === "swapped" && instead ? <small className="inst">→ {instead}</small> : <small>{clockText(e.start).replace(/ [AP]M$/, "")}–{clockText(e.end)}</small>)}
                            {badge(o)}
                          </button>
                        );
                      }
                      const carries = tasksFor(e).length > 0 || !!noteFor(e.id)?.body.trim();
                      return (
                        <button key={e.id} type="button" data-ev={e.id} className={`plan-ev${carries ? " has" : ""}${meeting?.id === e.id ? " lit" : ""}`} style={style} title={carries ? "Has tasks or a note" : undefined} onClick={() => { setDraft(null); setMeeting(e); }}>
                          <b>{e.title}</b>
                          {tall && <small>{clockText(e.start).replace(/ [AP]M$/, "")}–{clockText(e.end)}</small>}
                        </button>
                      );
                    })}
                    {draft && !draft.cal && draft.day === day && (
                      <div id="plan-preview" className={`plan-blk preview${clashWith(draft) ? " clash" : ""}`} style={{ ["--desk" as string]: `var(--space-${byId.get(draft.taskId)?.project_area ?? "work"})`, top: y(draft.start), height: Math.max(18, (draft.minutes / 60) * HOUR - 2), left: 3, right: 3 }}>
                        <b>{byId.get(draft.taskId)?.title}</b>
                      </div>
                    )}
                    {day === today && nowMin >= START && nowMin <= END && <span className="plan-now" style={{ top: y(nowMin) }} />}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <section className="plan-boardwrap">
          <div className="plan-boardhead">
            <h2>Board</h2>
            <div>
              {boardShown && placed.length > 0 && (
                <button type="button" className="press" aria-pressed={everything} title="Tasks in a project, and tasks with time already set aside, are left off the board" onClick={() => setEverything(!everything)}>
                  {everything ? "Hide project and blocked tasks" : "Show all tasks"}
                </button>
              )}
              <button type="button" className="press" aria-expanded={boardShown} onClick={() => setBoardShown(!boardShown)}>
                {boardShown ? "Hide board" : "Show board"}
              </button>
            </div>
          </div>
          <div className={`plan-boardfold${boardShown ? "" : " shut"}`}>
            <div>
              <div className="plan-board">
                {(["new", ...ROWS] as const).map((k) => (
                  <BoardRowView key={k} k={k} name={k === "new" ? "New" : names[k]} tasks={rows[k]} card={card} openers={rowOpeners.current} names={names} />
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* The panel and the message float above the page. They are drawn at the top of the
          document, because the page sits in an animated container that would otherwise make
          them part of its width. */}

      {meeting && createPortal(
        <MeetingPanel
          key={meeting.id}
          e={meeting}
          people={peopleIn(meeting.id)}
          project={ownCal(meeting) ? meeting.project : null}
          tasks={meeting.session ? [] : ownCal(meeting) ? inOrder(projectTasks(meeting)) : tasksFor(meeting)}
          note={noteFor(meeting.id)?.body ?? ""}
          // His own time (his project's block, or an entry with no one else on it), once it has begun.
          answer={isOwn(meeting) && begun(meeting.day, meeting.start) ? resultOf(refOf(meeting), meeting.day) ?? null : undefined}
          onAnswer={(a) => saveResult.mutate({ ref: refOf(meeting), day: meeting.day, ...a })}
          onClose={() => setMeeting(null)}
          onDone={(t) => markDone(t)}
        />,
        document.body,
      )}
      {draft && byId.get(draft.taskId) && createPortal(
        <BlockPanel
          draft={draft}
          setDraft={setDraft}
          task={byId.get(draft.taskId)!}
          today={today}
          weekStart={data.week_start}
          row={rowOf(byId.get(draft.taskId)!)}
          names={names}
          clash={clashWith(draft)}
          opens={opens(draft.minutes, draft.blockId)}
          answer={(() => { const b = blocks.find((x) => x.id === draft.blockId); return b && !b.id.startsWith("new-") && begun(b.day, b.start_min) ? resultOf(`block:${b.id}`, b.day) ?? null : undefined; })()}
          onAnswer={(a) => { const b = blocks.find((x) => x.id === draft.blockId); if (b) saveResult.mutate({ ref: `block:${b.id}`, day: b.day, ...a }); }}
          onCommit={commit}
          onDelete={() => { if (draft.blockId) delBlock.mutate(draft.blockId); setDraft(null); }}
          onDone={() => markDone(byId.get(draft.taskId)!)}
          onMove={(row) => moveTo(draft.taskId, row, 0)}
        />,
        document.body,
      )}

      {gone && createPortal(
        <DoneToast
          key={gone.id}
          text={`Checked off “${gone.title.length > 48 ? `${gone.title.slice(0, 47)}…` : gone.title}”`}
          onUndo={() => { edit.mutate({ id: gone.id, status: "todo" }); setGone(null); }}
          onGone={() => setGone(null)}
        />,
        document.body,
      )}
    </div>
  );
}

// ---------- a row of the board ----------

function BoardRowView({ k, name, tasks, card, openers, names }: { k: Row; name: string; tasks: TaskItem[]; card: (t: TaskItem) => ReactNode; openers: Map<string, () => void>; names: Record<BoardRow, string> }) {
  const [open, setOpen] = usePref(`plan-row-${k}`, tasks.length > 0);
  const save = useSaveSettings();
  // Dragging a card onto a closed row opens it after a moment.
  useEffect(() => {
    openers.set(k, () => setOpen(true));
    return () => void openers.delete(k);
  });
  const rename = (el: HTMLElement) => {
    const v = el.textContent?.trim() ?? "";
    if (!v) el.textContent = name;
    else if (v !== name && k !== "new") save.mutate({ board_names: { ...names, [k]: v } });
  };
  return (
    <section className={`plan-row${open ? " open" : ""}`} data-row={k}>
      <div className="plan-rowhead" data-toggle={k} onClick={(e) => !(e.target as HTMLElement).closest("[data-rename]") && setOpen(!open)}>
        <i className="dot" aria-hidden />
        <button type="button" className="tog" aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} ${name}`} onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
          <svg viewBox="0 0 12 12" aria-hidden><path d="M4.5 2.5L8 6l-3.5 3.5" /></svg>
        </button>
        {k === "new" ? (
          <span className="rowname">{name}</span>
        ) : (
        <span
          contentEditable="plaintext-only"
          suppressContentEditableWarning
          spellCheck={false}
          data-rename={k}
          title="Click to rename"
          onBlur={(e) => rename(e.currentTarget)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
        >
          {name}
        </span>
        )}
        {tasks.length > 0 && <span className="n">{tasks.length}</span>}
      </div>
      <div className="plan-fold">
        <div>
          <div className="plan-stack">{tasks.map(card)}</div>
        </div>
      </div>
    </section>
  );
}

// ---------- a card ----------

function Card({ t, onDone, children }: { t: TaskItem; onDone: () => void; children: ReactNode }) {
  const [ticked, setTicked] = useState(false);
  const mailLinks = useMailLinks();
  const mail = mailLinks({ source_ref: t.source_ref, url: null });
  return (
    <div className={`plan-card${ticked ? " ticked" : ""}`} data-card={t.id} tabIndex={0} role="button" aria-label={t.title}>
      <button
        type="button"
        className="chk"
        aria-label={`Check off ${t.title}`}
        onClick={(e) => {
          e.stopPropagation();
          setTicked(true);
          window.setTimeout(onDone, 380);
        }}
      >
        <svg viewBox="0 0 12 12" aria-hidden><path d="M2.5 6.4l2.4 2.4 4.6-5.2" /></svg>
      </button>
      <div className="t">{t.title}</div>
      <div className="m">
        {children}
        {mail && (
          <a {...linkProps(mail.superhuman ?? mail.gmail)} className="mail" title="Open the email this came from" aria-label="Open the email this came from" onClick={(e) => e.stopPropagation()}>
            <Icon name="email" size={13} />
          </a>
        )}
      </div>
    </div>
  );
}

// ---------- the panel: when, and how long ----------

/** The first line of a task's notes, without links: where it came from, usually. */
function sourceLine(t: TaskItem): string {
  const line = (t.notes ?? "").split("\n").map((l) => l.replace(/https?:\/\/\S+|superhuman:\/\/\S+/g, "").trim()).find(Boolean) ?? "";
  return line.length > 110 ? `${line.slice(0, 109)}…` : line;
}

function BlockPanel(p: {
  draft: Draft; setDraft: (d: Draft | null) => void; task: TaskItem; today: string; weekStart: string; row: Row; names: Record<BoardRow, string>;
  clash: string | null; opens: { day: string; start: number }[]; answer?: BlockResult | null; onAnswer: (a: Answer) => void; onCommit: () => void; onDelete: () => void; onDone: () => void; onMove: (row: Row) => void;
}) {
  const { draft, setDraft, task } = p;
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const asText = (d: When) => `${fmtWeekday(d.day).slice(0, 3)} ${clockText(d.start)} · ${lengthText(d.minutes)}`;
  const [text, setText] = useState(asText(draft));
  const [shown, setShown] = useState(false);
  const who = task.people.map((x) => x.name).join(", ");
  const src = sourceLine(task);

  // Beside the preview on the calendar, on whichever side has room; kept on screen.
  const place = () => {
    const el = ref.current;
    if (!el) return;
    const anchor = document.getElementById("plan-preview") ?? document.querySelector(".plan-ev.lit");
    const r = anchor ? anchor.getBoundingClientRect() : { left: innerWidth / 2 - 160, right: innerWidth / 2 + 160, top: 120 };
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = r.right + 12;
    if (x + w > innerWidth - 12) x = r.left - w - 12;
    if (x < 12) x = Math.max(12, Math.min(innerWidth - w - 12, r.left));
    el.style.left = `${x}px`;
    el.style.top = `${Math.max(12, Math.min(innerHeight - h - 12, r.top - 10))}px`;
  };
  useLayoutEffect(place);
  useEffect(() => {
    requestAnimationFrame(() => setShown(true));
    if (!draft.cal) { input.current?.focus(); input.current?.select(); }
    const close = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest(".plan-blk,.plan-ev.mine,[data-card]")) setDraft(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setDraft(null);
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [draft.taskId, draft.blockId, !!draft.cal]);
  // A chip or a drop changes the draft: show it in the line.
  useEffect(() => { if (document.activeElement !== input.current) setText(asText(draft)); }, [draft.day, draft.start, draft.minutes]);

  // A tap on a length or an open time: show it in the line and keep typing there, so Enter saves.
  const set = (patch: Partial<When>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    setText(asText(next));
    requestAnimationFrame(() => input.current?.focus());
  };
  const rowChoices: [Row, string][] = [...(["todo", "waiting", "back", "figure"] as const).map((k): [Row, string] => [k, p.names[k]]), ["new", "New"]];

  return (
    <div ref={ref} className={`plan-panel${shown ? " open" : ""}`} role="dialog" aria-label={`When to work on ${task.title}`}>
      <div className="what">{task.title}</div>
      {(who || src || task.project_title) && (
        <div className="src">
          {[who && `With ${who}`, task.project_title, src].filter(Boolean).join(" · ")}
          {task.project_id && (
            <>
              {" "}
              <Link to={`/projects/${task.project_id}`} className="press">Open project</Link>
            </>
          )}
        </div>
      )}
      <div className="row lanes">
        {rowChoices.map(([k, name]) => (
          <button key={k} type="button" className="chip press" aria-pressed={p.row === k} onClick={() => p.onMove(k)}>
            {name}
          </button>
        ))}
      </div>
      {draft.cal ? (
        <p className="read">
          Already on your calendar: {fmtWeekday(draft.cal.day)}, {clockText(draft.cal.start)} to {clockText(draft.cal.end)}
        </p>
      ) : (
        <>
          <input
            ref={input}
            value={text}
            aria-label="Day, time and length, for example thu 9 45m"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setText(e.target.value);
              setDraft({ ...draft, ...readWhen(e.target.value, draft, p.today, p.weekStart) });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); p.onCommit(); }
              if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); set({ start: Math.max(0, draft.start + (e.key === "ArrowUp" ? -15 : 15)) }); }
            }}
          />
          <p className={`read${p.clash ? " clash" : ""}`}>
            {fmtWeekday(draft.day)}, {clockText(draft.start)} to {clockText(draft.start + draft.minutes)}
            {p.clash && ` · runs into ${p.clash}`}
          </p>
          <div className="row">
            <div className="lbl">Length</div>
            {LENGTHS.map((n) => (
              <button key={n} type="button" className="chip press" aria-pressed={draft.minutes === n} onClick={() => set({ minutes: n })}>
                {n < 60 ? `${n}m` : `${n / 60}h`}
              </button>
            ))}
          </div>
          {p.opens.length > 0 && (
            <div className="row">
              <div className="lbl">Open time</div>
              {p.opens.map((o) => (
                <button key={`${o.day}-${o.start}`} type="button" className="chip press" aria-pressed={o.day === draft.day && o.start === draft.start} onClick={() => set({ day: o.day, start: o.start })}>
                  {fmtWeekday(o.day).slice(0, 3)} {clockText(o.start).replace(/ [AP]M$/, "")}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {p.answer !== undefined && <Kept answer={p.answer} onSet={p.onAnswer} />}
      <div className="actions">
        <button type="button" className="go press" onClick={p.onCommit}>
          {draft.cal ? "Done" : draft.blockId ? "Move it" : "Block it"}
        </button>
        {draft.cal ? (
          <button type="button" className="quiet press" onClick={() => setDraft({ taskId: draft.taskId, day: draft.day, start: draft.cal!.end + 15, minutes: 30 })}>
            Add another time
          </button>
        ) : (
          <button type="button" className="quiet press" onClick={() => setDraft(null)}>
            Cancel
          </button>
        )}
        {draft.blockId && (
          <button type="button" className="quiet danger press" onClick={p.onDelete}>
            Take off
          </button>
        )}
        <button type="button" className="quiet press push" onClick={p.onDone}>
          Check off
        </button>
      </div>
    </div>
  );
}

// ---------- how time he set aside went ----------

/** What the question's buttons send: he did the work, he did not, or what he did instead; null takes the answer back. */
interface Answer { kept: boolean | null; instead?: string }

/**
 * Asked once the time has begun. Three answers: Yes, No, or Something else, which opens a line
 * for what he did in that time instead (saved on Enter, or when the panel closes). Tapping the
 * chosen answer takes it back.
 */
function Kept({ answer, onSet }: { answer: BlockResult | null; onSet: (a: Answer) => void }) {
  const kept = answer ? answer.kept === 1 : null;
  const said = answer?.kept === 0 ? answer.instead : "";
  const [other, setOther] = useState(!!said);
  const [text, setText] = useState(said);
  // What to save if the panel closes while he is still typing.
  const pending = useRef<string | null>(null);
  const live = useRef(onSet);
  live.current = onSet;
  const save = () => {
    const v = text.trim();
    pending.current = null;
    if (v && v !== said) onSet({ kept: false, instead: v });
  };
  useEffect(() => () => { if (pending.current?.trim()) live.current({ kept: false, instead: pending.current.trim() }); }, []);
  const pick = (which: "yes" | "no" | "other") => {
    pending.current = null;
    if (which === "yes") { setOther(false); setText(""); return onSet(kept === true ? { kept: null } : { kept: true }); }
    if (which === "no") { const on = kept === false && !said && !other; setOther(false); setText(""); return onSet(on ? { kept: null } : { kept: false, instead: "" }); }
    if (other) { setOther(false); setText(""); if (said) onSet({ kept: null }); return; }
    setOther(true);
  };
  return (
    <div className="row kept">
      <div className="lbl">Did you get to it?</div>
      <button type="button" className="chip press" aria-pressed={kept === true && !other} onClick={() => pick("yes")}>
        Yes
      </button>
      <button type="button" className="chip press" aria-pressed={kept === false && !said && !other} onClick={() => pick("no")}>
        No
      </button>
      <button type="button" className="chip press" aria-pressed={other} onClick={() => pick("other")}>
        Something else
      </button>
      {other && (
        <TextInput
          autoFocus
          value={text}
          onChange={(e) => { setText(e.target.value); pending.current = e.target.value; }}
          onEnter={save}
          onBlur={save}
          placeholder="What did you do instead?"
          aria-label="What you did in that time instead"
        />
      )}
    </div>
  );
}

// ---------- a meeting: its tasks and its note ----------
// Also the panel for his own block for a project (`project` given): the project's tasks to
// check off and a line to add one to it. That is his own time, not a meeting, so it has no note.
// And for a session that is only its question (`e.session`: a block whose task is checked off,
// or one whose block or calendar entry has gone): the title, the time and "Did you get to it?".

function MeetingPanel({ e, people, project, tasks, note, answer, onAnswer, onClose, onDone }: { e: Ev; people: { id: string; name: string }[]; project: ProjectCard | null; tasks: TaskItem[]; note: string; answer?: BlockResult | null; onAnswer: (a: Answer) => void; onClose: () => void; onDone: (t: TaskItem) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const addTask = useAddTask();
  const saveNote = useSaveMeetingNote();
  const [shown, setShown] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState(note);
  const [saved, setSaved] = useState<"" | "saving" | "saved">("");
  const place = () => {
    const el = ref.current;
    if (!el) return;
    const anchor = document.querySelector(`[data-ev="${CSS.escape(e.id)}"]`);
    const r = anchor ? anchor.getBoundingClientRect() : { left: innerWidth / 2 - 180, right: innerWidth / 2 + 180, top: 120 };
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = r.right + 12;
    if (x + w > innerWidth - 12) x = r.left - w - 12;
    if (x < 12) x = Math.max(12, Math.min(innerWidth - w - 12, r.left));
    el.style.left = `${x}px`;
    el.style.top = `${Math.max(12, Math.min(innerHeight - h - 12, r.top - 10))}px`;
  };
  useLayoutEffect(place);
  const save = () => {
    if (text === note) return;
    setSaved("saving");
    saveNote.mutate({ eventId: e.id, body: text }, { onSuccess: () => setSaved("saved"), onError: () => setSaved("") });
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    requestAnimationFrame(() => setShown(true));
    const close = (ev: PointerEvent) => {
      const t = ev.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest(`[data-ev]`)) { saveRef.current(); onClose(); }
    };
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") { saveRef.current(); onClose(); } };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, []);
  const add = () => {
    const v = title.trim();
    if (!v) return;
    if (project) addTask.mutate({ title: v, project_id: project.id });
    // Tagged with his people in the meeting; for a 1:1, on that person's 1:1 list too.
    else addTask.mutate({ title: v, area: e.area as TaskItem["project_area"], meeting_ref: e.id, people: people.map((p) => ({ person_id: p.id, one_on_one: p.id === e.oneOnOne })) });
    setTitle("");
  };
  return (
    <div ref={ref} className={`plan-panel plan-meeting${shown ? " open" : ""}`} role="dialog" aria-label={e.title}>
      <div className="what">{e.title}</div>
      <div className="src">
        {fmtWeekday(e.day)}, {clockText(e.start)} to {clockText(e.end)}
        {e.location && ` · ${e.location.split("\n")[0]}`}
        {people.length > 0 && (
          <>
            {" · With "}
            {people.map((p, i) => (
              <span key={p.id}>
                {i > 0 && ", "}
                <Link to={`/people/${p.id}`} className="press">{p.name}</Link>
              </span>
            ))}
          </>
        )}
        {project && (
          <>
            {" · "}
            <Link to={`/projects/${project.id}`} className="press">Open project</Link>
          </>
        )}
        {e.url && (
          <>
            {" · "}
            <a href={e.url} target="_blank" rel="noreferrer" className="press">Open in Calendar</a>
          </>
        )}
      </div>
      {!e.session && (
        <div className="mtasks">
          {tasks.map((t) => (
            <MeetingTask key={t.id} t={t} onDone={() => onDone(t)} />
          ))}
          <TextInput value={title} onChange={(ev) => setTitle(ev.target.value)} onEnter={add} placeholder={project ? "Add a task to this project" : answer !== undefined || e.guests === 0 ? "Add a task for this block" : "Add a task for this meeting"} aria-label={project ? "Add a task to this project" : "Add a task for this"} />
        </div>
      )}
      {answer !== undefined && <Kept answer={answer} onSet={onAnswer} />}
      {!project && !e.session && (
        <>
          <div className="lbl">Notes{saved === "saving" ? " · saving" : saved === "saved" && text === note ? " · saved" : ""}</div>
          <TextArea value={text} onChange={(ev) => { setText(ev.target.value); setSaved(""); }} onBlur={save} onSubmit={save} minRows={3} placeholder="What was said, what was decided" aria-label="Notes for this meeting" />
        </>
      )}
    </div>
  );
}

function MeetingTask({ t, onDone }: { t: TaskItem; onDone: () => void }) {
  const [ticked, setTicked] = useState(false);
  return (
    <div className={`mtask${ticked ? " ticked" : ""}`}>
      <button type="button" className="chk" aria-label={`Check off ${t.title}`} onClick={() => { setTicked(true); window.setTimeout(onDone, 380); }}>
        <svg viewBox="0 0 12 12" aria-hidden><path d="M2.5 6.4l2.4 2.4 4.6-5.2" /></svg>
      </button>
      <span>{t.title}</span>
    </div>
  );
}

// ---------- after checking something off ----------

function DoneToast({ text, onUndo, onGone }: { text: string; onUndo: () => void; onGone: () => void }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    requestAnimationFrame(() => setOn(true));
    const t = window.setTimeout(() => { setOn(false); window.setTimeout(onGone, 200); }, 6000);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div className={`plan-toast${on ? " show" : ""}`} role="status">
      <span>{text}</span>
      <button type="button" className="press" onClick={onUndo}>Undo</button>
    </div>
  );
}

