// Builds the page at briandrenshaw.com/how-to (home.html) and /how-to/build (../GUIDE.md) into
// one small Cloudflare Worker, dist/worker.js. The pages are plain HTML with the styles inline;
// the only script is the "Copy" button on the prompts, allowed by its hash in the page's
// Content-Security-Policy. Nothing is loaded from another site.
//
//   npm install && node build.mjs            then: npx wrangler deploy
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = "https://github.com/brianrenshaw/robot-dashboard-template";
/**
 * Whether the pages link to the GitHub repositories. On: both templates are public (since
 * 2026-11-16). Build with SHOW_REPO=0 to leave the links out, e.g. if a repository goes
 * private. Passages about them are marked in the Markdown: <!--repo-->...<!--/repo--> is shown
 * only when this is on, and <!--norepo: ...--> (a comment, so GitHub never shows it) only
 * when it is off.
 */
const SHOW_REPO = process.env.SHOW_REPO !== "0";
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

function page({ title, description, path, body, toc, cls, label }) {
  const nav = [
    ["/how-to", "Overview"],
    ["/how-to/build", "Build your own"],
  ]
    .map(([href, label]) => `<a href="${href}"${href === path ? ' aria-current="page"' : ""}>${label}</a>`)
    .join("") + (SHOW_REPO ? `<a href="/how-to#templates">Templates</a>` : "");
  const contents = toc?.length
    ? `<nav class="toc" aria-label="On this page"><p class="toc-title">On this page</p><ul>${toc.map((h) => `<li><a href="#${h.id}">${h.text}</a></li>`).join("")}</ul></nav>`
    : "";
  // The guide: its title moves into the dark band at the top; the contents go after the opening
  // paragraphs, just before the first section. The home page is written as finished HTML.
  let main;
  if (cls === "page-guide") {
    const h1 = /<h1>([\s\S]*?)<\/h1>\n?/.exec(body);
    const rest = h1 ? body.replace(h1[0], "") : body;
    const at = rest.indexOf("<h2");
    const article = contents && at >= 0 ? rest.slice(0, at) + contents + rest.slice(at) : rest;
    main = `<header class="doc-head"><div class="wrap"><p class="label">${label}</p><h1>${h1 ? h1[1] : title}</h1></div></header><div class="doc"><article>${article}</article></div>`;
  } else {
    main = body;
  }
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
<body class="${cls}">
<header class="top"><div class="wrap"><a class="name" href="/how-to">Brian Renshaw</a><nav>${nav}</nav></div></header>
<main>${main}</main>
<footer class="wrap foot"><p>Built the way it describes: with an AI coding tool, one request at a time.${SHOW_REPO ? ` The templates on GitHub are MIT licensed and shared as is.` : ""}</p></footer>
<script>${SCRIPT}</script>
</body>
</html>`;
}

const home = forRepo(readFileSync(join(HERE, "home.html"), "utf8"));
const guide = render(readFileSync(join(HERE, "..", "GUIDE.md"), "utf8"));

const pages = {
  "/how-to": page({
    title: "How I keep track of my work and my health · Brian Renshaw",
    description: "My tasks and health records live in a database on my own Cloudflare account. I use them from a chat app and check on them at a private website.",
    path: "/how-to",
    body: home,
    cls: "page-home",
  }),
  "/how-to/build": page({
    title: "Build your own · Brian Renshaw",
    description: "Step by step: build a private dashboard you run from a chatbot through MCP, with an AI coding tool and no hand-written code.",
    path: "/how-to/build",
    body: guide.html,
    toc: guide.headings,
    cls: "page-guide",
    label: "The guide · step by step",
  }),
};

const cspFor = (hashes) => `default-src 'none'; style-src 'unsafe-inline'; script-src ${hashes.map((h) => `'sha256-${h}'`).join(" ")}; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
const CSP = cspFor([SCRIPT_HASH]);

// Standalone pages: a finished HTML document served as it is, without the site's header, menu,
// styles or Copy script, because it has its own. Each gets the same policy as the rest of the site
// (nothing from other sites, no forms) with its own inline scripts allowed by their hashes; a page
// with a <script src> or an inline event handler is refused, so the policy cannot be loosened by
// accident. They are left out of the menu.
//   /school-comparison  what a year at the college costs beside 17 other schools. Made in the
//                       a private repository repository by 5-school-comparison/build_page.py; copy
//                       its school-comparison.html into standalone/ and build again.
//
// Standalone pages are private. Their files sit in standalone/, which is never committed (this
// repository is public), and they are guarded twice: a Cloudflare Access application in front of
// their addresses asks for a sign-in, and the Worker itself serves one only with a valid Access
// token for the application below, so a gap in the Access setting cannot expose the page. The
// team domain and application audience are not secrets.
// The summary and the full findings sit under /school-comparison so the same Access application covers them.
const STANDALONE_FILES = {
  "/school-comparison": "school-comparison.html",
  "/school-comparison/summary": "school-comparison-summary.html",
  "/school-comparison/findings": "school-comparison-findings.html",
};
const ACCESS = { team: "jolly-dew-53f9.cloudflareaccess.com", aud: "13360554cace9cbbdb5c277f659ba89b722559e07c6388fd6c90569e88834d6c" }; // the "School comparison" Access application
if (Object.keys(STANDALONE_FILES).length && !(ACCESS.team && ACCESS.aud)) throw new Error("Standalone pages are private: set ACCESS.team and ACCESS.aud first");
// Who may open them: standalone/readers.json, a list of email addresses, kept out of GitHub with
// the pages. The Worker checks the signed-in email against it as well as Access's own policy.
const READERS_FILE = join(HERE, "standalone", "readers.json");
if (Object.keys(STANDALONE_FILES).length && !existsSync(READERS_FILE)) throw new Error("standalone/readers.json is missing: the emails allowed to open the private pages");
const READERS = existsSync(READERS_FILE) ? JSON.parse(readFileSync(READERS_FILE, "utf8")).map((e) => String(e).trim().toLowerCase()) : [];
if (Object.keys(STANDALONE_FILES).length && !READERS.length) throw new Error("standalone/readers.json lists no one");
const STANDALONE = Object.fromEntries(
  Object.entries(STANDALONE_FILES).map(([path, file]) => {
    const at = join(HERE, "standalone", file);
    if (!existsSync(at)) throw new Error(`standalone/${file} is missing. It is kept out of GitHub; copy it in before building, or publishing would take the page down.`);
    const html = readFileSync(at, "utf8");
    if (/<script[^>]+src=|<link[^>]+href=["']?https?:|\son[a-z]+=["']/i.test(html)) throw new Error(`${file}: loads from another site or has an inline handler`);
    const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => createHash("sha256").update(m[1]).digest("base64"));
    return [path, { html, csp: cspFor(hashes) }];
  }),
);

// Screenshots (made-up data) served by the Worker itself at /how-to/img/<file>.
const IMAGES = Object.fromEntries(
  readdirSync(join(HERE, "img"))
    .filter((f) => f.endsWith(".webp"))
    .map((f) => [`/how-to/img/${f}`, readFileSync(join(HERE, "img", f)).toString("base64")]),
);

const worker = `// Generated by howto-site/build.mjs. Do not edit; edit overview.md, ../GUIDE.md or style.css and build again.
const PAGES = ${JSON.stringify(pages)};
const IMAGES = ${JSON.stringify(IMAGES)};
const STANDALONE = ${JSON.stringify(STANDALONE)};
const ACCESS = ${JSON.stringify(ACCESS)};
const READERS = ${JSON.stringify(READERS)};
// True only for a request carrying a valid Cloudflare Access token for this application: signed
// by the team's current key, for this audience, from this team, not expired.
const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
async function signedIn(request) {
  try {
    const token = request.headers.get("Cf-Access-Jwt-Assertion") || "";
    const [h, p, s] = token.split(".");
    if (!h || !p || !s) return false;
    const header = JSON.parse(new TextDecoder().decode(b64url(h)));
    const claims = JSON.parse(new TextDecoder().decode(b64url(p)));
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (header.alg !== "RS256" || !aud.includes(ACCESS.aud) || claims.iss !== "https://" + ACCESS.team) return false;
    if (!(claims.exp > Date.now() / 1000)) return false;
    if (!READERS.includes(String(claims.email || "").toLowerCase())) return false;
    const certs = await (await fetch("https://" + ACCESS.team + "/cdn-cgi/access/certs", { cf: { cacheTtl: 3600 } })).json();
    const jwk = (certs.keys || []).find((k) => k.kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(s), new TextEncoder().encode(h + "." + p));
  } catch (e) {
    return false;
  }
}
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
    if (IMAGES[path]) {
      const bytes = Uint8Array.from(atob(IMAGES[path]), (c) => c.charCodeAt(0));
      return new Response(request.method === "HEAD" ? null : bytes, { headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" } });
    }
    const own = STANDALONE[path];
    if (own) {
      if (!(await signedIn(request))) return new Response("This page needs a sign-in.", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
      return new Response(request.method === "HEAD" ? null : own.html, { headers: { ...HEADERS, "Cache-Control": "private, no-store", "Content-Security-Policy": own.csp, "X-Robots-Tag": "noindex, nofollow" } });
    }
    const body = PAGES[path];
    if (body) return new Response(request.method === "HEAD" ? null : body, { headers: HEADERS });
    return new Response(PAGES["/how-to"].replace("<main>", '<main><div class="wrap" style="padding-top:16px"><p class="missing">That page does not exist. Here is the overview.</p></div>'), { status: 404, headers: HEADERS });
  },
};
`;

mkdirSync(join(HERE, "dist"), { recursive: true });
writeFileSync(join(HERE, "dist", "worker.js"), worker);
for (const [path, html] of Object.entries(pages)) {
  const file = join(HERE, "dist", "preview", path.replace(/^\//, "") + ".html");
  mkdirSync(dirname(file), { recursive: true });
  // The preview files open from disk, so their image paths are relative.
  writeFileSync(file, html.replaceAll('src="/how-to/img/', 'src="how-to/img/'));
}
for (const [path, { html }] of Object.entries(STANDALONE)) {
  const file = join(HERE, "dist", "preview", path.replace(/^\//, "") + ".html");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}
mkdirSync(join(HERE, "dist", "preview", "how-to", "img"), { recursive: true });
for (const f of readdirSync(join(HERE, "img"))) copyFileSync(join(HERE, "img", f), join(HERE, "dist", "preview", "how-to", "img", f));
console.log(`Built ${Object.keys(pages).length} pages and ${Object.keys(STANDALONE).length} standalone into dist/worker.js (${Math.round(worker.length / 1024)} KB).`);
