// DayLog.tsx
// One day of the daily log, as it reads: the day written up by his chatbot at its end, then
// anything he said he did that the write-up does not cover yet. Used on the Log page and under
// "Today's log" on the dashboard. There is nothing to edit here: he changes the log by telling
// his chatbot.
//
// Nothing is listed twice (2026-11-16: "I just don't want duplicated line items"). The
// write-up folds his own notes in, so only the notes he added after it was saved show beneath
// it (`notes_folded` counts the ones it covers). A day with no write-up is simply his notes.

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
  const written = log.body.trim();
  const said = written ? notesOf(log).slice(log.notes_folded ?? 0) : notesOf(log);
  return (
    <div className="max-w-[70ch] text-[14px] leading-relaxed">
      {/* A heading in a write-up is the name of a piece of work (a project), so it reads as a name. */}
      {written && <Markdown className="daylog">{written}</Markdown>}
      {said.length > 0 && (
        <div className={written ? "mt-4" : ""}>
          {/* Only labeled when it sits under a write-up; alone, it is simply the day. */}
          {written && <h3 className="tile-title mb-1.5">Added later</h3>}
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
