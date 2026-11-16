# My own server, any chatbot

I keep my records on my own server and work with them by talking to a chatbot. Claude,
ChatGPT, Grok, whatever comes next: each one is just a way to reach the server. Nothing
important lives inside a chat. The record, the rules and the history are in a database I own,
so I can switch apps or start a new chat and lose nothing.

I have built two of these so far: a **project dashboard** (tasks, people, 1:1s, projects) and a
**health dashboard** (daily numbers, food against my targets, my lifting program and a coach).
Neither was written by hand. I described what I wanted to an AI coding tool, tried it, and said
what was wrong, one request at a time.

<figure class="diagram">
<svg class="d-wide" viewBox="0 0 720 230" role="img" aria-label="You talk to any chatbot, which reaches your server through MCP. The server reads and writes your database. Your website shows the same database.">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M1 1.5 9 5 1 8.5" class="d-arrowhead"/></marker>
  </defs>
  <rect x="236" y="14" width="300" height="202" rx="14" class="d-group"/>
  <text x="252" y="36" class="d-caps">MY CLOUDFLARE ACCOUNT</text>
  <rect x="8" y="50" width="176" height="64" rx="10" class="d-box d-accent"/>
  <text x="24" y="76" class="d-title">Any chatbot</text>
  <text x="24" y="96" class="d-sub">Claude, ChatGPT, Grok</text>
  <rect x="8" y="140" width="176" height="64" rx="10" class="d-box"/>
  <text x="24" y="166" class="d-title">My website</text>
  <text x="24" y="186" class="d-sub">where I look</text>
  <rect x="256" y="50" width="150" height="64" rx="10" class="d-box d-accent"/>
  <text x="270" y="76" class="d-title">MCP server</text>
  <text x="270" y="96" class="d-sub">the tools and the rules</text>
  <rect x="256" y="140" width="150" height="64" rx="10" class="d-box"/>
  <text x="270" y="166" class="d-title">Web server</text>
  <text x="270" y="186" class="d-sub">the dashboard</text>
  <rect x="430" y="94" width="92" height="64" rx="10" class="d-box"/>
  <text x="444" y="120" class="d-title">Database</text>
  <text x="444" y="140" class="d-sub">the record</text>
  <rect x="566" y="50" width="146" height="64" rx="10" class="d-box"/>
  <text x="580" y="76" class="d-title">GitHub</text>
  <text x="580" y="96" class="d-sub">the code</text>
  <line x1="184" y1="82" x2="253" y2="82" class="d-line" marker-end="url(#arrow)" marker-start="url(#arrow)"/>
  <text x="219" y="74" class="d-label" text-anchor="middle">MCP</text>
  <line x1="184" y1="172" x2="253" y2="172" class="d-line" marker-end="url(#arrow)" marker-start="url(#arrow)"/>
  <path d="M406 82 H476 V91" class="d-line" marker-end="url(#arrow)"/>
  <path d="M406 172 H476 V161" class="d-line" marker-end="url(#arrow)"/>
  <line x1="566" y1="82" x2="539" y2="82" class="d-line d-dash" marker-end="url(#arrow)"/>
  <text x="639" y="134" class="d-label" text-anchor="middle">a push deploys</text>
  <text x="639" y="150" class="d-label" text-anchor="middle">both servers</text>
</svg>
<svg class="d-narrow" viewBox="0 0 360 330" role="img" aria-label="You talk to any chatbot, which reaches your server through MCP. The server reads and writes your database. Your website shows the same database.">
  <defs>
    <marker id="arrow2" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M1 1.5 9 5 1 8.5" class="d-arrowhead"/></marker>
  </defs>
  <rect x="4" y="4" width="166" height="58" rx="10" class="d-box d-accent"/>
  <text x="18" y="28" class="d-title">Any chatbot</text>
  <text x="18" y="47" class="d-sub">Claude, ChatGPT, Grok</text>
  <rect x="190" y="4" width="166" height="58" rx="10" class="d-box"/>
  <text x="204" y="28" class="d-title">My website</text>
  <text x="204" y="47" class="d-sub">where I look</text>
  <rect x="4" y="96" width="352" height="194" rx="14" class="d-group"/>
  <text x="342" y="116" class="d-caps" text-anchor="end">MY CLOUDFLARE ACCOUNT</text>
  <rect x="18" y="128" width="148" height="58" rx="10" class="d-box d-accent"/>
  <text x="32" y="152" class="d-title">MCP server</text>
  <text x="32" y="171" class="d-sub">the tools and the rules</text>
  <rect x="194" y="128" width="148" height="58" rx="10" class="d-box"/>
  <text x="208" y="152" class="d-title">Web server</text>
  <text x="208" y="171" class="d-sub">the dashboard</text>
  <rect x="106" y="218" width="148" height="58" rx="10" class="d-box"/>
  <text x="120" y="242" class="d-title">Database</text>
  <text x="120" y="261" class="d-sub">the record</text>
  <line x1="87" y1="62" x2="87" y2="125" class="d-line" marker-end="url(#arrow2)" marker-start="url(#arrow2)"/>
  <text x="95" y="84" class="d-label">MCP</text>
  <line x1="273" y1="62" x2="273" y2="125" class="d-line" marker-end="url(#arrow2)" marker-start="url(#arrow2)"/>
  <path d="M92 186 V247 H103" class="d-line" marker-end="url(#arrow2)"/>
  <path d="M268 186 V247 H257" class="d-line" marker-end="url(#arrow2)"/>
  <text x="180" y="318" class="d-label" text-anchor="middle">GitHub holds the code; a push deploys both servers</text>
</svg>
<figcaption>Both dashboards are built the same way. The website has no AI in it; the chatbot does the talking.</figcaption>
</figure>

## How it is put together

| Piece | What it is | What it does |
| --- | --- | --- |
| **Database** | Cloudflare D1 (SQLite), in my own Cloudflare account | The one record. Plain tables, so it answers exact questions |
| **MCP server** | A small program on Cloudflare (a Worker) | The chatbot's door: a few tools, and standing instructions on how to work with me. The rules live here, not in any app |
| **Website** | A second Worker, at my own address | The dashboard: where I look, check progress, make small edits |
| **Shared code** | One package both servers use | Every rule and calculation in one place, with tests. Every change is logged with what it was before, so "undo that" works |
| **GitHub** | The code | A push runs the checks and deploys both servers |
| **Sign-in** | Cloudflare Access (a PIN sent to my email) | Only I can open the website or connect a chatbot |

Day to day, I talk to a chatbot. It reads and writes the database through the MCP server, and the
website shows the result.

## The two dashboards

| | Project dashboard | Health dashboard |
| --- | --- | --- |
| **Keeps** | Tasks, people and what to raise at each 1:1, projects, notes, a daily log, time blocks | Daily health numbers, weigh-ins, workouts, food against my targets, my lifting program and what I lifted, my week's plan, a journal, the coach's reviews, a library of books and articles I trust |
| **The chatbot** | Adds and updates tasks, goes through my email and meeting notes with its own connections, plans my week | Brings in Apple Health from my phone, saves my food app's weekly targets from a screenshot, tells me what to lift today and logs it, plans my week around the weather |
| **The website** | Hands-on: check things off, drag cards, place time blocks | Mostly for looking: charts, trends, today against my targets, what is up next |
| **Reads by itself** | Only my calendar | Only the weather forecast |

The two are completely separate: separate code, databases, sign-ins and backups.

## Why this matters

- **I am not locked in.** Any chatbot that can add an MCP connector uses the same record in the
  same way.
- **It does not depend on chat history.** The memory is the database, so a new chat starts fully
  informed.
- **The rules live in one place.** I change how something works once, on the server, and every
  app follows it.
- **Exact answers.** "Who am I waiting on?" and "what did I lift last time?" come from records,
  not from a chatbot's recollection.
- **It is mine.** My server, my website, my data, with a full history of every change.

## Build your own

You do not need to write code. You need an AI coding tool, a Cloudflare account, a GitHub
account, and a clear idea of what you want to keep track of.

- **[The step-by-step guide](/how-to/build)**: the order to do things in, what to tell your AI at
  each step, and how to check it worked.
<!--repo-->
- **[The project dashboard, as a template](https://github.com/brianrenshaw/robot-dashboard-template)**: a
  working copy with made-up data, to run as your own or to point your AI at.
- **[The health dashboard, as a template](https://github.com/brianrenshaw/robot-health-template)**: the same, for health: Apple Health,
  food against your targets, a lifting coach, and a library of sources you trust.
<!--/repo-->
