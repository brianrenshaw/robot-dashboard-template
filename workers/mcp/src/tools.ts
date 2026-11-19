// tools.ts
// Every MCP tool. Each description tells a chatbot exactly when to use the tool.
// Names and titles are resolved with the fuzzy rules in @pd/core: a name that matches more
// than one record returns the candidates and nothing is written. Writes never guess.

import { McpServer } from "@modelcontextprotocol/server";
import { z, ZodError } from "zod";
import {
  AREAS, ENTRY_KINDS, LINK_KINDS, PROJECT_ROLES, PROJECT_STATUSES, TASK_STATUSES,
  logRun, todayInTz, setOneOnOne, endOneOnOne,
  AmbiguousError, NotFoundError, InputError, formatZodError, getSettings, mailLinks,
  addEntry, addLink, addTask, completeTask, deleteTask, createPerson, createProject, getPersonDetail, getTaskItem, workPlan, peopleComingUp,
  getProjectDetail, lastAuditBy, linkPersonToProject, listAudit, listPeople, listProjects, morningBriefData,
  requirePerson, requireProject, saveDigest, search, undoAudit,
  updatePerson, updateProject, updateTask, whatsChanged, getTask, taskBySource,
  addDays, listCalendarEvents, listGoogleAccounts, listTags, listTasks,
  dayFacts, getDailyLog, listDailyLogs, logNames, logNotes, looseNotes, outcomeOf, saveDailyLog, saveBlockResult, blockTally, saveMeetingNote, meetingPeople, addTimeBlock, deleteTimeBlock, listTimeBlocks,
  type DailyLog, type TaskFilterInput,
  type CalendarEvent, type Ctx, type EntryView, type ProjectCard, type Task, type TaskPerson,
} from "@pd/core";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(data: unknown): Result {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 1) }] };
}

function fail(err: unknown): Result {
  if (err instanceof AmbiguousError) {
    return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: err.message, candidates: err.candidates }, null, 1) }] };
  }
  if (err instanceof ZodError) return { isError: true, content: [{ type: "text", text: `Invalid input: ${formatZodError(err)}` }] };
  if (err instanceof NotFoundError || err instanceof InputError) return { isError: true, content: [{ type: "text", text: err.message }] };
  console.error(err);
  return { isError: true, content: [{ type: "text", text: `Server error: ${err instanceof Error ? err.message : String(err)}` }] };
}

/** Wrap a handler so errors come back as readable tool errors instead of protocol failures. */
function safe<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A): Promise<Result> => {
    try {
      return ok(await fn(args));
    } catch (e) {
      return fail(e);
    }
  };
}

// ---------- compact shapes ----------

function projectBrief(p: ProjectCard) {
  return {
    id: p.id,
    title: p.title,
    area: p.area,
    status: p.status,
    priority: p.priority,
    next_step: p.next_step || undefined,
    waiting_on: p.waiting_on || undefined,
    due_date: p.due_date ?? undefined,
    last_activity_at: p.last_activity_at,
    people: p.people.map((x) => x.name),
    tags: p.tags.length ? p.tags : undefined,
    open_tasks: p.open_task_count,
  };
}

function entryBrief(e: EntryView, bodyLimit = 600, mailAccount?: string) {
  const mail = mailLinks(e, mailAccount);
  return {
    id: e.id,
    kind: e.kind,
    title: e.title || undefined,
    body: e.body ? (e.body.length > bodyLimit ? e.body.slice(0, bodyLimit) + "…" : e.body) : undefined,
    occurred_at: e.occurred_at,
    project: e.project_title ?? undefined,
    project_id: e.project_id ?? undefined,
    people: e.people.length ? e.people.map((p) => p.name) : undefined,
    tags: e.tags?.length ? e.tags : undefined,
    url: e.url ?? undefined,
    open_in_superhuman_mac_app: mail?.superhuman_app ?? undefined,
    open_in_superhuman_web: mail?.superhuman ?? undefined,
    open_in_gmail: mail?.gmail ?? undefined,
    written_by: e.created_by,
  };
}

function taskBrief(t: Task & { people?: TaskPerson[]; person?: { name: string } | null; person_name?: string | null; project_title?: string | null; tags?: string[] }) {
  // Everyone tagged on the task, then the two marks a person can carry on it.
  const pick = (which?: (p: TaskPerson) => boolean) => {
    const list = (t.people ?? []).filter(which ?? (() => true)).map((p) => p.name);
    return list.length ? list : undefined;
  };
  const lead = t.person?.name ?? t.person_name ?? undefined;
  const waits = pick((p) => p.waiting) ?? (!t.people && t.side !== "mine" && lead ? [lead] : undefined);
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    due_date: t.due_date ?? undefined,
    people: pick() ?? (!t.people && lead ? [lead] : undefined),
    waiting_on: waits,
    on_one_on_one_list_with: pick((p) => p.one_on_one),
    project: t.project_title ?? undefined,
    tags: t.tags?.length ? t.tags : undefined,
    notes: t.notes || undefined,
    waiting_days: waits && t.status !== "done" ? Math.floor((Date.now() - Date.parse(t.waiting_since ?? t.created_at)) / 86_400_000) : undefined,
    hidden_until: t.hide_until ?? undefined,
    from_email: t.source_ref?.startsWith("gmail:") || undefined,
  };
}

/** "9:30 AM" from minutes after midnight. */
const clockOf = (min: number) => `${Math.floor(min / 60) % 12 || 12}:${String(min % 60).padStart(2, "0")} ${min % 1440 < 720 ? "AM" : "PM"}`;

function eventBrief(e: CalendarEvent, names: Map<string, string>, timezone: string) {
  const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" });
  return {
    // Pass this as meeting_id to add_task or add_entry to tie a task or a note to this meeting.
    id: e.id,
    day: e.day,
    // The owner's local time, ready to quote.
    time: e.all_day ? "all day" : e.ends_at ? `${clock(e.starts_at)} to ${clock(e.ends_at)}` : clock(e.starts_at),
    starts_at: e.all_day ? undefined : e.starts_at,
    title: e.title,
    // No one else is on it: time he set aside for himself, not a meeting.
    by_himself: (e.guests === 0 && !e.person_id && !e.all_day) || undefined,
    location: e.location || undefined,
    calendar: e.account,
    area: e.area,
    one_on_one_with: e.person_id ? names.get(e.person_id) ?? undefined : undefined,
    url: e.url ?? undefined,
  };
}

/** A day of the daily log: the write-up, then what he said he did. */
function logBrief(l: DailyLog) {
  const said = logNotes(l);
  return {
    day: l.day,
    weekday: new Date(`${l.day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long" }),
    written_up: l.body || undefined,
    his_notes: said.length ? said : undefined,
    // Said after the day was written up: the write-up does not cover these yet.
    not_yet_in_write_up: l.body && looseNotes(l).length ? looseNotes(l) : undefined,
    updated_at: l.updated_at,
  };
}

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const areaList = z.union([z.enum(AREAS), z.array(z.enum(AREAS))]).optional();
const asList = <T>(v: T | T[] | undefined): T[] | undefined => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);

async function personIds(ctx: Ctx, refs: string[] | undefined): Promise<string[]> {
  const out: string[] = [];
  for (const r of refs ?? []) out.push((await requirePerson(ctx.db, r)).id);
  return out;
}

/**
 * What every chat reads before the owner says anything. He works through his chatbot (adding,
 * changing, planning); the website is where he looks. Keep this short and in plain words: it is
 * the one place that tells a chatbot how he works.
 */
const INSTRUCTIONS = `This is the owner's dashboard: the canonical record of what he is working on, who he is waiting on, what he owes people and what he wants to discuss with them. He works through you. He asks you to add things, change them and tell him what to do next; the website is only where he looks and checks things off.

How to work with it:
- When he asks about his work, tasks, people, projects or schedule, read it from here first. Do not answer from memory or from earlier in the chat: call the tool again.
- "What should I work on", "plan my day", "plan my week": what_to_work_on. One specific thing: search. A filtered list of tasks: list_tasks. A person, or preparing for a meeting with them: get_person.
- Before adding anything, search for it. If it is already here, update it instead of adding a second copy.
- Adding a task: the title is one short line starting with a verb; detail goes in notes. Tag EVERY person the task involves (people): it then shows on each of their pages. Mark waiting_on for anyone who has to act before he can. Set due_date whenever he gives any timing. Use hide_until for "not until ...".
- Three things he loses track of, and how to record each. These are not categories and have no names: never say "promise", "commitment" or a label for them to him; just add the task and give the one-line receipt.
  - He told someone he would do something ("I told Ned I'd send him the list"): a task that is his, with that person in people and NO waiting_on.
  - He asked someone for something ("I asked Kai for the script", "follow up with Sam on the contract"): a task with waiting_on that person, worded as the thing he is waiting for ("launch video script"). His dashboard counts the days. When the person delivers, complete_task. "What do I need to follow up on" is list_tasks who: theirs.
  - He has something to be ready for ("the pricing meeting on December 1"): a task with due_date. Several pieces of work toward one date are a project with that due_date and a task for each piece.
  A task shows on his next meeting with its person by itself; do not also put it on the 1:1 list unless he asks.
- The 1:1 list: each person has a short list for his next 1:1 with them. Nothing goes on it by itself. Put a task there only when he asks ("put this on my 1:1 with Peter", "add that to my one-on-one with Kai"): update_task add_to_one_on_one, or one_on_one_with when adding. "What's on my 1:1 with Peter" is get_person. After the meeting, take off what was covered (remove_from_one_on_one) or mark it done if it is finished.
- Never guess a person or a project. If a name fits more than one, the tool says so: ask him which. If he uses a name that is not on file for someone ("Nena" for Nina Wade), ask once, then save it with update_person (aliases) so it matches next time.
- Never suggest or list a task he has hidden until a later day, unless he asks for hidden ones.
- After any change, tell him in one line what you changed, using the receipt and the link the tool returns. Do not read the whole task back.
- A task that is a duplicate, a mistake or no longer applies: delete_task. complete_task is only for things that were actually done.
- A mistake of yours can be reversed with undo_last.

How he plans his time: time blocking, in the manner of Cal Newport. Plan this way whenever he asks to plan his day or week, or asks what to do with an open stretch. Do not name the method or lecture him about it; just plan this way.
- Every hour of his workday gets a job. Meetings are fixed; the open time between them is where work happens, in blocks he chooses on purpose.
- Two scales. The week: on Monday (he has a "Weekly plan" block), look at the week's calendar and his open tasks and decide what deserves protected time this week, then place blocks for it, the bigger things first. The day: the evening before or first thing, give each open stretch of that day a job.
- To plan: call list_calendar for the days in question and what_to_work_on (horizon week or today). Find the open stretches, leaving about 10 minutes either side of a meeting. Then propose:
  - Thinking work (a decision, a document, a model, a proposal) in the longest stretch, early in the day: 60 to 90 minutes. A big piece of work gets several blocks across the week, not one heroic one.
  - Small things (a quick confirmation, a reply, a nudge to someone who owes him something) batched into one block of 30 to 45 minutes, never scattered across the day.
  - One block for email and requests, not all day.
  - Before a 1:1, a short prep block only if that person's list needs real work first.
  - A short last block to close the day: check things off, move what did not happen.
  - Slack. Do not fill every minute with heavy work; a day of back-to-back blocks fails by 10 AM.
- Weigh things by what they need, not by how much is written about them. A decision with a deadline (a contract, a salary) can matter more than a project with four tasks.
- Show the plan as a short schedule (time, then what) and wait for his yes. He will move things.
- Putting blocks on his week: only after his yes, with update_task block_time, one block per task (a batch of small things is one block on each, back to back, or one block on the main one). They show on his dashboard's week beside his meetings; list_calendar returns them with his meetings, so check it first and never double-book. To move one, clear_blocks and give the new time. Blocks live on his dashboard. Putting one on his Google Calendar as well is never the default: "time block this", "give the Jeremy decision 45 minutes Tuesday at 9" and plans he says yes to go on his dashboard only. Add to his calendar only when he asks for it in the same breath or later ("time block this and add it to my calendar", "put that on my calendar", "sync my blocks to my calendar", "put this week on my calendar"), and then only the blocks he named; never ask whether to. Use your own calendar connection: call list_calendar for the range, and for each block create an event titled exactly with the task's title, at the block's time, in his work calendar unless he says otherwise. Time for a whole project rather than one task ("block two hours Thursday for the pricing meeting prep and put it on my calendar") is an event titled exactly with the project's title from his dashboard: that is how his dashboard knows the time is for that project and lists its tasks there. If he names no time, propose one first. Skip a block whose event is already there (same title, same day and time). If an event with that title exists at another time in the range, a block has moved: move that event rather than adding one. Never change or delete any other event. Answer in one line: how many you added, moved and skipped. His dashboard shows a copied block once.
- When the day breaks (a meeting runs long, something urgent lands), do not abandon the plan: re-plan the rest of the day from now.
- Things he is waiting on from others are not blocked; their nudges go in a small-things block.
- A meeting can carry tasks and one note. "Add a note to my 2 o'clock", "note from my 1:1 with Ned: ...": find the meeting with list_calendar and call add_entry with meeting_id and the note as body; it is added to that meeting's note. "Add a task to my meeting with Aaron": add_task with meeting_id, and the people in the meeting. The note shows on the meeting, on its people's pages and in that day's log.
- His dashboard also has a board with rows he moves things between: New (not placed yet; everything starts there), To do, Waiting to hear back, Back burner, To figure out (he may rename them). Move a task with update_task board_row when he says so ("put that on the back burner"). Do not sort his tasks into rows on your own.

When he says "go through my email and update my dashboard" (you read mail with your own email connection; this server never reads or sends mail):
1. Read the recent threads that involve him, and read the mail he SENT with particular care: his promises and his requests are in what he wrote. Unless he gives a range, cover the days since the newest task here that came from an email (list_tasks has_email), or the last seven days if there is none.
2. Look for exactly these, and leave the rest of the mail alone:
   - Something he said he would do ("I'll send that over", "let me check and get back to you"): a task that is his, with the person he told in people.
   - Something he asked someone for and has not received ("can you send me...", "please confirm..."): a task with waiting_on that person. If a later reply in the thread delivers it, it is not a task; if it settles a task already here, that task is done.
   - A date he has to be ready for (a meeting to prepare for, a deadline someone gave him): a task with that due_date.
   For each one, search here for a matching task or person.
3. Show him ONE short plain list of proposed changes, with no groups or headings. Each line is the task as it would be added, then who it is with or who he is waiting on, and its date; a task to mark done says so. Wait for his yes. He may strike items.
4. Then write. Pass source_ref "gmail:<thread id>" on every task that comes from a thread, so doing this again never adds it twice.
5. Finish with one line saying how many things changed.
Do not send, draft or archive mail as part of this unless he asks.

His daily log is a short, casual record of what he worked on each day. He does not keep it himself; you do.
- EVERY time he asks you to update it, however he says it ("update my log", "log my day", "wrap up my day", "log that I finished the budget draft", "add to my log that I updated Dr. Ross"), bring the day up to date before you save. He should never have to ask for each source:
  1. get_daily_log for that day. It returns his calendar as the dashboard has it (his meetings and who they were with, and time_set_aside), the tasks he added and finished, the notes filed, what he already jotted down, and the write-up if there is one.
  2. With your own connections, look at the mail he SENT that day (when the day already has a write-up, the mail sent since it was saved) and at his Granola notes for that day's meetings. Look at your own calendar connection too, for a meeting the dashboard did not list.
  3. Save with ONE save_daily_log call: add (what he just told you, one short line each, close to his own words) and body (the write-up again: what still holds, what he just told you, and whatever is new from the mail, the calendar and Granola).
  4. Answer in a line or two: what went into the log, and the link.
  If this chat has no mail or no Granola connection, say which once, in one line, and carry on with what you have; do not say it again on every update in the same chat. The check is for today, or for yesterday when he is catching up. For an older day ("on Friday I updated Dr. Ross about..."), pass that day and fold in what he said, without going back through its mail unless he asks.
- What a write-up is. Short and plain, markdown, readable in under a minute. One line for each thing he worked on, whatever it showed up as, and never the same thing twice: an email he sent, a task he finished and something he said in his own words are often the same piece of work, and that is ONE line. Use judgment about what goes together.
  - Work on one of his projects goes under a heading that is exactly the project's title ("### Pricing Review"; project_names in get_daily_log lists them), with one line beneath it for each thing he did on it that day. The name is the same every day, so the days read as one piece of work: never reword it, shorten it or add to it.
  - Everything else is a plain list. Each line starts with what it was about in bold (the person or the subject), then what he did: "- **Grant contract**: finished the proposal and sent it to Jordan Ames". Things that go together sit next to each other.
  - A heading is only ever the name of a piece of work. No "Meetings", "Email", "Tasks" or "Follow-ups" headings, and no other fixed sections.
  - Every one of his own notes (his_notes) must be in the write-up, in his wording where he gave it: once it is saved they are no longer listed separately.
  - Skip calendar replies, one-word answers and anything automatic.
- Meetings and Granola. A meeting is ONE line: the time, who it was with, and a short summary from its Granola notes, one or two sentences on what it was about and what was decided. When it belongs to something else he worked on, it goes on that line or under that project. Granola notes are used for that summary and for nothing else. Never turn a meeting's notes, action items or next steps into tasks or to-do lines, in the log or on his dashboard, and never propose them as tasks. If he wants something from a meeting to be a task, he will say so.
  For a 1:1 that has Granola notes, also file a short meeting note with that person: add_entry, kind meeting, people [them], source_ref "granola:<meeting id>" so it is never filed twice. That note is a summary too, not a list of tasks.
- Grouping work as a project. When what he is logging looks like one piece of work that runs over several days and it is not under one of his projects yet (names_used_lately in get_daily_log shows it on earlier days, perhaps worded differently each day, or it fills a large part of today), ask him once, in one line, after you have saved: "This looks like the same work as Tuesday's the budget analysis. Should I group it as a project and call it the same thing in your log each day?" On his yes: settle the name with him, use the project already on his dashboard if there is one (never guess between two), otherwise create_project with that name, and from then on put that work under that exact heading; save today's write-up again with the heading. On his no, leave it as it is and do not ask about that work again in this chat. At most one such question per update, and never about a one-off thing.
- If he gives you more than a line (what was said, what was decided, a pasted conversation), keep the log line short and also file the detail as a note with that person: add_entry, kind meeting (call for a phone call, note otherwise), people [them], occurred_at that day, a short title, and a body of a few short lines in your words. It then shows on their page and in that day's log. If the person is not on his dashboard, file the note without people and say so; add them only if he asks. Answer in one line for both.
- Time he set aside for his own work is not a meeting. get_daily_log lists it apart from his meetings, as time_set_aside: blocks he made on his dashboard, and entries in his calendar with no one else on them. Never write one up as a meeting. An appointment that is not work (a haircut, a pickup) is neither: leave it out unless he mentions it.
- How each block went is one of three things, and his dashboard shows each differently. Record it with save_daily_log time_blocks, using the ref from time_set_aside:
  - he did the work: { ref, kept: true }
  - he did not get to it: { ref, kept: false }
  - he did not do it but used the time for something else: { ref, kept: false, instead: "what he did, in his words" } ("I never got to the newsletter, I was on the budget all morning" is instead "the budget analysis").
  Each entry of time_set_aside shows outcome once he has said. An entry that carries a day (its block was moved or taken off since) needs that day passed with its ref. This works for earlier days too ("yesterday I skipped the report block and did the budget instead": get_daily_log for yesterday, then save).
  In the write-up, time he set aside goes on the line for the work he actually did in it ("**Pricing calculator**: 90 minutes set aside at 9:30; finished the scenario model"; "**Budget**: most of the morning, including the time set aside for the customer newsletter"). A block he simply did not get to is not something he worked on: it needs no line, and never a "not done" section. His dashboard keeps the answer.
  "How are my time blocks going", "how often do I keep my blocks": get_daily_log with from and to returns the count. Give the numbers plainly, with no advice unless he asks.
- "What did I do yesterday", "what did I work on last week": get_daily_log.
- His scheduled 10:30 PM run (in Claude Duet) follows its own prompt: it asks him nothing, proposes nothing, and emails him only on a day he added nothing to the log himself. What follows is for when he logs his day in a chat.
- The end of the day in a chat ("log my day", "wrap up my day") is the same update, followed by two more things:
  a. Show him what you logged in a few lines and ask "Anything else you worked on today?" If any of today's time_set_aside has no outcome yet, first settle the ones you can without asking: one whose task was finished today, or that today's mail or his own notes show he did, was kept. Ask about the rest in the same message, in one line ("Did you get to the Pricing block at 9:30 and the report at 1, or did that time go to something else?"), and record what he says. Do not press: no answer means it stays unanswered. Save what he answers with ONE save_daily_log call: add, body and time_blocks.
  b. Then, from the mail he SENT today, and only from his mail (never from meeting notes), list anything that belongs on his dashboard and is not there yet: what he said he would do, what he asked someone for, a date to be ready for, and any task here that today's mail shows is done. Search first so nothing is proposed twice. Show it as one short list and ask "Add these?". Write only what he says yes to, as in the email routine above (source_ref "gmail:<thread id>" for anything from a thread). If there is nothing, say nothing.
  Writing the log itself never adds, finishes or changes a task. Step b is the only place tasks change, and only on his yes.`;

export function buildServer(ctx: Ctx, ownerEmail = "", appUrl = ""): McpServer {
  const server = new McpServer({ name: "project-dashboard", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  /** A link to a page of the dashboard, for the chatbot to hand to the owner. */
  const link = (path: string) => (appUrl ? `${appUrl.replace(/\/$/, "")}${path}` : undefined);
  /** Where a task is best seen: its lead person's page, its project, or the task list. */
  const taskLink = (t: Task) => link(t.person_id ? `/people/${t.person_id}` : t.project_id ? `/projects/${t.project_id}` : "/tasks");
  /** One plain line saying what was done to a task, for the chatbot to pass on. */
  const taskReceipt = (verb: string, b: ReturnType<typeof taskBrief>) => {
    const parts = [
      b.people && `with ${b.people.join(", ")}`,
      b.waiting_on && `waiting on ${b.waiting_on.join(", ")}`,
      b.on_one_on_one_list_with && `on the 1:1 list for ${b.on_one_on_one_list_with.join(", ")}`,
      b.due_date && `due ${b.due_date}`,
      b.hidden_until && `hidden until ${b.hidden_until}`,
    ].filter(Boolean);
    return `${verb} “${b.title.length > 70 ? `${b.title.slice(0, 69)}…` : b.title}”${parts.length ? ` (${parts.join(", ")})` : ""}.`;
  };
  const db = ctx.db;
  /** One person name or id, or several. */
  const who = z.union([z.string(), z.array(z.string())]);
  /** Person ids for one name or several. An unclear name stops the write (requirePerson). */
  const idsOf = async (names: string | string[] | null | undefined) => {
    const out: string[] = [];
    for (const name of [names ?? []].flat()) out.push((await requirePerson(db, name)).id);
    return out;
  };
  const personNames = async () => new Map((await listPeople(db)).map((p) => [p.id, p.name]));
  /** Mailbox for Superhuman links: the mail_account setting, else the owner's email. */
  const mailAccount = async () => (await getSettings(db)).mail_account || ownerEmail;

  // ---------- reading projects ----------

  server.registerTool(
    "list_projects",
    {
      description:
        "List the owner's projects with their status, next step, due date and last activity. Use to answer 'what am I working on', to browse an area (work, personal, side_business), or to find projects by person, tag or text. Archived projects are hidden unless include_archived is true.",
      inputSchema: z.object({
        area: areaList.describe("work, personal or side_business, or a list of them"),
        status: z.array(z.enum(PROJECT_STATUSES)).optional(),
        person: z.string().optional().describe("Person name, slug or id"),
        tag: z.string().optional(),
        text: z.string().optional().describe("Words to match in title, summary, next step or notes"),
        include_archived: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    safe(async (a) => {
      const person = a.person ? (await requirePerson(db, a.person)).id : undefined;
      const rows = await listProjects(db, {
        areas: asList(a.area),
        statuses: a.status,
        person,
        tag: a.tag,
        q: a.text,
        includeArchived: a.include_archived,
        sort: "priority",
      });
      return { count: rows.length, projects: rows.map(projectBrief) };
    }),
  );

  server.registerTool(
    "get_project",
    {
      description:
        "Get one project in full: fields, notes, people, open tasks (with ids), pinned links and the latest 20 timeline entries. Accepts a project id, slug or a few words of the title. If the words match several projects, the candidates are returned so you can ask which one.",
      inputSchema: z.object({ project: z.string().describe("Project id, slug or title words") }),
      annotations: { readOnlyHint: true },
    },
    safe(async ({ project }) => {
      const p = await requireProject(db, project);
      const d = (await getProjectDetail(db, p.id, 20))!;
      const acct = await mailAccount();
      return {
        ...projectBrief(d),
        slug: d.slug,
        summary: d.summary || undefined,
        notes: d.notes || undefined,
        start_date: d.start_date ?? undefined,
        waiting_on_person: d.waiting_on_person?.name,
        archived: !!d.archived_at,
        people: d.people.map((x) => ({ id: x.id, name: x.name, role: x.role })),
        open_tasks: d.tasks.filter((t) => t.status !== "done").map(taskBrief),
        links: d.links.filter((l) => l.pinned).map((l) => ({ id: l.id, label: l.label, url: l.url, kind: l.kind })),
        timeline: d.timeline.map((e) => entryBrief(e, 600, acct)),
      };
    }),
  );

  // ---------- writing projects ----------

  const projectFields = {
    summary: z.string().optional(),
    notes: z.string().optional().describe("Markdown. Replaces the existing notes."),
    next_step: z.string().optional(),
    waiting_on: z.string().optional().describe("What the project is waiting for, in words. Empty string clears it."),
    waiting_on_person: z.string().nullable().optional().describe("Person name or id the project is waiting on, or null to clear"),
    priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().describe("1 high, 2 normal, 3 low"),
    start_date: ymd.nullable().optional(),
    due_date: ymd.nullable().optional(),
    tags: z.array(z.string()).optional().describe("Replaces the project's tags"),
    color: z.string().nullable().optional().describe("Hex color like #4a7bd0"),
  };

  server.registerTool(
    "create_project",
    {
      description: "Create a new project. Check list_projects or search first so you do not create a duplicate.",
      inputSchema: z.object({
        title: z.string(),
        area: z.enum(AREAS),
        status: z.enum(PROJECT_STATUSES).optional().describe("Defaults to active"),
        people: z.array(z.object({ person: z.string(), role: z.enum(PROJECT_ROLES).optional() })).optional(),
        ...projectFields,
      }),
    },
    safe(async ({ people, waiting_on_person, ...rest }) => {
      const waitId = waiting_on_person ? (await requirePerson(db, waiting_on_person)).id : null;
      const resolved = [];
      for (const p of people ?? []) resolved.push({ id: (await requirePerson(db, p.person)).id, role: p.role });
      const created = await createProject(ctx, { ...rest, waiting_on_person_id: waitId });
      for (const p of resolved) await linkPersonToProject(ctx, created.id, p.id, p.role ?? "collaborator");
      return { created: true, id: created.id, title: created.title, slug: created.slug, receipt: `Created the project “${created.title}”.`, url: link(`/projects/${created.id}`) };
    }),
  );

  server.registerTool(
    "update_project",
    {
      description:
        "Change any field on a project: status, next step, waiting on, due date, priority, title, area, summary, notes or tags. Only the fields you pass change. Changing status adds a status change entry to the timeline automatically.",
      inputSchema: z.object({
        project: z.string().describe("Project id, slug or title words"),
        title: z.string().optional(),
        area: z.enum(AREAS).optional(),
        status: z.enum(PROJECT_STATUSES).optional(),
        ...projectFields,
      }),
    },
    safe(async ({ project, waiting_on_person, ...rest }) => {
      const p = await requireProject(db, project);
      const patch: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      if (waiting_on_person !== undefined) patch.waiting_on_person_id = waiting_on_person ? (await requirePerson(db, waiting_on_person)).id : null;
      const updated = await updateProject(ctx, p.id, patch);
      return { updated: true, id: updated.id, title: updated.title, status: updated.status, next_step: updated.next_step, due_date: updated.due_date, receipt: `Updated the project “${updated.title}”.`, url: link(`/projects/${updated.id}`) };
    }),
  );

  // ---------- timeline ----------

  server.registerTool(
    "add_entry",
    {
      description:
        "Add a timeline entry: an email, meeting, call, note, decision or file, optionally linked to a project and to people. Use this whenever the owner says something happened ('link this email to the MBA project', 'log my meeting with Dylan and Peter'). For an email, ALWAYS pass source_ref 'gmail:<thread id>' using the thread ID from Gmail or Superhuman (they are the same hex ID, for example gmail:1a13ac066450e2b6): the dashboard turns it into an 'Open in Superhuman' link, and the result returns open_in_superhuman_mac_app (for the owner's Mac) and open_in_superhuman_web (for his phone) so you can show him the right one. List the other people on the email in people. For other items use source_ref such as 'gcal:<event id>' and pass a url back to the source. If source_ref already exists, the existing entry is returned instead of a duplicate. occurred_at is when it happened (ISO 8601); it defaults to now. To tag a note, write #hashtags in its body (for example '#budget'): the dashboard files it under those tags, next to tasks with the same tag.",
      inputSchema: z.object({
        project: z.string().optional().describe("Main project: id, slug or title words. Omit for an entry only about people."),
        extra_projects: z.array(z.string()).optional().describe("Other projects this entry also belongs to"),
        people: z.array(z.string()).optional().describe("Names or ids of people involved"),
        kind: z.enum(ENTRY_KINDS.filter((k) => k !== "status_change" && k !== "digest") as [string, ...string[]]),
        title: z.string(),
        body: z.string().optional().describe("Markdown details or summary"),
        url: z.string().optional(),
        source_ref: z.string().optional(),
        occurred_at: z.string().optional(),
        meeting_id: z
          .string()
          .optional()
          .describe("A meeting's id from list_calendar ('add a note to my 2 o'clock', 'note from my 1:1 with Ned'). The body is added to that meeting's note, which is filed with its people and time; title, people and project are then not needed."),
      }),
    },
    safe(async (a) => {
      if (a.meeting_id) {
        const note = await saveMeetingNote(ctx, a.meeting_id, { add: (a.body ?? a.title).trim() });
        return { meeting_note: true, entry: entryBrief(note, 600, await mailAccount()), receipt: `Added to the note for ${note.title}.`, url: link("/") };
      }
      const project = a.project ? (await requireProject(db, a.project)).id : null;
      const extra = [];
      for (const r of a.extra_projects ?? []) extra.push((await requireProject(db, r)).id);
      const people = await personIds(ctx, a.people);
      const { entry, duplicate } = await addEntry(ctx, {
        project_id: project,
        extra_project_ids: extra,
        person_ids: people,
        kind: a.kind,
        title: a.title,
        body: a.body ?? "",
        url: a.url ?? null,
        source_ref: a.source_ref ?? null,
        occurred_at: a.occurred_at,
        source: "mcp",
      });
      return { duplicate, entry: entryBrief(entry, 600, await mailAccount()) };
    }),
  );

  // ---------- tasks and links ----------

  /** What list_tasks can filter by. Names of people and projects are resolved, never guessed. */
  const filterFields = {
    who: z.enum(["mine", "theirs"]).optional().describe("'mine' is his own (including what he owes someone); 'theirs' is waiting on other people"),
    person: z.string().optional().describe("Person name or id: only tasks with them on it"),
    tags: z.array(z.string()).optional().describe("Every one of these tags must be on the task"),
    project: z.string().optional().describe("Project ID, slug or title, or 'none' for tasks with no project"),
    area: areaList,
    due: z.enum(["late", "today", "week", "dated", "none"]).optional().describe("late: past its date. today / week: due by then. dated / none: has a due date or not"),
    older_than_days: z.number().int().min(0).optional().describe("Added at least this many days ago"),
    waiting_days: z.number().int().min(0).optional().describe("Waiting on someone for at least this many days"),
    has_email: z.boolean().optional().describe("Came from an email"),
    text: z.string().optional().describe("Words in the title or notes"),
    hidden: z.enum(["exclude", "include", "only"]).optional().describe("Tasks hidden until a later day: left out by default"),
    state: z.enum(["open", "done", "any"]).optional(),
    done_within_days: z.number().int().min(1).optional(),
  };
  const filterSchema = z.object({ ...filterFields, any: z.array(z.object(filterFields)).optional().describe("Alternatives: a task matches if it fits at least one, as well as everything else. 'Older than 12 days OR from an email' is any: [{older_than_days: 12}, {has_email: true}]") });
  type FilterArgs = z.infer<typeof filterSchema>;
  const toFilter = async ({ person, project, area, any, ...rest }: FilterArgs): Promise<TaskFilterInput> => ({
    ...rest,
    areas: asList(area),
    person_id: person ? (await requirePerson(db, person)).id : undefined,
    project_id: project ? (project === "none" ? "none" : (await requireProject(db, project)).id) : undefined,
    any: any ? await Promise.all(any.map((x) => toFilter(x))) : undefined,
  });

  server.registerTool(
    "list_tasks",
    {
      description:
        "The owner's tasks, filtered any way he asks. Use it for 'what's on my list', 'what am I waiting on from Sam', 'everything tagged budget that is late', 'what has been waiting more than a week', 'show me what I hid'. A task is one line; it may have a person on it, a due date, tags and a project, but none is required. All the filters combine (every one must hold); put alternatives in `any`. Returns open tasks that are not hidden, soonest due first, unless state or hidden says otherwise.",
      inputSchema: filterSchema,
      annotations: { readOnlyHint: true },
    },
    safe(async (a) => {
      const tasks = await listTasks(db, await toFilter(a));
      return { count: tasks.length, tasks: tasks.map((t) => ({ ...taskBrief(t), area: t.project_area })) };
    }),
  );

  server.registerTool(
    "list_tags",
    {
      description: "Every tag the owner uses, with how many open tasks, notes and projects carry each. Call it before tagging something new so you reuse his existing tags instead of inventing near-duplicates (budget vs budgets).",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    safe(async () => ({ tags: (await listTags(db)).map((t) => ({ name: t.name, open_tasks: t.tasks, notes: t.notes, projects: t.projects })) })),
  );

  server.registerTool(
    "add_task",
    {
      description:
        "Put a task on the owner's dashboard. This is the main way things get there: when he says 'add this to my dashboard', 'remind me to...', 'I need to...', or 'Sam owes me...', use this. Only the title is needed. People work like tags: put every person the task involves in `people` and it shows on each of their pages. ALWAYS do that: a task that mentions Nina belongs on Nina's page. Add `waiting_on` for anyone who has to do it before he can move ('Sam owes me the numbers', 'Jonathan to email Dylan' is waiting_on Jonathan with Dylan in people). Use `one_on_one_with` ONLY when he says to put it on his 1:1 list with someone ('add this to my 1:1 with Peter', 'bring this up with Kai at our one-on-one'): nothing goes on a 1:1 list unless he asks. Leave all three out only when the task is simply his own. (As a fallback, a task added with no people whose title names some of his people is tagged with them automatically.) Set due_date whenever he gives any timing ('by Friday', 'next week', 'before the board meeting on the 3rd'): his dashboard lists dated tasks soonest first. Something he told a person he would do ('I told Ned I'd send the list') is his task with that person in people and no waiting_on. Something he asked a person for is waiting_on them, and his dashboard counts the days. Add tags to make it findable (call list_tags first and reuse his tags). Most tasks have NO project: only pass project when he names one or the task is plainly part of an existing project with several tasks. area is the desk (work, personal or side_business) for a task with no project; it defaults to work. Put any detail he gave in notes rather than in a long title.",
      inputSchema: z.object({
        title: z.string().describe("One short line, starting with a verb"),
        people: who.optional().describe("Everyone the task involves: a person name or id, or a list of them. It shows on each of their pages."),
        waiting_on: who.optional().describe("Who he is waiting on for it: a name or id, or a list. They are tagged too."),
        one_on_one_with: who.optional().describe("Whose 1:1 list it goes on. Only when he asks for that. They are tagged too."),
        owed_to: who.optional().describe("Older name for people"),
        discuss_with: who.optional().describe("Older name for people"),
        mentions: who.optional().describe("Older name for people"),
        due_date: ymd.optional(),
        tags: z.array(z.string()).optional(),
        project: z.string().optional().describe("Project ID, slug or title. Usually omitted."),
        source_ref: z.string().optional().describe("Where it came from, so the same thing is never added twice. For a task that came out of an email ALWAYS pass 'gmail:<thread id>': that is what lets him filter for tasks tied to an email."),
        hide_until: ymd.optional().describe("Keep it out of his lists until this day ('not until January')"),
        area: z.enum(AREAS).optional(),
        notes: z.string().optional(),
        assigned_to: z.string().optional().describe("Older name for waiting_on"),
        meeting_id: z.string().optional().describe("A meeting's id from list_calendar, when he adds a task for a meeting ('add a task to my meeting with Aaron'). It then shows in that meeting on his dashboard. Also tag the people in it."),
      }),
    },
    safe(async (a) => {
      const p = a.project ? await requireProject(db, a.project) : null;
      const waiting = await idsOf(a.waiting_on ?? a.assigned_to);
      const oneOnOne = await idsOf(a.one_on_one_with);
      const tagged = [...waiting, ...oneOnOne, ...(await idsOf(a.people)), ...(await idsOf(a.owed_to)), ...(await idsOf(a.discuss_with)), ...(await idsOf(a.mentions))];
      const people = [...new Set(tagged)].map((id) => ({ person_id: id, waiting: waiting.includes(id), one_on_one: oneOnOne.includes(id) }));
      // The same thing sent twice (same source_ref) is not added twice; say so instead of "Added".
      const existed = a.source_ref ? !!(await taskBySource(db, a.source_ref)) : false;
      const t = await addTask(ctx, { project_id: p?.id ?? null, title: a.title, due_date: a.due_date ?? null, people: people.length ? people : undefined, tags: a.tags, area: a.area ?? null, notes: a.notes ?? "", source_ref: a.source_ref ?? null, hide_until: a.hide_until ?? null, meeting_ref: a.meeting_id ?? null,
        // For a meeting with no people named, the meeting's people, not a guess from the wording.
        ...(a.meeting_id && !people.length ? { people: (await meetingPeople(db, a.meeting_id)).map((id) => ({ person_id: id })) } : {}) });
      // Read it back whole: the people may have been picked up from the title.
      const brief = taskBrief((await getTaskItem(db, t.id)) ?? t);
      return { created: !existed, already_there: existed || undefined, task: brief, receipt: taskReceipt(existed ? "Already on the dashboard:" : "Added", brief), url: taskLink(t) };
    }),
  );

  server.registerTool(
    "update_task",
    {
      description:
        "Change a task: its title, notes, status (todo, doing, done), due date, the people on it, its tags (the full new list) or its project (null takes it off its project). People: add_people tags more people on it and remove_people takes them off; neither touches anyone else. waiting_on sets exactly who he is waiting on for it (they are tagged if they were not; null means no one), and everyone else stays tagged. The 1:1 list: add_to_one_on_one puts it on the list for his next 1:1 with those people ('put the Megan salary question on my 1:1 with Peter'), remove_from_one_on_one takes it off ('we covered that', 'clear my 1:1 list with Peter' is this for each task on it). board_row moves it on his planning board ('move the NGU agreement to back burner'). block_time sets aside time for it on his dashboard's week ('give the Jeremy decision 45 minutes Tuesday at 9'); clear_blocks takes its blocks off (to move a block, clear it and give the new time). Get task ids from list_tasks, search or get_person.",
      inputSchema: z.object({
        task_id: z.string(),
        title: z.string().optional(),
        notes: z.string().optional(),
        status: z.enum(TASK_STATUSES).optional(),
        due_date: ymd.nullable().optional(),
        add_people: who.optional().describe("Tag these people on it as well"),
        remove_people: who.optional().describe("Take these people off it"),
        waiting_on: who.nullable().optional().describe("Exactly who he is waiting on for it: a name or id, or a list. null means he is waiting on no one; they stay tagged."),
        add_to_one_on_one: who.optional().describe("Put it on the list for his next 1:1 with these people"),
        remove_from_one_on_one: who.optional().describe("Take it off the 1:1 list for these people; they stay tagged"),
        owed_to: who.optional().describe("Older name for add_people"),
        discuss_with: who.optional().describe("Older name for add_people"),
        mentions: who.optional().describe("Older name for add_people"),
        tags: z.array(z.string()).optional().describe("Replaces the task's tags"),
        hide_until: ymd.nullable().optional().describe("Keep it out of his lists until this day, or null to show it again"),
        project: z.string().nullable().optional().describe("Project ID, slug or title, or null for no project"),
        assigned_to: z.string().nullable().optional().describe("Older name for waiting_on"),
        board_row: z
          .enum(["new", "todo", "waiting", "back", "figure"])
          .optional()
          .describe("The row of his planning board: todo, waiting (to hear back), back (back burner), figure (to figure out), or new (not placed yet). He may have renamed them; his words for them are in the result's board_names."),
        block_time: z
          .object({
            day: ymd,
            start: z.string().regex(/^\d{1,2}:\d{2}$/, "Use HH:MM, 24-hour, his time zone").describe("Start, HH:MM in 24-hour time, his time zone"),
            minutes: z.number().int().min(5).max(720),
          })
          .optional()
          .describe("Set aside time for it on his dashboard's week. Only after he has said yes to the time."),
        clear_blocks: z.boolean().optional().describe("Take this task's blocks from today on off his week"),
      }),
    },
    safe(async ({ task_id, assigned_to, board_row, block_time, clear_blocks, waiting_on, owed_to, discuss_with, mentions, add_people, remove_people, add_to_one_on_one, remove_from_one_on_one, project, ...rest }) => {
      const patch: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      const waiting = waiting_on !== undefined ? waiting_on : assigned_to;
      const touched = [waiting, owed_to, discuss_with, mentions, add_people, remove_people, add_to_one_on_one, remove_from_one_on_one].some((x) => x !== undefined);
      if (touched) {
        // Start from who is on it now and apply each change; no one is dropped by accident.
        const now = (await getTaskItem(db, task_id))?.people ?? [];
        const on = new Map(now.map((p) => [p.id, { person_id: p.id, waiting: p.waiting, one_on_one: p.one_on_one }]));
        const tag = (id: string) => on.get(id) ?? on.set(id, { person_id: id, waiting: false, one_on_one: false }).get(id)!;
        for (const id of [...(await idsOf(add_people)), ...(await idsOf(owed_to)), ...(await idsOf(discuss_with)), ...(await idsOf(mentions))]) tag(id);
        if (waiting !== undefined) {
          const ids = await idsOf(waiting);
          for (const p of on.values()) p.waiting = false;
          for (const id of ids) tag(id).waiting = true;
        }
        for (const id of await idsOf(add_to_one_on_one)) tag(id).one_on_one = true;
        for (const id of await idsOf(remove_from_one_on_one)) if (on.has(id)) on.get(id)!.one_on_one = false;
        for (const id of await idsOf(remove_people)) on.delete(id);
        patch.people = [...on.values()];
      }
      if (project !== undefined) patch.project_id = project ? (await requireProject(db, project)).id : null;
      if (board_row !== undefined) patch.board = board_row === "new" ? null : board_row;
      const t = Object.keys(patch).length ? await updateTask(ctx, task_id, patch) : await getTask(ctx, task_id);
      if (!t) throw new NotFoundError(`No task with id ${task_id}`);
      const settings = await getSettings(db);
      const extra: string[] = [];
      if (clear_blocks) {
        const today = todayInTz(settings.timezone);
        const mine = (await listTimeBlocks(db, today, addDays(today, 60))).filter((b) => b.task_id === t.id);
        for (const b of mine) await deleteTimeBlock(ctx, b.id);
        if (mine.length) extra.push(`took ${mine.length === 1 ? "its block" : `its ${mine.length} blocks`} off the week`);
      }
      if (block_time) {
        const [h, m] = block_time.start.split(":").map(Number);
        await addTimeBlock(ctx, { task_id: t.id, day: block_time.day, start_min: h! * 60 + m!, minutes: block_time.minutes });
        extra.push(`blocked ${block_time.day} at ${block_time.start} for ${block_time.minutes} minutes`);
      }
      if (board_row !== undefined) extra.push(`moved to ${board_row === "new" ? "New" : settings.board_names[board_row]}`);
      const brief = taskBrief((await getTaskItem(db, t.id)) ?? t);
      const receipt = taskReceipt(t.status === "done" ? "Marked done:" : "Updated", brief);
      return {
        updated: true,
        task: brief,
        receipt: extra.length ? `${receipt.replace(/\.$/, "")}; ${extra.join("; ")}.` : receipt,
        url: block_time || clear_blocks || board_row !== undefined ? link("/") : taskLink(t),
        board_names: board_row !== undefined ? settings.board_names : undefined,
      };
    }),
  );

  server.registerTool(
    "delete_task",
    {
      description:
        "Remove a task from the dashboard: one added by mistake, a duplicate, or one that no longer applies. Use complete_task instead when the thing was actually done. When two tasks are the same thing, first put every person and any notes worth keeping on the one that stays (update_task), then remove the other. Nothing is destroyed: undo_last brings it back.",
      inputSchema: z.object({ task_id: z.string() }),
    },
    safe(async ({ task_id }) => {
      const t = await getTaskItem(db, task_id);
      if (!t) throw new NotFoundError(`No task with id ${task_id}`);
      await deleteTask(ctx, task_id);
      return { removed: true, task: taskBrief(t), receipt: `Removed “${t.title.length > 70 ? `${t.title.slice(0, 69)}…` : t.title}”. Say "undo" to bring it back.`, url: link("/tasks") };
    }),
  );

  server.registerTool(
    "complete_task",
    {
      description: "Mark a task done. If the task is on a project, this also adds a 'done' line to that project's timeline.",
      inputSchema: z.object({ task_id: z.string() }),
    },
    safe(async ({ task_id }) => {
      const before = await getTask(ctx, task_id);
      if (!before) throw new NotFoundError(`No task with id ${task_id}`);
      const t = await completeTask(ctx, task_id);
      const brief = taskBrief((await getTaskItem(db, t.id)) ?? t);
      return { completed: true, task: brief, receipt: `Marked done: “${brief.title}”.`, url: taskLink(t) };
    }),
  );

  server.registerTool(
    "add_link",
    {
      description: "Pin a resource (Google Doc, Sheet, Slides, Drive folder, email or website) to a project so it shows in the project's Links list.",
      inputSchema: z.object({
        project: z.string(),
        label: z.string(),
        url: z.string(),
        kind: z.enum(LINK_KINDS).optional(),
      }),
    },
    safe(async (a) => {
      const p = await requireProject(db, a.project);
      const l = await addLink(ctx, { project_id: p.id, label: a.label, url: a.url, kind: a.kind ?? "other" });
      return { created: true, id: l.id, project: p.title };
    }),
  );

  // ---------- people ----------

  server.registerTool(
    "get_person",
    {
      description:
        "Everything about one of the owner's people, and the way to prepare for a meeting with them. Use for 'prep me for my meeting with Kai', 'what is on my 1:1 list with Peter', 'what am I waiting on from Sam', 'what did Greta and I talk about last time', 'who is Nina'. Returns the next meeting with them, one_on_one_list (what he has put on the list for their next 1:1), waiting_on_them, every other task they are tagged on, the projects they share and the latest notes filed with them. Takes a name, another name they go by, an email or an id. If the name fits more than one person the answer lists them: ask which one.",
      inputSchema: z.object({ person: z.string().describe("Name, another name they go by, email or id") }),
      annotations: { readOnlyHint: true },
    },
    safe(async ({ person }) => {
      const p = await requirePerson(db, person);
      const d = (await getPersonDetail(db, p.id))!;
      const tasks = await listTasks(db, { person_id: p.id });
      // What this person is to each task they are on.
      const mark = (x: (typeof tasks)[number]) => x.people.find((y) => y.id === p.id);
      const settings = await getSettings(db);
      const next = (await peopleComingUp(db, todayInTz(settings.timezone))).find((x) => x.id === p.id)?.next;
      return {
        id: d.id,
        name: d.name,
        also_called: d.aliases || undefined,
        role: d.role || undefined,
        email: d.email || undefined,
        regular_one_on_one: d.one_on_one?.relationship ?? undefined,
        next_meeting: next ? { day: next.day, time: next.starts_at ? new Date(next.starts_at).toLocaleTimeString("en-US", { timeZone: settings.timezone, hour: "numeric", minute: "2-digit" }) : undefined, title: next.one_on_one ? "1:1" : next.title } : undefined,
        one_on_one_list: tasks.filter((x) => mark(x)?.one_on_one).map(taskBrief),
        waiting_on_them: tasks.filter((x) => mark(x)?.waiting).map(taskBrief),
        other_tasks_with_them: tasks.filter((x) => !mark(x)?.one_on_one && !mark(x)?.waiting).map(taskBrief),
        projects: d.projects.map((x) => ({ id: x.id, title: x.title, status: x.status })),
        recent_notes: d.timeline.slice(0, 8).map((e) => entryBrief(e, 1500)),
        url: link(`/people/${d.id}`),
      };
    }),
  );

  /** Whether the owner has a regular 1:1 with the person, and what they are to him. */
  const oneOnOne = z.enum(["direct", "manager", "peer", "other", "none"]).optional().describe("Set when the owner meets them regularly one on one: direct (report), manager, peer or other. 'none' ends it. Meetings titled like a 1:1 with them are then recognized on his calendar.");
  const personFields = {
    email: z.string().optional(),
    aliases: z.string().optional().describe("Other names and spellings they go by, separated by commas ('Nena, Nini'). Replaces the saved list. Add one whenever the owner's wording for a person differs from their record, so the next mention matches."),
    role: z.string().optional(),
    organization: z.string().optional(),
    area: z.enum(AREAS).nullable().optional(),
    notes: z.string().optional().describe("Markdown. Replaces existing notes."),
  };

  server.registerTool(
    "create_person",
    {
      description: "Add a new person to the dashboard. Call search with their name first so you do not create a duplicate. Give their email when you know it: that is how calendar meetings are tied to them.",
      inputSchema: z.object({ name: z.string(), ...personFields, regular_one_on_one: oneOnOne }),
    },
    safe(async ({ regular_one_on_one, ...a }) => {
      const p = await createPerson(ctx, a);
      if (regular_one_on_one && regular_one_on_one !== "none") await setOneOnOne(ctx, p.id, { relationship: regular_one_on_one });
      return { created: true, id: p.id, name: p.name, receipt: `Added ${p.name} to your people.`, url: link(`/people/${p.id}`) };
    }),
  );

  server.registerTool(
    "update_person",
    {
      description:
        "Change a person: their name, the other names they go by, email, role, desk (area), or whether the owner has a regular 1:1 with them. Use it when he says 'Nena is spelled Nina', 'Jon is Jordan Ahn', 'I meet with Jay regularly now'.",
      inputSchema: z.object({ person: z.string(), name: z.string().optional(), ...personFields, regular_one_on_one: oneOnOne }),
    },
    safe(async ({ person, regular_one_on_one, ...rest }) => {
      const p = await requirePerson(db, person);
      const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      const u = await updatePerson(ctx, p.id, patch);
      if (regular_one_on_one === "none") await endOneOnOne(ctx, p.id);
      else if (regular_one_on_one) await setOneOnOne(ctx, p.id, { relationship: regular_one_on_one });
      return { updated: true, id: u.id, name: u.name, receipt: `Updated ${u.name}.`, url: link(`/people/${u.id}`) };
    }),
  );

  server.registerTool(
    "link_person_to_project",
    {
      description: "Connect a person to a project as owner, collaborator or stakeholder, so the project shows on their page.",
      inputSchema: z.object({ person: z.string(), project: z.string(), role: z.enum(PROJECT_ROLES).optional() }),
    },
    safe(async (a) => {
      const person = await requirePerson(db, a.person);
      const project = await requireProject(db, a.project);
      await linkPersonToProject(ctx, project.id, person.id, a.role ?? "collaborator");
      return { linked: true, person: person.name, project: project.title, role: a.role ?? "collaborator" };
    }),
  );

  // ---------- search and views ----------

  server.registerTool(
    "search",
    {
      description: "Search everything on the dashboard by words: tasks (open, and ones finished in the last two weeks), projects, people, notes (emails, meetings, decisions) and the days of his daily log ('when did I last work on the budget'). Every word has to appear. Use it to find a specific thing ('the scholarship funds task', 'anything about the MBA pathway') and ALWAYS before adding something that may already be there. For a filtered list of tasks (by person, date, tag) use list_tasks instead.",
      inputSchema: z.object({ query: z.string() }),
      annotations: { readOnlyHint: true },
    },
    safe(async ({ query }) => {
      const r = await search(db, query, undefined, 15);
      return {
        tasks: r.tasks.map(taskBrief),
        projects: r.projects.map(projectBrief),
        people: r.people.map((p) => ({ id: p.id, name: p.name, also_called: p.aliases || undefined, role: p.role || undefined })),
        entries: r.entries.map((e) => entryBrief(e, 300)),
        daily_log: r.logs.length ? r.logs.map(logBrief) : undefined,
      };
    }),
  );

  server.registerTool(
    "whats_changed",
    {
      description: "Everything written to the dashboard since a date or time (by the owner on the website or by any AI), in plain language. Use for 'what changed since Monday' or to review what another AI did.",
      inputSchema: z.object({ since: z.string().describe("ISO date or time, for example 2026-11-10 or 2026-11-10T14:00:00Z") }),
      annotations: { readOnlyHint: true },
    },
    safe(async ({ since }) => {
      if (Number.isNaN(Date.parse(since))) throw new InputError("since must be an ISO date or time");
      const rows = await whatsChanged(db, since);
      return { count: rows.length, changes: rows.map((r) => ({ audit_id: r.id, at: r.at, by: r.actor, summary: r.summary, undone: !!r.undone_at })) };
    }),
  );

  server.registerTool(
    "what_to_work_on",
    {
      description:
        "Use this whenever the owner asks what he should work on, to plan his day or his week, or what is on his plate ('what should I be working on today', 'plan my week', 'what do I need to do'). His dashboard shows the meetings ahead and his promises; this is the fuller answer, including his own tasks with no date and no person. It returns, in the order to present it: late (past its due date), due_today, due_this_week, meetings (with people_you_are_meeting: who each is with, how many things are on his 1:1 list with them and how many he is waiting on from them, so he can raise them), waiting_a_week_or_more (things to nudge someone about), and no_due_date (his own tasks with no deadline). Lead with what is late and what is due today. Offer the no_due_date tasks only as options for open time, a few at a time, never as a to-do list. Tasks he has hidden until a later day are already left out: never suggest them. horizon is 'today' (the default) or 'week'.",
      inputSchema: z.object({ horizon: z.enum(["today", "week"]).optional() }),
      annotations: { readOnlyHint: true },
    },
    safe(async ({ horizon }) => {
      const d = await workPlan(db, horizon ?? "today");
      const names = await personNames();
      const timezone = (await getSettings(db)).timezone;
      const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" });
      return {
        today: d.today,
        horizon: d.horizon,
        late: d.late.map(taskBrief),
        due_today: d.due_today.map(taskBrief),
        due_this_week: d.due_this_week.map(taskBrief),
        meetings: d.meetings.map((e) => eventBrief(e, names, timezone)),
        people_you_are_meeting: d.people.map((p) => ({
          name: p.name,
          meeting: p.next!.one_on_one ? "1:1" : p.next!.title,
          day: p.next!.day,
          time: p.next!.starts_at ? clock(p.next!.starts_at) : undefined,
          on_one_on_one_list: p.discuss || undefined,
          waiting_on_them: p.theirs || undefined,
          other_tasks_with_them: p.mine || undefined,
        })),
        waiting_a_week_or_more: d.waiting_a_while.map(taskBrief),
        no_due_date: d.no_due_date.map(taskBrief),
      };
    }),
  );

  server.registerTool(
    "morning_brief_data",
    {
      description:
        "One call with everything the morning digest needs: today's and tomorrow's meetings from the owner's connected calendars, the 1:1s among them (with how many items are on each list), overdue, due soon, waiting on, stale projects, the last 24 hours of entries and changes, and open tasks grouped by project. Use this at the start of the morning digest task.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    safe(async () => {
      const d = await morningBriefData(db);
      const names = await personNames();
      return {
        today: d.today,
        timezone: d.timezone,
        calendar_today_and_tomorrow: d.calendar.map((e) => eventBrief(e, names, d.timezone)),
        one_on_ones_today_and_tomorrow: d.one_on_ones.map((o) => ({ with: o.name, day: o.next_expected, starts_at: o.next_starts_at ?? undefined, to_discuss: o.discuss, they_owe: o.theirs, i_owe: o.mine })),
        overdue: { projects: d.overdue.projects.map(projectBrief), tasks: d.overdue.tasks.map(taskBrief) },
        due_soon: { projects: d.due_soon.projects.map(projectBrief), tasks: d.due_soon.tasks.map(taskBrief) },
        waiting_on: { projects: d.waiting_on.projects.map(projectBrief), tasks: d.waiting_on.tasks.map(taskBrief) },
        stale: d.stale.map(projectBrief),
        last_24h_entries: d.last_24h_entries.map((e) => entryBrief(e, 300)),
        last_24h_changes: d.last_24h_changes.map((r) => ({ at: r.at, by: r.actor, summary: r.summary })),
        open_tasks_by_project: d.open_tasks_by_project,
      };
    }),
  );

  server.registerTool(
    "save_digest",
    {
      description: "Save the morning digest (markdown) so it shows at the top of the dashboard's Today view. run_date defaults to today in Eastern time.",
      inputSchema: z.object({ body: z.string(), run_date: ymd.optional() }),
    },
    safe(async (a) => {
      const d = await saveDigest(ctx, a);
      return { saved: true, id: d.id, run_date: d.run_date };
    }),
  );

  // ---------- the daily log ----------

  server.registerTool(
    "get_daily_log",
    {
      description:
        "The owner's daily log: a short record of what he worked on each day. Use it for 'what did I do today', 'what did I do yesterday', 'what did I work on last Tuesday', and as the FIRST step every time he asks to update or add to his log. With no arguments it is today. For one day it returns log (written_up: the day as it was written up; his_notes: things he said he did, in his words; not_yet_in_write_up: the ones he said after the write-up was saved; null when nothing is logged yet) and seen_by_the_dashboard: that day's meetings with who each was with, time_set_aside (time he blocked for his own work, which is NOT a meeting: each has a ref, and once he has said how it went an outcome: 'did the work', 'did not get to it', or 'did something else' with instead saying what), the tasks added, the tasks finished and the notes filed. It also returns project_names (his projects: a write-up heads work on one with exactly that title) and names_used_lately (what the last two weeks of write-ups called things, and on which days), so the same work carries the same name every day. Meetings are known for about the last two weeks; for an older day the saved log is the record. For several days ('what did I work on this week', a weekly review, 'how are my time blocks going') pass from and to (YYYY-MM-DD, both included): it returns the saved logs for those days, newest first, and time_blocks: how many sessions of his own time he did the work in, how many he did not, and how many of those went to something else. To find the day something happened ('when did I last work on the MBA pathway'), use search instead: it covers the log.",
      inputSchema: z.object({
        day: ymd.optional().describe("One day. Defaults to today."),
        from: ymd.optional().describe("First day of a range. Use with to, instead of day."),
        to: ymd.optional().describe("Last day of a range. Defaults to today."),
      }),
      annotations: { readOnlyHint: true },
    },
    safe(async ({ day, from, to }) => {
      const { timezone } = await getSettings(db);
      const today = todayInTz(timezone);
      if (from) {
        if (day) throw new InputError("Pass day for one day, or from and to for several, not both.");
        const logs = await listDailyLogs(db, { from, to: to ?? today, limit: 100 });
        const tally = await blockTally(db, from, to ?? today);
        return {
          from,
          to: to ?? today,
          days_logged: logs.length,
          logs: logs.map(logBrief),
          // Only sessions he answered for are counted.
          time_blocks: tally.kept + tally.not_kept
            ? { did_the_work: tally.kept, did_not: tally.not_kept, of_those_did_something_else: tally.something_else, hours_worked: Math.round(tally.minutes_kept / 6) / 10, hours_not: Math.round(tally.minutes_not_kept / 6) / 10 }
            : "None answered for in these days.",
          url: link("/log"),
        };
      }
      const d = day ?? today;
      const saved = await getDailyLog(db, d);
      const facts = await dayFacts(db, d);
      const names = await personNames();
      const projects = (await listProjects(db, {})).filter((p) => p.status !== "done");
      const lately = await logNames(db, addDays(d, -14), addDays(d, -1));
      return {
        day: d,
        weekday: new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long" }),
        log: saved ? logBrief(saved) : null,
        seen_by_the_dashboard: {
          meetings: facts.meetings_known
            ? facts.meetings.map((e) => ({ ...eventBrief(e, names, timezone), with: e.with.length ? e.with : undefined, day: undefined, url: undefined }))
            : "Not kept this far back. The saved log is the record of that day's meetings.",
          // His own time, not meetings. Pass ref to save_daily_log time_blocks to record how it went.
          time_set_aside: facts.own_time.map((o) => ({
            ref: o.ref,
            // Only on a session whose block or calendar entry was moved or taken off since: pass it with the ref.
            day: o.live ? undefined : o.day,
            time: `${clockOf(o.start_min)} to ${clockOf(o.start_min + o.minutes)}`,
            minutes: o.minutes,
            title: o.title,
            made_in: o.source === "dashboard" ? "his dashboard" : "his calendar",
            task_finished: o.task_done || undefined,
            outcome: outcomeOf(o) ?? undefined,
            instead: o.instead || undefined,
          })),
          tasks_finished: facts.tasks_finished.map(taskBrief),
          tasks_added: facts.tasks_added.map(taskBrief),
          notes_filed: facts.notes_filed.map((e) => ({ kind: e.kind, title: e.title || undefined, people: e.people.length ? e.people.map((p) => p.name) : undefined, project: e.project_title ?? undefined })),
        },
        // Work on one of these goes under a heading that is exactly its title, the same every day.
        project_names: projects.map((p) => p.title),
        // What the write-ups of the two weeks before called things. The same work keeps the same name.
        names_used_lately: lately.length ? lately : undefined,
        url: link(`/log#${d}`),
      };
    }),
  );

  server.registerTool(
    "save_daily_log",
    {
      description:
        "Write to the owner's daily log. Call get_daily_log first, every time. Three things can be written, in one call: (1) add: something he says he did or worked on, at any time of day ('log that I finished the budget draft', 'add to my log that I updated Dr. Ross on the MBA pathway', or his answer to 'anything else you worked on today?'). One short line for each thing, close to his own words. When he also gives the detail of a conversation, file that detail as a note with the person (add_entry) and keep the log line short. It is added to that day's notes and never replaces anything; the same line is not added twice. (2) body: the day written up (markdown, short): one line for each thing he worked on, with the meetings, the mail he sent, the tasks he finished and his own notes about the same thing put together, so nothing is listed twice; work on one of his projects under a heading that is exactly the project's title. It REPLACES what was written up before for that day, so keep what still holds. His notes are kept as he said them, but a saved write-up is taken to cover all of them (including any passed in add in the same call) and his dashboard stops listing them separately, so fold every one in. A note added without body shows under the write-up until the day is written up again, so pass both. day defaults to today; pass it to log an earlier day ('add to yesterday's log that...'). A day that has not happened yet is refused. (3) time_blocks: how time he had set aside went ('I did the pricing block', 'I never got to the report', 'I skipped the newsletter and did the budget instead'). Each is { ref, kept, instead }: ref from get_daily_log's time_set_aside; kept true when he did the work in that time; kept false when he did not get to it; kept false with instead (what he did, in his words) when he used the time for something else. It is how his blocks are counted over time and how his dashboard marks each one; record only what he said or what the day plainly shows, never a guess. This only records what he did: it does not add or finish tasks.",
      inputSchema: z.object({
        add: z.union([z.string(), z.array(z.string())]).optional().describe("One thing he said he did, or a list of them. One short line each."),
        body: z.string().optional().describe("The day written up, in markdown. Replaces the earlier write-up for that day."),
        time_blocks: z
          .array(
            z.object({
              ref: z.string().describe("The ref from time_set_aside"),
              kept: z.boolean().describe("true: he did the work in that time. false: he did not."),
              instead: z.string().max(200).optional().describe("Only with kept false: what he did in that time instead, one short line in his words. Leave out when he simply did not get to it."),
              day: ymd.optional().describe("Only when the time_set_aside entry carries a day (its block was moved or taken off since): that day."),
            }),
          )
          .max(30)
          .optional()
          .describe("How time he had set aside went."),
        day: ymd.optional().describe("Defaults to today."),
      }),
    },
    safe(async ({ add, body, time_blocks, day }) => {
      const lines = add === undefined ? undefined : [add].flat().map((x) => x.trim()).filter(Boolean);
      if (body === undefined && !lines?.length && !time_blocks?.length) throw new InputError("Pass add, body or time_blocks.");
      const kept: string[] = [];
      for (const b of time_blocks ?? []) {
        const r = await saveBlockResult(ctx, b);
        const how = outcomeOf(r);
        kept.push(`“${r.title}”: ${how === "did something else" ? `did something else (${r.instead})` : how}`);
      }
      const saved = body !== undefined || lines?.length ? await saveDailyLog(ctx, { day, body, add: lines?.length ? lines : undefined }) : null;
      const what = [body !== undefined && "wrote up the day", lines?.length && `added ${lines.length === 1 ? "a note" : `${lines.length} notes`}`].filter(Boolean).join(" and ");
      const receipt = [saved && `Daily log for ${saved.day}: ${what}.`, kept.length && `Time set aside: ${kept.join(", ")}.`].filter(Boolean).join(" ");
      return { saved: true, log: saved ? logBrief(saved) : undefined, receipt, url: link("/log") };
    }),
  );

  // ---------- the "Needs you" queue (email triage and other automations) ----------

  server.registerTool(
    "log_run",
    {
      description:
        "Record that a scheduled run finished, so the dashboard can show when it last ran. Call it once at the very end of the morning brief (name 'morning-brief') or the scheduled end-of-day log ('daily-log'), with a one-line result such as '5 meetings, 2 overdue' or '4 meetings, 6 emails, 3 tasks finished'. Not needed when he asks for either in a chat himself.",
      inputSchema: z.object({
        name: z.string().describe("Lowercase with dashes: morning-brief, daily-log"),
        summary: z.string().optional(),
      }),
    },
    safe(async (a) => {
      const r = await logRun(ctx, { name: a.name, summary: a.summary ?? "" });
      return { logged: true, name: r.name, ran_at: r.ran_at };
    }),
  );

  // ---------- 1:1s ----------

  server.registerTool(
    "undo_last",
    {
      description:
        "Reverse the most recent write made by an actor (default: this client). First call with confirm false to see what would be undone, then call again with confirm true. Use when the owner says 'undo that' or 'that was wrong'.",
      inputSchema: z.object({
        confirm: z.boolean(),
        actor: z.string().optional().describe("Whose last change to undo, for example mcp:claude or web. Defaults to this client."),
      }),
    },
    safe(async ({ confirm, actor }) => {
      const who = actor ?? ctx.actor;
      const last = await lastAuditBy(db, who);
      if (!last) return { nothing_to_undo: true, actor: who };
      const [view] = await listAudit(db, { since: last.at, actor: who, limit: 1 });
      if (!confirm) return { would_undo: view?.summary ?? `${last.action} on ${last.table_name}`, audit_id: last.id, at: last.at, confirm_needed: true };
      const r = await undoAudit(ctx, last.id);
      if (!r.ok) throw new InputError(r.error);
      return { undone: true, summary: view?.summary, audit_id: last.id };
    }),
  );

  // ---------- calendar (read by the dashboard itself, through the Google sign-ins in Settings) ----------

  server.registerTool(
    "list_calendar",
    {
      description:
        "The owner's meetings from the calendars connected to the dashboard (work, personal and side business), in order. Use it for 'what's on my calendar', 'when is my next 1:1 with Kai', or to plan around his day. Defaults to today through the next 7 days; pass from and to (YYYY-MM-DD) for another range, up to 4 weeks ahead. An event that is a 1:1 with someone the owner meets regularly names them in one_on_one_with. An event marked by_himself has no one else on it: it is time he set aside for his own work (or an appointment), not a meeting. Read only: this cannot create or change events. It also returns his blocks: time he set aside on his dashboard for tasks (made with update_task block_time). An empty list with connected false means no calendar is connected yet (Settings, Connections).",
      inputSchema: z.object({ from: ymd.optional(), to: ymd.optional(), area: areaList }),
      annotations: { readOnlyHint: true },
    },
    safe(async ({ from, to, area }) => {
      const { timezone } = await getSettings(db);
      const start = from ?? todayInTz(timezone);
      const events = await listCalendarEvents(db, start, to ?? addDays(start, 7), asList(area));
      const names = await personNames();
      const accounts = await listGoogleAccounts(db);
      const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
      const blocks = (await listTimeBlocks(db, start, to ?? addDays(start, 7))).filter((b) => !area || asList(area)!.includes(b.area as never));
      return {
        connected: accounts.length > 0,
        calendars: accounts.map((a) => ({ email: a.email, area: a.area, synced_at: a.calendar_synced_at ?? undefined })),
        count: events.length,
        events: events.map((e) => eventBrief(e, names, timezone)),
        blocks: blocks.map((b) => ({ day: b.day, start: hhmm(b.start_min), end: hhmm(b.start_min + b.minutes), task: b.title, task_id: b.task_id, done: b.status === "done" || undefined })),
      };
    }),
  );

  return server;
}
