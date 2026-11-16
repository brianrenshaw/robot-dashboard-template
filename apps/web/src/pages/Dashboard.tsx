// Dashboard.tsx
// The dashboard: the morning brief and today's log (one line each until opened), then the
// planner: his week or one day as time blocks, and the board under it (components/Planner.tsx).
// The same page serves the overview of all three desks (/) and each desk on its own; a desk
// shows only its own tasks, meetings and blocks.
//
// How it got here (2026-11-15). The three-card dashboard (Due, People, Next two weeks) was "too
// stock". A line of meetings carrying their tasks followed, then a task list beside it, which
// he rejected twice. He then asked for time blocking after Cal Newport, a board "like a
// whiteboard", rows that are "horizontal with a toggle", "rows of four or something so it's not
// as much scrolling", a New sidebar that everything defaults into "unless it's explicitly
// waiting to hear back", a way to check things off, and a week or day view. That is this page.

import { Link } from "react-router-dom";
import { useHome, type DailyLog, type HomeData } from "../api";
import { DayLog, logPreview } from "../components/DayLog";
import { Planner } from "../components/Planner";
import { PageHeader } from "../components/Shell";
import { Chevron, Collapse, ErrorNote, Icon, Markdown, Spinner } from "../components/ui";
import { fmtDay, longToday } from "../lib/time";
import { usePref, useScope } from "../spaces";

export function Dashboard() {
  const { scope, space } = useScope();
  const { data, error, isLoading } = useHome();
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorNote error={error} />;
  const all = scope === "all";
  return (
    <>
      <PageHeader tinted={!all} title={all ? longToday() : space.label} summary={all ? undefined : longToday()} />
      {(data.digest || data.log?.day === data.today) && (
        <div className="mb-4 grid grid-cols-12 gap-3 md:gap-4">
          {data.digest && <Brief digest={data.digest} today={data.today} />}
          {data.log?.day === data.today && <TodaysLog log={data.log} />}
        </div>
      )}
      {!data.calendar_connected && data.calendar.length === 0 && (
        <p className="mb-3 px-1 text-[13px] text-muted">
          No calendar connected.{" "}
          <Link to="/settings" className="press font-medium text-accent">
            Connect one in Settings
          </Link>{" "}
          to see your meetings on the week.
        </p>
      )}
      <Planner data={data} scope={scope} />
    </>
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

// ---------- today's log ----------

/**
 * The day as his chatbot logged it, one line until opened. It is here only on the day itself;
 * every earlier day is on the Log page.
 */
function TodaysLog({ log }: { log: DailyLog }) {
  const [open, setOpen] = usePref(`log-${log.day}`, false);
  return (
    <section className="tile col-span-12 overflow-hidden">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="press flex min-h-12 w-full items-center gap-2.5 px-4 text-left hover:bg-field">
        <Icon name="digest" size={15} className="text-muted" />
        <span className="text-[14px] font-semibold tracking-tight">Today's log</span>
        {!open && <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{logPreview(log)}</span>}
        <span className="ml-auto text-faint">
          <Chevron open={open} />
        </span>
      </button>
      <Collapse open={open}>
        <div className="px-4 pb-4 pt-1">
          <DayLog log={log} />
          <Link to="/log" className="press mt-3 inline-block text-[13px] text-muted hover:text-fg">
            Earlier days
          </Link>
        </div>
      </Collapse>
    </section>
  );
}
