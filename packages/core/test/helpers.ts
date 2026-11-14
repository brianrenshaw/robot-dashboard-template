// Test helper: an in-memory SQLite database with the real migrations applied.
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx, Db, Param } from "../src";

const MIGRATIONS = join(__dirname, "../../../migrations");

export function memoryDb(): Db {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    raw.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  }
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

export function ctx(actor = "web"): Ctx {
  return { db: memoryDb(), actor };
}
