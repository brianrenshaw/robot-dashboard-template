// Dashboard.tsx
// The dashboard: the owner's day and what needs him, readable at a glance. The same page serves the
// overview of all three desks (/) and each desk on its own (/work, /personal, /side); a desk
// simply shows only its own things, in its own color.
//
// It is deliberately short. Earlier versions put ten tiles here and he found it busy. Now:
// It is for looking, not for working in. The owner adds things and plans his day through his
// chatbot ("what should I work on today?" is answered by the what_to_work_on tool); here he
// glances and checks things off. So, top to bottom, each part only as big as what it says:
//   1. Your day: a plain card with what is on now or next and a bar of today's meetings, while
//      a meeting is on or ahead today; one line of small text once the day is clear. It is
//      never a block of color: that drew his eye even when it had nothing to say.
//   2. The morning brief, as one line until opened.
//   3. Due (the wide card): ONLY tasks that have a due date (and projects that have one),
//      soonest first, to check off.
//      A task with no date never shows here, and neither does one hidden until later.
//      Beside it, People: who he meets next, in the order of his next meeting with each (any
//      meeting, not only a 1:1), and whether there is something to discuss.
//   4. The next two weeks: one row of days. Pick a day to see what is on it.
// There is no Tags and projects card: he did not like it, and it only repeated other pages.
// Everything on it can be clicked: a card's heading opens its full page, a row opens the thing.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useHome, type CalendarEvent, type HomeData, type OneOnOneCard, type PersonComingUp, type ProjectCard, type TaskItem } from "../api";
import { PageHeader } from "../components/Shell";
import { TaskRow } from "../components/Tasks";
import { Avatar, Chevron, Chip, Collapse, Empty, ErrorNote, Icon, Markdown, Spinner, Tile } from "../components/ui";
import { deskModel, type UpcomingItem } from "../lib/desk";
import { addDaysYmd, dueLabel, fmtClock, fmtDay, fmtRange, fmtWeekday, longToday, minuteOfDay, untilLabel } from "../lib/time";
import { Sigil, usePref, useScope } from "../spaces";

export function Dashboard() {
  const { scope, space, base } = useScope();
  const { data, error, isLoading } = useHome();
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorNote error={error} />;
  const m = deskModel(data, scope);
  const all = scope === "all";

  return (
    <>
      <PageHeader tinted={!all} title={all ? longToday() : space.label} summary={all ? undefined : longToday()} />
      <div className="grid grid-cols-12 gap-3 md:gap-4">
        <YourDay connected={data.calendar_connected} events={m.events.filter((e) => e.day === data.today)} later={m.events.filter((e) => e.day > data.today && !e.all_day)} oneOnOnes={m.oneOnOnes} showSpace={all} />
        {data.digest && <Brief digest={data.digest} today={data.today} />}

        <DueCard tasks={m.dated} projects={m.datedProjects} today={data.today} to={`${base}/tasks`} showSpace={all} />
        <PeopleCard people={m.people} today={data.today} to={`${base}/people`} />

        <NextTwoWeeks items={m.upcoming} events={m.events} oneOnOnes={m.oneOnOnes} today={data.today} showSpace={all} />
      </div>
    </>
  );
}

// ---------- your day ----------

/** Redraw once a minute, so "in 25 min" and the now-line stay true while the page sits open. */
function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** How long a meeting runs, in minutes. All-day events and ones with no end count as nothing. */
function minutes(e: CalendarEvent): number {
  return e.all_day || !e.ends_at ? 0 : Math.max(0, (Date.parse(e.ends_at) - Date.parse(e.starts_at)) / 60_000);
}
const endOf = (e: CalendarEvent) => (e.ends_at ? Date.parse(e.ends_at) : Date.parse(e.starts_at) + 30 * 60_000);

/** Where a meeting leads: a 1:1 opens that person's list; anything else opens Google Calendar. */
function eventTarget(e: CalendarEvent, oneOnOnes: OneOnOneCard[]) {
  const o = e.person_id ? oneOnOnes.find((x) => x.person_id === e.person_id) : undefined;
  const open = o ? o.discuss + o.theirs + o.mine + o.unsorted : 0;
  return { o, open, title: o ? `1:1 with ${o.name}` : e.title };
}

/**
 * The colored block at the top: what is happening now or next, and today's meetings drawn as a
 * bar from morning to evening with a line at the present moment.
 */
function YourDay({ connected, events, later, oneOnOnes, showSpace }: { connected: boolean; events: CalendarEvent[]; later: CalendarEvent[]; oneOnOnes: OneOnOneCard[]; showSpace: boolean }) {
  const now = useNow();
  const timed = events.filter((e) => !e.all_day);
  const allDay = events.filter((e) => e.all_day);
  const current = timed.find((e) => Date.parse(e.starts_at) <= now && endOf(e) > now);
  const next = timed.find((e) => Date.parse(e.starts_at) > now);
  const focus = current ?? next;
  const left = timed.filter((e) => endOf(e) > now);
  const hoursLeft = Math.round((left.reduce((n, e) => n + minutes(e), 0) / 60) * 2) / 2;
  // A plain card like the others. It used to be a solid block of the desk's color, and he said
  // it "automatically draws my eyes" even when it had nothing to say.
  const shell = "tile col-span-12 p-4 md:p-5";

  if (!connected) {
    return (
      <p className="col-span-12 px-1 text-[13px] text-muted">
        No calendar connected.{" "}
        <Link to="/settings" className="press font-medium text-accent">
          Connect one in Settings
        </Link>{" "}
        to see your meetings here.
      </p>
    );
  }

  const pill = "press inline-flex h-9 items-center gap-1.5 rounded-full bg-field px-4 text-[13px] font-semibold hover:bg-field-hover";

  // Nothing on now and nothing left today: one line of small text, not a card.
  if (!focus) {
    const ahead = later[0];
    const a = ahead ? eventTarget(ahead, oneOnOnes) : null;
    return (
      <p className="col-span-12 px-1 text-[13px] text-muted">
        {timed.length ? "No more meetings today." : "No meetings today."}
        {allDay.map((e) => ` All day: ${e.title}.`)}
        {ahead && a && (
          <>
            {" "}Next:{" "}
            {a.o ? (
              <Link to={`/people/${a.o.person_id}`} className="press font-medium text-fg hover:text-accent">
                {a.title}
              </Link>
            ) : (
              <span className="font-medium text-fg">{a.title}</span>
            )}
            , {fmtWeekday(ahead.day)} {fmtClock(ahead.starts_at)}.
          </>
        )}
      </p>
    );
  }

  const f = eventTarget(focus, oneOnOnes);
  return (
    <section className={shell}>
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{current ? "Happening now" : "Next up"}</p>
          {(
            <>
              <p className="mt-1 truncate text-[18px] font-semibold leading-tight tracking-tight">{f.title}</p>
              <p className="mt-1 text-[13px] text-muted">
                {fmtRange(focus.starts_at, focus.ends_at)}
                {current ? ` · ends ${untilLabel(new Date(endOf(focus)).toISOString(), now)}` : ` · ${untilLabel(focus.starts_at, now)}`}
                {f.o ? ` · ${f.open ? `${f.open} on the list` : "nothing on the list yet"}` : focus.location ? ` · ${focus.location}` : ""}
              </p>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
          {timed.length > 0 && (
            <p className="text-[13px] text-muted">
              {timed.length} {timed.length === 1 ? "meeting" : "meetings"} today{left.length ? ` · ${hoursLeft} h left` : ""}
            </p>
          )}
          {f.o ? (
            <Link to={`/people/${f.o.person_id}`} className={pill}>
              Open {f.o.name.split(" ")[0]}'s list
              <Icon name="status_change" size={14} />
            </Link>
          ) : focus.url ? (
            <a href={focus.url} target="_blank" rel="noreferrer" className={pill}>
              Open in Calendar
              <Icon name="external" size={13} />
            </a>
          ) : null}
        </div>
      </div>

      {allDay.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {allDay.map((e) => (
            <span key={e.id} className="rounded-full bg-field px-2.5 py-1 text-[12px] font-medium">
              All day · {e.title}
            </span>
          ))}
        </div>
      )}
      {timed.length > 0 && <DayBar events={timed} oneOnOnes={oneOnOnes} now={now} showSpace={showSpace} />}
    </section>
  );
}

/** Today's meetings as blocks on a line from morning to evening. Overlapping ones get their own row. */
function DayBar({ events, oneOnOnes, now, showSpace }: { events: CalendarEvent[]; oneOnOnes: OneOnOneCard[]; now: number; showSpace: boolean }) {
  const spans = events.map((e) => ({ e, start: minuteOfDay(e.starts_at), end: Math.max(minuteOfDay(e.starts_at) + 20, minuteOfDay(e.starts_at) + minutes(e) || minuteOfDay(e.starts_at) + 30) }));
  // The bar covers 8 to 6 unless a meeting falls outside that.
  const from = Math.min(8 * 60, ...spans.map((s) => Math.floor(s.start / 60) * 60));
  const to = Math.max(18 * 60, ...spans.map((s) => Math.ceil(s.end / 60) * 60));
  const pct = (min: number) => `${((min - from) / (to - from)) * 100}%`;
  // Put each meeting on the first row where it does not overlap the one before it.
  const rowEnds: number[] = [];
  const placed = spans.map((s) => {
    let row = rowEnds.findIndex((end) => end <= s.start);
    if (row < 0) row = rowEnds.length;
    rowEnds[row] = s.end;
    return { ...s, row };
  });
  const rows = Math.min(3, rowEnds.length);
  const nowMin = minuteOfDay(new Date(now).toISOString());
  const hours = [];
  for (let h = Math.ceil(from / 60); h <= to / 60; h += 2) hours.push(h);

  return (
    <div className="mt-5">
      <div className="relative rounded-xl bg-field" style={{ height: rows * 34 + 8 }}>
        {placed
          .filter((s) => s.row < 3)
          .map(({ e, start, end, row }) => {
            const { o, title } = eventTarget(e, oneOnOnes);
            const past = endOf(e) <= now;
            const cls = `press absolute flex items-center overflow-hidden rounded-lg px-2 text-[12px] font-semibold leading-none ${o ? "bg-accent text-on-accent" : "bg-surface text-fg shadow-1"} ${past ? "opacity-40" : "hover:brightness-95"}`;
            const style = { left: pct(start), width: `calc(${((end - start) / (to - from)) * 100}% - 3px)`, top: 4 + row * 34, height: 30 };
            const label = (
              <span className="flex min-w-0 items-center gap-1.5">
                {showSpace && <Sigil scope={e.area} size={7} />}
                <span className="truncate max-sm:hidden">{o ? o.name.split(" ")[0] : title}</span>
              </span>
            );
            const tip = `${title}, ${fmtRange(e.starts_at, e.ends_at)}`;
            return o ? (
              <Link key={e.id} to={`/people/${o.person_id}`} title={tip} className={cls} style={style}>
                {label}
              </Link>
            ) : (
              <a key={e.id} href={e.url ?? undefined} target="_blank" rel="noreferrer" title={tip} className={cls} style={style}>
                {label}
              </a>
            );
          })}
        {nowMin >= from && nowMin <= to && (
          <span className="pointer-events-none absolute -bottom-1 -top-1 w-0.5 rounded-full bg-late" style={{ left: pct(nowMin) }} aria-label="Now" />
        )}
      </div>
      <div className="relative mt-1.5 h-4 text-[11px] font-medium text-faint">
        {hours.map((h) => (
          <span key={h} className="tabular absolute -translate-x-1/2 first:translate-x-0" style={{ left: pct(h * 60) }}>
            {h % 12 || 12}
            {h < 12 ? " AM" : " PM"}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------- morning brief ----------

function Brief({ digest, today }: { digest: NonNullable<HomeData["digest"]>; today: string }) {
  const fresh = digest.run_date === today;
  const [open, setOpen] = usePref(`brief-${digest.run_date}`, false);
  return (
    <section className="tile col-span-12 overflow-hidden">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="press flex min-h-12 w-full items-center gap-2.5 px-4 text-left hover:bg-field">
        <Icon name="sparkle" size={15} className="text-accent" />
        <span className="text-[14px] font-semibold tracking-tight">{fresh ? "This morning's brief" : `Brief from ${fmtDay(digest.run_date)}`}</span>
        {!open && <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{digest.body.replace(/[#*_>`-]/g, "").replace(/\s+/g, " ").trim().slice(0, 140)}</span>}
        <span className="ml-auto text-faint">
          <Chevron open={open} />
        </span>
      </button>
      <Collapse open={open}>
        <div className="px-4 pb-4">
          <Markdown className="brief max-w-[72ch] text-[13px]">{digest.body}</Markdown>
        </div>
      </Collapse>
    </section>
  );
}

// ---------- people ----------

/**
 * Who he meets next, in the order of his next meeting with each. It is any meeting on his
 * calendar that one of his people is in, not only a 1:1. Each row says when, and one quiet word
 * if there is something for it: "1:1 list" when he has put things on the list for their next
 * 1:1, else "Waiting on". No counts: he found figures here overwhelming. People with something open and no meeting in
 * sight come last. The heading opens the People page.
 */
function PeopleCard({ people, today, to }: { people: PersonComingUp[]; today: string; to: string }) {
  const shown = people.slice(0, 7);
  return (
    <Tile title="People" icon="people" tone="soon" to={to} className="col-span-12 lg:col-span-5">
      {shown.map((p) => {
        const n = p.next;
        const isToday = n?.day === today;
        const when = n ? `${isToday ? "Today" : `${fmtWeekday(n.day).slice(0, 3)} ${Number(n.day.slice(8))}`}${n.starts_at ? `, ${fmtClock(n.starts_at)}` : ""}` : "";
        return (
          <Link key={p.id} to={`/people/${p.id}`} className="press flex min-h-12 items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-field">
            <Avatar person={p} size={30} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium">{p.name}</span>
              <span className="block truncate text-[12px] text-faint">
                {n ? (
                  <>
                    <span className={isToday ? "font-semibold text-accent" : "text-muted"}>{when}</span>
                    {!n.one_on_one && ` · ${n.title}`}
                  </>
                ) : (
                  "No meeting scheduled"
                )}
              </span>
            </span>
            {p.discuss > 0 ? <Chip tone="accent">1:1 list</Chip> : p.theirs > 0 ? <Chip tone="wait">Waiting on</Chip> : null}
          </Link>
        );
      })}
      {!people.length && <Empty className="px-2">No meetings with your people in the next two weeks.</Empty>}
      {people.length > shown.length && (
        <Link to={to} className="press block rounded-xl px-2 py-1.5 text-[12px] font-medium text-faint hover:bg-field hover:text-fg">
          and {people.length - shown.length} more
        </Link>
      )}
    </Tile>
  );
}

// ---------- due, and projects ----------

/**
 * The only tasks the dashboard lists: the ones with a due date, soonest first (late ones
 * lead), from now through the next two weeks. A project with a due date in that time is a row
 * here too. He checks tasks off here; he adds and plans through his chatbot, so there is no
 * line to add one. The heading opens the Tasks page, where everything else is.
 */
function DueCard({ tasks, projects, today, to, showSpace }: { tasks: TaskItem[]; projects: ProjectCard[]; today: string; to: string; showSpace: boolean }) {
  const until = addDaysYmd(today, 14);
  const rows = [
    ...tasks.filter((t) => t.due_date! <= until).map((t) => ({ date: t.due_date!, key: t.id, task: t, project: null as ProjectCard | null })),
    ...projects.filter((p) => p.due_date! <= until).map((p) => ({ date: p.due_date!, key: p.id, task: null as TaskItem | null, project: p })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const shown = rows.slice(0, 10);
  const rest = tasks.length + projects.length - shown.length;
  return (
    <Tile title="Due" icon="task" tone="ok" count={rows.length || null} to={to} className="col-span-12 lg:col-span-7">
      {shown.map((r) => {
        if (r.task) return <TaskRow key={r.key} t={r.task} showSpace={showSpace} dense />;
        const due = dueLabel(r.date);
        return (
          <Link key={r.key} to={`/projects/${r.project!.id}`} className="press flex min-h-9 items-center gap-2.5 rounded-xl px-2 py-1 hover:bg-field">
            <span className="flex size-[18px] shrink-0 items-center justify-center text-faint">
              <Icon name="projects" size={14} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[14px]">{r.project!.title}</span>
            <span className="shrink-0 text-[12px] text-faint">Project</span>
            {due && <Chip tone={due.tone === "late" ? "late" : due.tone === "soon" ? "soon" : "idle"}>{due.text}</Chip>}
            <span className="size-8 shrink-0" />
          </Link>
        );
      })}
      {!rows.length && <Empty className="px-2">Nothing is due in the next two weeks.</Empty>}
      {rest > 0 && (
        <Link to={to} className="press block rounded-xl px-2 py-1.5 text-[12px] font-medium text-faint hover:bg-field hover:text-fg">
          and {rest} due later
        </Link>
      )}
    </Tile>
  );
}

// ---------- the next two weeks ----------

/** One meeting in a day's list. A 1:1 opens that person's page; anything else opens Google Calendar. */
function EventRow({ e, oneOnOnes, showSpace }: { e: CalendarEvent; oneOnOnes: OneOnOneCard[]; showSpace: boolean }) {
  const { o, open, title } = eventTarget(e, oneOnOnes);
  const body = (
    <>
      <span className="tabular w-[116px] shrink-0 whitespace-nowrap text-[12px] font-medium text-muted">{e.all_day ? "All day" : fmtRange(e.starts_at, e.ends_at)}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {showSpace && <Sigil scope={e.area} size={8} />}
          <span className="truncate text-[13px] font-medium">{title}</span>
        </span>
        {(o || e.location) && <span className="block truncate text-[12px] text-faint">{o ? (open ? `${open} on the list` : "Nothing on the list yet") : e.location}</span>}
      </span>
      <Icon name={o ? "people" : "external"} size={13} className="shrink-0 text-faint" />
    </>
  );
  const cls = "press flex min-h-11 items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-field";
  if (o) return <Link to={`/people/${o.person_id}`} className={cls}>{body}</Link>;
  return <a href={e.url ?? undefined} target="_blank" rel="noreferrer" className={cls}>{body}</a>;
}

const UP_ICON: Record<UpcomingItem["kind"], { icon: string; tone: string }> = {
  task: { icon: "task", tone: "ok" },
  project: { icon: "projects", tone: "accent" },
  one_on_one: { icon: "people", tone: "soon" },
};

/**
 * The next two weeks: one row of days. Each day shows a dot for every dated thing and a bar
 * for how much of the day is meetings. Pick a day to see its meetings and what is due; with no
 * day picked there is only the row (the Due and People cards already say what is coming).
 */
function NextTwoWeeks({ items, events, oneOnOnes, today, showSpace }: { items: UpcomingItem[]; events: CalendarEvent[]; oneOnOnes: OneOnOneCard[]; today: string; showSpace: boolean }) {
  const [day, setDay] = useState<string | null>(null);
  const days = Array.from({ length: 14 }, (_, i) => addDaysYmd(today, i));
  const dayEvents = day ? events.filter((e) => e.day === day) : [];
  // On a chosen day the calendar shows the 1:1s itself, so the same meeting is not listed twice.
  const list = day ? items.filter((i) => i.date === day && !(i.personId && dayEvents.some((e) => e.person_id === i.personId))) : items;
  return (
    <Tile
      title="Next two weeks"
      icon="calendar"
      tone="wait"
      className="col-span-12"
      right={
        day ? (
          <button type="button" className="press rounded-lg px-2 py-1 font-medium hover:bg-field hover:text-fg" onClick={() => setDay(null)}>
            Close
          </button>
        ) : (
          "Pick a day"
        )
      }
    >
      <div>
        <div className="grid grid-cols-7 gap-1 px-1 pb-1 md:grid-cols-[repeat(14,minmax(0,1fr))]">
          {days.map((d) => {
            const here = items.filter((i) => i.date === d);
            const meetings = events.filter((e) => e.day === d && !e.all_day);
            const load = Math.min(1, meetings.reduce((n, e) => n + minutes(e), 0) / 480); // of an eight-hour day
            const weekend = [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay());
            return (
              <button
                key={d}
                type="button"
                aria-pressed={day === d}
                title={meetings.length ? `${meetings.length} ${meetings.length === 1 ? "meeting" : "meetings"}, ${Math.round(load * 8 * 2) / 2} h` : undefined}
                onClick={() => setDay(day === d ? null : d)}
                className={`press flex h-[66px] flex-col items-center justify-center gap-0.5 rounded-xl ${day === d ? "bg-accent text-on-accent" : d === today ? "bg-accent-soft" : "hover:bg-field"} ${weekend && day !== d ? "opacity-50" : ""}`}
              >
                <span className="text-[10px] font-semibold uppercase tracking-wider opacity-70">{fmtWeekday(d).slice(0, 2)}</span>
                <span className="tabular text-[14px] font-semibold leading-none">{Number(d.slice(8))}</span>
                <span className="flex h-1.5 gap-0.5">
                  {here.slice(0, 4).map((i) => (
                    <i key={i.key} className="size-1.5 rounded-full" style={{ background: day === d ? "currentColor" : `var(--${UP_ICON[i.kind].tone})` }} />
                  ))}
                </span>
                <span className="day-load" aria-hidden>
                  <i style={{ width: `${load * 100}%`, background: day === d ? "currentColor" : undefined }} />
                </span>
              </button>
            );
          })}
        </div>

        <Collapse open={!!day}>
          {day && (
        <div className="min-w-0 pt-2">
          <p className="px-2 pb-1 text-[12px] font-semibold text-muted">{day === today ? "Today" : `${fmtWeekday(day)}, ${fmtDay(day)}`}</p>
          {dayEvents.map((e) => (
            <EventRow key={e.id} e={e} oneOnOnes={oneOnOnes} showSpace={showSpace} />
          ))}
          <ul>
            {list.slice(0, 20).map((i) => (
              <li key={i.key} className="min-w-0">
                <Link to={i.to} className="press flex min-h-11 items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-field">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg" style={{ color: `var(--${i.late ? "late" : UP_ICON[i.kind].tone})`, background: `color-mix(in srgb, var(--${i.late ? "late" : UP_ICON[i.kind].tone}) 13%, transparent)` }}>
                    <Icon name={UP_ICON[i.kind].icon} size={13} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-[13px] font-medium">{i.title}</span>
                    <span className="block truncate text-[12px] text-faint">{i.sub}</span>
                  </span>
                  <span className={`tabular shrink-0 text-right text-[12px] font-medium ${i.late ? "text-late" : "text-muted"}`}>
                    {i.estimate ? "~" : ""}
                    {i.date === today ? "Today" : `${fmtWeekday(i.date).slice(0, 3)} ${Number(i.date.slice(8))}`}
                    {i.startsAt && <span className="block font-normal text-faint">{fmtClock(i.startsAt)}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {!list.length && !dayEvents.length && <Empty className="px-2">Nothing on this day.</Empty>}
        </div>
          )}
        </Collapse>
      </div>
    </Tile>
  );
}
