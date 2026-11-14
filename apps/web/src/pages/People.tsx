// People.tsx: the people on a desk, and one person's page.
// A person's page shows everything you have with them across all desks: what they owe you,
// the projects you share, and every email, meeting and note that involved them.

import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, toast, useHome, usePeople, usePerson, usePersonTasks, useSetOneOnOne, useWrite, type Area, type PersonDetail } from "../api";
import { CheckedOff, OneOnOneTile, PersonLists, RELATIONSHIP, RELATIONSHIP_GROUP } from "../components/OneOnOne";
import { Editable, Field, Picker, TextInput } from "../components/fields";
import { PageHeader } from "../components/Shell";
import { Timeline } from "../components/Timeline";
import { Avatar, Collapse, Empty, ErrorNote, Icon, Section, Spinner } from "../components/ui";
import { ago, fmtClock, fmtDayLong } from "../lib/time";
import { DESKS, Sigil, useScope } from "../spaces";

export function People() {
  const { scope, space } = useScope();
  const { data, error, isLoading } = usePeople();
  const { data: home } = useHome();
  const [q, setQ] = useState("");
  const all = scope === "all";
  const oneOnOnes = (home?.one_on_ones ?? []).filter((o) => all || o.area === null || o.area === scope);
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorNote error={error} />;
  const list = q ? data.filter((p) => `${p.name} ${p.role} ${p.organization}`.toLowerCase().includes(q.toLowerCase())) : data;
  return (
    <>
      <PageHeader
        tinted={!all}
        title={all ? "Everyone" : space.label}
        summary={`${data.length} ${data.length === 1 ? "person" : "people"}`}
        right={
          <div className="w-full sm:w-56">
            <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name or role" aria-label="Filter people" />
          </div>
        }
      />
      {!q &&
        (["manager", "direct", "peer", "other"] as const).map((rel) => {
          const group = oneOnOnes.filter((o) => o.relationship === rel);
          if (!group.length) return null;
          return (
            <section key={rel} className="mb-6">
              <h2 className="tile-title mb-2 px-1">
                1:1s · {RELATIONSHIP_GROUP[rel]} <span className="font-normal text-faint">{group.length}</span>
              </h2>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {group.map((o) => (
                  <OneOnOneTile key={o.person_id} o={o} />
                ))}
              </div>
            </section>
          );
        })}
      <h2 className="tile-title mb-2 px-1">Everyone</h2>
      {!list.length && <Empty>{q ? `No one matches “${q}”.` : "No people here yet. Press N and choose Person to add someone."}</Empty>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((p) => (
          <Link key={p.id} to={`/people/${p.id}`} className="press lift tile flex items-center gap-3.5 p-3.5">
            <Avatar person={p} size={42} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{p.name}</p>
              <p className="truncate text-[13px] text-muted">{[p.role, p.organization].filter(Boolean).join(", ") || " "}</p>
              {/* Only what there is to say: no "nothing logged yet" on every card. */}
              {(p.active_project_count > 0 || (p.last_talked_at ?? p.last_contact_at)) && (
                <p className="mt-0.5 truncate text-[12px] text-faint">
                  {[p.active_project_count ? `${p.active_project_count} ${p.active_project_count === 1 ? "project" : "projects"}` : "", p.last_talked_at ?? p.last_contact_at ? `talked ${ago(p.last_talked_at ?? p.last_contact_at)}` : ""].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

export function PersonPage() {
  const { id = "" } = useParams();
  const { data, error, isLoading } = usePerson(id);
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorNote error={error ?? new Error("Person not found.")} />;
  return <PersonView p={data} />;
}

/**
 * One person. Deliberately bare: who they are, then the three lists (waiting on them, you owe
 * them, to discuss). Notes and projects show only when there are some. Everything else (email,
 * desk, whether they are a regular 1:1, what was checked off, archiving) is in one quiet line
 * at the foot. The owner's words: "This is my project manager. This is not a CRM."
 */
function PersonView({ p }: { p: PersonDetail }) {
  const { base } = useScope();
  const update = useWrite((patch: Record<string, unknown>) => api.patch(`/api/people/${p.id}`, patch));
  const archive = useWrite(() => api.post(`/api/people/${p.id}/${p.archived_at ? "restore" : "archive"}`));
  const setOneOnOne = useSetOneOnOne(p.id);
  const endOneOnOne = useWrite(() => api.del(`/api/one-on-ones/${p.id}`));
  const save = (patch: Record<string, unknown>) => update.mutate(patch);
  const [details, setDetails] = useState(false);
  const [checked, setChecked] = useState(false);
  const first = p.name.split(" ")[0]!;
  const o = p.one_on_one;
  const active = p.projects.filter((x) => !["done", "archived"].includes(x.status));
  const closed = (usePersonTasks(p.id).data ?? []).filter((t) => t.status === "done");
  // The next 1:1, only when it is a real date (on the calendar or set), never an estimate.
  const next = o?.next_expected && !o.next_is_estimate ? `Next 1:1 ${fmtDayLong(o.next_expected)}${o.next_starts_at ? `, ${fmtClock(o.next_starts_at)}` : ""}` : "";
  const quiet = "press rounded-lg px-2 py-1 text-[12px] font-medium text-faint hover:bg-field hover:text-fg";

  return (
    <div className="mx-auto max-w-[1120px] pt-4 md:pt-6">
      <Link to={`${base}/people`} className="press -ml-2 inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-accent hover:bg-accent-soft">
        <Icon name="back" size={13} />
        People
      </Link>
      <header className="mt-3 flex items-center gap-4">
        <Avatar person={p} size={52} />
        <div className="min-w-0 flex-1">
          <Editable label="name" value={p.name} onSave={(name) => name && save({ name })} className="display text-[24px] md:text-[28px]" />
          <div className="mt-0.5 text-[13px] text-muted">
            <Editable label="role" value={p.role} onSave={(role) => save({ role })} placeholder="Add a role" className="text-[13px]" />
          </div>
          {next && <p className="mt-0.5 text-[13px] font-medium text-accent">{next}</p>}
        </div>
      </header>

      <div className="mt-5">
        <PersonLists personId={p.id} firstName={first} area={p.area} />
      </div>

      <div className="mt-6 space-y-4">
        {p.timeline.length > 0 && (
          <Section id="person-notes" title="Notes" count={p.timeline.length}>
            <Timeline entries={p.timeline} showProject empty="" />
          </Section>
        )}
        {active.length > 0 && (
          <Section id="person-projects" title="Projects" count={active.length}>
            <ul>
              {active.map((x) => (
                <li key={x.id}>
                  <Link to={`/projects/${x.id}`} className="press flex min-h-10 items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-field">
                    <Sigil scope={x.area} size={9} />
                    <span className="truncate text-[14px] font-medium">{x.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>

      {/* Everything that is not the lists: one quiet line. */}
      <div className="mt-8 flex flex-wrap items-center gap-x-1 gap-y-1 border-t border-[var(--line)] pt-3">
        {closed.length > 0 && (
          <button type="button" aria-expanded={checked} onClick={() => setChecked(!checked)} className={quiet}>
            {checked ? "Hide" : "Show"} {closed.length} checked off lately
          </button>
        )}
        <button type="button" aria-expanded={details} onClick={() => setDetails(!details)} className={quiet}>
          {details ? "Hide details" : "Details"}
        </button>
        <button type="button" className={quiet} onClick={() => archive.mutate(undefined, { onSuccess: () => toast({ text: p.archived_at ? "Person restored." : "Person archived.", undo: true }) })}>
          {p.archived_at ? "Restore person" : "Archive person"}
        </button>
      </div>
      <Collapse open={checked && closed.length > 0}>
        <div className="pt-2">
          <CheckedOff personId={p.id} />
        </div>
      </Collapse>
      <Collapse open={details}>
        <div className="grid max-w-[960px] gap-4 pt-3 sm:grid-cols-4">
          <Field label="Also called">
            <Editable label="other names" value={p.aliases} onSave={(aliases) => save({ aliases })} placeholder="Nena, Nini" className="text-sm" />
          </Field>
          <Field label="Email">
            <Editable label="email" value={p.email} onSave={(email) => save({ email })} placeholder="Add an email" className="text-sm" />
          </Field>
          <Field label="Desk">
            <Picker
              label="Desk"
              value={p.area ?? ""}
              onChange={(v) => save({ area: (v || null) as Area | null })}
              options={[{ value: "", label: "Every desk" }, ...DESKS.map((d) => ({ value: d.id as string, label: d.label, icon: <Sigil scope={d.id} /> }))]}
            />
          </Field>
          <Field label="Regular 1:1">
            <Picker
              label="Regular 1:1"
              value={o?.relationship ?? ""}
              onChange={(v) => (v ? setOneOnOne.mutate({ relationship: v as NonNullable<typeof o>["relationship"] }) : endOneOnOne.mutate(undefined))}
              options={[{ value: "", label: "No" }, ...RELATIONSHIP]}
            />
          </Field>
        </div>
      </Collapse>
    </div>
  );
}
