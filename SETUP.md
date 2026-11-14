# Setting up your own copy

Written for you and your AI together. Each step says who does it: **You** (something only a
person can do, usually pressing buttons in a website) or **AI** (Claude Code or similar, working
in your copy of this repository).

AI: read `CLAUDE.md` first. Do one step at a time and confirm it worked before the next. Never
ask the owner to paste a secret into the chat; have them put it where the step says. These steps
were written from the first owner's working setup, not re-run on a fresh account, so if
Cloudflare's screens or commands have changed, check Cloudflare's current documentation and say
so plainly instead of guessing.

Every blank to fill in is written `YOUR-...` or `YOUR_...`. To see them all:

```bash
grep -rn "YOUR[-_]" --include=*.jsonc --include=*.md .
```

## 0. Look at it first (optional, no accounts needed)

**AI:**

```bash
npm install
```

```bash
npm run db:migrate:local
```

```bash
npm run seed:local
```

```bash
npm run build:web
```

```bash
cd workers/app && npx wrangler dev --var ENVIRONMENT:local --var CONNECTIONS_KEY:any-long-local-value
```

It is then at http://localhost:8787 with made-up sample data. Sign-in is skipped only on
localhost.

## 1. Your copy must be private

**You:** on GitHub, open your copy, then Settings, and check that it says Private. The nightly
backup saves your whole database into the repository. (The backup refuses to run if the
repository is public.)

## 2. Cloudflare account and a key for GitHub

**You:**

1. Create a Cloudflare account at dash.cloudflare.com if you do not have one.
2. Note your **Account ID** (shown on the Workers & Pages overview page).
3. Open Workers & Pages once so Cloudflare gives you a `workers.dev` address. Note the
   subdomain: in `something.workers.dev` it is the `something`.
4. Create an API token (My Profile, API Tokens, Create Token, Custom token) with these
   permissions: **Workers Scripts: Edit**, **D1: Edit**, **Access: Apps and Policies: Edit**,
   **Account Settings: Read**, **User Details: Read**.
5. In your GitHub repository: Settings, Secrets and variables, Actions. Add two repository
   secrets: `CLOUDFLARE_API_TOKEN` (the token) and `CLOUDFLARE_ACCOUNT_ID`.

If you work in Claude Code on the web, also give that environment access to Cloudflare so the
AI can run the commands below. Ask it how; it has current instructions for that.

## 3. Create the database

**AI:**

```bash
npx wrangler d1 create project-dashboard
```

Put the `database_id` it prints into **both** `workers/app/wrangler.jsonc` and
`workers/mcp/wrangler.jsonc`, replacing `YOUR_D1_DATABASE_ID`.

## 4. Fill in your addresses

**AI:** replace `YOUR-SUBDOMAIN` everywhere (the two `wrangler.jsonc` files, `README.md`,
`CLAUDE.md`, `docs/automations/`) with the subdomain from step 2.

## 5. Lock it to you (Cloudflare Access)

The website must only open for you. Until this is done the app refuses every request; it never
falls back to open.

**You** (in the Cloudflare dashboard, under Zero Trust; the AI can do most of this through the
Cloudflare API if you prefer, with the token from step 2):

1. Open Zero Trust and choose a team name. That is `YOUR-TEAM`.
2. Keep the login method **One-time PIN** (a code sent to your email).
3. Add a self-hosted application named "Project dashboard" for
   `project-dashboard.YOUR-SUBDOMAIN.workers.dev`, session length 30 days, with one policy that
   allows only your email address.
4. Add a second self-hosted application, "Project dashboard MCP sign-in", for the single path
   `project-dashboard-mcp.YOUR-SUBDOMAIN.workers.dev/authorize`, with the same policy. The rest
   of that address is deliberately not behind Access (chatbots have to reach it); it is
   protected by sign-in tokens instead.
5. Each application has an **Application Audience (AUD) tag**. Copy both.

**AI:** in `workers/app/wrangler.jsonc` set `ACCESS_TEAM_DOMAIN` (replace `YOUR-TEAM`) and
`ACCESS_AUD` (the first application's tag). In `workers/mcp/wrangler.jsonc` set
`ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` (the second application's tag, replacing
`YOUR_MCP_ACCESS_AUD`). Replace `YOUR-TEAM` in `CLAUDE.md` too.

## 6. First deploy

**AI:** commit the changes and push to `main`. The Deploy action builds, tests, creates the
tables and puts both Workers online. It also creates the `CONNECTIONS_KEY` secret on both
Workers the first time. Watch the run and fix anything it reports.

## 7. The secrets

Secrets are set after the first deploy, because the Workers have to exist. Each command asks for
the value; nothing is written to the repository.

**You or AI:** your login email, on both Workers:

```bash
npx wrangler secret put OWNER_EMAIL -c workers/app/wrangler.jsonc
```

```bash
npx wrangler secret put OWNER_EMAIL -c workers/mcp/wrangler.jsonc
```

**AI:** two long random tokens (for example from `openssl rand -hex 32`), each set to the
**same value on both Workers**. `MCP_TOKEN` is the key for Claude Code and scripts; `ICS_TOKEN`
is the key for the calendar feed.

```bash
npx wrangler secret put MCP_TOKEN -c workers/app/wrangler.jsonc
```

```bash
npx wrangler secret put MCP_TOKEN -c workers/mcp/wrangler.jsonc
```

```bash
npx wrangler secret put ICS_TOKEN -c workers/app/wrangler.jsonc
```

```bash
npx wrangler secret put ICS_TOKEN -c workers/mcp/wrangler.jsonc
```

## 8. Open it

**You:** go to `https://project-dashboard.YOUR-SUBDOMAIN.workers.dev`. Cloudflare asks for your
email and sends a code. The dashboard opens, empty.

To start with the sample data instead (optional; replace it later): `npm run seed:remote`.

## 9. Connect your chatbot (this is the main way you will use it)

**You**, in Claude (web, phone and desktop share connectors):

1. In a web browser, go to claude.ai/settings/connectors. (Use the website for this; adding it
   from the desktop app's dialog failed when this was first set up.)
2. Choose **Add custom connector**, give it a name, and paste
   `https://project-dashboard-mcp.YOUR-SUBDOMAIN.workers.dev/mcp`.
3. Press **Add**, sign in with your email code, then press **Allow**.

Then ask it: "put a task on my dashboard: try the new dashboard". It should answer in one line
with a link, and the task should be on the website.

**Other chatbots** that can add an MCP connector by signing in only need the same address.
Ones that take a header instead need two: `Authorization: Bearer <MCP_TOKEN>` (Settings on
the dashboard has **Copy token**) and `X-Client-Name: <the chatbot's name>`, so the Activity
page shows who made each change.

**Claude Code** (AI): ask the owner to copy the token from Settings and run, in their own terminal:

```bash
claude mcp add --transport http --scope user project-dashboard https://project-dashboard-mcp.YOUR-SUBDOMAIN.workers.dev/mcp --header "Authorization: Bearer PASTE_TOKEN" --header "X-Client-Name: claude"
```

The server gives every chatbot standing instructions when it connects (how to add a task, never
to guess a person, to show proposed changes before writing). They are `INSTRUCTIONS` in
`workers/mcp/src/tools.ts`. Rewrite them for the new owner in step 11.

## 10. Optional extras

- **Google Calendar** (today's meetings and 1:1 dates): the Settings page of the dashboard shows
  the steps. You create your own Google sign-in client; the site asks only to read your calendar.
- **Calendar feed of due dates**: Settings, Copy URL, then subscribe in your calendar app.
- **Morning brief**: a scheduled Claude task; the prompt is in `docs/automations/`.
- **Your own domain** (for example `dash.example.com`): see the comment near the top of
  `workers/app/wrangler.jsonc`. Add the domain to the Cloudflare Access application too, and
  change `APP_URL` in `workers/mcp/wrangler.jsonc` so the chatbot's links point at it.

## 11. Make it yours

**AI:**

- **Time zone.** Times are shown in `America/New_York`. Search for that text and change it in
  each place (`apps/web/src/lib/time.ts`, `apps/web/src/pages/Activity.tsx`,
  `packages/core/src/util.ts`, `workers/mcp/src/tools.ts`, the tests, and the `TZ` line and the
  two cron lines in `.github/workflows/backup.yml`). `migrations/0001_initial.sql` also sets it,
  but an applied migration is never edited: add a new migration that updates the `timezone`
  setting. Run `npm run typecheck && npm test` afterwards.
- **The three desks.** Work, Personal and Side business. `CLAUDE.md` says where to rename one or
  add a fourth.
- **The chatbot's standing instructions.** `INSTRUCTIONS` in `workers/mcp/src/tools.ts` still
  describe the first owner ("he"). Rewrite them in the new owner's terms and preferences: what
  "plan my day" should weigh, how they want email handled, what they call things.
- **`CLAUDE.md`.** Rewrite "What this is" to describe the new owner and how they work, and keep
  it current from then on. Remove history that no longer applies.
- **`README.md`.** Replace it with a plain description of the new owner's dashboard.
- **Things the first owner used that you may not**: OmniFocus (an import on the Settings page),
  Superhuman (links that open an email thread). Ask the owner which they use and remove or
  replace the rest.
