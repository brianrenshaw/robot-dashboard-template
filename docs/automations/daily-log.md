# Daily log

Writes the day's entry in the owner's daily log (the **Log** page, and the "Today's log" line on the
dashboard) and then asks him what else he worked on. He asked for it on 2026-11-14: a casual
record of each day that he does not have to keep himself.

Unlike the morning brief, this one runs in **Claude Duet**, not in a Claude Code cloud session.
It needs things only Duet's connectors can reach (the mail he sent, his Granola meeting notes),
and it ends with a question to him, so it has to run where he will see it. It reaches the
dashboard through his dashboard connector (it is named "Projects" in his Claude account), not
with the token.

To set it up, he pastes the text inside the code block below into Claude Duet as one message.

```
Every weekday at 4:45 PM New York time, run my end-of-day log. Do steps 1 to 6 without asking me anything, then ask me the question in step 7, then do step 8.

1. From my dashboard (the Projects connector), call get_daily_log with no arguments. It returns today's date, the meetings on my calendar and who each was with, the tasks I added and finished today, the notes filed today, anything I jotted in the log during the day, and the write-up if one is already saved.

2. From my email, find the mail I SENT today, in every mailbox of mine you can reach. Write one line per thread: who it went to, and what I said, asked or decided. Leave out calendar replies, one-word answers and anything automatic.

3. From Granola, find today's meetings. For each one that has notes, take one or two sentences: what it was about, and anything decided or promised. Match them to the meetings from step 1 by time and title. If my calendar shows a meeting I attended that the dashboard did not list, include it.

4. Write the day up and save it to my dashboard with save_daily_log, in the body field. Keep it short and plain, in markdown, something I can read in under a minute:
   - First, one sentence on what the day was mostly about.
   - "## Meetings": one line per meeting: the time in bold, who it was with, then what it was about when there are notes.
   - "## Email": the lines from step 2.
   - "## Tasks": a "Finished: ..." line for each task I finished, then an "Added: ..." line for each one I added.
   Leave out a section that has nothing in it. Do not repeat the things I jotted in the log myself: the dashboard shows those under the write-up. If a write-up is already saved for today, keep what still holds and add what is new. Plain words, and no dashes used as punctuation.

5. For each 1:1 today that has Granola notes, also file the summary with that person on my dashboard: add_entry with kind "meeting", title "1:1 with <their name>", people [<their name>], a body of three to six short lines (what we covered, what was decided, what each of us owes the other), and source_ref "granola:<the meeting's id>" so it is never filed twice. If the dashboard says the name fits more than one person, skip that one and tell me.

6. Call log_run with name "daily-log" and one line such as "4 meetings, 6 emails, 3 tasks finished".

7. Show me the write-up, then ask: "Anything else you worked on today?" When I answer, add each thing to the log with save_daily_log, in the add field, one short line each, close to my own words. If I do not answer, leave it. The log is already saved.

8. Last, catch what belongs on my dashboard. From the mail I sent today (step 2) and today's meeting notes (step 3), find:
   - things I said I would do ("I'll send that over", "let me get back to you"): a task of mine with the person I told in people, and no waiting_on;
   - things I asked someone for and have not received: a task with waiting_on that person, worded as the thing I am waiting for;
   - dates I have to be ready for: a task with that due_date;
   - tasks already on my dashboard that today's mail shows are done.
   Search the dashboard for each one first so nothing is proposed twice. Show me ONE short plain list with no groups or headings (each line is the task, who it is with or who I am waiting on, and its date; a task to mark done says so), and ask "Add these?". Write only the ones I say yes to: add_task (with source_ref "gmail:<thread id>" for anything that came from an email thread) and complete_task. If there is nothing, skip this step and say nothing.

Rules:
- Writing the log never adds, finishes or changes a task. Step 8 is the only place tasks change, and only the ones I say yes to. Do not send, draft, archive or label any email.
- If a connector is missing or fails (email, Granola or calendar), say which in one line and write the log from what you have.
- If there is nothing at all to log (no meetings, no mail sent, no tasks, nothing jotted), do not save an empty log. Just ask me the question.
- Never guess a person. Use the names the dashboard gives you.
```

Notes for whoever maintains this:

- It calls these dashboard tools by name: `get_daily_log`, `save_daily_log`, `add_entry`,
  `log_run`, and for step 8 `search`, `add_task` and `complete_task`. If one is renamed or removed, change this prompt in the same change and tell the owner
  to give Duet the new text: Duet keeps its own copy.
- The same routine, in shorter form, is in the chatbot's standing instructions (`INSTRUCTIONS`
  in `workers/mcp/src/tools.ts`), so "log my day" works in any chat that has the dashboard
  connector, at any time. Keep the two in step.
- The write-up (`body`) is replaced each time it is saved; what the owner said himself (`notes`,
  written with `add`) is only ever added to. That is why the prompt tells the chatbot not to
  repeat his notes in the write-up.
- The dashboard's own half of the day (`dayFacts` in `packages/core/src/daylog.ts`) knows
  meetings only for today and yesterday, because the calendar copy is replaced on every sync.
  A day is best logged on the day.
- Step 8 was added on 2026-11-15, when the owner said "adding the emails as tasks is definitely
  important" and named the three things he loses track of: what he told someone he would do,
  what he is getting ready for, and what he asked someone for. It is how those reach the
  dashboard without him typing them. It proposes; it never writes without his yes.
- The site still reads no mail and no meeting notes. Only Duet does, with the owner's own
  connectors, when this runs or when he asks.
- Settings, under Automations, shows when it last ran (from `log_run`).
