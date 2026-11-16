# CLAUDE.md

> **This is a starter copy.** It was built by one person, with an AI doing all the coding, and
> then cleaned up to share (last refreshed 2026-11-16). Read these notes before changing anything.
>
> - **The idea, in one line:** the owner works from their chatbot, which reads and writes one
>   database that is the canonical record; the website is a dashboard for looking at that record
>   and checking things off. Keep both halves working: anything the website can do to a task,
>   the chatbot should be able to do too.
> - **"The owner" means the person whose dashboard this is: you**, once you have set it up. In
>   examples and tests the owner is called Alex, and the other names (Kai, Sam, Peter, Greta) are
>   made up.
> - **The decisions recorded below are the first owner's**, with his reasons, in his words where
>   they are quoted ("he found that too convoluted"). They are kept because the reasons are the
>   useful part. They are not rules for you. When the new owner wants something different,
>   change it, and update this file so it describes their dashboard, not his.
> - **Nothing is set up yet.** `SETUP.md` has the steps. Anything written `YOUR-...` or
>   `YOUR_...` (in the `wrangler.jsonc` files and in the docs) is a blank to fill in.
> - **Keep your copy private.** The nightly backup saves the whole database into the repository.
>   The backup refuses to run in a public repository, and should stay that way.
> - Times are shown in `America/New_York`. To change it, search the code for that text; `SETUP.md`
>   lists the places.


Notes for the next AI session that fixes or extends this project. The owner does not read or edit
the code. Favor clarity and easy repair over cleverness. Read this whole file before changing anything.

## What this is

A private, single-user system for the owner, a vice president with nine direct reports. It
is **his canonical record of what he is working on**: his tasks, who he is waiting on, what he
owes people, what he wants to discuss with them, and his projects, across work, personal and a
side business.

It has two faces on one D1 database:

- **His chatbot is where he works.** In his words (2026-11-14): "My primary interaction is with
  my chatbot... it's my database of things to ask. It's the most important thing." He asks it to
  add things, change them, go through his email and update the record, and tell him what to
  work on. It reaches the database through the MCP Worker.
- **The website is where he looks.** "This is more like a dashboard where I can check off
  tasks." It shows the state of things. It has no AI inside it and holds no AI key.

Three things follow, and most of his corrections have been one of these:

1. **Bare minimum.** "This is my project manager. This is not a CRM." A page shows what he
   needs and nothing else. An empty state is never the loudest thing on a page, nothing is a
   block of color for decoration, and no filler line is repeated down a list.
2. **The database has to answer exact questions.** One kind of record per kind of thing, plain
   fields, people matched exactly. "The underlying information needs a really good database
   structure so it can pull the exact things."
3. **Nothing happens behind his back.** The site reads one outside thing, his Google Calendar.
   It does not read or send mail and does not pull meeting notes. He tried timers that checked
   Gmail and Granola and had them taken off as "too convoluted". That code is deleted; do not
   rebuild it unless he asks. He also rejected paying for a separate Claude API key.
   (The daily log, below, keeps to this: his chatbot reads his sent mail and meeting notes with
   its own connectors and writes the result here. The site still reads neither.)

OmniFocus is still his personal task manager. This is the shared picture: what is between him
and other people, and what has a date.

## The model

- **A task is the basic thing, and it is one line.** "Not everything is a project... oftentimes
  it's just a task." Everything else on it is optional: people, a due date, tags, notes, a
  project, a day to stay hidden until.
- **People work like tags** ("persons should probably work similar to tags too"). A task
  carries any number of people (`task_people`), and being on it only means it involves them.
  A person's page gathers every task they are tagged on. A person on a task can carry two
  marks, and that is all:
  - `waiting`: he is waiting on them for it. It is what the "Waiting on" list on the Tasks
    page groups by, and what counts the days.
  - `one_on_one`: it is on **the list for his next 1:1 with them**. Nothing lands there by
    itself: he puts it there on the site, or tells his chatbot ("put this on my 1:1 with Peter").
  **There are no roles to sort into.** Three lists (waiting on, you owe, to discuss) and then
  four roles were built and he rejected both: "I still don't like the waiting on, I owe, and
  to discuss." Do not bring categories back.
  - `tasks.person_id` and `side` are a **summary of the lead person** (someone he is waiting
    on, if any, else the first person on it), kept in step by `packages/core/src/tasks.ts` on
    every write. Lists that ask "is this mine, or am I waiting?" read the summary. Anything
    about a particular person reads `task_people`. Never write the summary columns directly.
    (`tasks.discuss` is unused and stays 0.)
- **A task that names people is tagged with them by itself** (`peopleNamedIn` in `tasks.ts`,
  with tests). "Jordan to email Dylan" tags both and marks Jordan as waited on, because
  the title opens with who has the next step; "...Discuss with Nina" tags Nina. He was angry when
  a task with Nina's name in it did not show on her page. It never guesses: a name two people
  share tags no one, and neither does a first name followed by someone else's surname ("Kai
  Ellis" is not Kai Hale).
- **People are matched by name, exactly.** Each person has `aliases` (other names and
  spellings, comma separated), because he dictates and "Nena" has to find Nina. Emails matter
  for the calendar; the calendar sync saves a guest's address onto a person it matched by name.
- **Tags** are shared by tasks, notes and projects; a #hashtag typed in a task or note becomes
  one. He has used none so far, so nothing gives them screen space until one exists.
- **A project** is only a name for something with several tasks. Its page is its tasks and its
  notes.
- **Notes** (`entries`: note, email, meeting, call, decision) are filed by the chatbot, on
  people and projects. The one place he writes a note on the site is a meeting (below).
- **A meeting's tasks and note** (migration 0017, `packages/core/src/meetings.ts`, asked for
  2026-11-16). `tasks.meeting_ref` ties a task to a calendar event (`calendar_events.id`, the
  account plus Google's event id, stable across syncs); the task shows in that meeting and is
  tagged with the meeting's people (and, for a 1:1, put on that person's 1:1 list). A
  meeting's note is one ordinary entry, kind `meeting`, `source_ref` `calendar:<event id>`,
  filed with the meeting's people and dated at its start, so it shows on their pages, in
  Notes and in that day's log. He adds to it over time; it is not one note per thought.
- **The daily log** (`daily_logs`, one row per day) is a casual record of what he worked on.
  He asked for it on 2026-11-14 and was clear about its weight: "I don't want it to be too
  intense... I'm not going to keep it throughout the day. It would just be a reflection on some
  things that I worked on, very casual." So his chatbot keeps it, and it has two plain fields:
  - `body`: the day written up at its end (markdown): the meetings he had and who with, the
    mail he sent, the tasks he finished and added. Saving it again replaces it.
  - `notes`: things he said he did ("log that I finished the budget draft"), one per line, in
    his words. Only ever added to; writing the day up never touches them.
  He adds to it whenever he likes, for any earlier day too ("on Friday I updated Dr. Ross
  about..."). When he gives the detail of a conversation, the log gets one line and the detail
  goes on the person's page as a note (`add_entry`), dated that day; `dayFacts` then lists it
  under that day's notes.
  The log only records. It belongs to no desk, and nothing in it adds or finishes a task.
  (The end-of-day routine that writes it finishes by proposing tasks from the day's sent mail,
  for him to say yes or no to. That is the routine, not the log.)
- **The planning board** (`tasks.board`, migration 0016). He plans after Cal Newport: a board he
  moves things between, and time blocks (below). A task's `board` is the row he put it in:
  `todo`, `waiting` (to hear back), `back` (back burner), `figure` (to figure out). NULL means
  he has not placed it: it waits in **New**, the board's first row ("stuff should default in
  there unless it's explicitly waiting to hear back"; it was a side drawer until he asked for
  it to be a row like the others, 2026-11-16), except that a task with someone marked
  `waiting` on it shows in Waiting by itself. The order within a row is `sort_order` (a
  fraction between neighbours, so a drop is one write). He renames rows on the board; the
  names are the `board_names` setting. **Rows are his to fill.** Nothing sorts tasks into them
  but him (or the chatbot when he says so); a guessed "This week" row was the first thing he
  questioned.
- **Time blocks** (`time_blocks`): time he set aside for a task: a day, a start in minutes after
  midnight, a length. A task can have several. They live on the dashboard only; the site still
  never writes his Google Calendar (rule 8); his chatbot copies blocks there when he asks. A calendar event named after a project ("Work on
  Pricing Review") counts as his own block for that project's tasks.
- **Three desks**: work, personal, side business (`area`). A task on a project takes the
  project's desk.

## Architecture

Two Cloudflare Workers share one D1 database (`project-dashboard`) and one data layer (`packages/core`).

- **Main Worker** (`workers/app`, name `project-dashboard`): Hono JSON API under `/api/*`, the
  half-hourly calendar sync (`scheduled`), plus the React app. Every `/api` request must carry
  a valid Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`), verified with `jose` against the
  team's certs and the Access AUD tag, and the email must match `OWNER_EMAIL`. If any of that is
  missing the API returns 503 or 401. It never falls back to open
  (`packages/core/src/access.ts`, shared with the MCP Worker). The React app is bundled into the
  Worker script by `scripts/embed-web.ts` (see "Why the frontend is embedded" below).
- **MCP Worker** (`workers/mcp`, name `project-dashboard-mcp`): a stateless remote MCP server at
  `/mcp` (Streamable HTTP, `createMcpHandler` from `agents/mcp/server` with
  `@modelcontextprotocol/server` v2, no Durable Objects) and an iCalendar feed at `/calendar.ics`.
  `/mcp` accepts two kinds of credential, both handled by `@cloudflare/workers-oauth-provider`
  (`OAuthProvider` in `src/index.ts`):
  1. **OAuth** for chat apps (Claude on the web and phone). The app discovers the server, registers
     itself (`/oauth/register` or a Client ID Metadata Document), and sends the owner to `/authorize`.
     That one path is behind Cloudflare Access, and `src/authorize.ts` verifies the Access JWT
     again before showing an Allow / Deny page. Tokens last an hour and refresh for as long as the
     app is used at least every 90 days.
  2. **`Authorization: Bearer <MCP_TOKEN>`** for Claude Code and scripts (`resolveExternalToken`).
  Anything else gets 401. The feed needs `?token=<ICS_TOKEN>`. Tokens are compared in constant time.
  The OAuth library expects a Workers KV namespace named `OAUTH_KV`; `src/index.ts` hands it
  `dbKv()` from `packages/core/src/kv.ts`, which stores the same records in the D1 table
  `oauth_kv`. (A real KV namespace bound as `OAUTH_KV` would also work: delete the `withStore` line.)
- **`packages/core`**: types, Zod schemas, every SQL query, derived rules, the audit log and
  undo, search, exports, and the calendar connection. **No SQL anywhere else.** Both Workers and
  all scripts import from `@pd/core`.
- **Frontend** (`apps/web`): React 19, Vite, Tailwind 4, TanStack Query, react-markdown. All
  server calls are in `apps/web/src/api.ts`.

### Repo map

```
CLAUDE.md, README.md          this file; plain-language overview for the owner
migrations/                   numbered D1 SQL migrations (never edit one that has been applied)
packages/core/src/            all data access: tasks.ts (tasks and the people on them),
                              views.ts (lists, the filter engine, search, the home data),
                              plan.ts (people by next meeting; the "what to work on" answer),
                              people.ts, projects.ts, entries.ts, tags.ts, perspectives.ts
                              (saved views), daylog.ts (the daily log), blocks.ts (time
                              blocks), oneonones.ts, audit.ts,
                              rows.ts (table registry),
                              runs.ts, omnifocus.ts, export.ts, and the calendar: connections.ts,
                              google.ts (the only code that calls Google), calsync.ts, sync.ts
packages/core/test/           Vitest tests (node:sqlite in memory with the real migrations)
apps/web/src/                 React app: api.ts, spaces.tsx (the three desks), styles.css,
                              lib/ (plan.ts, desk.ts, time.ts, quickadd.ts), components/
                              (Planner.tsx is the dashboard's planner), pages/
workers/app/                  main Worker (src/index.ts: routes, Google sign-in pages, the timer)
workers/mcp/                  MCP Worker (src/index.ts auth and routing, src/authorize.ts OAuth
                              consent page, src/tools.ts every tool and the standing instructions)
scripts/                      seed.ts, export-snapshot.ts, embed-web.ts, mcp-smoke.ts, oauth-smoke.ts
docs/automations/             the two scheduled Claude tasks (the morning brief, the daily
                              log) and their prompts
snapshot/, backups/           nightly markdown snapshot and SQL dumps, committed by the backup job
.github/workflows/            deploy.yml (push to main), backup.yml (nightly)
```

## This copy and the original

This repository is a copy of the first owner's own dashboard with every real name, workplace,
address and account id swapped for a made-up one. It is refreshed from the original now and
then (last on 2026-11-16, which added the planner, the daily log and a meeting's tasks and
note). Once you make it your own, it is yours: nothing flows into it from the original unless
you pull it in. The same owner also keeps a health dashboard built the same way; a template of
it is shared separately.

## Rules

1. **Never edit an applied migration.** Add `migrations/000N_description.sql` instead.
2. **Never hard delete.** Projects and people get `archived_at`; entries, tasks and links get
   `deleted_at`. The only rows ever removed are join rows (`project_people`, `entry_people`,
   `task_people`, the tag joins) and the calendar cache, and join-row removals are recorded in
   the audit log so they can be undone. A retired table keeps its rows.
3. **Every write goes through `packages/core`** and records an `audit_log` row (`recordAudit`).
   New write functions must do the same, or Activity and Undo break.
4. **Keep SQL in `packages/core`.** Column names are checked against `TABLES` in `rows.ts`; add new
   columns there too.
5. **Run every check the deploy runs before pushing**: `npm run lint && npm run typecheck && npm test`.
   A lint error stops the deploy before anything is changed.
6. **Writes from the chatbot must never guess.** Use `requireProject` / `requirePerson`, which
   throw `AmbiguousError` with candidates when a name matches more than one record.
7. **Keep the chatbot's tools few and their descriptions exact.** Every tool description in
   `workers/mcp/src/tools.ts` says when to use it. Before adding a tool, see whether an existing
   one can answer; 37 look-alike tools were cut to 24 because a chatbot picks worse among many.
   (There are 26 now: the daily log added one to read and one to write.)
8. **The site never sends email and does not read mail.** It reads Google Calendar only, with
   one Google permission: `calendar.readonly` (`GOOGLE_SCOPES` in `packages/core/src/google.ts`).
   Do not add a scope, and do not call an endpoint that changes a calendar or touches mail.
9. **Form controls come from `apps/web/src/components/fields.tsx`.** Do not style an input, menu
   or date field by hand on a page.
10. **Keys and sign-ins are never stored or logged in the clear.** They go through `setSecret` /
    `saveGoogleAccount` in `connections.ts` (AES-GCM with the `CONNECTIONS_KEY` Worker secret) and
    are never returned to the browser, written to the audit log, or put in an error message.

## Where each kind of change goes

| Change | Files |
| --- | --- |
| New field on a table | new migration; `types.ts`; `schemas.ts` (create and update); `rows.ts` `TABLES` columns; UI in `apps/web`; the tool input in `tools.ts` if the chatbot should set it |
| New API route | `workers/app/src/index.ts` calling a core function; add the call in `apps/web/src/api.ts` |
| What the chatbot is told about how the owner works | `INSTRUCTIONS` at the top of `workers/mcp/src/tools.ts` (every chat reads it first) |
| A chatbot tool | `workers/mcp/src/tools.ts`; update the count in `scripts/mcp-smoke.ts`. The morning brief task calls `morning_brief_data`, `get_person`, `save_digest` and `log_run` by name |
| What a write tells the chatbot afterwards | the `receipt` and `url` each write tool returns (`taskReceipt`, `link` in `tools.ts`) |
| What the chatbot answers to "what should I work on" | `workPlan` in `packages/core/src/plan.ts` (with a test); the `what_to_work_on` tool |
| What a task is, or what it can carry | migration; `Task` in `types.ts`; `taskCreateSchema` / `taskUpdateSchema`; `tasks.ts`; `TASKS` columns in `rows.ts`; `TaskRow` in `components/Tasks.tsx`; `add_task` / `update_task` in `tools.ts` |
| The people on a task, or the marks a person can carry on one | `TaskPerson` in `types.ts`; the `task_people` columns (new migration, and `rows.ts`); `leadOf` and `writeTaskPeople` in `tasks.ts`; the people editor in `TaskRow` (`components/Tasks.tsx`); `PersonLists` in `components/OneOnOne.tsx`; `add_task` / `update_task` in `tools.ts` |
| Which people a task's title puts on it | `peopleNamedIn` in `packages/core/src/tasks.ts` (with tests in `test/tasks.test.ts`) |
| How a person is found by name | `resolvePerson` and `aliasesOf` in `views.ts`; `peopleNamedIn` in `tasks.ts` |
| Which tasks a list shows, or a new way to filter | `taskFilterSchema` in `schemas.ts`; `filterConditions` and `listTasks` in `views.ts` (with a test); a control in the filter bar in `pages/Tasks.tsx`; `filterFields` in `tools.ts` |
| Search | `search()` in `packages/core/src/views.ts` (the only search entry point) |
| The dashboard's planner (the week, the board and its New row, the panel that asks when) | `components/Planner.tsx`; the `.plan-*` rules in `styles.css`; it reads `open_tasks`, `calendar`, `blocks` and `week_start` from the home data (`getHome` in `views.ts`) |
| Which row a task is in, open times, what "thu 9 45m" means, overlaps on a day | `apps/web/src/lib/plan.ts` (with tests beside it) |
| Time blocks: what they hold, how they are saved | migration 0016; `TimeBlock` in `types.ts`; `timeBlockSchema`; `packages/core/src/blocks.ts` (with tests in `test/board.test.ts`); routes under `/api/blocks`; `useAddBlock` / `useMoveBlock` / `useDeleteBlock` in `api.ts`; `block_time` / `clear_blocks` on `update_task` and `blocks` in `list_calendar` (`tools.ts`) |
| The board's rows, or their names | `BOARD_ROWS` in `types.ts`; `board` in `taskUpdateSchema`; `board_names` in `Settings` and `DEFAULT_SETTINGS`; `rowOf` in `lib/plan.ts`; `board_row` on `update_task` |
| A meeting's tasks and note (what the panel shows, how they are saved) | `packages/core/src/meetings.ts` (with tests in `test/meetings.test.ts`); `meeting_ref` on tasks (migration 0017); `PUT /api/meetings/:id/note`; `useSaveMeetingNote` in `api.ts`; `MeetingPanel` in `components/Planner.tsx`; `meeting_id` on `add_task` and `add_entry`, and `id` in `list_calendar` (`tools.ts`) |
| Which people a meeting is "with" | `storeCalendarEvents` (`calsync.ts`); `listCalendarEventPeople` hands it to the dashboard |
| How the chatbot records a promise, a request or a date, and what it looks for in his mail | the "Three things he loses track of" and "go through my email" parts of `INSTRUCTIONS` in `tools.ts`; step 8 of `docs/automations/daily-log.md` |
| What can be typed in the add line | `apps/web/src/lib/quickadd.ts` (with a test beside it) |
| Saved views | `perspectives.ts`; routes under `/api/views`; the views row and filter bar in `pages/Tasks.tsx` |
| How tags work, or what can be tagged | `packages/core/src/tags.ts`; a new taggable thing needs a join table like `task_tags` |
| A person's page | `PersonView` in `pages/People.tsx`; the lists are `PersonLists` in `components/OneOnOne.tsx` |
| What the half-hourly sync does | `runSync` in `packages/core/src/sync.ts` |
| Which calendar events are kept, or what counts as a 1:1 | `storeCalendarEvents` in `packages/core/src/calsync.ts` (with a test) |
| A new form control, or how inputs look | `components/fields.tsx` and the `.field` rules in `styles.css` |
| Desk colors, type, shadows, motion timing | the tokens at the top of `apps/web/src/styles.css` |
| A fourth desk (area) | new migration for the CHECK constraints; `AREAS` in `types.ts`; `SPACES` and `Sigil` in `spaces.tsx`; `--space-*` and `--paper-*` in `styles.css`; a route in `main.tsx` |
| What is read from an OmniFocus export | `packages/core/src/omnifocus.ts` (with a test) |
| The morning brief | its prompt in `docs/automations/`, then update the scheduled task to match (it keeps its own copy) |
| What the daily log holds, or how it is written | `packages/core/src/daylog.ts` (`saveDailyLog`, with tests in `test/daylog.test.ts`); a new field needs a migration, `DailyLog` in `types.ts`, `dailyLogSaveSchema`, `rows.ts`, and `get_daily_log` / `save_daily_log` in `tools.ts` |
| What the dashboard itself knows about a day (meetings, tasks added and finished) | `dayFacts` in `packages/core/src/daylog.ts` (with a test) |
| How the end-of-day log is gathered and worded | the "His daily log" part of `INSTRUCTIONS` in `tools.ts`, and the Claude Duet prompt in `docs/automations/daily-log.md` (Duet keeps its own copy: give the owner the new text). Keep the two in step |
| How a day of the log looks | `components/DayLog.tsx` (used by `pages/Log.tsx` and "Today's log" on the dashboard) |

## The chatbot

This is the face that matters most. Three parts, all in `workers/mcp/src/tools.ts`:

- **Standing instructions** (`INSTRUCTIONS`): sent to every chat when it connects. They say the
  dashboard is canonical and is read first; which tool answers which kind of question; to
  search before adding; to tag every person a task involves and set a due date when he gives
  timing; how he plans his time (time blocking after Cal Newport, asked for 2026-11-15: weekly and daily plans, thinking work in the longest early stretch, small things batched, slack left, blocks set on his dashboard with update_task only after his yes, and copied to his Google Calendar only when he asks, by the chatbot with its own calendar connection: never twice, moving an event when its block moved, touching no other event); how to record the three things he loses track of, without naming them to him (he
  told someone he would do it: his task with the person on it; he asked for it: waiting on
  them; a date to be ready for: a due date); that a 1:1 list only gets what he asks to put on it; never to guess a person; never to offer hidden tasks; to answer every change with one
  line; and the routine for "go through my email and update my dashboard" (read mail with the
  chatbot's own connection, his SENT mail above all, looking only for what he said he would
  do, what he asked for, and dates; propose one list, wait for his yes, write with `source_ref`
  `gmail:<thread id>` so a second run adds nothing twice). "Adding the emails as tasks is
  definitely important" (2026-11-15). They end with the daily log:
  "log that I ..." adds a line, "what did I do Tuesday" reads it back, and "log my day" is a
  routine (read the day from the dashboard, read his sent mail and Granola notes with the
  chatbot's own connections, write the day up, file a meeting note for each 1:1 that has
  notes, ask "anything else you worked on today?", then propose the promises, requests and
  dates found in today's sent mail and wait for his yes). Writing the log never changes a
  task; that last step is the only place tasks change.
- **A meeting's tasks and note**: `list_calendar` gives each meeting's `id`; `add_task` and
  `add_entry` take `meeting_id`. A task for a meeting with no people named takes the meeting's
  people, never a guess from its wording ("Send Aaron..." once tagged the wrong Aaron).
- **The board and time blocks** go through tools that already existed: `update_task` takes
  `board_row`, `block_time` (day, HH:MM, minutes) and `clear_blocks`; `list_calendar` returns
  his blocks with his meetings. The instructions say to block time only after his yes, to
  check `list_calendar` first, and never to sort tasks into rows on its own.
- **26 tools.** Reading: `what_to_work_on`, `search`, `list_tasks`, `get_person` (also the
  meeting-prep answer), `get_project`, `list_projects`, `list_tags`, `list_calendar`,
  `whats_changed`, `get_daily_log`. Writing: `add_task`, `update_task`, `complete_task`,
  `delete_task`, `create_person`, `update_person`, `create_project`, `update_project`,
  `link_person_to_project`, `add_entry` (a note), `add_link`, `save_daily_log`, `undo_last`.
  For the scheduled morning brief: `morning_brief_data`, `save_digest`, `log_run` (it also
  calls `get_person`). The scheduled daily log calls `get_daily_log`, `save_daily_log`,
  `add_entry` and `log_run`.
- **Receipts.** Every write returns `receipt` (one plain line: what was done, to whom, when
  due) and `url` (that spot on the dashboard), for the chatbot to pass on.

He does not want the chatbot making saved views; a `make_view` tool was built and scratched the
same day.

Chat apps cache a server's tool list and instructions; after a deploy he may need to start a
new chat to see changes.

## How the interface is put together

- **The dashboard is his planner** (`pages/Dashboard.tsx`, then `components/Planner.tsx`; the
  same page serves `/` and each desk, and a desk shows only its own tasks, meetings and blocks).
  Built 2026-11-15 after a day of attempts he turned down (three cards, then a line of meetings,
  then a task list beside it, twice). He asked for Cal Newport-style time blocking and "a big
  whiteboard" of things to move around, and shaped it in a sketch before it was built. Top to
  bottom:
  1. The morning brief and **Today's log**, one line each until opened (as before).
  2. **Week | Day** at the right. Week shows Monday to Friday (next week's on a
     weekend), 8 to 5 unless something falls outside. Day shows one day, beside the board on a
     wide screen. Clicking a day's name in the week opens that day. On a phone it opens in Day.
  3. **The calendar**, pinned while the board scrolls under it (not on a phone, where it would
     cover the board). **Color says whose time it is** (asked for 2026-11-16: "add some color and
     actually think about the design"): a meeting is a tint of its desk's color with a rail of
     it; his own time (his blocks, and a calendar event named after one of his projects) is the
     desk color, solid, white text. Today is the date in a red circle and the red now-line,
     nothing louder. His own name is dropped from meeting titles.
  4. **The board**: New first, then four rows, **horizontal, each opening and closing** with
     its arrow ("a toggle to show them"); cards wrap **four across** ("rows of four or something so it's not
     as much scrolling"), fewer on smaller screens. "Hide board" folds it all away. **Each row
     has its own color** (New sky, To do green, Waiting violet, Back burner amber, To figure out
     rose): a square dot, its count in a tinted pill, and its cards' check circles. A closed row
     is only its name and count: repeating its first titles in the heading was "ugly". Row names are renamed in place (all but
     New). Do not move New back into a side drawer.
  The calendar is pinned below the site's own top bar (56px), so the day names stay in view.
  **A card** is the task's exact title (never shortened or reworded: he could not recognise a
  shortened one), who it is with (names only, never "Greta has it": a name means involved,
  not responsible), its project, its due date, the day and time it is blocked, and an envelope
  when it came from an email. A circle checks it off, with Undo.
  **Blocking time**: drag a card onto the calendar, or click it. A small panel opens beside the
  block's preview with the time to type in one line ("thu 9 45m", "tomorrow 1:30pm 1h"), the
  lengths 15 minutes to 2 hours, his next open times (10 minutes clear of meetings; the shown
  day first in Day view), and the rows to move it to with one tap. The preview turns red and
  the panel names what it runs into. Enter saves, Esc cancels, the arrow keys nudge by 15
  minutes. A block clicked on the calendar opens the same panel to move it or take it off. A
  task whose project already has a calendar block says "Already on your calendar" instead of
  offering a second time ("Add another time" is there if he wants one). The panel also shows
  where the task came from: the first line of its notes.
  **A meeting** (gray) opens its own panel when clicked: the time, place and who it is with
  (each a link to their page), "Open in Calendar", the tasks it carries (added for it, and for
  a 1:1 that person's 1:1 list) to check off, a line to add a task for it, and its note, saved
  when he clicks away. A meeting that carries tasks or a note has a small accent dot.
  **Do not put back** the line of meetings, a list of tasks beside the calendar, labelled groups
  ("Getting ready for", "You said you'd"), a "This week" row that guesses, the Due / People /
  Next two weeks cards, "Tags and projects" or "Needs you". No counts other than a closed row's
  and New's, no empty-state cards, no block of color.
- **Tasks** (`pages/Tasks.tsx`) is the full list, dated or not: the saved views (one button
  each), a **Filter** button that unfolds the filter bar, the line to add a task, then "Yours"
  and "Waiting on". Waiting on is grouped by person, and **the person's name leads its rows**
  (his complaint about the first version: the name was the smallest thing on the card). A task
  waiting on two people is listed under each. The pieces are in `components/Tasks.tsx`
  (`TaskAdd`, `TaskRow`, `TagChip`).
  - **One filter engine.** Every task list goes through `listTasks` in `views.ts` with a
    `TaskFilter`. The Tasks page keeps the filter in the address (`?f=`).
  - **Saved views** (`perspectives.ts`): a name and a filter, made on the Tasks page. A few are
    built in (Late, Due this week, Waiting a week or more, From email, Hidden).
  - **Typing a whole task** (`lib/quickadd.ts`): `@sam` puts Sam on it as waiting (several
    @names put several people on), a date at the end sets when it is due, `#tag` tags it.
  - **Hiding** (`hide_until`): kept out of the ordinary lists until a day; never lost.
  - **Waiting age**: days waited, amber from a week, red from two.
- **A person's page** (`PersonView` in `pages/People.tsx`) is bare on purpose: the name, the
  role, the next 1:1 when the calendar knows it; then two lists (`PersonLists`):
  **For our next 1:1** (what he or his chatbot put there; each row has "Take off") and
  **Everything with Nina** (every other task she is tagged on; ones he is waiting on her for
  say "Waiting"; each row has "Add to 1:1"). Notes filed with the person and their projects
  show only when there are some. One quiet line at the foot: "Show N checked off lately"
  (finished tasks), "Details" (other names, email, desk, whether they are a regular 1:1) and
  "Archive person". **Do not put back** sorted lists (waiting on / you owe / to discuss), a
  rhythm picker, a meeting-notes section or composer, organization, notes about the person,
  "Last talked", or an Email button.
- **Projects** (`pages/Projects.tsx`) is a plain list: title, open task count when there is
  one, due date when there is one. `components/Pulse.tsx` is the older row with activity and
  progress columns; it is unused while his projects carry no tasks. No kanban: he rejected it.
- **Notes** (`pages/Notes.tsx`): what the chatbot has filed, newest first. No writing box.
- **Log** (`pages/Log.tsx`, `/log`): the daily log for reading back, newest day first: the day
  as written up, then "In your words" (what he said he did). A day with nothing logged is not
  listed. No writing box and nothing to edit: he changes it by telling his chatbot. It is one
  log for all three desks.
- **A tag's page** (`/tag/:name`): the tasks, notes and projects with that tag.
- **Click to edit, no edit buttons.** Titles, notes and tags use `Editable`. A task row's arrow
  opens the rest (notes, due date, hide until, project, the people on it with their two
  switches "Waiting on" and "On 1:1 list", tags, delete).
- **Three desks** (`spaces.tsx`), each with its own color and mark, set by `data-space` on
  `<html>`. The desk color is identity; the status colors (`--late` red, `--soon` amber, `--ok`
  green, `--wait` violet, `--idle` gray) say how things stand. Color is never decoration.
- **A sidebar that is not always there** (`components/Sidebar.tsx`), in the manner of Things:
  Today and Tasks; the views; People, Projects, Notes and Log; his tags; Activity and Settings. The
  button at the top left, or `\`, slides it in. While docked, pages leave out what it shows.
- **One request feeds every desk.** `useHome()` loads all areas once; `lib/desk.ts` filters it.
- **One set of controls** (`components/fields.tsx`); menus open through `components/Popover.tsx`.
- **Type.** One typeface, the system font. No serif.
- **Behavior** follows his quiet-depth design language: press states on everything, composed
  transitions, reduced motion respected, light and dark designed together, plain copy.
- **Keyboard, never shown on screen:** Cmd+K search, N add, 1 to 4 switch desk, \\ sidebar, Esc.
- **Undo.** After a delete, a toast offers Undo (`POST /api/audit/undo-last`).
- To look at a change, take screenshots with the Playwright preinstalled in the Claude Code
  cloud sandbox; check a desk, a person's page, a phone width and dark mode before calling it done.

## The calendar

Set up on the Settings page under Connections (`components/Connections.tsx`) and kept current
by `runSync` (`packages/core/src/sync.ts`), which the main Worker runs every 30 minutes
(`triggers.crons` in `workers/app/wrangler.jsonc`) and when "Sync now" is pressed.

- **Stored keys** (`connection_secrets`): the Google client ID and secret, encrypted with the
  `CONNECTIONS_KEY` secret, which must be the same value on **both** Workers (the deploy
  workflow creates it once if it is missing and never replaces it). If it is ever changed,
  every saved key and sign-in becomes unreadable and has to be entered again.
- **Google sign-in.** the owner owns a Google Cloud OAuth client (type Web application, audience
  External, published; steps are shown in Settings). `GET /api/connections/google/start?area=`
  sends the browser to Google with a signed `state`; Google returns to
  `/api/connections/google/callback`, which stores the account and its encrypted refresh token
  in `google_accounts` against a desk.
- **Events** (`calendar_events`, a cache): each sync replaces that account's rows with the next
  four weeks of its main calendar. Cancelled and declined events are dropped. An event is a 1:1
  (`person_id` set) when its only other guest is someone the owner has a regular 1:1 with, or its
  title reads "Kai and Alex 1:1".
- **Who a meeting is with** (`calendar_event_people`, also a cache): the 1:1 partner, any guest
  matched to one of his people by email or exact name (meetings of up to eight guests), and
  people the title names ("Lunch with Kai Ellis"). The People card and `what_to_work_on` read it.
- **A regular 1:1** (`one_on_ones`) only marks a person as someone he meets one on one
  (relationship: direct, manager, peer, other) so the calendar can recognize the meeting. There
  is no rhythm: he asked "Why do I need a set rhythm?" (Older rows may carry `cadence_days`; a
  date estimated from it is never shown as the next meeting on a person's page.)
- **OmniFocus import** (`POST /api/import/omnifocus`, Settings "Choose file"): copies his 1:1
  lists from an OmniFocus JSON export as tasks with the person on them. It matches by OmniFocus
  id, so a newer export can be loaded again.

## Names (never the secret values)

| Thing | Name |
| --- | --- |
| D1 database | `project-dashboard` (id in both `wrangler.jsonc` files) |
| Main Worker | `project-dashboard` → https://dash.YOUR-DOMAIN.com (custom domain, `routes` in `workers/app/wrangler.jsonc`; zone `YOUR-DOMAIN.com` is in the same Cloudflare account). The older https://project-dashboard.YOUR-SUBDOMAIN.workers.dev still works. The MCP Worker deliberately stays on workers.dev: moving it would mean re-adding the connector in every chat app. |
| MCP Worker | `project-dashboard-mcp` → https://project-dashboard-mcp.YOUR-SUBDOMAIN.workers.dev/mcp |
| Calendar feed | https://project-dashboard-mcp.YOUR-SUBDOMAIN.workers.dev/calendar.ics?token=... |
| Main Worker vars | `ENVIRONMENT`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `MCP_URL`, `CALENDAR_URL` |
| Main Worker secrets | `OWNER_EMAIL` (allowed login email, comma separated if more than one); `MCP_TOKEN`, `ICS_TOKEN` (copies, only so Settings can show and copy them); `CONNECTIONS_KEY` (encrypts the keys and Google sign-ins saved in Settings) |
| Google OAuth client | Owned by the owner in Google Cloud. Its ID and secret are saved in Settings, not as Worker secrets. Authorized redirect URIs (one per address the site is opened at; the callback uses whichever address the browser is on): `https://dash.YOUR-DOMAIN.com/api/connections/google/callback` and `https://project-dashboard.YOUR-SUBDOMAIN.workers.dev/api/connections/google/callback` |
| Cloudflare Access | Zero Trust team `YOUR-TEAM` (login at YOUR-TEAM.cloudflareaccess.com); self-hosted app "Project dashboard" with two destinations, `dash.YOUR-DOMAIN.com` and a `worker` destination for the main Worker (so both addresses need the login and share one AUD), policy "Only the owner", 30-day sessions. A second app, "Project dashboard MCP sign-in", covers only `project-dashboard-mcp.YOUR-SUBDOMAIN.workers.dev/authorize` (its AUD is the MCP Worker's `ACCESS_AUD`). The rest of the MCP Worker is deliberately not behind Access. Login method: One-time PIN. |
| MCP Worker vars | `ENVIRONMENT`, `APP_URL`, `PUBLIC_URL`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` |
| MCP Worker secrets | `MCP_TOKEN`, `ICS_TOKEN`, `OWNER_EMAIL`, `CONNECTIONS_KEY` (same value as the main Worker's) |
| GitHub Actions secrets | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| Cloudflare API token permissions | Workers Scripts Edit, D1 Edit, Access: Apps and Policies Edit, Account Settings Read, User Details Read; for the custom domain: Zone Edit, DNS Edit, Workers Routes Edit |

Worker secrets are set with `wrangler secret put NAME -c <worker>/wrangler.jsonc` and are never committed.
Rotating `MCP_TOKEN`: put the new value on **both** Workers, then update every chatbot that uses it.

## Running locally

```bash
npm install
npm run db:migrate:local
npm run seed:local
npm run build:web                       # builds apps/web and embeds it into the main Worker
cd workers/app && npx wrangler dev --local-upstream localhost:8787 --var ENVIRONMENT:local --var CONNECTIONS_KEY:any-long-local-value     # http://localhost:8787
# (--local-upstream is needed since the custom domain: without it the Worker sees the request as
#  coming for dash.YOUR-DOMAIN.com and answers "Access is not configured".)
# MCP Worker against the same local database:
cd workers/mcp && npx wrangler dev --port 8788 --persist-to ../app/.wrangler/state \
  --var MCP_TOKEN:testtoken --var ICS_TOKEN:caltoken \
  --var ENVIRONMENT:local --var PUBLIC_URL:http://localhost:8788 \
  --var CONNECTIONS_KEY:any-long-local-value
npx tsx scripts/mcp-smoke.ts            # bearer-token route; defaults to localhost:8788 and testtoken
npx tsx scripts/oauth-smoke.ts          # OAuth sign-in route, local only (needs ENVIRONMENT=local)
```

Running both Workers at once: give the second one its own debugger port, or it fails with
"Address already in use" (add `--inspector-port 9240` to the MCP Worker command).

For frontend work with hot reload run `npm run dev:web` (Vite proxies `/api` to port 8787).
To look at a change, take screenshots with the Playwright that is preinstalled in the Claude Code
cloud sandbox; check a desk, a project page, a phone width and dark mode before calling it done.
The Access check is skipped only when `ENVIRONMENT=local` **and** the request comes from localhost.

## Deploying

Pushing to `main` runs `.github/workflows/deploy.yml`: install, build, typecheck, test, apply D1
migrations, deploy both Workers. To deploy by hand: `npm run deploy` (needs a Cloudflare token in
`CLOUDFLARE_API_TOKEN`).

**Why the frontend is embedded instead of using Workers static assets:** static asset uploads
authenticate with a one-time upload token in the `Authorization` header. Environments that inject a
Cloudflare token through a proxy (including the Claude Code cloud sandbox this was built in)
overwrite that header and the upload fails with 401. Embedding the built files into the Worker
works everywhere. If that ever matters less than using static assets, switch back by adding an
`assets` block to `workers/app/wrangler.jsonc` with `run_worker_first: ["/api/*"]`, pointing Vite's
`outDir` at it, and deleting the catch-all route at the bottom of `workers/app/src/index.ts`.

## Rolling back a deploy

`npx wrangler deployments list -c workers/app/wrangler.jsonc` then
`npx wrangler rollback <version-id> -c workers/app/wrangler.jsonc` (same for `workers/mcp`).
Rolling back code does not roll back the database; migrations only move forward.

## Backups and restore

- **Nightly**: `.github/workflows/backup.yml` runs at 3:15 AM Eastern time: `wrangler d1 export`
  to `backups/YYYY-MM-DD.sql`, `scripts/export-snapshot.ts` rebuilds `snapshot/`, keeps the newest
  30 dumps, commits and pushes. It can also be run by hand from the Actions tab.
- **D1 Time Travel**: point-in-time restore to any minute in the last 30 days on the Workers Paid
  plan (7 days on Free), per the D1 docs checked November 2026.
  `npx wrangler d1 time-travel info project-dashboard` shows the current bookmark;
  `npx wrangler d1 time-travel restore project-dashboard --timestamp=<ISO time>` restores.
  Restoring replaces the whole database, so export first.
- **From a SQL dump**: create a fresh database or empty the current one, then
  `npx wrangler d1 execute project-dashboard --remote --file backups/<date>.sql`.
- **Undo a single change**: Activity page Undo button, `POST /api/audit/:id/undo`, or the MCP
  `undo_last` tool.

## Known limitations

- **Rebuilding a table that others point at has to be done in a particular order.** Migration
  0006 explains it: set the rows aside, drop the table, create it again under the same name,
  put the rows back, all with `PRAGMA defer_foreign_keys = true`. Copying into a new table and
  renaming it fails on D1 as soon as a row elsewhere references the old table.
- **The lead-person summary can go stale after an undo.** Undoing a change to the people on a
  task restores the `task_people` rows, but `tasks.person_id` / `side` are only recomputed by
  the next write to that task through `updateTask`.
- **Changes to the people on a task made before migration 0014 cannot be undone from
  Activity.** Those audit rows describe the old `role` column, which no longer exists.
- **A person newly added to a task on the site shows a moment late**: the list reloads rather
  than updating in place. (Switching "Waiting on" or "On 1:1 list" shows at once.)
- **A task's title can link the wrong person** when it opens with a word that is also a first
  name ("Mark the forms done"). The arrow on the task takes them off.
- **A calendar event counts as his block for a project only when its title is the project's
  name** (ignoring "Work on" and punctuation). One worded differently is an ordinary meeting.
- **Blocks reach his Google Calendar only when he asks his chatbot to sync them.** "I don't
  think I want the calendar items to go to my calendar", then "I can set things up and then ask
  the chatbot to sync" (2026-11-16). The site still only reads the calendar and the calendar
  feed carries due dates only. A copied block comes back with the next calendar sync; the week
  hides it (`isCopyOfBlock` in `lib/plan.ts`: same day, start within five minutes, same title)
  so it shows once. A block moved after a sync stays at its old calendar time until he syncs
  again.
- **A task he is waiting on someone for cannot be put in New**: with no row it shows in
  Waiting. Taking the waiting mark off (the task's arrow on the Tasks page) frees it.
- **Dragging on a phone is fiddly.** Tapping a card opens the same panel, with the rows as
  one-tap choices, so nothing needs a drag.
- **A card on the dashboard can be checked off and placed, not reworded.** Rewording, dating
  and the people on it are on the Tasks page or through his chatbot.
- **`lib/desk.ts` and `calendar_people` / `peopleComingUp` feed things the dashboard no longer
  shows** (counts elsewhere, `what_to_work_on`). Prune them when those go.
- **Days waited can be wrong for old items.** The count runs from `waiting_since`, which for
  tasks loaded in bulk is the day they were loaded, not the day he asked. Many "waiting"
  marks came from September and October meeting notes (next steps a Granola summary gave
  someone), not from him; he said half of them were already done.
- **A meeting counts as "with" someone only if the calendar can tell**: they are a guest whose
  email or exact name matches a person, or the title names them. Most people have no email on
  file yet.
- **Only the main calendar of each account is read**, four weeks ahead, and the copy is up to 30
  minutes old.
- **Retired tables still exist**: `queue_items` ("Needs you"), `agenda_items` (old 1:1 topics;
  migration 0013 turned the open ones into tasks), `mail_seen`, `sync_state`. Nothing reads or
  writes them. Their rows are kept, and old Activity lines about them still read correctly.
- **Search uses LIKE, not FTS5.** Every word must appear; there is no ranking. D1 supports
  FTS5, but `wrangler d1 export` cannot export a database that contains virtual tables, which
  would break the nightly backup. `search()` in `views.ts` is the single place to change.
- **"Came from an email" depends on the chatbot** passing `source_ref` `gmail:<thread id>`.
- **Tags on a note come only from #hashtags in its text.**
- **A saved view on a desk page still shows every desk** unless the view itself names desks.
- **Writes are not transactional.** D1 has no BEGIN/COMMIT from Workers. Each core write does its
  update, then its audit row.
- **Undo reverts fields, not side effects.** Completing a task writes two changes (the task and
  its timeline entry), so that action has no toast Undo; use Activity.
- **MCP client names** come from the `X-Client-Name` header, `?client=`, MCP clientInfo, or a
  User-Agent containing "claude"; otherwise writes show as `mcp:unknown`.
- **Adding the connector in Claude**: do it at claude.ai/settings/connectors in a browser. In
  Nov 2026 the desktop app's "Add custom connector" dialog failed with "couldn't be added"; the
  same server worked from the website. To see what an app is asking for, set `DEBUG_LOG` to
  `"1"` in `workers/mcp/wrangler.jsonc`, deploy, and read the `debug:*` rows in `oauth_kv`.
- **OAuth records and the encrypted keys live in D1**, so the nightly SQL dump in `backups/`
  contains them (tokens only as hashes; keys unreadable without `CONNECTIONS_KEY`). Keep the
  repo private. To sign every chat app out, delete all rows from `oauth_kv`.
- **A Claude Code session cannot attach connectors to a scheduled task** on this account, which
  is why the morning brief reaches the dashboard over HTTPS with the `MCP_TOKEN`.
- **A Claude Code cloud session may be refused when pushing to `main`** by its own permission
  check, even after the owner says to deploy in general terms. Push the working branch, tell him,
  and push `main` when he says "deploy".
- **Google's sign-in client has to stay published**, or sign-ins expire after seven days. The
  work account may be refused if your organization's Google administrator restricts outside apps.
- **The site cannot see the scheduled tasks.** It only knows when each last called `log_run`.
- **The daily log runs in Claude Duet, not in a Claude Code session**, because it needs his
  mail and Granola connectors and ends by asking him a question. No session here can see or
  change that schedule; a change to the prompt reaches Duet only when he pastes the new text.
- **A past day's meetings are only in its log.** The calendar copy is replaced on every sync
  and reaches back about a day, so `dayFacts` knows meetings for today and yesterday only.
  Tasks added and finished are known for any day.
- **The first write to a day's log shows as two lines in Activity** ("started the log", then
  the note or write-up). The row is made empty and then filled so that the first write can be
  undone like any other; a row with nothing in it reads as no log.
- **Search finds a day of the log but not the line within it**: it opens the Log page at that
  day.

## Future ideas

- Let the morning brief open with a line from yesterday's log.
- A week of the log on one screen ("what did I do this week") for his own weekly review.
- A proper word index for search, once the backup can handle it.
- Recompute the lead-person summary on undo.
- Read shared and secondary calendars, not only each account's main one.
- A department view for Work: each direct report with their team and what is open with them.
- Attachments (R2) for files on notes.
- Code-split the frontend bundle.
