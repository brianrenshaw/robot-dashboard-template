// google.ts
// The only place the project talks to Google: sign-in (OAuth) and Google Calendar, over plain
// HTTPS. The main Worker uses it for the sign-in pages and the half-hourly calendar sync.
//
// The only permission asked for at sign-in is reading the calendar (calendar.readonly). The
// site does not read or send mail (rule 8 in CLAUDE.md); the code that once did is deleted.

import type { GoogleEvent } from "./calsync";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.readonly",
];

export interface GoogleClientKeys {
  clientId: string;
  clientSecret: string;
}

/** The Google page to send the owner to. `state` comes back unchanged on the return trip. */
export function googleSignInUrl(keys: GoogleClientKeys, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: keys.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline", // ask for a refresh token, so the site can keep reading later
    prompt: "consent select_account",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function token(body: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; id_token?: string; scope?: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(`Google sign-in failed: ${data.error_description ?? data.error ?? res.status}`);
  return data;
}

/** Finish sign-in: trade the code Google sent back for a refresh token, and learn which account it is. */
export async function finishGoogleSignIn(keys: GoogleClientKeys, redirectUri: string, code: string): Promise<{ email: string; refreshToken: string; scopes: string }> {
  const t = await token({ code, client_id: keys.clientId, client_secret: keys.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" });
  if (!t.refresh_token) throw new Error("Google did not return a refresh token. Remove this site's access at myaccount.google.com/permissions and connect again.");
  // The id token comes straight from Google over HTTPS, so its email claim can be read as is.
  const claims = JSON.parse(decodeBase64Url((t.id_token ?? "").split(".")[1] ?? "") || "{}");
  if (!claims.email) throw new Error("Google did not say which account this is.");
  return { email: String(claims.email).toLowerCase(), refreshToken: t.refresh_token, scopes: t.scope ?? "" };
}

/** A short-lived access token for one account. */
export async function googleAccessToken(keys: GoogleClientKeys, refreshToken: string): Promise<string> {
  return (await token({ client_id: keys.clientId, client_secret: keys.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" })).access_token;
}

async function api<T>(accessToken: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", ...(init.headers ?? {}) } });
  if (!res.ok) {
    const detail = ((await res.json().catch(() => ({}))) as any)?.error?.message ?? "";
    throw new Error(`Google answered ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return (await res.json()) as T;
}

// ---------- Calendar ----------

/** Every event on the account's main calendar between two times, with repeating events spread out. */
export async function listCalendar(accessToken: string, from: Date, to: Date): Promise<GoogleEvent[]> {
  const out: GoogleEvent[] = [];
  let pageToken = "";
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({ singleEvents: "true", orderBy: "startTime", timeMin: from.toISOString(), timeMax: to.toISOString(), maxResults: "250" });
    if (pageToken) q.set("pageToken", pageToken);
    const res = await api<{ items?: GoogleEvent[]; nextPageToken?: string }>(accessToken, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`);
    out.push(...(res.items ?? []));
    if (!res.nextPageToken) break;
    pageToken = res.nextPageToken;
  }
  return out;
}

function decodeBase64Url(data: string): string {
  if (!data) return "";
  const bin = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
