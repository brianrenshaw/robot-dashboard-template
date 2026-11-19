// Log.tsx
// The daily log, for reading back. It works like a journal app (Day One was his example,
// 2026-11-19: "you have entries and being able to tap them to see the whole thing, a today
// button, a calendar button to see past things, and a search"):
//
//   - a list of days, newest first, under their months; each is its date, its first line and
//     the start of the rest
//   - tapping a day opens the whole of it: beside the list on a wide screen, in place of the
//     list on a phone (with a way back)
//   - Today opens today; the calendar opens a month with the logged days marked; search keeps
//     the days that have every word, and shows the line that matched
//
// The open day is the address's #2026-11-18, so a day can be linked to (search does) and Back
// returns to the list. His chatbot writes the log, so there is no writing box and nothing to
// edit here. A day with nothing logged is not in the list. It is one log for all three desks.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useBlockTally, useDailyLog, useLogDay, useLogDays, type DailyLog } from "../api";
import { DayLog } from "../components/DayLog";
import { TextInput } from "../components/fields";
import { Popover } from "../components/Popover";
import { PageHeader } from "../components/Shell";
import { Button, ErrorNote, Icon, Spinner } from "../components/ui";
import { addMonths, logSummary, markParts, matchLine, monthGrid, monthOf, monthTitle } from "../lib/log";
import { daysBetween, todayYmd } from "../lib/time";

const PAGE = 60;
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const at = (day: string) => new Date(`${day}T12:00:00Z`);

/** "Friday, November 14", with the year only when it is not this year. */
function dayTitle(day: string): string {
  const sameYear = todayYmd().slice(0, 4) === day.slice(0, 4);
  return at(day).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export function Log() {
  const today = todayYmd();
  const nav = useNavigate();
  const { hash } = useLocation();
  const picked = isDay(hash.slice(1)) ? hash.slice(1) : null;

  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  // Search a moment after he stops typing, not on every letter.
  useEffect(() => {
    const t = setTimeout(() => setQ(typed.trim()), 220);
    return () => clearTimeout(t);
  }, [typed]);

  const [limit, setLimit] = useState(PAGE);
  const { data, error, isLoading, isFetching } = useDailyLog(limit, q);
  const { data: logged } = useLogDays();
  // Whether he went through with the time he set aside, over the last four weeks. Said only
  // once he has answered for a block; until then there is nothing to say.
  const { data: tally } = useBlockTally(28);
  const answered = tally ? tally.kept + tally.not_kept : 0;

  // The day that is open: the one in the address, else the newest in the list (a wide screen
  // always has a day open beside the list).
  const shown = picked ?? data?.[0]?.day ?? null;
  const inList = data?.find((l) => l.day === shown);
  const fetched = useLogDay(shown, !!shown && !!data && !inList);
  const entry: DailyLog | null | undefined = inList ?? (shown ? fetched.data : null);

  const open = (day: string) => nav({ hash: day });
  // The days either side of the open one that have a log.
  const days = logged ?? [];
  const earlier = shown ? days.find((d) => d < shown) : undefined;
  const later = shown ? [...days].reverse().find((d) => d > shown) : undefined;

  // The list, under its months.
  const months = useMemo(() => {
    const out: { month: string; logs: DailyLog[] }[] = [];
    for (const l of data ?? []) {
      const m = monthOf(l.day);
      if (out[out.length - 1]?.month === m) out[out.length - 1]!.logs.push(l);
      else out.push({ month: m, logs: [l] });
    }
    return out;
  }, [data]);

  if (isLoading && !data) return <Spinner />;
  if (error || !data) return <ErrorNote error={error} />;
  return (
    <>
      <PageHeader
        title="Log"
        summary={answered > 0 ? `Time blocks in the last four weeks: you did the work in ${tally!.kept} of ${answered}${tally!.something_else ? `, and ${tally!.something_else} went to something else` : ""}` : undefined}
      />
      <div className={`log${picked ? " has-day" : ""}`}>
        <aside className="log-side">
          <div className="log-bar">
            <button type="button" className="log-btn press" aria-pressed={shown === today} onClick={() => open(today)}>
              Today
            </button>
            <CalendarButton logged={days} shown={shown} today={today} onPick={open} />
            <label className="log-search">
              <Icon name="search" size={14} className="text-faint" />
              <TextInput type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search the log" aria-label="Search the log" />
            </label>
          </div>

          {!data.length && <p className="log-none">{q ? `No day mentions “${q}”.` : "Nothing logged yet. Tell your chatbot “log my day” and it shows here."}</p>}
          <nav className="log-list" aria-label="Days">
            {months.map(({ month, logs }) => (
              <section key={month}>
                <h3>{monthTitle(month)}</h3>
                {logs.map((l) => {
                  const s = logSummary(l);
                  const found = q ? matchLine(l, q) : "";
                  return (
                    <Link key={l.day} to={{ hash: l.day }} className={`log-item press${l.day === shown ? " on" : ""}`} aria-current={l.day === shown ? "true" : undefined}>
                      <span className={`log-date${l.day === today ? " today" : ""}`}>
                        <i>{at(l.day).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" })}</i>
                        <b>{Number(l.day.slice(8))}</b>
                      </span>
                      <span className="log-text">
                        <b>{s.title}</b>
                        {found ? (
                          <span>
                            {markParts(found, q).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : p.text))}
                          </span>
                        ) : (
                          s.rest && <span>{s.rest}</span>
                        )}
                      </span>
                    </Link>
                  );
                })}
              </section>
            ))}
          </nav>
          {data.length >= limit && (
            <div className="pt-3">
              <Button variant="ghost" size="sm" disabled={isFetching} onClick={() => setLimit(limit + PAGE)}>
                Show earlier days
              </Button>
            </div>
          )}
        </aside>

        <article className="log-entry" key={shown ?? "none"}>
          {shown && (
            <>
              <Link to="/log" className="log-back press">
                <Icon name="back" size={14} /> All days
              </Link>
              <header>
                <div>
                  <h2>{dayTitle(shown)}</h2>
                  {daysBetween(shown, today) <= 1 && daysBetween(shown, today) >= 0 && <span>{shown === today ? "Today" : "Yesterday"}</span>}
                </div>
                <div className="log-step">
                  <button type="button" className="press" disabled={!earlier} aria-label="The day before" title="The day before" onClick={() => earlier && open(earlier)}>
                    <svg viewBox="0 0 12 12" aria-hidden><path d="M7.5 2.5L4 6l3.5 3.5" /></svg>
                  </button>
                  <button type="button" className="press" disabled={!later} aria-label="The day after" title="The day after" onClick={() => later && open(later)}>
                    <svg viewBox="0 0 12 12" aria-hidden><path d="M4.5 2.5L8 6l-3.5 3.5" /></svg>
                  </button>
                </div>
              </header>
              {entry ? <DayLog log={entry} /> : fetched.isLoading ? null : <p className="log-none">Nothing logged for {shown === today ? "today yet" : "this day"}.</p>}
            </>
          )}
        </article>
      </div>
    </>
  );
}

// ---------- the calendar: a month, with the days that have a log ----------

function CalendarButton({ logged, shown, today, onPick }: { logged: string[]; shown: string | null; today: string; onPick: (day: string) => void }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(monthOf(shown ?? today));
  // Open on the month of the day he is reading.
  useEffect(() => {
    if (open) setMonth(monthOf(shown ?? today));
  }, [open]);
  const has = useMemo(() => new Set(logged), [logged]);
  const oldest = logged.length ? monthOf(logged[logged.length - 1]!) : monthOf(today);
  return (
    <>
      <button ref={anchor} type="button" className="log-btn press" aria-label="Pick a day from the calendar" title="Pick a day" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="calendar" size={15} />
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={264} label="Pick a day">
        <div className="log-cal">
          <div className="head">
            <button type="button" className="press" aria-label="The month before" disabled={month <= oldest} onClick={() => setMonth(addMonths(month, -1))}>
              <svg viewBox="0 0 12 12" aria-hidden><path d="M7.5 2.5L4 6l3.5 3.5" /></svg>
            </button>
            <b>{monthTitle(month)}</b>
            <button type="button" className="press" aria-label="The month after" disabled={month >= monthOf(today)} onClick={() => setMonth(addMonths(month, 1))}>
              <svg viewBox="0 0 12 12" aria-hidden><path d="M4.5 2.5L8 6l-3.5 3.5" /></svg>
            </button>
          </div>
          <div className="grid" role="grid" aria-label={monthTitle(month)}>
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <i key={i} aria-hidden>{d}</i>
            ))}
            {monthGrid(month).flat().map((d, i) =>
              d ? (
                // A day with a log opens it. A day without one has nothing to open.
                <button key={d} type="button" className={`press${d === shown ? " on" : ""}${d === today ? " today" : ""}`} disabled={!has.has(d)} aria-label={`${dayTitle(d)}${has.has(d) ? "" : ", nothing logged"}`} onClick={() => { onPick(d); setOpen(false); }}>
                  {Number(d.slice(8))}
                </button>
              ) : (
                <span key={`x${i}`} />
              ),
            )}
          </div>
        </div>
      </Popover>
    </>
  );
}
