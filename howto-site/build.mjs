// Builds the page at briandrenshaw.com/how-to (overview.md) and /how-to/build (../GUIDE.md) into
// one small Cloudflare Worker, dist/worker.js. The pages are plain HTML with the styles inline;
// the only script is the "Copy" button on the prompts, allowed by its hash in the page's
// Content-Security-Policy. Nothing is loaded from another site.
//
//   npm install && node build.mjs            then: npx wrangler deploy
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = "https://github.com/brianrenshaw/robot-dashboard";
/**
 * Whether the pages link to the GitHub repository. Off while the repository is private (a visitor
 * would get a 404). Passages about it are marked in the Markdown: <!--repo-->...<!--/repo--> is
 * shown only when this is on, and <!--norepo: ...--> (a comment, so GitHub never shows it) only
 * when it is off. Turn on with SHOW_REPO=1 once the repository is public.
 */
const SHOW_REPO = process.env.SHOW_REPO === "1";
const forRepo = (md) =>
  md
    .replace(/<!--repo-->([\s\S]*?)<!--\/repo-->/g, (_, a) => (SHOW_REPO ? a : ""))
    .replace(/<!--norepo: ([\s\S]*?)-->/g, (_, b) => (SHOW_REPO ? "" : b));

const slug = (text) => text.toLowerCase().replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function render(markdown) {
  markdown = forRepo(markdown);
  const headings = [];
  const marked = new Marked({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const id = slug(text);
        if (depth === 2) headings.push({ id, text });
        return depth === 1 ? `<h1>${text}</h1>\n` : `<h${depth} id="${id}"><a class="anchor" href="#${id}">${text}</a></h${depth}>\n`;
      },
      table(token) {
        const head = `<tr>${token.header.map((c) => `<th>${this.parser.parseInline(c.tokens)}</th>`).join("")}</tr>`;
        const rows = token.rows.map((r) => `<tr>${r.map((c) => `<td>${this.parser.parseInline(c.tokens)}</td>`).join("")}</tr>`).join("");
        return `<div class="table-wrap"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>\n`;
      },
      blockquote({ tokens }) {
        // In the guide a quote is a prompt to paste into an AI coding tool.
        return `<div class="prompt"><button type="button" class="copy" aria-label="Copy this prompt">Copy</button><blockquote>${this.parser.parse(tokens)}</blockquote></div>\n`;
      },
      link({ href, tokens }) {
        // Links between files of the repository go to GitHub.
        const to = /^[A-Z]+\.md$/.test(href) ? `${REPO}/blob/main/${href}` : href;
        const outside = /^https?:/.test(to);
        return `<a href="${to}"${outside ? ' rel="noopener"' : ""}>${this.parser.parseInline(tokens)}</a>`;
      },
    },
  });
  return { html: marked.parse(markdown), headings };
}

const SCRIPT = `document.addEventListener("click",function(e){var b=e.target.closest(".copy");if(!b)return;var q=b.nextElementSibling;navigator.clipboard.writeText(q.innerText.trim()).then(function(){b.textContent="Copied";setTimeout(function(){b.textContent="Copy"},1600)})});`;
const SCRIPT_HASH = createHash("sha256").update(SCRIPT).digest("base64");
const CSS = readFileSync(join(HERE, "style.css"), "utf8");

function page({ title, description, path, body, toc }) {
  const nav = [
    ["/how-to", "Overview"],
    ["/how-to/build", "Build your own"],
  ]
    .map(([href, label]) => `<a href="${href}"${href === path ? ' aria-current="page"' : ""}>${label}</a>`)
    .join("") + (SHOW_REPO ? `<a href="${REPO}" rel="noopener">GitHub</a>` : "");
  const contents = toc?.length
    ? `<nav class="toc" aria-label="On this page"><p class="toc-title">On this page</p><ul>${toc.map((h) => `<li><a href="#${h.id}">${h.text}</a></li>`).join("")}</ul></nav>`
    : "";
  // The contents go after the title and the opening paragraphs, just before the first section.
  const at = body.indexOf("<h2");
  const article = contents && at >= 0 ? body.slice(0, at) + contents + body.slice(at) : body;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta name="color-scheme" content="light dark">
<style>${CSS}</style>
</head>
<body>
<header class="top"><div class="wrap"><a class="name" href="/how-to">Brian Renshaw</a><nav>${nav}</nav></div></header>
<main class="wrap"><article>${article}</article></main>
<footer class="wrap foot"><p>Built the way it describes: with an AI coding tool, one request at a time.${SHOW_REPO ? ` The template on <a href="${REPO}" rel="noopener">GitHub</a> is MIT licensed and shared as is.` : ""}</p></footer>
<script>${SCRIPT}</script>
</body>
</html>`;
}

const overview = render(readFileSync(join(HERE, "overview.md"), "utf8"));
const guide = render(readFileSync(join(HERE, "..", "GUIDE.md"), "utf8"));

const pages = {
  "/how-to": page({
    title: "My own server, any chatbot · Brian Renshaw",
    description: "How I keep my records on my own server and work with them through any chatbot, with a website to see them.",
    path: "/how-to",
    body: overview.html,
  }),
  "/how-to/build": page({
    title: "Build your own · Brian Renshaw",
    description: "Step by step: build a private dashboard you run from a chatbot through MCP, with an AI coding tool and no hand-written code.",
    path: "/how-to/build",
    body: guide.html,
    toc: guide.headings,
  }),
};

const CSP = `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${SCRIPT_HASH}'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

const worker = `// Generated by howto-site/build.mjs. Do not edit; edit overview.md, ../GUIDE.md or style.css and build again.
const PAGES = ${JSON.stringify(pages)};
const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "public, max-age=300",
  "Content-Security-Policy": ${JSON.stringify(CSP)},
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\\/+$/, "") || "/";
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    // The front page is the overview, for now. A 302, so a real home page can take its place later.
    if (path === "/") return Response.redirect(new URL("/how-to", url).toString(), 302);
    const body = PAGES[path];
    if (body) return new Response(request.method === "HEAD" ? null : body, { headers: HEADERS });
    return new Response(PAGES["/how-to"].replace("<article>", '<article><p class="missing">That page does not exist. Here is the overview.</p>'), { status: 404, headers: HEADERS });
  },
};
`;

mkdirSync(join(HERE, "dist"), { recursive: true });
writeFileSync(join(HERE, "dist", "worker.js"), worker);
for (const [path, html] of Object.entries(pages)) {
  const file = join(HERE, "dist", "preview", path.replace(/^\//, "") + ".html");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}
console.log(`Built ${Object.keys(pages).length} pages into dist/worker.js (${Math.round(worker.length / 1024)} KB).`);
