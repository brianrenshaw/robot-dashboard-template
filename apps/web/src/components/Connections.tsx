// Connections.tsx
// What the site reads by itself, on the Settings page: Google Calendar, one account per desk.
// (It used to read Gmail and Granola too; the owner had those switched off.) Keys typed here are sent
// once to the server, stored encrypted, and never shown again; the page only ever sees whether
// a key is saved and its last four characters.

import { useEffect, useState } from "react";
import { api, toast, useConnections, useWrite, type ConnectionsInfo, type GoogleAccount, type SecretInfo, type SyncReport } from "../api";
import { ago } from "../lib/time";
import { DESKS, Sigil } from "../spaces";
import { TextInput } from "./fields";
import { MoreMenu } from "./Popover";
import { Button, Chevron, Collapse, ErrorNote, Spinner } from "./ui";

const linkButton = "press inline-flex h-8 shrink-0 items-center rounded-[10px] bg-surface px-3 text-[13px] font-medium text-fg shadow-1 hover:bg-raised";

/** After Google sends the owner back, the address says how it went. Say so once, then tidy the address. */
function useSignInResult() {
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const connected = q.get("connected");
    const failed = q.get("connect_error");
    if (!connected && !failed) return;
    toast(connected ? { text: `Connected ${connected}. Its calendar is loading now.` } : { text: failed!, tone: "error" });
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
}

export function Connections() {
  const { data, error, isLoading } = useConnections();
  useSignInResult();
  const sync = useWrite(
    () => api.post<SyncReport>("/api/sync"),
    undefined,
    (r) => toast(syncSummary(r)),
  );
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorNote error={error} />;
  const has = (key: SecretInfo["key"]) => !!data.secrets.find((s) => s.key === key)?.set;
  const googleReady = has("google_client_id") && has("google_client_secret");

  return (
    <>
      {!data.ready && <p className="px-5 py-3 text-[13px] text-late">Connections are switched off: the main Worker has no CONNECTIONS_KEY secret, so nothing can be saved yet.</p>}

      <div className="px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Google Calendar</p>
            <p className="max-w-[60ch] text-[12px] text-faint">
              One account per desk. The site reads each calendar every half hour so the dashboard can show your meetings. It cannot change your calendar and does not read your mail.
            </p>
          </div>
          <Button size="sm" disabled={sync.isPending} onClick={() => sync.mutate(undefined)}>
            {sync.isPending ? "Syncing…" : "Sync now"}
          </Button>
        </div>
        <div className="mt-3 space-y-1.5">
          {DESKS.map((d) => (
            <DeskAccounts key={d.id} area={d.id} label={d.label} accounts={data.google.filter((g) => g.area === d.id)} canConnect={data.ready && googleReady} />
          ))}
        </div>
        <GoogleSetup info={data} done={googleReady} />
      </div>

    </>
  );
}

function syncSummary(r: SyncReport): { text: string; tone?: "error" } {
  const failed = r.calendar.find((x) => x.error);
  if (failed) return { text: `${failed.account}: ${failed.error}`, tone: "error" };
  if (!r.calendar.length) return { text: "No calendar is connected yet." };
  return { text: `Synced. ${r.calendar.reduce((n, c) => n + (c.events ?? 0), 0)} calendar events in the next four weeks.` };
}

/** One desk's row: the Google account connected to it, or a button to connect one. */
function DeskAccounts({ area, label, accounts, canConnect }: { area: GoogleAccount["area"]; label: string; accounts: GoogleAccount[]; canConnect: boolean }) {
  const move = useWrite(({ email, to }: { email: string; to: GoogleAccount["area"] }) => api.patch(`/api/connections/google/${encodeURIComponent(email)}`, { area: to }));
  const disconnect = useWrite(
    (email: string) => api.del(`/api/connections/google/${encodeURIComponent(email)}`),
    undefined,
    (_r, email) => toast({ text: `Disconnected ${email}. To remove the site's access at Google too, open myaccount.google.com/permissions.` }),
  );
  const start = `/api/connections/google/start?area=${area}`;
  return (
    <div data-tint={area} className="rounded-xl bg-field px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <Sigil scope={area} size={10} />
        <span className="w-28 shrink-0 text-[13px] font-semibold">{label}</span>
        {!accounts.length && <span className="min-w-0 flex-1 truncate text-[13px] text-faint max-sm:invisible">Not connected</span>}
        {!accounts.length &&
          (canConnect ? (
            <a href={start} className={linkButton}>
              Connect Google
            </a>
          ) : (
            <span className="text-[12px] text-faint">Set up sign-in below first</span>
          ))}
        {accounts.length > 0 && <span className="flex-1" />}
        {accounts.length > 0 && canConnect && (
          <a href={start} className="press rounded-lg px-2 py-1 text-[12px] font-medium text-muted hover:bg-surface hover:text-fg">
            Add another
          </a>
        )}
      </div>
      {accounts.map((a) => (
        <div key={a.email} className="mt-1.5 flex items-center gap-2 pl-[22px]">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{a.email}</p>
            {a.last_error ? (
              <p className="text-[12px] text-late">{a.last_error}</p>
            ) : (
              <p className="truncate text-[12px] text-faint">
                {a.calendar_synced_at ? `Calendar read ${ago(a.calendar_synced_at)}` : "Calendar not read yet"}
              </p>
            )}
          </div>
          {a.last_error && (
            <a href={start} className={linkButton}>
              Reconnect
            </a>
          )}
          <MoreMenu
            label={`Actions for ${a.email}`}
            items={[
              ...DESKS.filter((d) => d.id !== area).map((d) => ({ label: `Move to ${d.label}`, onClick: () => move.mutate({ email: a.email, to: d.id }) })),
              { label: "Disconnect", danger: true, onClick: () => disconnect.mutate(a.email) },
            ]}
          />
        </div>
      ))}
    </div>
  );
}

/** The one-time Google sign-in setup. Open until it is done, then folded away. */
function GoogleSetup({ info, done }: { info: ConnectionsInfo; done: boolean }) {
  const [open, setOpen] = useState(!done);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(info.redirect_uri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast({ text: "Your browser blocked copying.", tone: "info" });
    }
  };
  const secret = (key: SecretInfo["key"]) => info.secrets.find((s) => s.key === key)!;
  return (
    <div className="mt-3">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="press flex items-center gap-1.5 rounded-lg py-1 text-[13px] font-medium text-muted hover:text-fg">
        <Chevron open={open} />
        {done ? "Google sign-in is set up" : "Set up Google sign-in (one time, about ten minutes)"}
      </button>
      <Collapse open={open}>
        <div className="pt-2">
          <p className="max-w-[62ch] text-[13px] text-muted">
            Google only lets a site read your calendar through a sign-in client that you own. You make it once; all three accounts then use it.
          </p>
          <ol className="mt-2 max-w-[62ch] list-decimal space-y-1.5 pl-5 text-[13px] text-muted">
            <li>
              Open{" "}
              <a className="font-medium text-accent hover:underline" href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">
                console.cloud.google.com
              </a>{" "}
              with your personal Gmail account and create a project (any name).
            </li>
            <li>In APIs &amp; Services, Library, turn on the Google Calendar API.</li>
            <li>In Google Auth Platform, fill in Branding (a name and your email). Under Audience choose External, then press Publish app so sign-ins do not expire after a week.</li>
            <li>Under Clients, create a client of type Web application. Add this as an authorized redirect URI:</li>
          </ol>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="field min-w-0 flex-1 truncate font-mono !text-[12px] text-muted">{info.redirect_uri}</code>
            <Button size="sm" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="mt-3 text-[13px] text-muted">Then paste the two values Google gives you:</p>
          <SecretField info={secret("google_client_id")} label="Client ID" placeholder="…apps.googleusercontent.com" disabled={!info.ready} />
          <SecretField info={secret("google_client_secret")} label="Client secret" placeholder="GOCSPX-…" disabled={!info.ready} />
          <p className="mt-3 max-w-[62ch] text-[12px] text-faint">
            When you connect an account, Google will warn that the app is not verified. That is expected for a private app: choose Advanced, then continue. If the work account is refused, your organization's Google
            administrator has to allow the client ID above.
          </p>
        </div>
      </Collapse>
    </div>
  );
}

/** A key that can be saved or replaced but never read back. */
function SecretField({ info, label, placeholder, disabled }: { info: SecretInfo; label: string; placeholder: string; disabled?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const save = useWrite(
    (v: string) => api.put(`/api/connections/secrets/${info.key}`, { value: v }),
    undefined,
    () => {
      setValue("");
      setEditing(false);
      toast({ text: `${label} saved.` });
    },
  );
  const remove = useWrite(() => api.del(`/api/connections/secrets/${info.key}`), undefined, () => toast({ text: `${label} removed.` }));
  if (info.set && !editing) {
    return (
      <div className="mt-2 flex min-h-9 flex-wrap items-center gap-2">
        <span className="w-28 shrink-0 text-[13px] text-muted">{label}</span>
        <span className="tabular min-w-0 flex-1 truncate text-[13px]">{info.key === "google_client_id" ? `Saved: ${info.hint}` : `Saved, ends in ${info.hint}`}</span>
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          Replace
        </Button>
        <Button size="sm" variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(undefined)}>
          Remove
        </Button>
      </div>
    );
  }
  const submit = () => {
    if (value.trim()) save.mutate(value.trim());
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="w-28 shrink-0 text-[13px] text-muted">{label}</span>
      <div className="min-w-40 flex-1">
        <TextInput autoFocus={editing} type="password" autoComplete="off" aria-label={label} placeholder={placeholder} value={value} disabled={disabled} onChange={(e) => setValue(e.target.value)} onEnter={submit} />
      </div>
      <Button size="sm" variant="tonal" disabled={disabled || !value.trim() || save.isPending} onClick={submit}>
        {save.isPending ? "Saving…" : "Save"}
      </Button>
      {editing && (
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      )}
    </div>
  );
}
