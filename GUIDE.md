# Build your own: a dashboard you run from a chatbot

This guide walks you through building your own version of this setup, for whatever you want to
keep track of: your work, your health, your reading, your house, your side business. It is not a
kit you install. It is the order to do things in, what to tell your AI coding tool at each
step, and how to know each step worked.

It comes from building two of these: a project dashboard (tasks, people, 1:1s, projects<!--repo-->;
[robot-dashboard-template](https://github.com/brianrenshaw/robot-dashboard-template) is a copy of it with made-up data<!--/repo-->) and a health
dashboard (daily numbers from Apple Health, food against targets, a lifting program and
coach<!--repo-->; [robot-health-template](https://github.com/brianrenshaw/robot-health-template) is a copy of it<!--/repo-->). Neither was written by hand. Both
were described to an AI, tried, and corrected, one request at a time. That is how you will build
yours.

## The idea

You work by talking to a chatbot: Claude, ChatGPT, GrokBot, whichever you like. The chatbot reads
and writes **one database that you own**, through a small server you also own. A **website** on
top of the same database is where you look at how things stand.

```
You
 │  talk
 ▼
Any chatbot (Claude, ChatGPT, GrokBot, ...)
 │  MCP
 ▼
Your server (the tools and the rules)
 │
 ▼
Your database (the record)
 │
 ▼
Your website (where you look)
```

Why bother, when chatbots can already remember things and draw dashboards?

- **A chat is a fast way to put things in and a poor place to keep them.** Chats forget, scroll
  away, and live inside one company's app. Your database keeps everything, in plain tables you
  can query exactly ("who am I waiting on?", "what did I lift last time?").
- **You are not locked in.** The record and the rules live on your server. Switch chat apps, or
  use two, and nothing is lost: each one connects to the same server and gets the same rules.
- **The rules live in one place.** How a number is rounded, what counts as "on target", what the
  chatbot should say after a change: all of it is on the server, tested, and the same for every
  app.
- **It is safe to let an AI write to it.** Every change is logged with what it was before, and
  "undo that" takes it back.

**MCP** (Model Context Protocol) is the standard way a chat app plugs into outside tools. Most
chat apps call an MCP server you add yourself a "custom connector".

## What you need

- **An AI coding tool** that can work on a project for you: Claude Code (claude.ai/code, or the
  desktop app) is what these were built with.
- **A GitHub account**, to keep the code.
- **A Cloudflare account, on the free plan.** Everything runs there: the server, the website,
  the database, the backups, the sign-in. Both of my dashboards fit inside the free allowances
  with lots of room: 100,000 requests a day, a 5 GB database, 10 GB of storage for backups, and
  sign-in for up to 50 people. (R2, the storage, may ask for a card on file even though it is
  free at this size.)
- **A chat app that can add a custom MCP connector**, on a plan that allows it.
- **Optional: a domain name.** You don't need one: every Cloudflare account gets a free
  `workers.dev` address. If you want your own name, buy it at a registrar (I use Hover) and point
  it at Cloudflare, which walks you through changing its nameservers. With or without a domain,
  the site is private: Cloudflare Access puts a sign-in in front of it.
- **Time:** a weekend for a first working version, then small additions whenever you want them.

You do not need to know how to code. You need to know what you want, try what you get, and say
plainly what is wrong.

## How to work with your AI (read this first)

- **One request at a time.** Ask for one thing, try it, then the next. Big vague requests get big
  vague results.
- **Say what is wrong in your own words.** "This looks cluttered", "I don't know what this label
  means", "that number should be in pounds". You do not have to know the fix.
- **When you have a spec, say "follow it as written."** If you write down exactly what you want
  (tables, rules, wording), tell the AI the spec wins over its own ideas. Otherwise it will
  improve on it.
- **Ask to see it.** "Run it locally with made-up data and show me screenshots on a phone and a
  desktop, light and dark." Look before you approve.
- **Keep a notes file for the AI** (step 2). A new session knows nothing; the notes file is its
  memory.

Each step below has three parts: **why**, **say this** (paste it, then add your own details), and
**done when** (how to check).

---

## Step 1. Write a one-page brief

**Why.** The AI builds what you describe. A page of plain sentences saves days of corrections.

Write down, in your own words:

1. **What it is for**, in one or two sentences. ("My record of my tasks, who I'm waiting on and
   what I owe people." "My health numbers, my lifting program, and a coach that works from them.")
2. **The kinds of things it keeps.** Tasks, people, projects, notes. Or: daily numbers, weigh-ins,
   workouts, lifts, journal entries. One line each.
3. **What you will say to the chatbot.** Ten real sentences. "Add this: Sam owes me the numbers by
   Friday." "What are my lifts today?" "Update my health page." These become the tools.
4. **What the website should show**, and what it should not. Start smaller than you think.
5. **What it must never do.** "Never delete anything." "Never read my email on its own." "Never
   guess which person I mean."
6. **Where outside data comes from**, if any. Calendar, Apple Health, a food app, email. (See
   step 11: usually the chatbot fetches it, not the website.)

**Say this:**

> I want to build a private dashboard that I run from my chatbot through MCP, with a website to
> look at it. Here is my brief: [paste]. Interview me with questions until the brief has no gaps,
> one question at a time, then write it up as BRIEF.md.

**Done when** the brief answers every question the AI had, and reading it back, you would not
change anything.

## Step 2. Start the project and its notes file

**Why.** Your AI forgets everything between sessions. A file called `CLAUDE.md` at the top of the
project (other tools read `AGENTS.md`) is where it writes down what was built, why, and the rules.
Every new session reads it first. This is the single most useful habit in this guide.

**Say this:**

> Create a new private GitHub repository for this project, using <!--repo-->the same structure as
> github.com/brianrenshaw/robot-dashboard-template:<!--/repo--><!--norepo: this structure:--> two Cloudflare Workers (one for the website, one for
> the MCP server) sharing one D1 database and one shared code package that holds every database
> query and rule. Start a CLAUDE.md that explains what this is and why (from BRIEF.md), and these
> rules:
> - All SQL lives in the shared package. Nothing else talks to the database.
> - Every change is recorded in a change log with the row before and after, so it can be undone.
> - Never hard delete my records.
> - The chatbot hands data over as it got it; the server applies the rules (dates, units,
>   rounding) and those rules have tests.
> - Tests and local development use made-up data, never mine.
> - No database copies, exports or real data in GitHub.
> Keep CLAUDE.md up to date after every change, including my reasons in my words.

**Done when** the repository exists, `CLAUDE.md` reads like a clear explanation of your project,
and the AI can run its checks (`npm test` or similar) and they pass.

## Step 3. The database

**Why.** Everything depends on the shape of your data. One table per kind of thing, plain fields,
nothing clever. A database that "answers exact questions" beats one that stores everything as
notes.

**Say this:**

> Design the database from BRIEF.md: one table per kind of thing, plain columns, dates as
> YYYY-MM-DD in my time zone ([your city]), and a change-log table. Write it as numbered
> migrations, never edited once applied. Explain each table to me in one line before you build
> it.

Things worth deciding now:

- **Missing is not zero.** If there is no number for a day, store nothing, never 0. Otherwise
  every average is wrong.
- **Units at the door.** Decide the unit of every number (pounds or kilograms, miles or meters)
  and convert when it comes in, with a test. One project stored kilograms as pounds for months.
- **People and names.** If people matter, match them exactly and keep other spellings ("Anna"
  for "Ana"). Never let the AI guess.

**Done when** you can read the list of tables and say what each is for, and the tests build the
database from the migrations.

## Step 4. The rules, the change log and undo

**Why.** This is what makes it safe to let an AI write to your records. If it gets something
wrong, "undo that" puts it back.

**Say this:**

> In the shared package, write the functions that save and read each kind of record. Every write
> checks its input first (and saves nothing if anything is wrong, with a plain error that says
> what to fix), then records the change with the row before and after. Add undo: it takes back
> the most recent change as a whole, and calling it again takes back the one before. Test every
> rule with made-up data.

**Done when** the tests cover saving, refusing bad input, and undoing, and all pass.

## Step 5. The MCP server: the chatbot's door

**Why.** This is the part you will use every day. Two things make a chatbot good at it: **few
tools with exact descriptions** (a chatbot picks badly among many look-alikes), and **standing
instructions** the server sends to every chat when it connects (how you work, what to do for each
kind of request). Because the instructions live on the server, every chat app follows the same
ones, and you change them in one place.

**Say this:**

> Build the MCP server Worker. Turn the ten sentences from my brief into as few tools as possible.
> Each tool's description says exactly when to use it. Write standing instructions the server
> sends when a chat connects: that my database is the record and it should read it before
> answering, not rely on chat history; how to handle each of my sentences; to answer every change
> with one plain line and a link to the page; never to estimate or fill in a gap. Add a tool that
> returns these instructions, for chat apps that do not pass them on. Add a local test script
> that calls every tool.

Good habits to ask for:

- **A receipt after every change**: one line ("Saved Nov 13 to Nov 15: 3 days, 2 weigh-ins.").
- **Refuse rather than guess.** A name that fits two people, a lift that is not in the session, a
  weight that is far from the last one: refuse with a message that says what to do.
- **Arithmetic on the server, not in the chat.** Averages, targets, suggestions: the server works
  them out and the chatbot is told to use them as given. Chatbots are bad at arithmetic and good
  at conversation.

**Done when** the local test script runs every tool against made-up data and each returns what
you expect.

## Step 6. Lock the doors

**Why.** It is your data on the open internet. Only you should get in, and if anything is
misconfigured, it must refuse rather than open.

**Say this:**

> Lock this down with Cloudflare Access: the website requires a one-time PIN sent to my email,
> and only my email is allowed. The website also checks the Access login itself on every request
> and refuses if anything is missing (never falls back to open). For the MCP server, use OAuth
> (@cloudflare/workers-oauth-provider): a chat app registers itself, I sign in through Cloudflare
> Access and press Allow. No long-lived passwords or keys. Turn off any second address that skips
> the sign-in. Walk me through the steps I have to do in the Cloudflare dashboard myself.

**Done when**, from a browser that is not signed in, the website sends you to the PIN page, and
the server's `/mcp` address answers "401" to anyone without a sign-in. Ask the AI to check both.

## Step 7. The website

**Why.** The website is where you look. It should show the state of things at a glance and get
out of the way. It has no AI inside it.

**Say this:**

> Build the website: [what it shows, from the brief]. It must work on my phone ([model]) and a
> desktop, in light and dark. Calm: neutral colors, one idea per card, an empty card says one
> quiet line. Each number I care about gets a large headline with its change. Run it locally
> with made-up data and show me screenshots of every page on a phone and a desktop.

Then react to the screenshots honestly. "It looks like an amateur made it" with a screenshot of
something you like is a perfectly good instruction. So is "too busy" or "what does this word
mean".

**Done when** you would be happy to open it every day.

## Step 8. Put it online, automatically

**Why.** You do not want to deploy by hand. Every change the AI pushes should test itself and go
live.

**Say this:**

> Set up deploys: a push to main runs every check (types, lint, tests), applies database
> migrations, and deploys both Workers. It needs a Cloudflare API token as a GitHub secret; tell
> me exactly how to make one with only the permissions it needs. Put the website on
> [dash.yourdomain.com].

**Done when** a small change pushed to main shows up on the live site a minute later, and the
GitHub Actions run is green.

## Step 9. Connect your chatbot

**Why.** This is the payoff.

In your chat app, add a custom connector (in Claude: Settings, Connectors, Add custom connector)
with your MCP server's address (it ends in `/mcp`). Sign in with your email PIN and press Allow.
Then, in a **new chat**:

> What can you do with my dashboard?

Then try your ten sentences from the brief. Use a second chat app the same way if you like; they
share the same record.

Two things to know:

- **Chat apps remember a server's tools and instructions.** After you change them, start a new
  chat.
- **Each app has different abilities.** Claude and ChatGPT can read Apple Health on an iPhone;
  GrokBot cannot yet. One app can read your calendar and another cannot. The server's instructions should say what to do when an app cannot do something.

**Done when** you can do a full day's work through the chat and see it on the website.

## Step 10. Backups

**Why.** It is your only copy.

**Say this:**

> Back up the database every night to a private place in my Cloudflare account, keep the last 30,
> and show on the website when the last backup ran. Add a "Back up now" button. Write the restore
> steps in CLAUDE.md, and test a restore into a new, empty database.

Cloudflare D1 can also rewind a database to any minute of the last 30 days (7 on the free plan);
ask the AI to note how in `CLAUDE.md`.

**Done when** a backup exists, and a test restore matched.

## Step 11. Grow it, one request at a time

Now use it, and change it as you go. Some patterns that worked:

- **Let the chatbot fetch outside data, not the website.** The chatbot already has connectors for
  your email, calendar or Apple Health. Ask it to read them when you say so ("go through my email
  and update my dashboard", "update my health page") and to save what it found through your
  server. The website stays simple and reads nothing behind your back.
- **Screenshots are input too.** When an app will not share its data, send the chatbot a
  screenshot and have it save the numbers exactly as shown, with a tool built for that.
- **Bring documents into the server.** Books, a program spreadsheet, articles you trust: load them
  into a table so the chatbot can look things up and cite the page, instead of answering from
  memory.
- **When something is wrong, ask why before asking for a fix.** "Why didn't the Nov 15 weigh-in
  go away when I deleted it?" leads to a better fix than "delete it".
- **Write down the why.** Every time you decide something, the AI should record it in `CLAUDE.md`
  with your words. Six months from now, that is how a new session understands you.

## Lessons learned the hard way

- **The first version of almost everything was wrong.** That is normal. The corrections are the
  design.
- **Bare minimum on screen.** Every extra tile, count or label is something to read. Start with
  less.
- **Nothing happens behind your back.** Timers that read email or notes on their own were taken
  out of the project dashboard as "too convoluted". Ask, then act.
- **Check what came in, not just that something came in.** Look at a few real numbers after the
  first sync. Units, time zones and duplicates are where things go wrong.
- **"Today" is never finished.** Do not count today's running totals in averages.
- **A new chat after every change** to tools or instructions.
- **Keep private data out of GitHub.** Code in GitHub; data and backups in your Cloudflare
  account.

<!--repo-->
## Where to look in the templates

Two working copies on GitHub, with made-up data: [robot-dashboard-template](https://github.com/brianrenshaw/robot-dashboard-template) (tasks,
people, 1:1s, projects, a planner) and [robot-health-template](https://github.com/brianrenshaw/robot-health-template) (Apple Health, food against
targets, a lifting coach, a library of sources you trust). In each:

- README.md: what it does.
- SETUP.md: every step to run it as your own.
- CLAUDE.md: how it is built and why, decision by decision. Point your AI at it when you want
  "do it the way they did".
<!--/repo-->
