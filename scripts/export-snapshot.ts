// Writes the readable markdown snapshot (snapshot/index.md, snapshot/projects/*.md,
// snapshot/people/*.md) from a `wrangler d1 export` SQL dump.
//   npx tsx scripts/export-snapshot.ts backups/2026-11-13.sql
// Used by .github/workflows/backup.yml. Rebuilds the folder from scratch each run, so
// renamed or removed projects do not leave stale files behind.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { exportAll, getSettings, snapshotFiles } from "@pd/core";
import { ROOT, memoryFromDump } from "./lib/sqlite";

async function main() {
  const dump = process.argv[2];
  if (!dump) throw new Error("Pass the path to a SQL dump, for example backups/2026-11-13.sql");
  const { db } = memoryFromDump(dump);
  const data = await exportAll(db);
  const { timezone } = await getSettings(db);
  const files = snapshotFiles(data, timezone);
  const out = join(ROOT, "snapshot");
  rmSync(out, { recursive: true, force: true });
  for (const [path, content] of Object.entries(files)) {
    const full = join(out, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  console.log(`Wrote ${Object.keys(files).length} files to snapshot/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
