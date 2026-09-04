# How the ladder is calculated

This document is the complete specification of the ranking engine. It is written to be
readable by a coach, an athletic director, or a student developer — if a player asks why
they are ranked below someone with a worse record, the answer is in here.

---

## 1. What these ratings are, and what they are not

The dashboard shows each player a **team rating** on the 1.0–7.0 NTRP scale.

**These are not official USTA NTRP ratings.** They are computed only from the matches in
your own sheet, by this app, and must never be reported as a player's NTRP rating.

The engine is *modelled on* USTA's dynamic NTRP system. USTA does not publish the exact
coefficients of its dynamic algorithm, so this implementation reproduces the part that is
publicly documented — the structure that makes the system fair — and states its own
calibration openly:

1. Every match produces a **match rating** for each player, anchored on the opponent's
   rating and adjusted by the **game differential**. Beating a stronger player is worth
   more than beating a weaker one, and the margin matters, not just the win.
2. A player's rating is the **recency-weighted average** of their match ratings.
3. A rating stays **provisional** until the player has enough matches to be meaningful.
   USTA requires three matches before publishing a year-end rating; this app uses the same
   default.

### Only the gaps are meaningful

Your sheet contains results between teammates only. Nothing in it establishes how strong
your team is in absolute terms — a squad of 4.5 players and a squad of 3.0 players who
each beat each other by identical scores produce identical data.

So the engine pins the **squad average** to a fixed value (default 3.5) and lets the gaps
between players fall out of the results. Set *Squad average rating* in the coach console to
your team's true level and the numbers will read realistically. The ladder order is
unaffected by this setting.

---

## 2. The calculation, step by step

### Step 1 — Read the score

Each match is parsed into sets and games. A match tiebreak (a deciding set to 10) counts
as **one game** for its winner, not ten, so it cannot swamp the differential. This is the
same convention USTA and UTR use.

### Step 2 — Compute the game margin

From player *p*'s point of view, with *gp* games won and *go* games lost:

```
m = (gp − go) / (gp + go)          m ranges from −1 to +1
```

| Scoreline | m | Meaning |
|---|---|---|
| 6-0, 6-0 | +1.00 | total domination |
| 6-2, 6-2 | +0.50 | comfortable |
| 6-4, 6-4 | +0.20 | clear but competitive |
| 7-6, 6-7, 10-8 | ~+0.02 | a coin flip |

### Step 3 — Compute the match rating

```
matchRating(p) = rating(opponent) + SPREAD × m          SPREAD = 1.0
```

In words: *if you beat someone 6-2, 6-2, you are about half a level above them.*

`SPREAD = 1.0` is calibrated against how NTRP levels play out in practice. NTRP levels are
0.5 apart, and players a half-level apart typically produce roughly a 6-2, 6-2 scoreline
(m = 0.5 → a 0.5 rating gap). A full level apart produces roughly a double bagel
(m = 1.0 → a 1.0 gap). The mapping is linear between those anchors.

### Step 4 — Weight by recency

```
weight = 0.5 ^ (age in days / 60)
```

A result from 60 days ago counts half as much as one from today. **Matches with no date
count at full weight**, so a sheet with no date column works normally — it simply has no
recency information to use.

### Step 5 — Solve

Every player's rating depends on their opponents' ratings, and nobody starts with a known
rating, so the system is solved as a **fixed point**:

1. Start every player at the squad average.
2. Set each player's target to the weighted mean of their match ratings.
3. Move each rating halfway toward its target (damping keeps this stable).
4. Shift every rating so the squad average returns to its anchor.
5. Repeat until nothing moves by more than 0.0000001, or 200 passes.

Step 4 is necessary: adding a constant to *everybody's* rating would otherwise also be a
valid solution, and the ratings would drift off the scale.

Ratings are finally clamped to the 1.0–7.0 NTRP range.

---

## 3. Ladder order and tiebreakers

Players are ordered by rating, highest first. When ratings tie exactly, the USTA league
standings sequence decides, in order:

1. **Head-to-head** between those two players
2. **Win percentage**
3. **Games-won percentage**
4. **Total wins**, then **matches played**
5. **Alphabetical by name**

The last step guarantees the board is fully deterministic: the same sheet always produces
the same ladder for every person viewing it.

> Head-to-head is used only on an exact rating tie. It is not transitive across three or
> more players (A beats B beats C beats A happens constantly in tennis), so applying it
> more widely could make the order depend on the order rows appear in the sheet.

---

## 4. Two ladder modes

### Rating mode (default)

Order is computed from all results, as above. This is the mode that works with a plain
results sheet, and the one to use unless you actively run a challenge ladder.

### Challenge ladder mode

The classic ladder. Requires a **Roster** tab with a `Rank` column giving starting
positions. Results are then replayed in date order, applying the standard USTA ladder
movement rule:

> When a challenger beats a player ranked above them, the challenger takes that player's
> position, and the defender — plus everyone in between — moves down exactly one place.

If the defender wins, nothing moves. Players with no seed are appended below the seeded
block, ordered by rating.

**Example.** #8 challenges and beats #6:

```
before   1  2  3  4  5  [6] 7  [8]
after    1  2  3  4  5  [8] 6   7
```

---

## 5. Challenge eligibility

A challenge is legal when **all** of these hold:

- The challenger is **below** the defender on the ladder.
- The gap is between 1 and the **challenge range** (default 3), so a #8 may challenge #7,
  #6 or #5 — but not #4.
- Neither player is on **Injury Hold** or **Inactive**.
- Neither player already has an **open challenge**.
- The pair is past the **cooling-off period** since they last played (default 7 days).

The app shows every player above the challenger, with a reason next to each one who cannot
be challenged, rather than quietly shortening the list.

---

## 6. Movement arrows and Top Climber

Movement is **not** a stored "previous rank". The app rebuilds the entire ladder as it
stood *N* days ago (default 30) using only matches on or before that date, and compares.

This means arrows stay correct even if a coach corrects an old score — the history is
recomputed rather than carrying a stale number forward.

**A sheet with no dates shows no arrows.** There is no history to reconstruct, and
inventing movement would be a fabrication.

---

## 7. Which matches count

| Status column | Counted? |
|---|---|
| Empty / missing | Yes — your sheet is the record of truth |
| `Verified`, `Approved`, `Confirmed` | Yes |
| `Pending`, `Awaiting`, `Submitted` | Configurable (counted by default) |
| `Rejected`, `Void`, `Disputed` | Never |

Turn off *Count results marked Pending* in the coach console to require your verification
before a result moves anyone.

---

## 8. What the app refuses to guess

The dashboard never silently drops or silently "fixes" a row. Everything below appears in
**Data health** with its sheet row number.

| Situation | What happens |
|---|---|
| A player name is blank | Row skipped, reported |
| Both columns name the same player | Row skipped, reported |
| The score cannot be read at all | Row skipped, reported |
| The score is level (4-4) | Row skipped — no winner can exist |
| The set is not a completed set (6-5) | **Counted, with a warning** (or skipped in strict mode) |
| `Winner` column disagrees with the score | Winner column wins, disagreement reported |
| A player is in results but not on the roster | Counted, flagged as a likely misspelling |
| Part of the squad has never played the rest | Ranked, but the ambiguity is reported |

That last one matters. If your ladder splits into two groups who have never played anyone
in the other group, **no algorithm can order them against each other** — the data simply
does not say. The app ranks them, says so plainly, and one cross-group match fixes it.

---

## 9. Accepted score formats

| Format | Valid examples |
|---|---|
| Standard set (to 6) | 6-0, 6-1, 6-2, 6-3, 6-4, 7-5, 7-6 |
| Short set (to 4) | 4-0, 4-1, 4-2, 4-3, 5-3, 5-4 |
| Pro set (to 8) | 8-0 … 8-6, 9-7, 9-8 |
| Match tiebreak | 10-8, 12-10 — **deciding set only** |
| Full match | `6-4, 7-5` · `6-3, 4-6, 10-8` · `7-6(5), 6-4` |
| Two game columns | `6` and `1` → a 6-1 single set |
| Retirement | `6-4, 2-1 ret.` — awarded to whoever led |

A bare `10-2` is **rejected**: a match tiebreak is only a legal set when it decides a match
whose earlier sets are split. This is exactly the case QA test TC-2.2.1 checks.

---

## 10. Where this lives in the code

| Concern | File |
|---|---|
| Score parsing and validation | `src/lib/score.ts` |
| Rating engine | `src/lib/rating.ts` |
| Ladder order, tiebreakers, movement | `src/lib/ladder.ts` |
| Records and streaks | `src/lib/stats.ts` |
| Challenge eligibility | `src/lib/challenge.ts` |
| Spotlight metrics | `src/lib/leaders.ts` |
| Column detection | `src/lib/schema.ts` |

Every rule in this document is covered by a test in `src/__tests__/`.
