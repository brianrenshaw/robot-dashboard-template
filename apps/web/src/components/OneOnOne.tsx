// OneOnOne.tsx
// What the owner and one person have between them. A tile for each person he meets with (the
// People page), and the two lists on a person's page:
//   For our next 1:1    what he (or his chatbot) has put on the list for their next meeting.
//                       Nothing lands here by itself.
//   Everything with Nina every other task she is tagged on. Ones he is waiting on her for say so.
// They are ordinary tasks with the person on them, the same ones the Tasks page shows. There
// used to be three sorted lists (waiting on, you owe, to discuss); he did not want to sort
// things into those. Nothing else lives here: no rhythm, no meeting notes, no settings.

import { Link } from "react-router-dom";
import { useEditTask, usePersonTasks, type Area, type OneOnOneCard, type TaskItem } from "../api";
import { TaskAdd, TaskRow } from "./Tasks";
import { ago, daysBetween, fmtClock, fmtDayLong, relDay, todayYmd } from "../lib/time";
import { Avatar, Chip } from "./ui";

export const RELATIONSHIP = [
  { value: "direct" as const, label: "Direct report" },
  { value: "manager" as const, label: "My manager" },
  { value: "peer" as const, label: "Peer" },
  { value: "other" as const, label: "Other" },
];
export const RELATIONSHIP_GROUP: Record<string, string> = { manager: "Manager", direct: "Direct reports", peer: "Peers", other: "Others" };

/** One person's 1:1 at a glance: when it is, and how much is on the list. */
export function OneOnOneTile({ o }: { o: OneOnOneCard }) {
  const soon = o.next_expected ? daysBetween(todayYmd(), o.next_expected) : null;
  return (
    <Link to={`/people/${o.person_id}`} className="press lift tile flex flex-col gap-3 p-3.5">
      <div className="flex items-center gap-2.5">
        <Avatar person={o} size={34} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold leading-tight">{o.name}</p>
          <p className="truncate text-[12px] text-muted">{o.role || RELATIONSHIP.find((r) => r.value === o.relationship)?.label}</p>
        </div>
      </div>
      <div className="flex items-baseline gap-2">
        {o.next_expected ? (
          <>
            <span className={`text-[13px] font-semibold ${soon !== null && soon <= 1 ? "text-accent" : ""}`}>
              {o.next_is_estimate ? "About " : ""}
              {fmtDayLong(o.next_expected)}
            </span>
            <span className="text-[12px] text-faint">{o.next_starts_at ? fmtClock(o.next_starts_at) : relDay(o.next_expected)}</span>
          </>
        ) : (
          <span className="text-[13px] text-faint">{o.last_met_at ? `Last met ${ago(o.last_met_at)}` : "No meeting yet"}</span>
        )}
      </div>
      <div className="flex min-h-[22px] flex-wrap gap-1">
        {o.discuss > 0 && <Chip tone="accent">{o.discuss} on the 1:1 list</Chip>}
        {o.theirs > 0 && <Chip tone="wait">waiting on {o.theirs}</Chip>}
      </div>
    </Link>
  );
}

/** A quiet button at the end of a task row. Left out on a phone, where the title needs the room; the row's arrow has the same switch. */
function RowAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="press shrink-0 rounded-lg px-2 py-1 text-[12px] font-medium text-faint hover:bg-surface hover:text-fg max-sm:hidden">
      {label}
    </button>
  );
}

/** The two lists on a person's page: the list for their next 1:1, then everything else they are tagged on. */
export function PersonLists({ personId, firstName, area }: { personId: string; firstName: string; area: Area | null }) {
  const { data } = usePersonTasks(personId);
  const edit = useEditTask();
  const open = (data ?? []).filter((t) => t.status !== "done");
  const here = (t: TaskItem) => t.people.find((p) => p.id === personId);
  const agenda = open.filter((t) => here(t)?.one_on_one);
  const rest = open.filter((t) => !here(t)?.one_on_one);
  // Move a task on or off this person's 1:1 list; everyone else on the task is left as they are.
  const move = (t: TaskItem, on: boolean) =>
    edit.mutate({ id: t.id, people: t.people.map((p) => ({ person_id: p.id, waiting: p.waiting, one_on_one: p.id === personId ? on : p.one_on_one })) });
  const heading = "flex h-8 items-center gap-2 px-2 text-[14px] font-semibold";
  return (
    <div className="tile space-y-5 p-2">
      <div>
        <h3 className={heading}>
          <span className="size-2 rounded-full bg-accent" />
          For our next 1:1
        </h3>
        {agenda.map((t) => (
          <TaskRow key={t.id} t={t} hide={{ person: personId }} dense aside={<RowAction label="Take off" onClick={() => move(t, false)} />} />
        ))}
        <div className="px-1 pt-1">
          <TaskAdd defaults={{ person_id: personId, side: "mine", discuss: true }} area={area} placeholder={`Add something for your next 1:1 with ${firstName}`} />
        </div>
      </div>
      <div>
        <h3 className={heading}>
          <span className="size-2 rounded-full" style={{ background: "var(--idle)" }} />
          Everything with {firstName}
        </h3>
        {rest.map((t) => (
          <TaskRow key={t.id} t={t} hide={{ person: personId }} dense aside={<RowAction label="Add to 1:1" onClick={() => move(t, true)} />} />
        ))}
        <div className="px-1 pt-1">
          <TaskAdd defaults={{ person_id: personId, side: "mine" }} area={area} placeholder={`Add a task with ${firstName}`} />
        </div>
      </div>
    </div>
  );
}

/** What was checked off with a person in the last two weeks. Shown, on request, at the foot of their page. */
export function CheckedOff({ personId }: { personId: string }) {
  const { data } = usePersonTasks(personId);
  return (
    <div className="tile p-2">
      {(data ?? []).filter((t) => t.status === "done").map((t) => (
        <TaskRow key={t.id} t={t} hide={{ person: personId }} dense />
      ))}
    </div>
  );
}
