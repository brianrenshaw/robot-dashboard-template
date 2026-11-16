# The how-to page

The page at https://briandrenshaw.com/how-to (the overview) and /how-to/build (this repository's
`GUIDE.md`, as a web page). **It is not part of the starter**: if you copy this repository to make
your own dashboard, delete this folder.

- `overview.md`: the overview page. `../GUIDE.md`: the guide. `style.css`: how both look.
- `build.mjs` turns them into one small Cloudflare Worker, `dist/worker.js` (plain HTML with the
  styles inline; nothing loaded from other sites). `dist/preview/` has the same pages as files,
  to look at locally.
- `wrangler.jsonc` sends only `briandrenshaw.com/how-to*` (and `www.`) to the Worker. The rest of
  the domain is untouched.

To change and publish (from a session with a Cloudflare token):

```bash
cd howto-site
npm install
node build.mjs
CLOUDFLARE_ACCOUNT_ID=<the account id> npx wrangler deploy
```
