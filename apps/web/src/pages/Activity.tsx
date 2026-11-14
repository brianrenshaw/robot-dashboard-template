// Activity.tsx: every change, by the owner or by an AI, in plain language, with Undo on each row.

import { Link } from "react-router-dom";
import { api, useAudit, useWrite, type AuditView } from "../api";
import { Button, Empty, ErrorNote, Icon, Spinner } from "../components/ui";
import { fmtClock } from "../lib/time";

function dayKey(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric" });
}

export function Activity() {
  const { data, error, isLoading } = useAudit(200);
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorNote error={error} />;
  const groups: { day: string; rows: AuditView[] }[] = [];
  for (const r of data) {
    const day = dayKey(r.at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(r);
    else groups.push({ day, rows: [r] });
  }
  return (
    <div className="mx-auto max-w-3xl">
      <header className="pb-5 pt-4 md:pt-6">
        <h1 className="display text-[26px] md:text-[30px]">Activity</h1>
        <p className="mt-2 text-muted">Every change, yours or an AI's. Any of them can be undone.</p>
      </header>
      {!data.length && <Empty>No changes yet.</Empty>}
      <div className="space-y-8">
        {groups.map((g) => (
          <section key={g.day}>
            <h2 className="mb-1 px-2 text-[13px] font-semibold text-muted">{g.day}</h2>
            <ul>
              {g.rows.map((r) => (
                <Row key={r.id} r={r} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function Row({ r }: { r: AuditView }) {
  const undo = useWrite(() => api.post(`/api/audit/${r.id}/undo`));
  const isAi = r.actor.startsWith("mcp:");
  return (
    <li className={`group flex min-h-10 items-center gap-3 rounded-xl px-2 hover:bg-field ${r.undone_at ? "opacity-50" : ""}`}>
      <span className="flex size-5 shrink-0 items-center justify-center text-faint" title={isAi ? "Changed by an AI" : undefined}>
        {isAi ? <Icon name="sparkle" size={14} className="text-accent" /> : <span className="size-1.5 rounded-full bg-[var(--faint)]" />}
      </span>
      <div className="min-w-0 flex-1 py-1.5 text-sm">
        {r.link ? (
          <Link to={r.link} className="press hover:text-accent">
            {r.summary}
          </Link>
        ) : (
          <span>{r.summary}</span>
        )}
      </div>
      <span className="tabular shrink-0 text-[12px] text-faint">{fmtClock(r.at)}</span>
      <span className="flex w-16 shrink-0 justify-end">
        {r.undone_at ? (
          <span className="text-[12px] text-faint">Undone</span>
        ) : r.can_undo ? (
          <Button size="sm" variant="ghost" disabled={undo.isPending} onClick={() => undo.mutate(undefined)} className="opacity-60 group-hover:opacity-100">
            Undo
          </Button>
        ) : null}
      </span>
    </li>
  );
}
