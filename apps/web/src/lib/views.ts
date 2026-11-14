// views.ts
// The views that are always there. Each is just a filter over the task list; the ones the owner
// saves himself come from the server (useViews). Used by the sidebar and the Tasks page.

import type { TaskFilter } from "../api";

export const BUILT_IN: { name: string; filter: TaskFilter; icon: string; tone: string }[] = [
  { name: "Late", filter: { due: "late" }, icon: "heads_up", tone: "late" },
  { name: "Due this week", filter: { due: "week" }, icon: "calendar", tone: "soon" },
  { name: "Waiting a week or more", filter: { waiting_days: 7 }, icon: "clock", tone: "wait" },
  { name: "From email", filter: { has_email: true }, icon: "email", tone: "accent" },
  { name: "Hidden", filter: { hidden: "only" }, icon: "x", tone: "idle" },
];

/** The address of the Tasks page showing one filter. */
export function filterHref(filter: TaskFilter): string {
  return `/tasks?f=${encodeURIComponent(JSON.stringify(filter))}`;
}
