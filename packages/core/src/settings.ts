// settings.ts

import { recordAudit } from "./audit";
import type { Db } from "./db";
import { settingsUpdateSchema } from "./schemas";
import type { Ctx, Settings } from "./types";
import { DEFAULT_TZ, parseJson } from "./util";

export const DEFAULT_SETTINGS: Settings = {
  board_names: { todo: "To do", waiting: "Waiting to hear back", back: "Back burner", figure: "To figure out" },
  stale_days: 14, due_soon_days: 7, timezone: DEFAULT_TZ, mail_account: "" };

export async function getSettings(db: Db): Promise<Settings> {
  const rows = await db.all<{ key: string; value: string }>(`SELECT key, value FROM settings`);
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (r.key in out) (out as any)[r.key] = parseJson(r.value, (out as any)[r.key]);
  }
  return out;
}

export async function updateSettings(ctx: Ctx, input: unknown): Promise<Settings> {
  const patch = settingsUpdateSchema.parse(input);
  const current = await getSettings(ctx.db);
  for (const [key, value] of Object.entries(patch)) {
    const before = { key, value: JSON.stringify((current as any)[key]) };
    const after = { key, value: JSON.stringify(value) };
    if (before.value === after.value) continue;
    await ctx.db.run(
      `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, after.value],
    );
    await recordAudit(ctx, "update", "settings", before, after);
  }
  return getSettings(ctx.db);
}
