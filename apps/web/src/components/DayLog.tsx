// DayLog.tsx
// One day of the daily log, as it reads: the day written up by his chatbot at its end, then
// the things he said he did, in his own words. Used on the Log page and under "Today's log" on
// the dashboard. There is nothing to edit here: he changes the log by telling his chatbot.

import type { DailyLog } from "../api";
import { Markdown } from "./ui";

/** The things he said he did that day, one per line in the record. */
export function notesOf(log: Pick<DailyLog, "notes">): string[] {
  return log.notes.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** One line that stands for the day while it is folded shut. */
export function logPreview(log: DailyLog): string {
  const text = log.body.trim() ? log.body.replace(/[#*_>`]/g, "").replace(/^\s*-\s+/gm, "") : notesOf(log).join(" · ");
  return text.replace(/\s+/g, " ").trim().slice(0, 140);
}

export function DayLog({ log }: { log: DailyLog }) {
  const said = notesOf(log);
  const written = log.body.trim();
  return (
    <div className="max-w-[70ch] text-[14px] leading-relaxed">
      {written && <Markdown className="brief">{written}</Markdown>}
      {said.length > 0 && (
        <div className={written ? "mt-4" : ""}>
          {/* Only labeled when it sits under a write-up; alone, it is simply the day. */}
          {written && <h3 className="tile-title mb-1.5">In your words</h3>}
          {/* The same list styling as the write-up above it (.md), so the two line up. */}
          <div className="md">
            <ul>
              {said.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
