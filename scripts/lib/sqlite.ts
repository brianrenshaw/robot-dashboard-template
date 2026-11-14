// Helpers for scripts: run @pd/core against a local SQLite file or memory database (node:sqlite),
// and turn rows into INSERT statements that `wrangler d1 execute --file` can load.

import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Db, Param } from "@pd/core";

export const ROOT = join(import.meta.dirname, "..", "..");

export function wrap(raw: DatabaseSync): Db {
  const norm = (row: any) => (row ? { ...row } : null);
  return {
    async all<T>(sql: string, params: Param[] = []) {
      return raw.prepare(sql).all(...params).map(norm) as T[];
    },
    async first<T>(sql: string, params: Param[] = []) {
      return norm(raw.prepare(sql).get(...params)) as T | null;
    },
    async run(sql: string, params: Param[] = []) {
      raw.prepare(sql).run(...params);
    },
  };
}

/** A fresh in-memory database with every migration applied. */
export function memoryWithMigrations(): { raw: DatabaseSync; db: Db } {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  const dir = join(ROOT, "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) raw.exec(readFileSync(join(dir, f), "utf8"));
  return { raw, db: wrap(raw) };
}

/** Load a `wrangler d1 export` SQL dump into memory. */
export function memoryFromDump(path: string): { raw: DatabaseSync; db: Db } {
  // Foreign keys off: the dump creates tables in an order that can reference tables not yet created.
  const raw = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
  raw.exec(readFileSync(path, "utf8"));
  return { raw, db: wrap(raw) };
}

function lit(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** INSERT statements for every row of the given tables, in order. */
export function dumpInserts(raw: DatabaseSync, tables: string[]): string {
  const out: string[] = [];
  for (const t of tables) {
    const rows = raw.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[];
    for (const r of rows) {
      const cols = Object.keys(r);
      out.push(`INSERT INTO ${t} (${cols.join(", ")}) VALUES (${cols.map((c) => lit(r[c])).join(", ")});`);
    }
  }
  return out.join("\n") + "\n";
}
