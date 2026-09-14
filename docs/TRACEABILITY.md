# Requirements traceability

Maps every acceptance criterion and QA test case from the project documents to the code
that implements it and the test that proves it.

Status key: **Done** · **Partial** (works differently than specified — reason given) ·
**Not built** (see [Deliberately not built](#deliberately-not-built))

UI references are to `src/design/DrawSheetLeaderboard.tsx` (the ladder page) and
`src/components/CoachPanel.tsx` (the coach console) unless stated otherwise. Browser tests
are in `e2e/` and run on desktop and mobile Chrome.

---

## US-1.1 · Switch between Boys and Girls ladders

| AC | Requirement | Implementation | Test | Status |
|---|---|---|---|---|
| AC-1.1.1 | Prominent Boys / Girls tabs | Ladder tablist · `ladder.ts:listTeams` | `acceptance.test.ts` "produces separate Boys and Girls ladders" · `e2e/ladder.spec.ts` TC-1.1.1 | Done |
| AC-1.1.2 | Tab switch < 500ms, no reload | All boards — standings and spotlight — computed in one `buildDashboard` pass and held in memory; switching is a state change | `e2e/ladder.spec.ts` TC-1.1.1 measures the switch and checks the document did not reload | Done |
| AC-1.1.3 | High-contrast active tab | `draw-sheet.css` `.ds-tab[aria-selected='true']` — ink text, bold weight and a solid 2px ink underline; inactive tabs are muted | `e2e/ladder.spec.ts` TC-1.1.1 checks the selected state moves | Done |

**TC-1.1.1** — passes, automated. Both tabs visible; switching re-renders standings and
spotlight from memory in under 500ms with no reload; the active tab takes the underline and
the other loses it.

---

## US-1.2 · Ladder positions and rank changes

| AC | Requirement | Implementation | Test | Status |
|---|---|---|---|---|
| AC-1.2.1 | Rank, name, avatar, grade, division, status, movement | Standings row: rank + movement, avatar (photo or initials), name, grade · division, Status column (under the name on phones) | `acceptance.test.ts` "supplies every column" · `e2e/ladder.spec.ts` TC-1.2.1 · `e2e/mobile.spec.ts` | Done |
| AC-1.2.2 | Movement calculated correctly | `ladder.ts:historicalOrder` — rebuilds the ladder as of 30 days ago from the same counted results | `ladder.test.ts` "computes movement…" · "builds the past ladder from counted results only" · `e2e/ladder.spec.ts` TC-1.2.1 (▲2) | Done |
| AC-1.2.3 | Distinct badges for Available / Challenge Pending / Injury Hold | `ladder.ts:displayStatusFor` · `.ds-badge` (each clears WCAG AA, 5.5–6.2:1). Challenge Pending comes from score-less rows in the sheet | `acceptance.test.ts` "reads open challenges straight from score-less rows" · `e2e/ladder.spec.ts` TC-1.2.1 | Done |

**TC-1.2.1** — passes, automated. All seven fields render; a player who climbed two places
shows a green ▲2; Available, Challenge Pending and Injury Hold badges are distinct.

> **Deviation, deliberate:** a sheet with no `Date` column shows **no** movement arrows
> rather than "unchanged". There is no history to compare against, and a flat indicator
> would assert something the data does not support. Covered by `ladder.test.ts` "reports no
> movement at all when the sheet has no dates".

---

## US-2.1 · Issue a challenge match

| AC | Requirement | Implementation | Test | Status |
|---|---|---|---|---|
| AC-2.1.1 | #8 may only challenge #7, #6, #5 | `challenge.ts:challengeOptions` · "Can challenge" list in each player's expanded row | `challenge.test.ts` "offers exactly ranks 7, 6 and 5" · `acceptance.test.ts` | Done |
| AC-2.1.2 | Blocked when either player has an open challenge | `challenge.ts:blockingReasonFor`, fed the open challenges read from the sheet | `acceptance.test.ts` "blocks challenging a player whose challenge from the sheet is still open" · `e2e/ladder.spec.ts` TC-2.1.1 | Done |
| AC-2.1.3 | Defender receives in-app + email alert | Open challenges are shown publicly under **Upcoming challenge matches**; no email | — | **Not built** (email) |

**TC-2.1.1** — steps 1–2 pass, automated: a player sees the three players within range, each
marked *Eligible* or *Blocked* with the reason, and players further up summarized as out of
range. Step 3 passes as a sheet edit: the coach adds a row naming both players with the
score blank, and both switch to *Challenge Pending*. Step 4's email alert is not built.

Beyond the specification: a **cooling-off period** blocks immediate rematches of the same
pair, which is standard on USTA ladders.

---

## US-2.2 · Log match score and coach approval

| AC | Requirement | Implementation | Test | Status |
|---|---|---|---|---|
| AC-2.2.1 | Accept valid set scores, reject invalid | `score.ts:validateSet` / `validateScore` | `score.test.ts` ×23 | Done |
| AC-2.2.2 | Submitted scores enter a Pending queue | `Status` column (text or checkbox) → coach console "Awaiting your verification" | `acceptance.test.ts` "holds pending results out of the ladder" · `schema.test.ts` "never counts an unticked checkbox or a No as verified" | Partial |
| AC-2.2.3 | On approval, ranks adjust and movement updates | `ladder.ts:applyChallengeResult` | `ladder.test.ts` ×5 · `acceptance.test.ts` | Done |

**TC-2.2.1** — all four steps covered:

1. `10-2` is rejected — a match tiebreak is only legal as a deciding set.
2. `6-4, 7-5` is accepted.
3. Pending rows appear in the coach console verification queue with sheet row numbers.
4. `applyChallengeResult(['p1'…'p8'], 'p8', 'p6', true)` puts the challenger at rank 6 and
   the defender at rank 7, leaving ranks 1–5 untouched. Typing the score into an open
   challenge's row also resets both players to *Available*.

> **Partial, and why:** scores are entered and approved in the sheet (Status → `Verified`)
> rather than through an in-app form and Approve button. Every viewer's ladder updates
> within 30 seconds of the edit.

---

## US-3.1 · Manual rank adjustment and lockout

| AC | Requirement | Implementation | Test | Status |
|---|---|---|---|---|
| AC-3.1.1 | Coach reorders players | Roster `Rank` column + challenge ladder mode | `ladder.test.ts` "starts from the coach seeds" | Partial |
| AC-3.1.2 | Injured players bypassed, history kept | `schema.ts:parseActiveStatus` · `challenge.ts` · pairs on hold when either partner is injured | `ladder.test.ts` · `challenge.test.ts` · `acceptance.test.ts` · `e2e/ladder.spec.ts` TC-2.1.1 | Done |
| AC-3.1.3 | Audit trail with coach ID, date, reason | Publish history: timestamp and note for each of the last 20 settings publishes, with restore (`api/ladder.js`). Score edits: Google Sheets version history | `ladder-api.test.ts` "keeps the last 20 publishes" · `e2e/published.spec.ts` "…publish history can restore…" | Partial |

**TC-3.1.1** — step 2 (injury toggle) and step 3 (cannot be challenged) pass. Step 1 is done
by editing the `Rank` column rather than dragging. Step 4: publishes are logged with time
and reason; there is no per-coach ID because there is one coach password and no accounts,
and score edits are attributed by Google Sheets' own version history.

---

## PRD requirements

| PRD § | Requirement | Implementation | Status |
|---|---|---|---|
| 5 | Coaching staff: approve, override, configure rules | Coach password → coach console; rules, mapping and tabs published to the team | Done (approval via sheet) |
| 5 | Parents & AD: read-only ladder | Public ladder at the site's address, no sign-in | Done |
| 6.1 | Dual ladder standings | `dashboard.ts` per-team boards | Done |
| 6.1 | Rank, movement, status badges | Standings row and Status column | Done |
| 6.2 | Top 3 spotlight cards | `Podium` in `DrawSheetLeaderboard.tsx` | Done |
| 6.2 | Most Wins / Longest Active Streak / Top Climber | `leaders.ts` · `Leaderboards` | Done |
| 6.3 | Challenge workflow | Eligibility engine, open challenges and upcoming matches from sheet rows | Partial |
| 7 | Mobile-first responsive | Status badge under the name, stacked spotlight and leaderboards under 640px | Done — `e2e/mobile.spec.ts` checks no horizontal overflow |
| 7 | Under 2s on 4G | ~87 KB gzipped HTML, CSS and JS; web fonts load without blocking first paint; cache-first repeat loads | Done |
| 7 | Student data privacy | No accounts; the site stores only the sheet link and settings | Done |
| 8 | PLAYER entity | `RosterEntry` in `types.ts` | Done |
| 8 | MATCH_RESULT entity | `Match` in `types.ts` | Done |
| 9 | Future scope: Doubles Ladder | Boys / Girls / Mixed doubles boards, from pair rows or a Doubles tab | Done — `acceptance.test.ts` "doubles ladders" ×7 · `schema.test.ts` "doubles" ×7 |

---

## Developer tasks

| Task | Status | Notes |
|---|---|---|
| DEV-101 Dual ladder navigation | Done | |
| DEV-102 Standings table and badges | Done | |
| DEV-103 Challenge modal UI | Partial | Eligibility list in each player's expanded row; challenges are recorded as score-less sheet rows |
| DEV-201 Challenge rules validation API | Done as a library | `challenge.ts:canChallenge` |
| DEV-202 Notification service | Not built | Upcoming matches are listed publicly instead |
| DEV-203 Score validation and submission | Partial | Validation done and tested; submission is a sheet edit |
| DEV-301 Rank recalculation engine | Done | `applyChallengeResult` |
| DEV-302 Drag-and-drop reordering | Partial | Reorder via the roster `Rank` column |
| DEV-303 Injury toggle and audit logging | Partial | Toggle done; settings publishes logged with time and note; score edits in Sheets version history |

---

## Deliberately not built

The team chose a no-accounts design: players and parents never sign in, and one coach
password protects publishing. Requirements that need a player identity follow from that:

| Requirement | Why | Instead |
|---|---|---|
| AC-2.1.3 — email / in-app challenge alerts | Needs player email addresses and accounts | Open challenges listed under Upcoming challenge matches |
| AC-2.2.2 — in-app score submission | Needs to know which player is submitting | Scores typed into the sheet; ladder updates within 30 seconds |
| AC-3.1.1 — drag-and-drop reordering | Would make the app a second record of rank alongside the sheet | Roster `Rank` column |
| AC-3.1.3 — per-coach audit ID | One shared coach password has no individual identity | Publish history with notes; Sheets version history |

The ranking core is free of React and of network access, so a future account-based
version would give `buildDashboard` a different data source without changing any rule.

---

## Test summary

```
 12 files · 262 unit and acceptance tests · all passing   (npm test)

 score.test.ts        23   parsing, validation, tiebreak rules
 rating.test.ts       20   NTRP calibration, convergence, determinism
 ladder.test.ts       29   ordering, tiebreakers, movement, rank history, both modes
 challenge.test.ts    20   eligibility, blocking, cooling-off
 schema.test.ts       49   column detection, coercion, dates, open challenges, doubles
 csv.test.ts          12   RFC 4180 edge cases
 sheets.test.ts       21   URL parsing, endpoint order, error kinds
 config.test.ts        9   settings and column mapping in links
 ladder-api.test.ts   14   publishing API: password, lockout, tokens, validation, history
 publish.test.ts       9   publishing client
 export.test.ts        8   CSV and text exports, formula-injection guard
 acceptance.test.ts   48   QA test cases, doubles, data integrity invariants

 4 files · 16 browser tests · desktop and mobile Chrome   (npm run test:e2e)

 ladder.spec.ts        6   TC-1.1.1, TC-1.2.1, TC-2.1.1, rank chart, doubles, CSV download
 published.spec.ts     7   sign-in, preview, tabs, publish, team view, URL tampering, history, offline, sign-out
 states.spec.ts        2   publishing not configured; static host fallback
 mobile.spec.ts        1   no horizontal overflow, badges, tap to expand, doubles
```

CI (`.github/workflows/ci.yml`) runs all of it, plus the typecheck and production build, on
every push and pull request.
