# Requirements traceability

Maps every acceptance criterion and QA test case from the project documents to the code
that implements it and the test that proves it.

Status key: **Done** · **Partial** (works differently than specified — reason given) ·
**Not built** (needs a backend — see [Deferred](#deferred-needs-a-backend))

UI references are to `src/design/DrawSheetLeaderboard.tsx` (the ladder page) and
`src/components/CoachPanel.tsx` (the coach console) unless stated otherwise. "Verified in
browser" means checked in the running app at 1280px and 375px.

---

## US-1.1 · Switch between Boys and Girls ladders

| AC | Requirement | Implementation | Test | Status |
|---|---|---|---|---|
| AC-1.1.1 | Prominent Boys / Girls tabs | Ladder tablist · `ladder.ts:listTeams` | `acceptance.test.ts` "produces separate Boys and Girls ladders" | Done |
| AC-1.1.2 | Tab switch < 500ms, no reload | Both boards — standings and spotlight — computed in one `buildDashboard` pass and held in memory; switching is a state change that also updates `?ladder=` in the address bar | `acceptance.test.ts` "precomputes both boards in one pass" · verified in browser | Done |
| AC-1.1.3 | High-contrast active tab | `draw-sheet.css` `.ds-tab[aria-selected='true']` — ink text, bold weight and a solid 2px ink underline; inactive tabs are muted | Verified in browser | Done |

**TC-1.1.1** — passes. Both tabs visible; switching re-renders standings and spotlight from
memory with no network request; the active tab takes the underline and the other loses it.

---

## US-1.2 · Ladder positions and rank changes

| AC | Requirement | Implementation | Test | Status |
|---|---|---|---|---|
| AC-1.2.1 | Rank, name, avatar, grade, division, status, movement | Standings row: rank + movement, avatar (photo or initials), name, grade · division, Status column (under the name on phones) | `acceptance.test.ts` "supplies every column the standings table needs" · verified in browser | Done |
| AC-1.2.2 | Movement calculated correctly | `ladder.ts:historicalOrder` — rebuilds the ladder as of 30 days ago from the same counted results | `ladder.test.ts` "computes movement against the ladder as it stood 30 days ago" · "builds the past ladder from counted results only" | Done |
| AC-1.2.3 | Distinct badges for Available / Challenge Pending / Injury Hold | `ladder.ts:displayStatusFor` · `.ds-badge` (each clears WCAG AA, 5.5–6.2:1). Challenge Pending comes from score-less rows in the sheet (`schema.ts:mapMatches`) | `ladder.test.ts` ×2 · `acceptance.test.ts` "reads open challenges straight from score-less rows" · `schema.test.ts` "reads a row with two players and no score as an open challenge" | Done |

**TC-1.2.1** — passes. All seven fields render; movement shows a green ▲2 for a player who
climbed two places; the three badges are visually distinct.

> **Deviation, deliberate:** a sheet with no `Date` column shows **no** movement arrows
> rather than "unchanged". There is no history to compare against, and a flat indicator
> would assert something the data does not support. Covered by `ladder.test.ts` "reports no
> movement at all when the sheet has no dates".

---

## US-2.1 · Issue a challenge match

| AC | Requirement | Implementation | Test | Status |
|---|---|---|---|---|
| AC-2.1.1 | #8 may only challenge #7, #6, #5 | `challenge.ts:challengeOptions` · "Can challenge" list in each player's expanded row | `challenge.test.ts` "offers exactly ranks 7, 6 and 5" · `acceptance.test.ts` | Done |
| AC-2.1.2 | Blocked when either player has an open challenge | `challenge.ts:blockingReasonFor`, fed the open challenges read from the sheet | `challenge.test.ts` "blocks a challenge when either player already has one open" · `acceptance.test.ts` "blocks challenging a player whose challenge from the sheet is still open" | Done |
| AC-2.1.3 | Defender receives in-app + email alert | — | — | **Not built** |

**TC-2.1.1** — steps 1–2 pass in the expanded row: a rank-8 player sees ranks 5–7 marked
*Eligible*, and ranks 1–4 summarized as out of challenge range. Step 3 passes as a sheet
edit: the coach adds a row naming both players with the score blank, and both switch to
*Challenge Pending*. Step 4 (notifying the defender) requires a backend.

Beyond the specification: a **cooling-off period** blocks immediate rematches of the same
pair, which is standard on USTA ladders and prevents one player repeatedly re-challenging
the same opponent.

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

> **Partial, and why:** approval is done by changing the `Status` cell to `Verified` in the
> sheet, not by clicking Approve in the app. A static page cannot write to a Google Sheet
> without OAuth and a server. The queue, the rules and the rank recalculation are all built
> and tested — only the write-back is a sheet edit.

---

## US-3.1 · Manual rank adjustment and lockout

| AC | Requirement | Implementation | Test | Status |
|---|---|---|---|---|
| AC-3.1.1 | Coach reorders players | Roster `Rank` column + challenge ladder mode; Roster tab connected from the coach console | `ladder.test.ts` "starts from the coach seeds" | Partial |
| AC-3.1.2 | Injured players bypassed, history kept | `schema.ts:parseActiveStatus` · `challenge.ts` | `ladder.test.ts` · `challenge.test.ts` · `acceptance.test.ts` | Done |
| AC-3.1.3 | Audit trail with coach ID, date, reason | — | — | **Not built** |

**TC-3.1.1** — step 2 (injury toggle) and step 3 (cannot be challenged) pass. Step 1
(drag-and-drop) is done by editing the `Rank` column rather than dragging. Step 4 (audit
trail) needs a backend; Google Sheets' own **File → Version history** records who changed
what and when in the meantime.

---

## PRD requirements

| PRD § | Requirement | Implementation | Status |
|---|---|---|---|
| 6.1 | Dual ladder standings | `dashboard.ts` per-team boards | Done |
| 6.1 | Rank, movement, status badges | Standings row and Status column | Done |
| 6.2 | Top 3 spotlight cards | `Podium` in `DrawSheetLeaderboard.tsx` | Done |
| 6.2 | Most Wins | `leaders.ts:mostWins` · `Leaderboards` | Done |
| 6.2 | Longest Active Streak | `leaders.ts:longestActiveStreak` · `Leaderboards` | Done |
| 6.2 | Top Climber, 30 days | `leaders.ts:topClimber` · `Leaderboards` | Done |
| 6.3 | Challenge workflow | Eligibility engine and open-challenge tracking from sheet rows; in-app submission and alerts need a backend | Partial |
| 7 | Mobile-first responsive | Under 640px the status badge moves under the name and the spotlight and leaderboards stack; no horizontal scrolling at 375px (verified in browser) | Done |
| 7 | Under 2s on 4G | ~78 KB gzipped HTML, CSS and JS; web fonts load without blocking first paint; cache-first repeat loads | Done |
| 7 | Student data privacy | No server, no data collection; guidance in the coach guide | Done |
| 8 | PLAYER entity | `RosterEntry` in `types.ts` | Done |
| 8 | MATCH_RESULT entity | `Match` in `types.ts` | Done |

---

## Developer tasks

| Task | Status | Notes |
|---|---|---|
| DEV-101 Dual ladder navigation | Done | |
| DEV-102 Standings table and badges | Done | |
| DEV-103 Challenge modal UI | Partial | Eligibility list in each player's expanded row; challenges are recorded as score-less sheet rows rather than submitted from a form |
| DEV-201 Challenge rules validation API | Done as a library | `challenge.ts:canChallenge` — the rules, minus the HTTP endpoint |
| DEV-202 Notification service | Not built | Needs a backend |
| DEV-203 Score validation and submission | Partial | Validation done and tested; submission is a sheet edit |
| DEV-301 Rank recalculation engine | Done | `applyChallengeResult` |
| DEV-302 Drag-and-drop reordering | Partial | Reorder via the roster `Rank` column |
| DEV-303 Injury toggle and audit logging | Partial | Toggle done; audit relies on Sheets version history |

---

## Deferred (needs a backend)

Four requirements cannot be met by a page that only *reads* a Google Sheet. They are all
the same shape: they need authenticated writes.

| Requirement | What it needs |
|---|---|
| AC-2.1.3 — email / in-app challenge alerts | A mail service and a place to queue notifications |
| AC-2.2.2 — in-app score submission | Authenticated write access to the sheet or a database |
| AC-3.1.1 — drag-and-drop reordering | The same write access |
| AC-3.1.3 — audit trail | Server-side identity, so the log records who acted |

**Why it was built this way.** The brief was that the coach supplies data and the team sees
it live. A read-only architecture delivers that with no server to run, no cost, no accounts
for minors, and no student data held anywhere but the coach's own Drive — and it keeps
working if nobody maintains this repository.

The ranking core is deliberately free of React and of any I/O, so adding a backend later
means giving `buildDashboard` a different data source. None of the rules would change.

**The upgrade path**, if the team wants full write support: a Google Apps Script bound to
the sheet, published as a web app, gives authenticated writes with no hosting bill and no
new accounts — students sign in with the Google accounts the school already issues.

---

## Test summary

```
 9 files · 214 tests · all passing

 score.test.ts        23   parsing, validation, tiebreak rules
 rating.test.ts       20   NTRP calibration, convergence, determinism
 ladder.test.ts       27   ordering, tiebreakers, movement, both modes
 challenge.test.ts    20   eligibility, blocking, cooling-off
 schema.test.ts       42   column detection, coercion, dates, open challenges
 csv.test.ts          12   RFC 4180 edge cases
 sheets.test.ts       21   URL parsing, endpoint order, error kinds
 config.test.ts        8   settings and column mapping in shared links
 acceptance.test.ts   41   QA test cases + data integrity invariants
```

Run with `npm test`.
