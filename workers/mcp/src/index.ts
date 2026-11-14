// MCP Worker.
//   /mcp            Remote MCP server (Streamable HTTP, stateless). Two ways in:
//                     1. OAuth sign-in, for chat apps such as Claude on the web and phone.
//                     2. Authorization: Bearer <MCP_TOKEN>, for Claude Code and scripts.
//   /authorize      OAuth consent page. Behind Cloudflare Access, and verified again here.
//   /oauth/token, /oauth/register, /.well-known/...   Served by the OAuth library.
//   /calendar.ics   iCalendar feed of due dates. Needs ?token=<ICS_TOKEN>.
//   /health         Liveness check, no data.
// Fails closed: with no valid OAuth token and no matching MCP_TOKEN, /mcp answers 401.

import { OAuthProvider, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import { calendarFeed, d1, dbKv, safeEqual, type AccessEnv, type Ctx } from "@pd/core";
import { clientSlug, handleAuthorize } from "./authorize";
import { buildServer } from "./tools";

interface Env extends AccessEnv {
  DB: D1Database;
  MCP_TOKEN?: string;
  ICS_TOKEN?: string;
  APP_URL: string;
  /** Public address of this Worker, no trailing slash. Overridden with --var for local dev. */
  PUBLIC_URL: string;
  /** The same secret as on the main Worker. Lets the mail tools use the Google sign-ins saved in Settings. */
  CONNECTIONS_KEY?: string;
  /** Set to "1" to record each request (never tokens) in oauth_kv under debug:* for one day. */
  DEBUG_LOG?: string;
  OAUTH_KV: ReturnType<typeof dbKv>;
  OAUTH_PROVIDER: OAuthHelpers;
}

interface Props {
  /** Short client label: "claude", "grok", ... Becomes the actor "mcp:<client>". */
  client: string;
}

const CLIENT_INFO_KEY = "io.modelcontextprotocol/clientInfo";
const SCOPE = "dashboard";

/** For bearer-token callers: X-Client-Name header, ?client=, MCP clientInfo, then User-Agent. */
async function clientFromRequest(req: Request): Promise<string> {
  const url = new URL(req.url);
  let name = req.headers.get("X-Client-Name") ?? url.searchParams.get("client");
  if (!name && req.method === "POST") {
    try {
      const body = (await req.clone().json()) as any;
      for (const m of Array.isArray(body) ? body : [body]) {
        name = m?.params?.clientInfo?.name ?? m?.params?._meta?.[CLIENT_INFO_KEY]?.name ?? null;
        if (name) break;
      }
    } catch {
      /* not JSON; fall through */
    }
  }
  // The Claude app's connector service sends no client name on tool calls; it is the only
  // caller that uses this User-Agent with the token.
  if (!name && /claude|python-httpx/i.test(req.headers.get("User-Agent") ?? "")) name = "claude";
  return clientSlug(name) ?? "unknown";
}

/** The protected MCP endpoint. Only reached with a valid OAuth token or the MCP_TOKEN. */
const mcpHandler = {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const props = (ctx as ExecutionContext & { props?: Props }).props;
    const callCtx: Ctx = { db: d1(env.DB), actor: `mcp:${props?.client ?? "unknown"}` };
    return createMcpHandler(() => buildServer(callCtx, (env.OWNER_EMAIL ?? "").split(",")[0]!.trim(), env.APP_URL), { route: "/mcp" })(req, env, ctx);
  },
};

/** Everything that is not /mcp or an OAuth library endpoint. */
const defaultHandler = {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");
    if (url.pathname === "/authorize") return handleAuthorize(req, env, env.OAUTH_PROVIDER);
    if (url.pathname === "/calendar.ics") {
      const deny = (message: string, status: number) =>
        new Response(JSON.stringify({ error: message }), { status, headers: { "Content-Type": "application/json" } });
      if (!env.ICS_TOKEN) return deny("Calendar feed is not configured.", 503);
      if (!safeEqual(url.searchParams.get("token") ?? "", env.ICS_TOKEN)) return deny("Missing or wrong token.", 401);
      return new Response(await calendarFeed(d1(env.DB), env.APP_URL), {
        headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=900" },
      });
    }
    return new Response("Not found", { status: 404 });
  },
};

function provider(env: Env) {
  const resource = `${env.PUBLIC_URL}/mcp`;
  return new OAuthProvider<Env>({
    apiRoute: "/mcp",
    apiHandler: mcpHandler as any,
    defaultHandler: defaultHandler as any,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    // Client ID Metadata Documents are off. Apps register themselves through /oauth/register, which
    // is the route confirmed working with Claude (Nov 2026). CIMD was never confirmed either way:
    // the early failures turned out to come from the desktop app's add-connector dialog.
    clientIdMetadataDocumentEnabled: false,
    scopesSupported: [SCOPE],
    requiredScopes: [SCOPE],
    resourceMetadata: { resource, authorization_servers: [env.PUBLIC_URL], resource_name: "Project dashboard" },
    accessTokenTTL: 3600,
    // Stay connected as long as the app is used at least once every 90 days.
    refreshTokenTTL: 90 * 86400,
    refreshTokenIdleTTL: 90 * 86400,
    // The long-lived MCP_TOKEN keeps working for Claude Code and scripts.
    onError: (e) => {
      if (env.DEBUG_LOG === "1") {
        void env.OAUTH_KV.put(`debug:${Date.now()}:oauth-error`, JSON.stringify({ code: e.code, description: e.description, status: e.status, internal: (e as any).internal }), { expirationTtl: 86400 });
      }
    },
    resolveExternalToken: async ({ token, request, env }) => {
      if (!env.MCP_TOKEN || !safeEqual(token, env.MCP_TOKEN)) return null;
      return { props: { client: await clientFromRequest(request) } satisfies Props, audience: resource };
    },
  });
}

const DISCOVERY_ALIASES: Record<string, string> = {
  "/.well-known/oauth-protected-resource": "/.well-known/oauth-protected-resource/mcp",
  "/.well-known/oauth-authorization-server/mcp": "/.well-known/oauth-authorization-server",
  "/.well-known/openid-configuration": "/.well-known/oauth-authorization-server",
  "/.well-known/openid-configuration/mcp": "/.well-known/oauth-authorization-server",
  "/mcp/.well-known/openid-configuration": "/.well-known/oauth-authorization-server",
};

/** Troubleshooting aid (DEBUG_LOG=1): records what was asked and what was answered. No tokens or cookies. */
async function debugLogged(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  let reqBody = "";
  if (req.method === "POST" && url.pathname !== "/authorize") reqBody = (await req.clone().text()).slice(0, 600).replace(/(code|refresh_token|code_verifier|client_secret|access_token)=[^&]+/g, "$1=…");
  let res: Response;
  let thrown = "";
  try {
    res = await provider(env).fetch(req, env, ctx);
  } catch (e) {
    thrown = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    res = new Response("Internal error", { status: 500 });
  }
  let resBody = "";
  if (res.status >= 400) resBody = (await res.clone().text()).slice(0, 400);
  const auth = req.headers.get("Authorization");
  await env.OAUTH_KV.put(
    `debug:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`,
    JSON.stringify({
      m: req.method, path: url.pathname, query: url.search.replace(/=[^&]*/g, "").slice(0, 200), client_id: url.searchParams.get("client_id"),
      redirect_uri: url.searchParams.get("redirect_uri"), ua: req.headers.get("User-Agent"), accept: req.headers.get("Accept"),
      proto: req.headers.get("MCP-Protocol-Version"), auth: auth ? `${auth.split(" ")[0]} (${auth.length} chars)` : null,
      access_jwt: !!req.headers.get("Cf-Access-Jwt-Assertion"), status: res.status, location: (res.headers.get("Location") ?? "").replace(/code=[^&]+/, "code=…").slice(0, 200),
      reqBody, resBody, thrown,
    }),
    { expirationTtl: 86400 },
  );
  return res;
}

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // The OAuth library stores its records through env.OAUTH_KV; back it with the D1 table.
    const withStore: Env = { ...env, OAUTH_KV: dbKv(d1(env.DB)) };
    // Some apps look for the discovery documents at alternate addresses. Answer those with the
    // same documents the OAuth library serves at its standard ones.
    const alias = DISCOVERY_ALIASES[new URL(req.url).pathname];
    if (alias && req.method === "GET") req = new Request(new URL(alias, req.url), req);
    if (env.DEBUG_LOG !== "1") return provider(withStore).fetch(req, withStore, ctx);
    return debugLogged(req, withStore, ctx);
  },
} satisfies ExportedHandler<Env>;
