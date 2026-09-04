# River Island High School — Tennis Team Ladder Dashboard

Live team standings, computed from the coach's Google Sheet using a USTA-modelled ranking
engine.

**The coach records scores in a spreadsheet. Everyone else watches the ladder update.**

```
Coach's Google Sheet  ──►  published CSV  ──►  every teammate's browser
   (the database)          (read directly)      (ranks it, live)
```

---

## Why it is built this way

There is no server, no database, and no login. The coach's sheet *is* the datastore, and
the app is a static page that reads it.

That is a deliberate choice for a high-school team:

- **Free to run, forever.** Static hosting, no backend, no bill anyone has to remember.
- **Can never disagree with the coach's records.** There is only one copy of the data.
- **No accounts for minors**, and no student data held by this app at all.
- **It outlives this repository.** If nobody maintains the code, the sheet still works.

The trade-off is honest and documented: features that require *writing* data — in-app
challenge submission, email alerts, a server-side audit trail — are not built. See
[docs/TRACEABILITY.md](docs/TRACEABILITY.md) for exactly what that covers and the upgrade
path if the team wants it later.

---

## Quick start

```bash
npm install
npm run dev
```

Open the URL it prints and click **See a demo first** — a simulated season across two
ladders, no setup needed.

To use real data, paste a Google Sheets link. Coaches should start with
[docs/COACH_GUIDE.md](docs/COACH_GUIDE.md).

```bash
npm test        # 184 tests
npm run build   # production build into dist/
```

---

## What it does

**Dual ladders** — separate Boys and Girls boards from a `Team` column, or one combined
ladder when there isn't one.

**USTA-modelled ratings** — each match rating is anchored on the opponent's rating and
adjusted by game differential, then averaged with recency weighting. Beating a stronger
player counts for more, and margin matters, not just the win. Ratings stay *provisional*
below three matches, the same minimum USTA uses.

**Leaders spotlight** — top three, Most Wins, Longest Active Streak, and Top Climber over
30 days.

**Real movement arrows** — the ladder is rebuilt as it stood 30 days ago and compared, so
arrows stay correct even after a coach fixes an old score. A sheet with no dates shows no
arrows rather than inventing them.

**Challenge eligibility** — the 3-spot range, injury holds, open-challenge blocking and a
cooling-off period, with the *reason* shown next to every opponent a player cannot
challenge.

**Data health** — every row that could not be read, or that looks unusual, is listed with
its sheet row number. Nothing is silently dropped or silently corrected.

**Live** — polls every 30 seconds, and immediately when a phone wakes or the network
returns. Renders from cache instantly, then revalidates.

---

## How ranking works

Full specification in **[docs/RANKING_RULES.md](docs/RANKING_RULES.md)**. The essentials:

```
m = (games won − games lost) / total games            −1 … +1
matchRating(p) = rating(opponent) + 1.0 × m
rating(p)      = recency-weighted mean of p's match ratings
```

Since nobody has a known starting rating, the system is solved as a damped fixed point,
re-anchoring the squad mean each pass.

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
`Winner`, `Notes`. Header names are matched loosely, and anything read wrong is fixable in
**Coach console → Column mapping** without touching the sheet.

An optional `Roster` tab adds grade, division, injury status and seed ranks.

---

## Deploying

Static output — host it anywhere.

```bash
npm run build          # → dist/
VITE_BASE=/repo-name/ npm run build   # for GitHub Pages under a subpath
```

Netlify, Vercel, Cloudflare Pages and GitHub Pages all work with no configuration beyond
`VITE_BASE`.

---

## Security model

Stated plainly, because it is easy to assume more than is there:

- **Coach mode is a URL flag, not authentication.** It decides what *you see* — the console,
  the mapping tools, the settings. Anyone with the coach link can change dashboard settings
  on their own screen and nothing else.
- **Google's sharing settings are the real access control.** Only people the coach grants
  edit access to the sheet can change a score. The app cannot write to the sheet at all.
- **The sheet is readable by anyone with the link.** Put nothing in it that shouldn't be on
  a scoreboard — no contact details, addresses, or medical specifics.

---

## Project layout

```
src/lib/          ranking core — no React, no I/O, fully unit-tested
  score.ts        tennis score parsing and validation
  rating.ts       NTRP-style dynamic rating engine
  ladder.ts       ordering, tiebreakers, movement, ladder modes
  stats.ts        records, streaks, head-to-head
  challenge.ts    eligibility rules
  leaders.ts      spotlight metrics
  schema.ts       column detection and row mapping
  csv.ts          RFC 4180 parser
  sheets.ts       Google Sheets endpoints and error handling
  dashboard.ts    the end-to-end pipeline
src/components/   UI
src/hooks/        live polling
src/__tests__/    184 tests
scripts/          demo data generator
docs/             ranking rules, coach guide, traceability
sample-data/      demo season + the original sample sheet
```

The ranking core is deliberately free of React and of any I/O, so it can be tested as plain
functions and reused unchanged behind a real backend later.

---

## Documentation

| Document | For |
|---|---|
| [COACH_GUIDE.md](docs/COACH_GUIDE.md) | Coaches — setup, daily use, troubleshooting |
| [RANKING_RULES.md](docs/RANKING_RULES.md) | Anyone asking why a player is ranked where they are |
| [TRACEABILITY.md](docs/TRACEABILITY.md) | Every AC and QA test case mapped to code and tests |
