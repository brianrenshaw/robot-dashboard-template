# The scheduled tasks

The owner works with the dashboard through his chatbot: he asks it to add things, change them and
tell him what to work on. Nothing on the site runs on a timer to read his mail or his meeting
notes; he tried that and had it taken off.

Two scheduled Claude tasks exist, one for each end of the day:

| Task | When | Where it runs | What it does |
| --- | --- | --- | --- |
| [Morning brief](morning-brief.md) | Weekdays, 6:45 AM New York time | A Claude Code cloud session | Writes a short brief from his calendar and what is on the dashboard. It shows as one line at the top of the dashboard. |
| [Daily log](daily-log.md) | Weekdays, 4:45 PM New York time | Claude Duet | Writes up the day (meetings, mail he sent, tasks added and finished) into his daily log, files a note for each 1:1 that has meeting notes, then asks him what else he worked on. |

The morning brief reaches the dashboard with `curl` to the MCP endpoint (a plain `tools/call`
works without a session) and uses four tools: `morning_brief_data`, `get_person`, `save_digest`
and `log_run`. The daily log uses the owner's own connectors in Claude Duet (the dashboard, his
email, Granola) and four tools: `get_daily_log`, `save_daily_log`, `add_entry` and `log_run`.
Do not rename or remove any of those without changing the prompt and the scheduled task.

## Setting up or changing the morning brief

The task runs in a Claude Code cloud environment named `project-dashboard`. Two things have to
be true there:

1. **The environment holds the dashboard token** for the host
   `project-dashboard-mcp.YOUR-SUBDOMAIN.workers.dev`, saved as a network secret (a bearer
   token). The environment adds it to every request to that host, so the prompt never contains
   it. A Claude Code session can ask for it with a secure form; it is never pasted into a chat.
   The value is in the site's Settings under "For other apps" (Copy token).
2. **It is a scheduled task that starts a fresh session each time**, named "Dashboard: morning
   brief", with the text inside the code block of `morning-brief.md` as its prompt.

A Claude Code session can create, change, pause and test it. It is also listed on the scheduled
tasks page at claude.ai. If you edit the prompt here, update the scheduled task as well: the
schedule keeps its own copy.

## Setting up or changing the daily log

The owner pastes the text inside the code block of `daily-log.md` into Claude Duet. Duet keeps its
own copy, so after editing the prompt here, give him the new text to paste again.

Three older tasks ("Dashboard: email check", its 1:30 PM twin and "Dashboard: meeting
follow-up") were deleted on 2026-11-14, along with their prompts here. The tools they called
no longer exist.
