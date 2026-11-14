// Notes.tsx
// Every note in one place, newest first: notes, meetings, calls, decisions, emails that were
// filed. Notes get here when the owner writes one (the line at the top) or asks his chatbot to file
// one. A #hashtag written anywhere in a note tags it; the tag's page then lists it next to the
// tasks with the same tag.

import { useState } from "react";
import { useHome, useNotes } from "../api";
import { TextInput } from "../components/fields";
import { PageHeader } from "../components/Shell";
import { TagChip } from "../components/Tasks";
import { Timeline } from "../components/Timeline";
import { ErrorNote, Spinner } from "../components/ui";
import { useScope } from "../spaces";

export function Notes() {
  const { scope, space, param } = useScope();
  const { data, error, isLoading } = useNotes(param);
  const { data: home } = useHome();
  const [q, setQ] = useState("");
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorNote error={error} />;
  const all = scope === "all";
  const words = q.toLowerCase();
  const list = q ? data.filter((e) => `${e.title} ${e.body} ${e.people.map((p) => p.name).join(" ")}`.toLowerCase().includes(words)) : data;
  const tags = (home?.tags ?? []).filter((t) => t.notes > 0);
  return (
    <>
      <PageHeader
        tinted={!all}
        title={all ? "Notes" : space.label}
        summary={`${data.length} ${data.length === 1 ? "note" : "notes"}`}
        right={
          <div className="w-full sm:w-64">
            <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by person, title or text" aria-label="Filter notes" />
          </div>
        }
      />
      <div className="mx-auto max-w-[820px] space-y-4">
        {tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-1">
            {tags.map((t) => (
              <TagChip key={t.id} name={t.name} count={t.notes} />
            ))}
          </div>
        )}
        <Timeline entries={list} showProject empty={q ? `No note matches “${q}”.` : "No notes yet. Ask your chatbot to file one here."} />
      </div>
    </>
  );
}
