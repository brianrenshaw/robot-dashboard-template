// Log.tsx
// The daily log: what he worked on, day by day, newest first. It is a page for reading back.
// His chatbot writes it (at the end of the day, and whenever he says "log that I ..."), so
// there is no writing box and nothing to edit. A day with nothing logged is simply not here.

import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useDailyLog } from "../api";
import { DayLog } from "../components/DayLog";
import { Button, Empty, ErrorNote, Spinner } from "../components/ui";
import { daysBetween, todayYmd } from "../lib/time";

const PAGE = 30;

/** "Friday, November 14", with the year only when it is not this year. */
function dayTitle(day: string): string {
  const sameYear = todayYmd().slice(0, 4) === day.slice(0, 4);
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export function Log() {
  const [limit, setLimit] = useState(PAGE);
  const { data, error, isLoading, isFetching } = useDailyLog(limit);
  const { hash } = useLocation();
  // Arriving from search (/log#2026-11-14): bring that day to the top.
  useEffect(() => {
    if (data && hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [hash, data]);

  if (isLoading && !data) return <Spinner />;
  if (error || !data) return <ErrorNote error={error} />;
  const today = todayYmd();
  return (
    <div className="mx-auto max-w-3xl">
      <header className="pb-6 pt-4 md:pt-6">
        <h1 className="display text-[26px] md:text-[30px]">Log</h1>
      </header>
      {!data.length && <Empty>Nothing logged yet. Tell your chatbot “log my day” and it shows here.</Empty>}
      <div className="space-y-10">
        {data.map((log) => {
          const ago = daysBetween(log.day, today);
          return (
            <section key={log.day} id={log.day} className="scroll-mt-20">
              <h2 className="mb-2 flex items-baseline gap-2.5 text-[15px] font-semibold tracking-tight">
                {dayTitle(log.day)}
                {ago <= 1 && <span className="text-[13px] font-normal text-faint">{ago === 0 ? "Today" : "Yesterday"}</span>}
              </h2>
              <DayLog log={log} />
            </section>
          );
        })}
      </div>
      {data.length >= limit && (
        <div className="pt-8">
          <Button variant="ghost" size="sm" disabled={isFetching} onClick={() => setLimit(limit + PAGE * 2)}>
            Show earlier days
          </Button>
        </div>
      )}
    </div>
  );
}
