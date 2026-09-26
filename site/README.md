# Landing page

Static, framework-free, and served in two places from the same files:

- by every Appreciator instance at `/` and `/leaderboard` (the server answers
  `config.json` from its own settings, so the live demo just works), and
- on GitHub Pages, where `.github/workflows/pages.yml` deploys this folder
  and writes `config.json` from two repository variables.

Everything is linked relatively so it works under
`https://<user>.github.io/appreciator/`. The leaderboard is linked as
`./leaderboard` with no extension: the server serves it there, and GitHub
Pages resolves it to `leaderboard.html`. The server also serves this folder
under `/site/`, which is how the dashboard shares `site.css` and the images.

No inline scripts or styles, and none may be added: the server sends a
Content-Security-Policy that refuses them (see the server README, "Web
pages"). The one exception is structured data
(`<script type="application/ld+json">`), which is data the browser never runs.

## Generated pages

The keyword pages (`clap-button`, `applause-button`, `like-button`), the
platform guides under `guides/` and the comparisons under `alternatives/` are
generated from `site-pages/` at the repository root, one layout for all:

```bash
npm run site:pages              # write them, and sitemap.xml
npm run site:pages -- --check   # fail if any is out of date
```

- Edit `site-pages/`, never the generated files here: each one says where it
  came from on its second line. A unit test fails when they are out of date.
- A source page is an HTML fragment with a front block (`title`,
  `description`, `crumb`). It is written to the same path here and served at
  its clean URL: `site-pages/guides/hugo.html` becomes `guides/hugo.html`,
  at `/guides/hugo`. The server resolves clean URLs the way GitHub Pages
  does, so the same relative links work on both.
- `{{root}}` is the relative way back to this folder, `{{origin}}` the
  canonical origin, and `{{name}}` inserts the partial `site-pages/_name.html`.
- The layout gives every page a canonical URL on
  `https://appreciator.medhat.dev`, Open Graph and Twitter tags, breadcrumbs
  and JSON-LD. `sitemap.xml` lists the landing page, the leaderboard and every
  generated page by that URL.
- Snippets marked `data-instance-snippet` name that instance; `landing.js`
  swaps in the instance serving the page.
- `img/og.png`, the link-preview image, is rendered by
  `npm run site:og-image`.

The landing page and the leaderboard are written by hand and carry the same
tags. `robots.txt` keeps the dashboard, sign-in and API out of search
results.

## GitHub Pages setup

1. Settings → Pages → **Source: GitHub Actions**.
2. Settings → Secrets and variables → Actions → **Variables**:
   - `SITE_API_URL` — the public URL of the instance that backs the demo,
     e.g. `https://appreciator.example.com`.
   - `SITE_DEMO_KEY` — the demo button's public key (`pk_…`), shown by
     `GET /config.json` on that instance.
3. On that instance, add the Pages origin to `DEMO_ALLOWED_ORIGINS`
   (e.g. `https://<user>.github.io`), otherwise the demo button refuses the
   cross-origin embed.

With the variables unset the page still deploys; the demo blocks are replaced
by a "no instance connected" note and the leaderboard page says the same.

## `config.json`

The shape `GET /config.json` answers on an instance (`WebConfig` in
`@appreciator/shared`):

```json
{
  "apiUrl": "https://appreciator.example.com",
  "demoKey": "pk_…",
  "signInEnabled": true,
  "repoUrl": "https://github.com/medhatdawoud/appreciator",
  "leaderboardEnabled": true
}
```

- `apiUrl` and `demoKey` mount the demo buttons and fill in the install
  snippet; without either, the demos are hidden.
- `signInEnabled` shows the "Sign in with GitHub" call to action, which links
  to `${apiUrl}/dashboard`.
- `leaderboardEnabled: false` hides the "Most appreciated" link.
- `?error=not_allowed` on the landing page (where the server sends a refused
  sign-in) shows the allowlist notice.

The Pages workflow sets both booleans to whether `SITE_API_URL` is set; an
instance that has switched either feature off answers accordingly when the
page reaches it.

## Tests

`packages/widget/test/e2e/landing.spec.ts` and `leaderboard.spec.ts` load
these pages from a real server under its Content-Security-Policy and fail on
any console error or policy violation. `seo.spec.ts` crawls every page linked
from the home page: each must load cleanly, have one `<h1>`, a distinct title
and description and its canonical URL, and the sitemap must list exactly the
pages the links reach.
