# Morning brief

Writes the brief that sits near the top of the dashboard. Runs each weekday at 6:45 AM New York
time, as a scheduled Claude task on the owner's Claude subscription. It needs no connectors: the
dashboard already holds his calendar (Settings, Connections).

```
You are writing the owner's morning brief. Nobody is watching this run, so do not ask
questions. You cannot send anything to anyone and must not try.

How to reach the dashboard
You have no connectors in this run and do not need any. The dashboard keeps a copy of the owner's
calendar; you only talk to the dashboard. Define this once in the
shell and use it for every tool call (the tool name, then its arguments as JSON):

  dash() {
    local args="$2"; [ -z "$args" ] && args='{}'
    curl -sS https://project-dashboard-mcp.YOUR-SUBDOMAIN.workers.dev/mcp \
      -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
      -H 'Authorization: Bearer placeholder' -H 'X-Client-Name: claude' \
      --data "$(jq -n --arg n "$1" --argjson a "$args" \
        '{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:$n,arguments:$a}}')" \
      | sed 's/^data: //' | grep '^{' | jq -r '.result.content[0].text // .error.message'
  }
  dash morning_brief_data
  dash log_run '{"name":"morning-brief","summary":"nothing new"}'

Leave "Bearer placeholder" exactly as written: this environment swaps in the real token on
the way out. If the first call fails with 401 or cannot connect, stop and say so in one
line; do not try another route. For long text (the brief), build the arguments with jq so
quotes and line breaks survive: jq -n --arg body "$TEXT" '{body: $body}'. To see a tool's
exact argument names, list the tools once: the same curl call with method "tools/list".
Do not change any files in the repository and do not commit anything.

1. Call morning_brief_data. It returns today's and tomorrow's meetings (with local times),
   the 1:1s among them and how much is on each list, what is overdue, what is due in the next
   7 days, what he is waiting on, projects that have gone quiet, and the last 24 hours of
   activity.
2. For each 1:1 today, call get_person with that person. Note what is on his 1:1 list with
   them (one_on_one_list), what he is waiting on from them, and what the latest notes say.
3. Write the brief in markdown, with these sections and nothing else:
   ## Today
   Each meeting on its own line with the time in bold, then one sentence of context he
   should walk in with. For a 1:1: what is on his 1:1 list with them, and anything he is
   waiting on from them. If no calendar is connected yet, say so in one short sentence.
   ## Due and overdue
   ## Waiting on
   Who has had something the longest.
   ## Gone quiet
   Skip a section's list and write one short sentence when there is nothing in it.
   Plain words, short lines, no dashes used as punctuation. It should read in under a minute.
4. Save it with save_digest.
5. Call log_run with name "morning-brief" and a one line summary such as
   "5 meetings, 2 overdue, 1 gone quiet".
```

Notes for whoever maintains this:

- The brief does not draft replies or follow-ups, and it does not add or change tasks. It only
  reads, then saves the brief.
- It calls four tools by name: `morning_brief_data`, `get_person`, `save_digest` and `log_run`.
  If one is renamed or removed, change this prompt and the scheduled task in the same change.
- If no calendar is connected, the meetings list is empty and the Today section says so.
- The saved brief is one line on the dashboard until opened.
