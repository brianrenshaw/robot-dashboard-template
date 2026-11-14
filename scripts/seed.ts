// Seed script. Creates the starting projects and people from the build brief.
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
import { createPerson, createProject, linkPersonToProject, type Area, type Ctx, type ProjectStatus } from "@pd/core";
import { ROOT, dumpInserts, memoryWithMigrations } from "./lib/sqlite";

const target = process.argv.includes("--remote") ? "--remote" : "--local";
const force = process.argv.includes("--force");

// Made-up sample data, so the dashboard has something to show the first time it opens.
// Replace it with your own, or skip seeding and let your chatbot fill the dashboard in.
const PEOPLE: { name: string; role?: string; organization?: string; notes?: string }[] = [
  { name: "Peter Aldin", role: "Chief Operating Officer", organization: "Northfield", notes: "My manager." },
  { name: "Sam Fields", role: "Director of Sales" },
  { name: "Kai Hale", role: "Director of Customer Success" },
  { name: "Greta Stone", role: "Head of Marketing" },
  { name: "Jordan Ahn", role: "Product Lead" },
  { name: "Maya Arden", role: "Finance Manager" },
  { name: "Ned Chang", role: "Operations Analyst" },
  { name: "Blair Banks", role: "Partnerships" },
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
  // Create in reverse so the first project in the list sits at the top of its board column.
  for (const p of [...PROJECTS].reverse()) {
    const row = await createProject(ctx, { title: p.title, area: p.area, status: p.status ?? "active" });
    for (const name of p.people ?? []) await linkPersonToProject(ctx, row.id, ids.get(name)!, "collaborator");
  }

  const sql = dumpInserts(raw, ["people", "projects", "project_people", "audit_log"]);
  const file = join(mkdtempSync(join(tmpdir(), "pd-seed-")), "seed.sql");
  writeFileSync(file, sql);
  console.log(`Seeding ${PROJECTS.length} projects and ${PEOPLE.length} people into the ${target.slice(2)} database…`);
  wrangler(["d1", "execute", "project-dashboard", target, "--file", file, ...(target === "--remote" ? ["--yes"] : [])]);
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
