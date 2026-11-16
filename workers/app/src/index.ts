// Main Worker. Serves the built React app (static assets) and the JSON API under /api.
// Every /api request must pass Cloudflare Access verification (src/access.ts).
// All data access goes through @pd/core. No SQL here.

import { Hono } from "hono";
import { ZodError, z } from "zod";
import {
  AREAS, AmbiguousError, InputError, NotFoundError, PROJECT_STATUSES, ENTRY_KINDS, d1, formatZodError,
  addEntry, addLink, addTask, archivePerson, archiveProject, createPerson, createProject, deleteEntry,
  deleteLink, deleteTask, exportAll, exportHtml, getHome, getPersonDetail, getProjectDetail, getSettings,
  linkPersonToProject, listAudit, listPeople, listProjects, listTags, listTimeline, reorderProjects,
  reorderTasks, restorePerson, restoreProject, search, undoAudit, unlinkPersonFromProject, updateEntry,
  updateLink, updatePerson, updateProject, updateSettings, updateTask, projectPersonSchema,
  projectReorderSchema, reorderSchema, todayInTz, endOneOnOne, 
  importOmniFocus, listOneOnOnes, getOneOnOne, getTagView, listTasks, taskFilterSchema, 
  createSavedView, deleteSavedView, listSavedViews, openSavedView, updateSavedView, setOneOnOne,
  clearSecret, disconnectGoogleAccount, finishGoogleSignIn, googleKeys, googleSignInUrl,
  listGoogleAccounts, listSecrets, runSync, addTimeBlock, updateTimeBlock, deleteTimeBlock, saveMeetingNote, saveGoogleAccount, setGoogleAccountArea, setSecret, signValue, lastAuditBy, latestRuns, listDailyLogs,
  type Area, type Ctx, type Db, type EntryKind, type ProjectFilter, type ProjectStatus, type SyncEnv,
} from "@pd/core";
import { verifyAccess, type AccessEnv } from "@pd/core";
import { WEB_ASSETS } from "./web-assets.generated";

interface Env extends AccessEnv {
  DB: D1Database;
  MCP_URL?: string;
  CALENDAR_URL?: string;
  MCP_TOKEN?: string;
  ICS_TOKEN?: string;
  /**
   * A long random secret. Keys and Google sign-ins saved in Settings are encrypted with it, so
   * the database never holds a usable key. Without it, connections cannot be saved.
   */
  CONNECTIONS_KEY?: string;
}

/** What the background sync needs from this Worker. */
function syncEnv(env: Env): SyncEnv {
  return { db: d1(env.DB), connectionsKey: env.CONNECTIONS_KEY };
}

type Vars = { db: Db; ctx: Ctx; email: string };
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// ---------- auth (fail closed) ----------
app.use("/api/*", async (c, next) => {
  const result = await verifyAccess(c.req.raw, c.env);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  const db = d1(c.env.DB);
  c.set("db", db);
  c.set("email", result.email);
  c.set("ctx", { db, actor: "web" });
  c.header("Cache-Control", "no-store");
  await next();
});

// ---------- helpers ----------
function list(value: string | undefined): string[] {
  return (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}
function areasOf(value: string | undefined): Area[] | undefined {
  const a = list(value).filter((x): x is Area => (AREAS as readonly string[]).includes(x));
  return a.length ? a : undefined;
}
async function body(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new InputError("Request body must be JSON");
  }
}

app.onError((err, c) => {
  if (err instanceof ZodError) return c.json({ error: formatZodError(err) }, 400);
  if (err instanceof AmbiguousError) return c.json({ error: err.message, candidates: err.candidates }, 409);
  if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
  if (err instanceof InputError) return c.json({ error: err.message }, 400);
  console.error(err);
  return c.json({ error: "Something went wrong on the server. Check the Worker logs." }, 500);
});

// ---------- home, settings, me ----------
app.get("/api/home", async (c) => c.json(await getHome(c.var.db, areasOf(c.req.query("areas")))));

app.get("/api/me", async (c) => {
  const mask = (t?: string) => (t ? `${t.slice(0, 4)}…${t.slice(-4)}` : null);
  return c.json({
    email: c.var.email,
    mcp_url: c.env.MCP_URL ?? null,
    calendar_url: c.env.CALENDAR_URL ?? null,
    mcp_token_masked: mask(c.env.MCP_TOKEN),
    ics_token_masked: mask(c.env.ICS_TOKEN),
    // Full values are only sent when asked for (the copy button), never cached.
    mcp_token: c.req.query("reveal") === "1" ? c.env.MCP_TOKEN ?? null : null,
    ics_token: c.req.query("reveal") === "1" ? c.env.ICS_TOKEN ?? null : null,
  });
});

app.get("/api/settings", async (c) => c.json(await getSettings(c.var.db)));
app.patch("/api/settings", async (c) => c.json(await updateSettings(c.var.ctx, await body(c))));

// ---------- projects ----------
const SORTS = ["board", "priority", "due", "activity", "title", "created"] as const;
app.get("/api/projects", async (c) => {
  const q = c.req.query();
  const statuses = list(q.status).filter((s): s is ProjectStatus => (PROJECT_STATUSES as readonly string[]).includes(s));
  const filter: ProjectFilter = {
    areas: areasOf(q.areas ?? q.area),
    statuses: statuses.length ? statuses : undefined,
    person: q.person || undefined,
    tag: q.tag || undefined,
    q: q.q || undefined,
    includeArchived: q.archived === "1" || q.archived === "true",
    sort: (SORTS as readonly string[]).includes(q.sort ?? "") ? (q.sort as ProjectFilter["sort"]) : "board",
  };
  return c.json(await listProjects(c.var.db, filter));
});
app.post("/api/projects", async (c) => c.json(await createProject(c.var.ctx, await body(c)), 201));
app.post("/api/projects/reorder", async (c) => {
  const { ids, status } = projectReorderSchema.parse(await body(c));
  await reorderProjects(c.var.ctx, ids, status);
  return c.json({ ok: true });
});
app.get("/api/projects/:id", async (c) => {
  const p = await getProjectDetail(c.var.db, c.req.param("id"));
  if (!p) throw new NotFoundError("Project not found");
  return c.json(p);
});
app.patch("/api/projects/:id", async (c) => c.json(await updateProject(c.var.ctx, c.req.param("id"), await body(c))));
app.post("/api/projects/:id/archive", async (c) => c.json(await archiveProject(c.var.ctx, c.req.param("id"))));
app.post("/api/projects/:id/restore", async (c) => c.json(await restoreProject(c.var.ctx, c.req.param("id"))));
app.get("/api/projects/:id/timeline", async (c) => {
  const kinds = list(c.req.query("kind")).filter((k): k is EntryKind => (ENTRY_KINDS as readonly string[]).includes(k));
  return c.json(
    await listTimeline(c.var.db, {
      projectId: c.req.param("id"),
      kinds: kinds.length ? kinds : undefined,
      before: c.req.query("before") || undefined,
      limit: Number(c.req.query("limit") ?? 100),
    }),
  );
});
app.post("/api/projects/:id/people", async (c) => {
  const { person_id, role } = projectPersonSchema.parse(await body(c));
  return c.json(await linkPersonToProject(c.var.ctx, c.req.param("id"), person_id, role), 201);
});
app.delete("/api/projects/:id/people/:personId", async (c) => {
  await unlinkPersonFromProject(c.var.ctx, c.req.param("id"), c.req.param("personId"));
  return c.json({ ok: true });
});

// ---------- entries ----------
app.get("/api/entries", async (c) => {
  const kinds = list(c.req.query("kind")).filter((k): k is EntryKind => (ENTRY_KINDS as readonly string[]).includes(k));
  return c.json(await listTimeline(c.var.db, { areas: areasOf(c.req.query("areas")), kinds: kinds.length ? kinds : undefined, limit: Number(c.req.query("limit") ?? 50), before: c.req.query("before") || undefined }));
});
app.post("/api/entries", async (c) => {
  const input = (await body(c)) as Record<string, unknown>;
  const { entry, duplicate } = await addEntry(c.var.ctx, { ...input, source: "web" });
  return c.json({ ...entry, duplicate }, duplicate ? 200 : 201);
});
app.patch("/api/entries/:id", async (c) => c.json(await updateEntry(c.var.ctx, c.req.param("id"), await body(c))));
app.post("/api/entries/:id/delete", async (c) => {
  await deleteEntry(c.var.ctx, c.req.param("id"));
  return c.json({ ok: true });
});

// ---------- tasks ----------
// The task list. Simple cases use the address: ?person=<id> for one person's tasks, ?done=1
// to include ones finished in the last two weeks.
app.get("/api/tasks", async (c) => {
  const q = c.req.query();
  return c.json(await listTasks(c.var.db, { areas: areasOf(q.areas), person_id: q.person || undefined, state: q.done === "1" ? "any" : "open" }));
});
// Any filter (the Tasks page, a saved view before it is saved). The body is a TaskFilter.
app.post("/api/tasks/search", async (c) => c.json(await listTasks(c.var.db, taskFilterSchema.parse(await body(c)))));

// ---------- saved views ----------
app.get("/api/views", async (c) => c.json(await listSavedViews(c.var.db)));
app.post("/api/views", async (c) => c.json(await createSavedView(c.var.ctx, await body(c)), 201));
app.get("/api/views/:id", async (c) => c.json(await openSavedView(c.var.db, c.req.param("id"))));
app.patch("/api/views/:id", async (c) => c.json(await updateSavedView(c.var.ctx, c.req.param("id"), await body(c))));
app.post("/api/views/:id/delete", async (c) => {
  await deleteSavedView(c.var.ctx, c.req.param("id"));
  return c.json({ ok: true });
});

app.post("/api/tasks", async (c) => c.json(await addTask(c.var.ctx, await body(c)), 201));
app.post("/api/tasks/reorder", async (c) => {
  const { ids } = reorderSchema.parse(await body(c));
  await reorderTasks(c.var.ctx, ids);
  return c.json({ ok: true });
});
app.patch("/api/tasks/:id", async (c) => c.json(await updateTask(c.var.ctx, c.req.param("id"), await body(c))));
app.post("/api/tasks/:id/delete", async (c) => {
  await deleteTask(c.var.ctx, c.req.param("id"));
  return c.json({ ok: true });
});

// ---------- time blocks (the planner) ----------
app.post("/api/blocks", async (c) => c.json(await addTimeBlock(c.var.ctx, await body(c)), 201));
app.patch("/api/blocks/:id", async (c) => c.json(await updateTimeBlock(c.var.ctx, c.req.param("id"), await body(c))));
app.post("/api/blocks/:id/delete", async (c) => {
  await deleteTimeBlock(c.var.ctx, c.req.param("id"));
  return c.json({ ok: true });
});

// ---------- a meeting's note ----------
app.put("/api/meetings/:id/note", async (c) => c.json(await saveMeetingNote(c.var.ctx, c.req.param("id"), await body(c))));

// ---------- links ----------
app.post("/api/links", async (c) => c.json(await addLink(c.var.ctx, await body(c)), 201));
app.patch("/api/links/:id", async (c) => c.json(await updateLink(c.var.ctx, c.req.param("id"), await body(c))));
app.post("/api/links/:id/delete", async (c) => {
  await deleteLink(c.var.ctx, c.req.param("id"));
  return c.json({ ok: true });
});

// ---------- people ----------
app.get("/api/people", async (c) =>
  c.json(await listPeople(c.var.db, { areas: areasOf(c.req.query("areas")), q: c.req.query("q") || undefined, includeArchived: c.req.query("archived") === "1" })),
);
app.post("/api/people", async (c) => c.json(await createPerson(c.var.ctx, await body(c)), 201));
app.get("/api/people/:id", async (c) => {
  const p = await getPersonDetail(c.var.db, c.req.param("id"), areasOf(c.req.query("areas")));
  if (!p) throw new NotFoundError("Person not found");
  return c.json(p);
});
app.patch("/api/people/:id", async (c) => c.json(await updatePerson(c.var.ctx, c.req.param("id"), await body(c))));
app.post("/api/people/:id/archive", async (c) => c.json(await archivePerson(c.var.ctx, c.req.param("id"))));
app.post("/api/people/:id/restore", async (c) => c.json(await restorePerson(c.var.ctx, c.req.param("id"))));

// ---------- when the scheduled morning brief last ran ----------
app.get("/api/runs", async (c) => c.json(await latestRuns(c.var.db)));

// The daily log, newest day first. It is written by the chatbot; the site only shows it.
app.get("/api/log", async (c) => c.json(await listDailyLogs(c.var.db, { limit: Number(c.req.query("limit")) || 60 })));

// ---------- 1:1s ----------
app.get("/api/one-on-ones", async (c) => c.json(await listOneOnOnes(c.var.db, areasOf(c.req.query("areas")))));
app.get("/api/one-on-ones/:personId", async (c) => {
  const o = await getOneOnOne(c.var.db, c.req.param("personId"));
  if (!o) throw new NotFoundError("No 1:1 with this person");
  return c.json(o);
});
app.put("/api/one-on-ones/:personId", async (c) => c.json(await setOneOnOne(c.var.ctx, c.req.param("personId"), await body(c))));
app.delete("/api/one-on-ones/:personId", async (c) => {
  await endOneOnOne(c.var.ctx, c.req.param("personId"));
  return c.json({ ok: true });
});

// ---------- connections: Google Calendar, OmniFocus ----------
// Where Google sends the owner back to after he signs in. This exact address has to be listed on
// the Google sign-in client (Settings shows it to copy).
const googleRedirect = (c: { req: { url: string } }) => `${new URL(c.req.url).origin}/api/connections/google/callback`;

function connectionsKey(env: Env): string {
  if (!env.CONNECTIONS_KEY) throw new InputError("Connections are not switched on yet: the CONNECTIONS_KEY secret is missing on the main Worker.");
  return env.CONNECTIONS_KEY;
}

// Everything Settings shows about connections. Never includes a key or a token.
app.get("/api/connections", async (c) => {
  return c.json({
    ready: !!c.env.CONNECTIONS_KEY,
    redirect_uri: googleRedirect(c),
    secrets: await listSecrets(c.var.db),
    google: await listGoogleAccounts(c.var.db),
  });
});
app.put("/api/connections/secrets/:key", async (c) => {
  const { value } = z.object({ value: z.string().min(1).max(4000) }).parse(await body(c));
  await setSecret(c.var.ctx, connectionsKey(c.env), c.req.param("key"), value);
  return c.json({ ok: true });
});
app.delete("/api/connections/secrets/:key", async (c) => {
  await clearSecret(c.var.ctx, c.req.param("key"));
  return c.json({ ok: true });
});

// Connecting a Google account is two page loads, not API calls: the browser goes to Google and
// comes back. `state` says which desk the account is for and is signed, so a link made anywhere
// else is refused.
app.get("/api/connections/google/start", async (c) => {
  const area = areasOf(c.req.query("area"))?.[0];
  if (!area) throw new InputError("Say which desk this account belongs to.");
  const master = connectionsKey(c.env);
  const keys = await googleKeys(c.var.db, master);
  if (!keys) throw new InputError("Add the Google client ID and secret in Settings first.");
  const payload = `${area}.${Date.now() + 15 * 60_000}`;
  return c.redirect(googleSignInUrl(keys, googleRedirect(c), `${payload}.${await signValue(master, payload)}`));
});
app.get("/api/connections/google/callback", async (c) => {
  const back = (params: Record<string, string>) => c.redirect(`/settings?${new URLSearchParams(params)}`);
  try {
    const master = connectionsKey(c.env);
    const [area, expires, sig] = (c.req.query("state") ?? "").split(".");
    const valid = area && expires && sig && sig === (await signValue(master, `${area}.${expires}`)) && Number(expires) > Date.now();
    if (!valid || !(AREAS as readonly string[]).includes(area)) throw new Error("That sign-in link has expired. Start again from Settings.");
    if (c.req.query("error")) throw new Error(c.req.query("error") === "access_denied" ? "Google sign-in was cancelled." : `Google said: ${c.req.query("error")}`);
    const keys = await googleKeys(c.var.db, master);
    if (!keys) throw new Error("The Google client ID and secret are missing.");
    const account = await finishGoogleSignIn(keys, googleRedirect(c), c.req.query("code") ?? "");
    await saveGoogleAccount(c.var.ctx, master, { ...account, area: area as Area });
    // Fill the calendar right away, so the dashboard is not empty.
    c.executionCtx.waitUntil(runSync(syncEnv(c.env)).catch((e) => console.error("Sync after connecting failed", e)));
    return back({ connected: account.email });
  } catch (e) {
    return back({ connect_error: e instanceof Error ? e.message : String(e) });
  }
});
app.patch("/api/connections/google/:email", async (c) => {
  const { area } = z.object({ area: z.enum(AREAS) }).parse(await body(c));
  await setGoogleAccountArea(c.var.ctx, c.req.param("email"), area);
  return c.json({ ok: true });
});
app.delete("/api/connections/google/:email", async (c) => {
  await disconnectGoogleAccount(c.var.ctx, c.req.param("email"));
  return c.json({ ok: true });
});

// Run the background sync now (the calendars). The same sync runs on a timer (see `scheduled`).
app.post("/api/sync", async (c) => c.json(await runSync(syncEnv(c.env))));
// Load 1:1 lists from an OmniFocus export file (the JSON the export script writes).
app.post("/api/import/omnifocus", async (c) => {
  const ctx: Ctx = { db: c.var.db, actor: "import:omnifocus" };
  return c.json(await importOmniFocus(ctx, (await body(c)) as any));
});

// ---------- tags, search, audit ----------
app.get("/api/tags", async (c) => c.json(await listTags(c.var.db)));
// Everything that carries one tag: tasks, notes and projects.
app.get("/api/tags/:name", async (c) => c.json(await getTagView(c.var.db, c.req.param("name"), areasOf(c.req.query("areas")))));
app.get("/api/search", async (c) => c.json(await search(c.var.db, c.req.query("q") ?? "", areasOf(c.req.query("areas")))));
app.get("/api/audit", async (c) => {
  const limit = z.coerce.number().int().min(1).max(1000).catch(100).parse(c.req.query("limit"));
  return c.json(await listAudit(c.var.db, { limit, actor: c.req.query("actor") || undefined }));
});
// Undo the most recent change made on the website. Used by the "Undo" button on the toast
// that follows a delete or a cleared queue item.
app.post("/api/audit/undo-last", async (c) => {
  const last = await lastAuditBy(c.var.db, "web");
  if (!last) return c.json({ error: "Nothing to undo" }, 400);
  const r = await undoAudit(c.var.ctx, last.id);
  return r.ok ? c.json(r) : c.json({ error: r.error }, 400);
});
app.post("/api/audit/:id/undo", async (c) => {
  const r = await undoAudit(c.var.ctx, c.req.param("id"));
  return r.ok ? c.json(r) : c.json({ error: r.error }, 400);
});

// ---------- exports ----------
app.get("/api/export.json", async (c) => {
  const data = await exportAll(c.var.db);
  c.header("Content-Disposition", `attachment; filename="project-dashboard-${todayInTz()}.json"`);
  return c.json(data);
});
app.get("/api/export.html", async (c) => {
  const data = await exportAll(c.var.db);
  const s = await getSettings(c.var.db);
  c.header("Content-Disposition", `attachment; filename="project-dashboard-${todayInTz(s.timezone)}.html"`);
  return c.html(exportHtml(data, s.timezone));
});

app.all("/api/*", (c) => c.json({ error: "No such API route" }, 404));

// Anything else is the React app. Hashed files under /assets/ are cached for a year;
// every other path gets index.html so the React router can handle it.
app.get("*", (c) => {
  const path = new URL(c.req.url).pathname;
  const file = WEB_ASSETS[path] ?? WEB_ASSETS["/index.html"]!;
  const body = file.base64 ? Uint8Array.from(atob(file.body), (ch) => ch.charCodeAt(0)) : file.body;
  return new Response(body, {
    headers: {
      "Content-Type": file.type,
      "Cache-Control": path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
    },
  });
});

export default {
  fetch: app.fetch,
  // Runs on the timer set in wrangler.jsonc (`triggers.crons`): keeps the calendar copy current
  // without anyone opening the site. Does nothing until a calendar is connected.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runSync(syncEnv(env)).catch((e) => console.error("Background sync failed", e)));
  },
};
