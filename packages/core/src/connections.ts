// connections.ts
// The outside services the site reads by itself, and the keys it needs for them.
//
// Keys that the owner pastes into Settings (Granola, the Google sign-in client) and the
// Google refresh tokens are stored encrypted. The encryption key is the main Worker's
// CONNECTIONS_KEY secret, which never touches the database, so a database dump or the nightly
// backup in the repo never contains a usable key. Nothing here ever returns a stored key to the
// browser; Settings only sees whether one is set and its last four characters.

import { recordAudit } from "./audit";
import type { Db } from "./db";
import { InputError, NotFoundError } from "./errors";
import type { Area, Ctx } from "./types";
import { nowIso } from "./util";

/** The keys Settings can store. */
export const SECRET_KEYS = ["google_client_id", "google_client_secret", "granola_api_key"] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

// ---------- encryption (AES-GCM, key derived from CONNECTIONS_KEY) ----------

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function aesKey(master: string): Promise<CryptoKey> {
  if (!master || master.length < 16) throw new InputError("Connections are not switched on yet: the CONNECTIONS_KEY secret is missing on the main Worker.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(master));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(master: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(master), new TextEncoder().encode(plain)));
  return `${b64(iv)}.${b64(ct)}`;
}

export async function decryptSecret(master: string, stored: string): Promise<string> {
  const [iv, ct] = stored.split(".");
  if (!iv || !ct) throw new Error("Stored secret is not in the expected form");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(master), unb64(ct));
  return new TextDecoder().decode(plain);
}

/** A signature for short values the site hands out and later gets back (the Google sign-in state). */
export async function signValue(master: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(master), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return b64(sig).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------- stored keys ----------

export interface SecretInfo {
  key: SecretKey;
  set: boolean;
  /** Enough to tell which key is stored: the last four characters (the start, for the client ID, which is not secret). */
  hint: string;
  updated_at: string | null;
}

export async function listSecrets(db: Db): Promise<SecretInfo[]> {
  const rows = await db.all<{ key: string; hint: string; updated_at: string }>(`SELECT key, hint, updated_at FROM connection_secrets`);
  return SECRET_KEYS.map((key) => {
    const r = rows.find((x) => x.key === key);
    return { key, set: !!r, hint: r?.hint ?? "", updated_at: r?.updated_at ?? null };
  });
}

/** Save a key. The audit log records that it changed, never the value. */
export async function setSecret(ctx: Ctx, master: string, key: string, value: string): Promise<void> {
  if (!(SECRET_KEYS as readonly string[]).includes(key)) throw new InputError(`Unknown connection key ${key}`);
  const v = value.trim();
  if (!v) throw new InputError("The key is empty.");
  const before = await ctx.db.first<{ key: string; hint: string }>(`SELECT key, hint FROM connection_secrets WHERE key = ?`, [key]);
  const hint = key === "google_client_id" ? `${v.slice(0, 12)}…` : v.slice(-4);
  await ctx.db.run(
    `INSERT INTO connection_secrets (key, ciphertext, hint, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET ciphertext = excluded.ciphertext, hint = excluded.hint, updated_at = excluded.updated_at`,
    [key, await encryptSecret(master, v), hint, nowIso()],
  );
  await recordAudit(ctx, before ? "update" : "create", "connection_secrets", before, { key, hint });
}

export async function clearSecret(ctx: Ctx, key: string): Promise<void> {
  const before = await ctx.db.first<{ key: string; hint: string }>(`SELECT key, hint FROM connection_secrets WHERE key = ?`, [key]);
  if (!before) return;
  await ctx.db.run(`DELETE FROM connection_secrets WHERE key = ?`, [key]);
  await recordAudit(ctx, "delete_soft", "connection_secrets", before, null);
}

/** The stored key, decrypted, or null. Only ever used inside the Worker. */
export async function getSecret(db: Db, master: string | undefined, key: SecretKey): Promise<string | null> {
  if (!master) return null;
  const row = await db.first<{ ciphertext: string }>(`SELECT ciphertext FROM connection_secrets WHERE key = ?`, [key]);
  return row ? decryptSecret(master, row.ciphertext) : null;
}

// ---------- Google accounts ----------

export interface GoogleAccount {
  email: string;
  area: Area;
  scopes: string;
  last_error: string;
  calendar_synced_at: string | null;
  mail_synced_at: string | null;
  connected_at: string;
}

const ACCOUNT_COLS = `email, area, scopes, last_error, calendar_synced_at, mail_synced_at, connected_at`;

/** Connected accounts, without their tokens. */
export async function listGoogleAccounts(db: Db): Promise<GoogleAccount[]> {
  return db.all<GoogleAccount>(`SELECT ${ACCOUNT_COLS} FROM google_accounts WHERE disconnected_at IS NULL ORDER BY connected_at`);
}

/**
 * Connected accounts with their refresh tokens decrypted, for the sync. A token that cannot be
 * read (the CONNECTIONS_KEY changed since it was saved) comes back empty, and the caller reports
 * that account as needing to be connected again; the other accounts are not affected.
 */
export async function googleAccountsForSync(db: Db, master: string): Promise<(GoogleAccount & { refresh_token: string })[]> {
  const rows = await db.all<GoogleAccount & { refresh_token: string }>(`SELECT ${ACCOUNT_COLS}, refresh_token FROM google_accounts WHERE disconnected_at IS NULL ORDER BY connected_at`);
  return Promise.all(rows.map(async (r) => ({ ...r, refresh_token: await decryptSecret(master, r.refresh_token).catch(() => "") })));
}

/** Connect a Google account to a desk, or reconnect it with a fresh token. */
export async function saveGoogleAccount(ctx: Ctx, master: string, input: { email: string; area: Area; refreshToken: string; scopes: string }): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const before = await ctx.db.first<{ email: string; area: string }>(`SELECT email, area FROM google_accounts WHERE email = ?`, [email]);
  const now = nowIso();
  await ctx.db.run(
    `INSERT INTO google_accounts (email, area, refresh_token, scopes, last_error, connected_at, disconnected_at) VALUES (?, ?, ?, ?, '', ?, NULL)
     ON CONFLICT(email) DO UPDATE SET area = excluded.area, refresh_token = excluded.refresh_token, scopes = excluded.scopes,
       last_error = '', connected_at = excluded.connected_at, disconnected_at = NULL`,
    [email, input.area, await encryptSecret(master, input.refreshToken), input.scopes, now],
  );
  await recordAudit(ctx, before ? "update" : "create", "google_accounts", before, { email, area: input.area });
}

/** Move a connected account to another desk. Its calendar and new mail follow on the next sync. */
export async function setGoogleAccountArea(ctx: Ctx, email: string, area: Area): Promise<void> {
  const before = await ctx.db.first<{ email: string; area: string }>(`SELECT email, area FROM google_accounts WHERE email = ? AND disconnected_at IS NULL`, [email]);
  if (!before) throw new NotFoundError(`No connected Google account ${email}`);
  if (before.area === area) return;
  await ctx.db.run(`UPDATE google_accounts SET area = ? WHERE email = ?`, [area, email]);
  await ctx.db.run(`UPDATE calendar_events SET area = ? WHERE account = ?`, [area, email]);
  await recordAudit(ctx, "update", "google_accounts", before, { email, area });
}

/** Disconnect an account: forget its token and drop its cached calendar. */
export async function disconnectGoogleAccount(ctx: Ctx, email: string): Promise<void> {
  const before = await ctx.db.first<{ email: string; area: string }>(`SELECT email, area FROM google_accounts WHERE email = ? AND disconnected_at IS NULL`, [email]);
  if (!before) throw new NotFoundError(`No connected Google account ${email}`);
  await ctx.db.run(`UPDATE google_accounts SET refresh_token = '', disconnected_at = ? WHERE email = ?`, [nowIso(), email]);
  await ctx.db.run(`DELETE FROM calendar_events WHERE account = ?`, [email]);
  await recordAudit(ctx, "delete_soft", "google_accounts", before, null);
}

/** Note that a sync ran for an account (a heartbeat, not in the audit log). */
export async function markGoogleSync(db: Db, email: string, what: "calendar" | "mail", error = ""): Promise<void> {
  const col = what === "calendar" ? "calendar_synced_at" : "mail_synced_at";
  if (error) await db.run(`UPDATE google_accounts SET last_error = ? WHERE email = ?`, [error.slice(0, 300), email]);
  else await db.run(`UPDATE google_accounts SET ${col} = ?, last_error = '' WHERE email = ?`, [nowIso(), email]);
}

// ---------- sync heartbeats ----------

export async function getSyncState(db: Db, key: string): Promise<string | null> {
  return (await db.first<{ value: string }>(`SELECT value FROM sync_state WHERE key = ?`, [key]))?.value ?? null;
}

export async function setSyncState(db: Db, key: string, value: string): Promise<void> {
  await db.run(`INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, [key, value, nowIso()]);
}
