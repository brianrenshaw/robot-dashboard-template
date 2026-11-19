// sync.ts
// The background sync: what the site keeps current by itself. The main Worker runs it on a
// timer (every half hour) and when the owner presses "Sync now" in Settings.
//
// It does one thing: copy the last two weeks and the next four of each connected Google
// Calendar into calendar_events, so the dashboard can show his week (the days already gone
// included), today's meetings and the real time of each 1:1.
//
// That is all it does. Mail and meeting notes reach the dashboard only when the owner or his
// chatbot puts them there; the code that once checked Gmail and Granola here is deleted.

import { storeCalendarEvents } from "./calsync";
import { getSecret, googleAccountsForSync, markGoogleSync, type GoogleAccount } from "./connections";
import type { Db } from "./db";
import { googleAccessToken, listCalendar, type GoogleClientKeys } from "./google";
import { getSettings } from "./settings";

export interface SyncEnv {
  db: Db;
  /** The CONNECTIONS_KEY secret. Without it the saved Google sign-ins cannot be read. */
  connectionsKey?: string;
}

export interface SyncReport {
  calendar: { account: string; events?: number; error?: string }[];
}

/** The Google sign-in client keys, or null when Google is not set up yet. */
export async function googleKeys(db: Db, connectionsKey: string | undefined): Promise<GoogleClientKeys | null> {
  // A key that cannot be read (CONNECTIONS_KEY changed) counts as not set up.
  const clientId = await getSecret(db, connectionsKey, "google_client_id").catch(() => null);
  const clientSecret = await getSecret(db, connectionsKey, "google_client_secret").catch(() => null);
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Each connected Google account with a fresh access token for reading its calendar. */
export async function connectedAccounts(db: Db, connectionsKey: string | undefined): Promise<{ account: GoogleAccount; accessToken: string }[]> {
  const keys = await googleKeys(db, connectionsKey);
  if (!keys || !connectionsKey) return [];
  const out = [];
  for (const account of await googleAccountsForSync(db, connectionsKey)) {
    try {
      if (!account.refresh_token) throw new Error("the saved sign-in could not be read");
      const accessToken = await googleAccessToken(keys, account.refresh_token);
      out.push({ account, accessToken });
    } catch (e) {
      await markGoogleSync(db, account.email, "calendar", `Sign-in no longer works (${message(e).replace(/^Google sign-in failed: /, "").replace(/\.$/, "")}). Connect this account again.`);
    }
  }
  return out;
}

/**
 * How far back the calendar copy reaches. It was one day, which emptied the earlier days of
 * his week as it went on: Monday's meetings and time blocks were gone from the dashboard by
 * Wednesday (2026-11-19: "it shouldn't be cleared on the dashboard"). Two weeks keeps the whole
 * week in view on any day, and lets a day be logged a while after it happened.
 */
export const CALENDAR_DAYS_BACK = 14;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runSync(env: SyncEnv, now: Date = new Date()): Promise<SyncReport> {
  const report: SyncReport = { calendar: [] };
  const settings = await getSettings(env.db);
  for (const { account, accessToken } of await connectedAccounts(env.db, env.connectionsKey)) {
    try {
      const events = await listCalendar(accessToken, new Date(now.getTime() - CALENDAR_DAYS_BACK * 86_400_000), new Date(now.getTime() + 28 * 86_400_000));
      report.calendar.push({ account: account.email, events: await storeCalendarEvents({ db: env.db, actor: "sync:calendar" }, { email: account.email, area: account.area }, events, settings.timezone) });
    } catch (e) {
      await markGoogleSync(env.db, account.email, "calendar", `Calendar: ${message(e)}`);
      report.calendar.push({ account: account.email, error: message(e) });
    }
  }
  return report;
}
