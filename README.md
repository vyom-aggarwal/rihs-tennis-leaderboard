# River Island High School — Tennis Team Ladder Dashboard

Live Boys and Girls singles and doubles ladders, computed from the coach's Google Sheet
with a USTA-modelled ranking engine.

**The coach records scores in a spreadsheet. Everyone else opens one address and watches
the ladder update.**

```
Coach's Google Sheet  ──►  every viewer's browser  ──►  ranked ladders, live
   (the database)          (reads the sheet itself)

Coach password  ──►  /api/ladder  ──►  "which sheet, under which settings"
                     (one small record, the only thing the site stores)
```

---

## Why it is built this way

The coach's sheet *is* the datastore, and each viewer's browser ranks it. Players and
parents never sign in. One coach password — set in Vercel — protects the only thing the
site keeps: which sheet and settings make up the team's official ladder.

That is a deliberate choice for a high-school team:

- **Free to run.** Static hosting, one small function, and the free Upstash Redis tier.
- **Can never disagree with the coach's records.** There is only one copy of the results.
- **No accounts for minors, and no student data stored by the app.** The published
  record is a sheet link and rule settings.
- **It survives neglect.** If nobody maintains the code, the sheet still holds every result.

The trade-off is stated openly: challenges, results and approvals are recorded in the sheet
rather than submitted through forms, and there are no email alerts. See
[docs/TRACEABILITY.md](docs/TRACEABILITY.md) for exactly what that covers.

---

## Quick start

```bash
npm install
npm run dev
```

Open the URL it prints and click **See a demo first** — a simulated season of Boys and
Girls singles and doubles. The dev server has no publishing API, so it runs in
link-sharing mode (see [Deploying](#deploying)).

```bash
npm test          # 261 unit and acceptance tests
npm run test:e2e  # production build + 16 browser tests, desktop and mobile
npm run build     # production build into dist/
```

Browser tests use your installed Google Chrome locally; CI installs Playwright's Chromium.

---

## What it does

**Dual ladders, singles and doubles** — Boys and Girls tabs, each with a Singles / Doubles
switch when doubles results exist. Doubles pairs are ranked as teams.

**Standings** — rank, movement, avatar, name, grade, division, an Available /
Challenge Pending / Injury Hold badge, record and rating on every row. Tap a player for
their stats, rank over time, recent matches, and who they may challenge.

**Leaderboards** — Most Wins, Longest Active Streak, and Top Climber over 30 days.

**Real movement and rank history** — the ladder is rebuilt as it stood on any past day
from the same counted results, so arrows and each player's rank-over-time chart stay
correct even after a coach fixes or rejects an old score. A sheet with no dates shows no
arrows rather than inventing them.

**Challenges** — a row with two players and no score yet is an open challenge: both sides
show *Challenge Pending* and appear under **Upcoming challenge matches** until the score is
typed in. Eligibility enforces the 3-spot range, injury holds, open-challenge blocking and
a cooling-off period, with the *reason* shown next to every opponent a player cannot
challenge.

**Coach publishing** — the coach signs in with a password, connects the sheet, previews
changes privately, and publishes them to the whole team. The last 20 publishes are kept
and any of them can be restored. **Coach console → Refresh the leaderboard** re-reads the
sheet and stamps the team page with who did it — "Coach Lokesh updated the leaderboard 3
hours ago". The name is typed at sign-in; with one shared password it says whom to ask, not
who proved they were whom.

**Exports** — download the visible ladder as CSV, copy it as text for a group chat, or
print it.

**Data health** — every row that could not be read, or that looks unusual, is listed with
its tab and row number. Nothing is silently dropped or silently corrected.

**Live** — re-reads the sheet every 30 seconds while the page is on screen, and
immediately when a phone wakes or the network returns. Renders from cache instantly, then
revalidates. Initial load is about 87 KB gzipped.

---

## How ranking works

Full specification in **[docs/RANKING_RULES.md](docs/RANKING_RULES.md)**. The essentials:

```
m = (games won − games lost) / total games            −1 … +1
matchRating(p) = rating(opponent) + 1.0 × m
rating(p)      = recency-weighted mean of p's match ratings
```

Since nobody has a known starting rating, the system is solved as a damped fixed point,
re-anchoring the squad mean each pass. Doubles pairs go through the same engine as single
entities, on their own ladders.

> ### These are not official USTA NTRP ratings
>
> USTA does not publish the coefficients of its dynamic NTRP algorithm. This engine
> reproduces the publicly documented *structure* and states its own calibration openly. The
> numbers are computed only from your sheet and must not be reported as a player's NTRP
> rating.
>
> Because the sheet holds only intra-team results, **only the gaps between players are
> meaningful.** Nothing in the data fixes the team's absolute level, so the squad average is
> pinned to a configurable baseline (default 3.5).

---

## Sheet format

The minimum that works — the shape of the original sample:

| Person 1 | Person 2 | Person 1 Score | Person 2 Score |
|---|---|---|---|
| Jake | Marcus | 6 | 1 |

Optional columns, all auto-detected: `Date`, `Team`, `Score` (e.g. `6-4, 7-5`), `Status`,
`Winner`, `Format`, `Notes`. Header names are matched loosely, and anything read wrong is
fixable in **Coach console → Column mapping** without touching the sheet.

- **Doubles** — write each side as a pair, `Jake Whitmore / Marcus Webb`, either in the
  main tab or on a separate Doubles tab.
- **Open challenges** — leave the score blank.
- **Roster tab** — optional grade, division, photo, injury status and seed ranks.

Connect the Roster and Doubles tabs in **Coach console → More tabs**.

---

## Deploying

### Vercel (recommended)

1. **Import the repository** in Vercel. The Vite preset is detected, and `vercel.json`
   pins the build (`npm ci`, `npm run build`, `dist/`) and adds long-lived caching for the
   hashed assets plus basic security headers.
2. **Connect storage.** In the project, open **Storage**, add **Upstash for Redis** from the
   Marketplace (the free plan is plenty), and connect it to this project. That adds
   `KV_REST_API_URL` and `KV_REST_API_TOKEN`. A store created directly in Upstash works too,
   as `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. **Set the coach password.** In **Settings → Environment Variables**, add
   `COACH_PASSWORD` — at least 10 characters — for Production (and Preview, if you use
   preview deployments).
4. **Optional: tie the site to one Google Sheet.** Add `LADDER_SHEET` — the sheet's link
   (or just its id) — and the site is permanently connected to it: visitors never see a
   "connect a sheet" screen and nobody can publish a different sheet. Without it, the
   coach pastes a sheet link on first sign-in instead.
5. **Redeploy**, so the new variables take effect.
6. Open the site, choose **Coach sign-in**, enter your name and the password (and paste
   the sheet link, unless you set `LADDER_SHEET`), check the preview and press **Publish to
   team**. Share the site's plain address with everyone.

Until steps 2 and 3 are done, the site tells visitors which step is missing and still
offers the demo. Changing `COACH_PASSWORD` later signs every coach device out.

Optionally, set the GitHub repository variable `PRODUCTION_URL` to the site's address, and
`.github/workflows/production-monitor.yml` checks every hour that the site loads and has a
published ladder. CI (`.github/workflows/ci.yml`) runs every test on each push.

### Any other static host

`dist/` also works on Netlify, Cloudflare Pages or GitHub Pages, in **link-sharing mode**:
with no publishing API, the ladder settings travel in the URL and `?coach=1` opens the
console. There is no password in this mode.

```bash
VITE_BASE=/repo-name/ npm run build   # for GitHub Pages under a subpath
```

---

## Security model

Stated plainly, because it is easy to assume more than is there:

- **Google's sharing settings protect the scores.** Only people the coach grants edit
  access can change a result. The app cannot write to the sheet at all.
- **The coach password protects the published ladder.** It is checked on the server in
  constant time. Eight wrong attempts from one network lock sign-in for 15 minutes. A
  correct password returns a signed session that expires after 7 days, and changing the
  password invalidates every session. The password itself is never stored by the app.
- **What is published is only a sheet id, tab ids, rule settings and column mapping**, with
  a timestamp and an optional note. Visitors cannot swap in another sheet through the URL.
- **The sheet is readable by anyone with its link.** Put nothing in it that shouldn't be on
  a scoreboard — no contact details, addresses, or medical specifics.
- **In link-sharing mode there is no password.** Coach mode is a URL flag that controls what
  that one browser shows, and nothing else.

---

## Project layout

```
api/ladder.js     coach publishing function - the only server code
src/lib/          ranking core in plain TypeScript, no React
  score.ts        tennis score parsing and validation
  rating.ts       NTRP-style dynamic rating engine
  ladder.ts       ordering, tiebreakers, movement, rank history, ladder modes
  stats.ts        records, streaks, head-to-head
  challenge.ts    eligibility rules
  leaders.ts      leaderboard metrics
  schema.ts       column detection, row mapping, doubles pairs
  csv.ts          RFC 4180 parser
  sheets.ts       Google Sheets endpoints and error handling
  config.ts       ladder settings as a query string
  publish.ts      publishing API client
  export.ts       CSV and text exports
  dashboard.ts    the end-to-end pipeline
src/design/       the ladder page, plus a design preview harness (design-preview.html)
src/components/   setup page, coach sign-in, coach console
src/hooks/        live sheet polling, the published ladder
src/__tests__/    261 unit and acceptance tests
e2e/              16 browser tests and a local stand-in for the Vercel deployment
scripts/          demo data generator
docs/             ranking rules, coach guide, traceability
sample-data/      demo season (singles, doubles, roster) + the original sample sheet
```

The ranking core has no React and no network access of its own, so it can be tested as
plain functions and reused unchanged behind a different data source.

---

## Documentation

| Document | For |
|---|---|
| [COACH_GUIDE.md](docs/COACH_GUIDE.md) | Coaches — setup, publishing, daily use, troubleshooting |
| [RANKING_RULES.md](docs/RANKING_RULES.md) | Anyone asking why a player is ranked where they are |
| [TRACEABILITY.md](docs/TRACEABILITY.md) | Every AC and QA test case mapped to code and tests |
