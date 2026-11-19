# Daily log

Makes sure the day's entry in the owner's daily log (the **Log** page, and the "Today's log" line on
the dashboard) is complete, late each weekday evening. He asked for the log on 2026-11-14: a
casual record of each day that he does not have to keep himself.

It runs at 10:30 PM and asks him nothing (2026-11-19: "i actually don't want it asking me
questions... run maybe at like 10:30 at night to make sure everything is updated"). Most days he
has already updated the log through his chatbot, and it quietly adds whatever is missing. On a
day he added nothing himself, it writes the day up and emails him a short note, because he keeps
notifications off to stay focused and a message in Duet would go unseen ("If i hadn't added
anything to the log that day then just email myself and say something simple like here is what
I added to my log, let me know if you wanted anything added").

It runs in **Claude Duet**, not in a Claude Code cloud session, because it needs things only
Duet's connectors can reach (the mail he sent, his Granola meeting notes, and sending him the
email). It reaches the dashboard through his dashboard connector (it is named "Projects" in his
Claude account), not with the token.

To set it up, he pastes the text inside the code block below into Claude Duet as one message.

```
Every weekday at 10:30 PM New York time, make sure today's entry in my daily log is complete. Run it from start to finish without asking me anything: I keep notifications off, so a question here would go unseen.

1. From my dashboard (the Projects connector), call get_daily_log with no arguments. It returns today's date, the meetings on my calendar and who each was with, the time I set aside for my own work (time_set_aside: this is NOT a meeting), the tasks I added and finished today, the notes filed today, anything I put in the log during the day (his_notes), the write-up if one is saved (written_up), my projects (project_names) and what my log called things over the last two weeks (names_used_lately).
   Note whether I added anything to the log myself today: I did if log is not null, that is, if there is a write-up or any of his_notes. Remember the answer for step 7.

2. From my email, find the mail I SENT today, in every mailbox of mine you can reach. Write one line per thread: who it went to, and what I said, asked or decided. Leave out calendar replies, one-word answers and anything automatic.

3. From Granola, find today's meetings. For each one that has notes, write a SHORT summary: one or two sentences on what it was about and what was decided. Match them to the meetings from step 1 by time and title. If my calendar shows a meeting I attended that the dashboard did not list, include it. Granola notes are used for these summaries and for nothing else: never turn a meeting's notes, action items or next steps into tasks or to-do lines.

4. Write the day up and save it with save_daily_log, in the body field. If a write-up is already saved, keep everything in it that still holds, in its wording, and add only what is missing; if nothing is missing, do not save at all. Keep it short and plain, in markdown, something I can read in under a minute:
   - ONE line for each thing I worked on, whatever it showed up as. Never list the same thing twice. Put together everything about the same piece of work: if I sent an email about a contract, finished a task for it and also noted "finished the contract proposal", that is one line, not three. Use your judgment about what goes together.
   - Work on one of my projects goes under a heading that is exactly the project's title from project_names, with one line beneath it for each thing I did on it today. Use the same name every day: never reword it, shorten it or add to it. Work that is not one of my projects but appears in names_used_lately keeps the name it had there.
   - Everything else is a plain list. Start each line with what it was about in bold (the person or the subject), then what I did: "- **Grant contract**: finished the proposal and sent it to Jordan Ames". Things that go together sit next to each other.
   - A heading is only ever the name of a piece of work. No "Meetings", "Email", "Tasks" or "Follow-ups" headings, and no other fixed sections.
   - A meeting is one line: the time, who it was with, and its short summary from step 3. When it belongs to something else I worked on, it goes on that line or under that project.
   - Time I set aside for my own work (time_set_aside) is never a meeting. It goes on the line for the work I actually did in it. A block I did not get to gets no line, and never a "not done" section. An appointment that is not work (a haircut, a pickup) is left out.
   - A task I finished or added goes on the line for the thing it belongs to, or on its own line only when nothing else mentions it.
   - Every one of his_notes must be in the write-up, in my wording where I gave it: once it is saved, the dashboard no longer lists them separately.
   Plain words, and no dashes used as punctuation.

5. For each 1:1 today that has Granola notes, also file the summary with that person on my dashboard: add_entry with kind "meeting", title "1:1 with <their name>", people [<their name>], a body of three to six short lines (what we covered and what was decided), and source_ref "granola:<the meeting's id>" so it is never filed twice. It is a summary, not a list of tasks. If the dashboard says the name fits more than one person, skip that one.

6. Time I set aside today with no outcome yet: record only what the day plainly shows, with save_daily_log time_blocks. If its task was finished today, or today's mail or my own notes show I did that work in that time, it was { ref, kept: true }. If my own notes say I did something else in that time, it was { ref, kept: false, instead: "what I did, in my words" }. Leave every other one unanswered. Never guess.

7. Only if I had NOT added anything to the log myself today (step 1), send one email to myself, from and to my own address, with your mail connection. Nothing else, and to no one else.
   Subject: Your log for <weekday, month day>
   Body, in plain text:
   Here's what I added to your log for <weekday>. Let me know if you want anything else added.

   <the write-up from step 4>

   <the link to the day from get_daily_log's url>
   If there was nothing at all to log (no meetings, no mail sent, no tasks), send the same email with "Nothing was logged for <weekday>." in place of the write-up, and save nothing.
   If I had already added to the log myself, send nothing.

8. Call log_run with name "daily-log" and one line such as "4 meetings, 6 emails, 3 tasks finished; emailed" or "...; already updated, added 2 lines".

Rules:
- Ask me nothing, and wait for nothing. Everything here either is plainly true from the day, or is left alone.
- Writing the log never adds, finishes or changes a task, and never creates a project. Do not propose tasks.
- The email in step 7 is the only mail you send. Do not reply to, draft, archive or label any other email.
- Granola notes become short meeting summaries and nothing else.
- If a connector is missing or fails (email, Granola or calendar), write the log from what you have, and say which one failed in the log_run line.
- Never guess a person or a project. Use the names the dashboard gives you.
```

Notes for whoever maintains this:

- It calls these dashboard tools by name: `get_daily_log`, `save_daily_log`, `add_entry` and
  `log_run`, and it sends one email with Duet's own mail connector. If a tool is renamed or
  removed, change this prompt in the same change and tell the owner to give Duet the new text: Duet
  keeps its own copy.
- **It asks nothing, and emails only on a day he added nothing** (2026-11-19). It used to run
  at 4:45 PM, end with "Anything else you worked on today?", ask about his time blocks, offer to
  group work as a project and propose tasks from his sent mail, all waiting for his answer. He
  keeps notifications off, so none of that reached him. Now it runs at 10:30 PM, settles only
  what the day plainly shows, and sends him one plain email ("Here's what I added to your log
  for Tuesday. Let me know if you want anything else added.") only when the log was empty until
  it ran. Proposing tasks from his mail is left to his chatbot, when he says "go through my
  email and update my dashboard"; the questions about time blocks and projects are asked when
  he logs his day in a chat himself.
- The same routine, in shorter form, is in the chatbot's standing instructions (`INSTRUCTIONS`
  in `workers/mcp/src/tools.ts`), so "log my day" works in any chat that has the dashboard
  connector, at any time. Keep the two in step.
- The write-up (`body`) is replaced each time it is saved; what the owner said himself (`notes`,
  written with `add`) is only ever added to.
- **Nothing is said twice.** On 2026-11-16 he asked for the log to "group together similar
  things, like if I sent an email and said something about it in my own words... it doesn't
  have to be hard and fast categories... I just don't want duplicated line items". So the
  write-up dropped its Meetings / Email / Tasks sections for one line per thing he worked on,
  with his own notes folded in. The dashboard stops listing a note separately once a write-up
  is saved after it (`notes_folded`); a note he adds later shows under the write-up as "Added
  later" until the day is written up again.
- **Every update looks again** (2026-11-19: "whenever i ask to update it then it should
  always look for some latest emails i sent, calendar items, and granola notes"). The routine
  is no longer only the end-of-day one: any request to update the log goes back to his sent
  mail, his calendar and Granola first, and saves one write-up.
- **Granola is for summaries, never tasks** (same day: "Granola notes should always be short
  summaries for meetings and should not be used as tasks for the log. if i want something to be
  an explicit task i will say so"). Step 3 writes one or two sentences a meeting, and nothing
  in the routine makes tasks. Meeting notes used to feed the task proposals and the old "waiting
  on" marks; half of those were already done when he looked.
- **The same work has the same name each day** (same day: "should this be grouped as a project
  and named the same in your logs over multiple days"). `get_daily_log` returns `project_names`
  and `names_used_lately`; work on a project sits under a heading that is exactly its title;
  and his chatbot asks, once, whether work that has run over several days should become one
  (in a chat, not in this routine, which asks nothing).
- **A time block has three answers** (same day): he did the work, he did not get to it, or he
  did something else, with what (`instead`). His dashboard marks each differently.
- **A time block is not a meeting** (2026-11-16). `get_daily_log` lists time he set aside for his
  own work apart from his meetings (`time_set_aside`: blocks on his dashboard, and calendar
  entries with no one else on them). Step 6 records only what the day plainly shows; he answers
  the rest on the dashboard or to his chatbot, with `save_daily_log` `time_blocks`, so he can see over time whether he goes through with his
  blocks ("how are my time blocks going" reads the count from `get_daily_log` with a range).
- The dashboard's own half of the day (`dayFacts` in `packages/core/src/daylog.ts`) knows
  meetings for about the last two weeks (`CALENDAR_DAYS_BACK` in `sync.ts`); the calendar copy
  is replaced on every sync and reaches back that far.
- Proposing tasks from the day's sent mail (added 2026-11-15, when he said "adding the emails
  as tasks is definitely important") moved out of this routine on 2026-11-19, since it needs his
  yes. His chatbot still does it in a chat: at the end of "log my day", and for "go through my
  email and update my dashboard".
- The site still reads no mail and no meeting notes. Only Duet does, with the owner's own
  connectors, when this runs or when he asks.
- Settings, under Automations, shows when it last ran (from `log_run`).
