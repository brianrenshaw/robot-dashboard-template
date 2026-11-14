// Settings.tsx: what the site reads (Google Calendar, an OmniFocus export), the
// automations and when they last ran, thresholds, exports, and the addresses other apps use to
// reach the dashboard (MCP and the calendar feed).

import { useEffect, useState } from "react";
import { api, toast, useHome, useMe, useSettings, useWrite } from "../api";
import { Connections } from "../components/Connections";
import { TextInput } from "../components/fields";
import { Button, Card, ErrorNote, Icon, Spinner } from "../components/ui";
import { ago, fmtTime } from "../lib/time";

const AUTOMATIONS: { name: string; label: string; what: string }[] = [
  { name: "morning-brief", label: "Morning brief", what: "Writes the brief at the top of the dashboard from your calendar, due dates and what is waiting." },
];

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-[13px] font-semibold text-muted">{title}</h2>
      <Card className="divide-y divide-[var(--line)]">{children}</Card>
      {hint && <p className="mt-2 px-1 text-[12px] text-faint">{hint}</p>}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-3">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {hint && <p className="text-[12px] text-faint">{hint}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2 text-sm text-muted">{children}</div>
    </div>
  );
}

export function SettingsPage() {
  const { data, error, isLoading } = useSettings();
  const { data: me } = useMe();
  const { data: home } = useHome();
  const save = useWrite((patch: Record<string, unknown>) => api.patch("/api/settings", patch));
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorNote error={error} />;
  const runs = home?.runs ?? [];
  const known = new Set(AUTOMATIONS.map((a) => a.name));

  return (
    <div className="mx-auto max-w-2xl">
      <header className="pb-5 pt-4 md:pt-6">
        <h1 className="display text-[26px] md:text-[30px]">Settings</h1>
        {me?.email && <p className="mt-2 text-muted">Signed in as {me.email}</p>}
      </header>

      <div className="space-y-10">
        <Group title="Connections" hint="The calendar is the one thing the site reads by itself. Mail and meeting notes reach the dashboard only when you or your chatbot put them there.">
          <Connections />
          <OmniFocusRow />
        </Group>

        <Group title="Automations" hint="A scheduled Claude task that runs on your Claude subscription.">
          {AUTOMATIONS.map((a) => {
            const run = runs.find((r) => r.name === a.name);
            return (
              <div key={a.name} className="flex items-start gap-3.5 px-5 py-4">
                <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${run ? "bg-accent-soft text-accent" : "bg-field text-faint"}`}>
                  <Icon name="sparkle" size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{a.label}</p>
                  <p className="text-[13px] text-muted">{a.what}</p>
                  <p className="mt-1 text-[12px] text-faint" title={run ? fmtTime(run.ran_at) : undefined}>
                    {run ? `Last ran ${ago(run.ran_at)}${run.summary ? `: ${run.summary}` : ""}` : "Has not run yet."}
                  </p>
                </div>
              </div>
            );
          })}
          {runs
            .filter((r) => !known.has(r.name))
            .map((r) => (
              <Row key={r.id} label={r.name.replace(/-/g, " ")} hint={r.summary}>
                {ago(r.ran_at)}
              </Row>
            ))}
        </Group>

        <Group title="Thresholds">
          <Row label="A project goes quiet after">
            <NumberBox value={data.stale_days} onSave={(v) => save.mutate({ stale_days: v })} label="Days until a project goes quiet" />
            days
          </Row>
          <Row label="Count something as due soon within">
            <NumberBox value={data.due_soon_days} onSave={(v) => save.mutate({ due_soon_days: v })} label="Days ahead that count as due soon" />
            days
          </Row>
          <Row label="Time zone">{data.timezone}</Row>
        </Group>

        <Group title="Export" hint="A nightly backup also lands in the GitHub repo.">
          <Row label="Everything as JSON">
            <a href="/api/export.json" className="press inline-flex h-8 items-center rounded-[10px] bg-surface px-3 text-[13px] font-medium text-fg shadow-1 hover:bg-raised">
              Download
            </a>
          </Row>
          <Row label="Offline page" hint="One HTML file you can open without a connection.">
            <a href="/api/export.html" className="press inline-flex h-8 items-center rounded-[10px] bg-surface px-3 text-[13px] font-medium text-fg shadow-1 hover:bg-raised">
              Download
            </a>
          </Row>
        </Group>

        <Group title="For other apps">
          <Endpoint label="MCP endpoint" hint="For Claude Code and scripts, with the bearer token. Chat apps sign in instead." url={me?.mcp_url ?? null} tokenMasked={me?.mcp_token_masked ?? null} tokenField="mcp_token" />
          <Endpoint label="Calendar feed" hint="Subscribe in Apple Calendar or Google Calendar to see due dates." url={me?.calendar_url ?? null} tokenMasked={me?.ics_token_masked ?? null} tokenField="ics_token" tokenInUrl />
        </Group>
      </div>
    </div>
  );
}

function OmniFocusRow() {
  const load = useWrite(
    (data: unknown) => api.post<{ people_added: number; one_on_ones: number; items_added: number; items_closed: number }>("/api/import/omnifocus", data),
    undefined,
    (r) => toast({ text: `OmniFocus: ${r.items_added} items added, ${r.items_closed} checked off, ${r.one_on_ones} new 1:1s.` }),
  );
  return (
    <Row label="OmniFocus 1:1 lists" hint="OmniFocus has no web connection, so its lists come in from an export file. New items are added and finished ones are checked off. Nothing is duplicated.">
      <label className={`press inline-flex h-8 cursor-pointer items-center rounded-[10px] bg-surface px-3 text-[13px] font-medium text-fg shadow-1 hover:bg-raised ${load.isPending ? "opacity-50" : ""}`}>
        {load.isPending ? "Loading…" : "Choose file"}
        <input
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            try {
              load.mutate(JSON.parse(await file.text()));
            } catch {
              toast({ text: "That file is not an OmniFocus export.", tone: "info" });
            }
          }}
        />
      </label>
    </Row>
  );
}

function NumberBox({ value, onSave, label }: { value: number; onSave: (v: number) => void; label: string }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number(draft);
    if (Number.isInteger(n) && n > 0 && n !== value) onSave(n);
    else setDraft(String(value));
  };
  return (
    <div className="w-16">
      <TextInput type="number" min={1} aria-label={label} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onEnter={() => (document.activeElement as HTMLElement | null)?.blur()} className="text-right" />
    </div>
  );
}

function Endpoint({ label, hint, url, tokenMasked, tokenField, tokenInUrl = false }: { label: string; hint: string; url: string | null; tokenMasked: string | null; tokenField: "mcp_token" | "ics_token"; tokenInUrl?: boolean }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (what: "url" | "token") => {
    try {
      const me = await api.get<Record<string, string | null>>("/api/me?reveal=1");
      const token = me[tokenField];
      const text = what === "token" ? token ?? "" : tokenInUrl && token ? `${url}?token=${token}` : url ?? "";
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      toast({ text: "Your browser blocked copying.", tone: "info" });
    }
  };
  return (
    <div className="space-y-2.5 px-5 py-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-[12px] text-faint">{hint}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <code className="field min-w-0 flex-1 truncate font-mono !text-[12px] text-muted">{url ? (tokenInUrl ? `${url}?token=${tokenMasked ?? "…"}` : url) : "Not configured"}</code>
        <Button size="sm" disabled={!url} onClick={() => copy("url")}>
          {copied === "url" ? "Copied" : "Copy address"}
        </Button>
        {!tokenInUrl && (
          <Button size="sm" disabled={!tokenMasked} onClick={() => copy("token")}>
            {copied === "token" ? "Copied" : tokenMasked ? "Copy token" : "No token set"}
          </Button>
        )}
      </div>
    </div>
  );
}
