// Tests for what the site reads from outside by itself: stored keys, the calendar copy and
// the background sync. Google is replaced by made-up events; nothing here touches the network.
import { describe, expect, it } from "vitest";
import {
  addDays, createPerson, decryptSecret, getHome, getOneOnOne, getSecret,
  listAudit, listCalendarEvents, listGoogleAccounts, listSecrets, runSync,
  saveGoogleAccount, setGoogleAccountArea, setOneOnOne, setSecret, storeCalendarEvents, todayInTz,
  type GoogleEvent,
} from "../src";
import { ctx } from "./helpers";

const MASTER = "a-long-random-test-secret";
const TZ = "America/New_York";

describe("stored keys", () => {
  it("encrypts a key, shows only its last four characters, and never logs the value", async () => {
    const c = ctx();
    await setSecret(c, MASTER, "granola_api_key", "grn_supersecret1234");
    expect((await listSecrets(c.db)).find((s) => s.key === "granola_api_key")).toMatchObject({ set: true, hint: "1234" });
    expect(await getSecret(c.db, MASTER, "granola_api_key")).toBe("grn_supersecret1234");

    const stored = (await c.db.first<{ ciphertext: string }>(`SELECT ciphertext FROM connection_secrets`))!.ciphertext;
    expect(stored).not.toContain("supersecret");
    await expect(decryptSecret("some-other-master-key", stored)).rejects.toThrow();
    expect(JSON.stringify(await listAudit(c.db, {}))).not.toContain("supersecret");

    await expect(setSecret(c, MASTER, "not_a_key", "x")).rejects.toThrow(/Unknown/);
    await expect(setSecret(c, "", "granola_api_key", "x")).rejects.toThrow(/CONNECTIONS_KEY/);
  });

  it("keeps a Google sign-in encrypted and lists the account without its token", async () => {
    const c = ctx();
    await saveGoogleAccount(c, MASTER, { email: "Alex@Example.edu", area: "work", refreshToken: "1//refresh-token", scopes: "x" });
    expect(await listGoogleAccounts(c.db)).toMatchObject([{ email: "alex@example.edu", area: "work" }]);
    expect(JSON.stringify(await listGoogleAccounts(c.db))).not.toContain("refresh");
    expect((await c.db.first<{ refresh_token: string }>(`SELECT refresh_token FROM google_accounts`))!.refresh_token).not.toContain("refresh-token");
    await setGoogleAccountArea(c, "alex@example.edu", "personal");
    expect((await listGoogleAccounts(c.db))[0]!.area).toBe("personal");
  });
});

describe("calendar", () => {
  it("keeps real meetings, spots 1:1s, and gives the 1:1 its exact date and time", async () => {
    const c = ctx();
    const kai = await createPerson(c, { name: "Kai Hale", email: "khale@example.edu" });
    const greta = await createPerson(c, { name: "Greta Stone" }); // no email on file
    await setOneOnOne(c, kai.id, { cadence_days: 14 });
    await setOneOnOne(c, greta.id, {});
    await saveGoogleAccount(c, MASTER, { email: "alex@example.edu", area: "work", refreshToken: "t", scopes: "" });

    const today = todayInTz(TZ);
    const at = (days: number, hour: string) => `${addDays(today, days)}T${hour}:00-05:00`;
    const me = { email: "alex@example.edu", self: true, responseStatus: "accepted" };
    const events: GoogleEvent[] = [
      { id: "1", summary: "Kai / Alex", start: { dateTime: at(3, "08:30") }, end: { dateTime: at(3, "09:00") }, attendees: [me, { email: "Khale@example.edu" }] },
      { id: "2", summary: "Greta and Alex 1:1", start: { dateTime: at(5, "14:00") }, end: { dateTime: at(5, "14:30") } },
      { id: "3", summary: "Cabinet", start: { dateTime: at(1, "10:00") }, attendees: [me, { email: "a@example.edu" }, { email: "khale@example.edu" }] },
      { id: "4", summary: "Declined thing", start: { dateTime: at(1, "11:00") }, attendees: [{ ...me, responseStatus: "declined" }] },
      { id: "5", summary: "Cancelled", status: "cancelled", start: { dateTime: at(1, "12:00") } },
      { id: "6", summary: "Home", eventType: "workingLocation", start: { date: addDays(today, 1) } },
      { id: "7", summary: "Board retreat", start: { date: addDays(today, 2) }, end: { date: addDays(today, 3) } },
    ];
    expect(await storeCalendarEvents(c, { email: "alex@example.edu", area: "work" }, events, TZ)).toBe(4);

    const stored = await listCalendarEvents(c.db, today, addDays(today, 14));
    expect(stored.map((e) => e.title)).toEqual(["Cabinet", "Board retreat", "Kai / Alex", "Greta and Alex 1:1"]);
    expect(stored.find((e) => e.title === "Cabinet")!.person_id).toBeNull(); // a group meeting is not a 1:1
    expect(stored.find((e) => e.title === "Board retreat")).toMatchObject({ all_day: 1, day: addDays(today, 2) });
    expect(await listCalendarEvents(c.db, today, addDays(today, 14), ["personal"])).toEqual([]);

    const k = (await getOneOnOne(c.db, kai.id))!;
    expect(k).toMatchObject({ next_expected: addDays(today, 3), next_is_estimate: false, next_starts_at: new Date(at(3, "08:30")).toISOString() });
    expect((await getOneOnOne(c.db, greta.id))!.next_expected).toBe(addDays(today, 5)); // matched by first name in the title
    expect((await getHome(c.db)).calendar).toHaveLength(4);

    // The next sync replaces the copy: a meeting that was moved or cancelled does not linger.
    await storeCalendarEvents(c, { email: "alex@example.edu", area: "work" }, [events[2]!], TZ);
    expect(await listCalendarEvents(c.db, today, addDays(today, 14))).toHaveLength(1);
    expect((await getOneOnOne(c.db, kai.id))!.next_starts_at).toBeNull();
    expect((await listGoogleAccounts(c.db))[0]!.calendar_synced_at).not.toBeNull();
  });
});

describe("background sync", () => {
  it("does nothing when no calendar is connected", async () => {
    const c = ctx();
    expect(await runSync({ db: c.db })).toEqual({ calendar: [] });
    // An account whose saved sign-in cannot be read is reported on that account, not thrown.
    await saveGoogleAccount(c, MASTER, { email: "alex@example.edu", area: "work", refreshToken: "t", scopes: "" });
    await setSecret(c, MASTER, "google_client_id", "id.apps.googleusercontent.com");
    await setSecret(c, MASTER, "google_client_secret", "secret");
    expect(await runSync({ db: c.db, connectionsKey: "a-different-master-key-entirely" })).toEqual({ calendar: [] });
  });

});
