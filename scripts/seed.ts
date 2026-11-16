// Seed script. Creates made-up people, projects and a sample week of tasks, meetings and notes.
//   npm run seed:local    (local wrangler dev database)
//   npm run seed:remote   (the real D1 database)
// Refuses to run if the target already has projects, unless you pass --force.
//
// How it works: it runs the normal @pd/core functions against an in-memory SQLite copy of the
// schema (so audit rows are written exactly as the app would), then loads the rows into D1
// with `wrangler d1 execute --file`.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addDays,
  addEntry,
  addTask,
  addTimeBlock,
  createPerson,
  createProject,
  DEFAULT_TZ,
  linkPersonToProject,
  saveDailyLog,
  setOneOnOne,
  storeCalendarEvents,
  todayInTz,
  updateTask,
  weekStart,
  type Area,
  type BoardRow,
  type Ctx,
  type ProjectStatus,
} from "@pd/core";
import { ROOT, dumpInserts, memoryWithMigrations } from "./lib/sqlite";

const target = process.argv.includes("--remote") ? "--remote" : "--local";
const force = process.argv.includes("--force");

// Made-up sample data, so the dashboard has something to show the first time it opens.
// Replace it with your own, or skip seeding and let your chatbot fill the dashboard in.
const PEOPLE: { name: string; role?: string; organization?: string; notes?: string; email?: string }[] = [
  { name: "Peter Aldin", role: "Chief Operating Officer", organization: "Northfield", notes: "My manager.", email: "peter@example.com" },
  { name: "Sam Fields", role: "Director of Sales", email: "sam@example.com" },
  { name: "Kai Hale", role: "Director of Customer Success", email: "kai@example.com" },
  { name: "Greta Stone", role: "Head of Marketing", email: "greta@example.com" },
  { name: "Jordan Ahn", role: "Product Lead", email: "jordan@example.com" },
  { name: "Maya Arden", role: "Finance Manager", email: "maya@example.com" },
  { name: "Ned Chang", role: "Operations Analyst", email: "ned@example.com" },
  { name: "Blair Banks", role: "Partnerships", email: "blair@example.com" },
];

const PROJECTS: { title: string; area: Area; status?: ProjectStatus; people?: string[] }[] = [
  { title: "Pricing review for next year", area: "work", people: ["Maya Arden", "Sam Fields"] },
  { title: "Customer onboarding redesign", area: "work", people: ["Kai Hale", "Jordan Ahn"] },
  { title: "Budget meeting (December)", area: "work" },
  { title: "Hiring: two account managers", area: "work", people: ["Sam Fields"] },
  { title: "Partner program launch", area: "work", people: ["Blair Banks", "Greta Stone"] },
  { title: "Newsletter and small courses", area: "side_business" },
  { title: "Photo sorting app", area: "side_business" },
  { title: "Recipe site idea", area: "side_business", status: "idea" },
  { title: "Garage storage and organization", area: "personal" },
  { title: "Front bed landscaping", area: "personal" },
];

// A made-up week, so the planner has something to show: tasks on the board, meetings on the
// calendar, time set aside, and a day of the log. Days count from this week's Monday (next
// week's on a weekend, as the planner shows it); hours are local.
const OWNER = "alex@example.com";
const MEETINGS: { day: number; at: string; minutes: number; title: string; with: string[] }[] = [
  { day: 0, at: "09:00", minutes: 30, title: "Kai and Alex 1:1", with: ["kai@example.com"] },
  { day: 0, at: "11:00", minutes: 60, title: "Leadership team", with: ["peter@example.com", "sam@example.com", "kai@example.com", "greta@example.com"] },
  { day: 0, at: "14:00", minutes: 30, title: "Pricing review", with: ["maya@example.com", "sam@example.com"] },
  { day: 1, at: "10:00", minutes: 30, title: "Sam and Alex 1:1", with: ["sam@example.com"] },
  { day: 1, at: "13:00", minutes: 60, title: "Onboarding redesign: first look", with: ["kai@example.com", "jordan@example.com"] },
  { day: 2, at: "09:30", minutes: 45, title: "Peter and Alex 1:1", with: ["peter@example.com"] },
  { day: 2, at: "15:00", minutes: 30, title: "Partner program check-in", with: ["blair@example.com", "greta@example.com"] },
  { day: 3, at: "11:00", minutes: 60, title: "Leadership team", with: ["peter@example.com", "sam@example.com", "kai@example.com", "greta@example.com"] },
  { day: 3, at: "14:30", minutes: 30, title: "Interview: account manager", with: ["sam@example.com"] },
  { day: 4, at: "10:00", minutes: 30, title: "Greta and Alex 1:1", with: ["greta@example.com"] },
];
const TASKS: { title: string; board?: BoardRow; project?: string; due?: number; waiting?: string[]; people?: string[]; oneOnOne?: string; block?: { day: number; at: string; minutes: number } }[] = [
  { title: "Draft the pricing memo", board: "todo", project: "Pricing review for next year", due: 3, block: { day: 0, at: "15:00", minutes: 90 } },
  { title: "Write the account manager job description", board: "todo", project: "Hiring: two account managers", block: { day: 1, at: "08:30", minutes: 60 } },
  { title: "Read the onboarding survey results", board: "todo", project: "Customer onboarding redesign", block: { day: 1, at: "11:00", minutes: 45 } },
  { title: "Budget slides for December", board: "todo", project: "Budget meeting (December)", due: 14 },
  { title: "Q3 numbers by region", board: "waiting", waiting: ["Maya Arden"], project: "Pricing review for next year" },
  { title: "Partner agreement draft", board: "waiting", waiting: ["Blair Banks"], project: "Partner program launch" },
  { title: "Send Kai the renewal list", people: ["Kai Hale"], oneOnOne: "Kai Hale" },
  { title: "Talk with Peter about the offsite date", people: ["Peter Aldin"], oneOnOne: "Peter Aldin" },
  { title: "Sam to share the interview schedule", board: "waiting" },
  { title: "Pick a newsletter platform", board: "figure", project: "Newsletter and small courses" },
  { title: "Price out garage shelving", board: "back", project: "Garage storage and organization" },
  { title: "Call the landscaper about the front bed", board: "back", project: "Front bed landscaping" },
];

/** A local time on a day, as an ISO time with the time zone's offset that day. */
function at(day: string, hhmm: string, tz: string): string {
  const guess = new Date(`${day}T${hhmm}:00Z`);
  const shown = new Date(guess.toLocaleString("en-US", { timeZone: tz }));
  const asUtc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() + (asUtc.getTime() - shown.getTime())).toISOString();
}

async function sampleWeek(ctx: Ctx, people: Map<string, string>, projects: Map<string, string>) {
  const tz = DEFAULT_TZ;
  const today = todayInTz(tz);
  const monday = weekStart(today);
  const day = (n: number) => addDays(monday, n);

  for (const name of ["Peter Aldin", "Sam Fields", "Kai Hale", "Greta Stone"]) {
    await setOneOnOne(ctx, people.get(name)!, { relationship: name === "Peter Aldin" ? "manager" : "direct" });
  }
  await storeCalendarEvents(
    ctx,
    { email: OWNER, area: "work" },
    MEETINGS.map((m, i) => {
      const start = at(day(m.day), m.at, tz);
      const end = new Date(new Date(start).getTime() + m.minutes * 60_000).toISOString();
      return {
        id: `sample${i}`,
        status: "confirmed",
        summary: m.title,
        start: { dateTime: start },
        end: { dateTime: end },
        attendees: [{ email: OWNER, self: true, responseStatus: "accepted" }, ...m.with.map((email) => ({ email }))],
      };
    }),
    tz,
  );

  for (const s of TASKS) {
    const task = await addTask(ctx, {
      title: s.title,
      project_id: s.project ? projects.get(s.project)! : null,
      due_date: s.due === undefined ? null : day(s.due),
      // Left out when none are given, so a name in the title tags that person by itself.
      ...(s.waiting || s.people
        ? {
            people: [
              ...(s.waiting ?? []).map((n) => ({ person_id: people.get(n)!, waiting: true })),
              ...(s.people ?? []).map((n) => ({ person_id: people.get(n)!, one_on_one: s.oneOnOne === n })),
            ],
          }
        : {}),
    });
    if (s.board) await updateTask(ctx, task.id, { board: s.board });
    if (s.block) await addTimeBlock(ctx, { task_id: task.id, day: day(s.block.day), start_min: toMinutes(s.block.at), minutes: s.block.minutes });
  }

  const yesterday = addDays(today, -1);
  await saveDailyLog(ctx, {
    day: yesterday,
    body: "A quiet day of planning.\n\n## Worked on\n- The pricing memo: first outline\n- Read the onboarding survey summary",
    add: ["Sent Sam the interview questions"],
  });
  await addEntry(ctx, {
    kind: "meeting",
    title: "1:1 with Kai",
    body: "Renewals look steady. Kai wants a second person on onboarding calls.",
    person_ids: [people.get("Kai Hale")!],
    source_ref: "calendar:" + `${OWNER}:sample0`,
    occurred_at: at(day(0), "09:00", tz),
  });
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

function wrangler(args: string[]): string {
  return execFileSync("npx", ["wrangler", ...args, "-c", join(ROOT, "workers/app/wrangler.jsonc")], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

async function main() {
  if (!force) {
    const out = wrangler(["d1", "execute", "project-dashboard", target, "--json", "--command", "SELECT COUNT(*) AS n FROM projects"]);
    const n = JSON.parse(out.slice(out.indexOf("[")))[0]?.results?.[0]?.n ?? 0;
    if (n > 0) {
      console.log(`The ${target.slice(2)} database already has ${n} projects. Not seeding. Pass --force to seed anyway.`);
      return;
    }
  }

  const { raw, db } = memoryWithMigrations();
  const ctx: Ctx = { db, actor: "script:seed" };
  const ids = new Map<string, string>();
  for (const p of PEOPLE) {
    const row = await createPerson(ctx, { ...p, area: "work" });
    ids.set(p.name, row.id);
  }
  const projectIds = new Map<string, string>();
  // Create in reverse so the first project in the list sits at the top of its board column.
  for (const p of [...PROJECTS].reverse()) {
    const row = await createProject(ctx, { title: p.title, area: p.area, status: p.status ?? "active" });
    projectIds.set(p.title, row.id);
    for (const name of p.people ?? []) await linkPersonToProject(ctx, row.id, ids.get(name)!, "collaborator");
  }
  await sampleWeek(ctx, ids, projectIds);

  const sql = dumpInserts(raw, [
    "people",
    "projects",
    "project_people",
    "one_on_ones",
    "calendar_events",
    "calendar_event_people",
    "tasks",
    "task_people",
    "time_blocks",
    "daily_logs",
    "entries",
    "entry_people",
    "audit_log",
  ]);
  const file = join(mkdtempSync(join(tmpdir(), "pd-seed-")), "seed.sql");
  writeFileSync(file, sql);
  console.log(`Seeding ${PROJECTS.length} projects, ${PEOPLE.length} people and a sample week into the ${target.slice(2)} database…`);
  wrangler(["d1", "execute", "project-dashboard", target, "--file", file, ...(target === "--remote" ? ["--yes"] : [])]);
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
