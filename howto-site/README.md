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

**Links to GitHub are on**: both templates (robot-dashboard-template and robot-health-template)
are public. If one goes private, build with `SHOW_REPO=0 node build.mjs` and deploy, and the
links, the template bullets and the guide's "Where to look in the templates" are left out. The
passages are marked in the Markdown with `<!--repo-->...<!--/repo-->` (shown only with links on)
and `<!--norepo: ...-->` (shown only with links off; GitHub never shows a comment).
