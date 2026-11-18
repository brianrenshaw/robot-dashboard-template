# The how-to page

The page at https://briandrenshaw.com/how-to (the overview) and /how-to/build (this repository's
`GUIDE.md`, as a web page). **It is not part of the starter**: if you copy this repository to make
your own dashboard, delete this folder.

- `home.html`: the overview page, as finished HTML (its GitHub links are marked like the guide's). `../GUIDE.md`: the guide. `style.css`: how both look.
- `build.mjs` turns them into one small Cloudflare Worker, `dist/worker.js` (plain HTML with the
  styles inline; nothing loaded from other sites). `dist/preview/` has the same pages as files,
  to look at locally.
- `wrangler.jsonc` sends all of `briandrenshaw.com` and `www.briandrenshaw.com` to the Worker; the
  front page redirects to `/how-to`. Other names under the domain (the dashboards) are separate.

To change and publish (from a session with a Cloudflare token):

```bash
cd howto-site
npm install
node build.mjs
CLOUDFLARE_ACCOUNT_ID=<the account id> npx wrangler deploy
```

## Adding a page

Every address under the domain comes to this Worker, so a page can sit anywhere, not only under
`/how-to`. Publishing is by hand (no workflow deploys this folder), and the site has no login and
this repository is public, so nothing private goes on a page.

- **A page in the site's look**: write it as Markdown (like the guide) or finished HTML (like the
  overview), read it in `build.mjs` next to `home` and `guide`, and add an entry to `pages` with
  its address, title, description, body and `cls` (`page-guide` for the dark title band, narrow
  column and "On this page" list; `page-home` to leave the layout to the HTML). For the top menu,
  add a line to the `nav` list in `page()`. Pictures go in `img/` as small `.webp` files, used
  as `/how-to/img/<file>`.
- **A private standalone page**: a finished HTML document with its own styles and script, served
  as it is with no site header or menu, to signed-in people only. Its file goes in
  `standalone/`, which is never committed, and its address in `STANDALONE_FILES` in `build.mjs`.
  It is guarded twice: a Cloudflare Access application covering the address (on both
  `briandrenshaw.com` and `www.briandrenshaw.com`) asks for a sign-in, and the Worker serves the
  page only with a valid Access token for the application named in `ACCESS` (team domain and
  AUD tag, which are not secrets) whose email is in `standalone/readers.json`, a list of
  addresses kept out of GitHub. Change who can read in both places: the Access policy and that
  file, then build and publish. The page gets the site's policy (nothing from other sites, no
  forms) with its own inline scripts allowed by their hashes, and `noindex`. The build refuses to
  run if the file is missing (publishing would take the page down), if `ACCESS` is not set, or if
  the page has a `<script src>`, an outside stylesheet or an inline event handler.
  `/share`, `/share/summary`, `/share/findings` and `/share/compare` are link cards: public short addresses that show a
  preview when texted and send a person on to the private page (`CARDS` in `build.mjs`; pictures in
  `standalone/cards/`). A card carries a title and nothing from the page.
  `/school-comparison/summary` and `/school-comparison/findings` are two more, written there by
  `6-incoming-students/pages/build_pages.py`; they sit under `/school-comparison` so the same Access
  application covers them.
  `/school-comparison` is one: it is made in the a private repository repository by
  `5-school-comparison/build_page.py`, so rebuild it there, copy `school-comparison.html` into
  `standalone/` and build again.

Then `node build.mjs`, open `dist/preview/`, deploy, and commit the source files (`dist/` is not
kept). A browser may keep the old page for five minutes.

**Links to GitHub are on**: both templates (robot-dashboard-template and robot-health-template)
are public. If one goes private, build with `SHOW_REPO=0 node build.mjs` and deploy, and the
links, the template bullets and the guide's "Where to look in the templates" are left out. The
passages are marked in the Markdown with `<!--repo-->...<!--/repo-->` (shown only with links on)
and `<!--norepo: ...-->` (shown only with links off; GitHub never shows a comment).
