# Coach's guide

Everything you need to run the ladder. No technical background assumed.

---

## The short version

1. Keep recording match results in a Google Sheet, the way you already do.
2. Share the sheet as **Anyone with the link → Viewer**.
3. Open the team site, choose **Coach sign-in**, and enter the coach password.
4. Paste the sheet link, check the preview, and press **Publish to team**.
5. Send everyone the site's address. That's the whole link — nothing else to share.

From then on: **you type a score into the sheet, and the team's ladder updates by itself.**
Players and parents never sign in, and there is nothing to install.

> Whoever set up the site on Vercel chose the coach password. If the site says it "is not
> set up yet", that person needs to finish the steps in the README's *Deploying* section.

---

## Step 1 — Set up your sheet

The dashboard reads whatever columns you already have. At minimum it needs the two
players and the score.

### The simplest sheet that works

| Person 1 | Person 2 | Person 1 Score | Person 2 Score |
|---|---|---|---|
| Jake | Marcus | 6 | 1 |
| Adrian | Pedro | 2 | 4 |

That is enough to produce a ranked ladder.

### A fuller sheet

Add any of these columns and the dashboard picks them up automatically:

| Column | What it unlocks |
|---|---|
| `Date` | Movement arrows (▲ ▼), rank-over-time charts, and the Top Climber board |
| `Team` | Separate **Boys Ladder** and **Girls Ladder** tabs |
| `Score` | One column like `6-4, 7-5` instead of two number columns |
| `Status` | A verification workflow — `Pending` / `Verified` / `Rejected`, or a checkbox (unticked = pending) |
| `Winner` | An explicit winner, if your scores are ever recorded loser-first |
| `Format` | `Singles` or `Doubles`, if you keep both in one tab |
| `Notes` | Anything you want; shown only to you |

Example:

| Date | Team | Person 1 | Person 2 | Score | Status |
|---|---|---|---|---|---|
| 2026-08-14 | Boys | Ravi Menon | Adrian Foster | 6-4, 7-5 | Verified |
| 2026-08-15 | Girls | Zara Haddad | Ava Thompson | 6-3, 4-6, 10-8 | Pending |

**Column names are flexible.** `Player 1`, `Challenger`, `Home`, `P1` and `Person 1` all
work. If anything is read wrong, fix it in **Coach console → Column mapping**, then publish.

### Doubles

Write each side as a pair, with a slash between the partners:

| Date | Team | Pair 1 | Pair 2 | Score |
|---|---|---|---|---|
| 2026-08-20 | Boys | Jake Whitmore / Mike Sullivan | Diego Ramirez / Ethan Cole | 6-3, 6-4 |

`&` and `+` work too, and partner order does not matter — `Mike / Jake` is the same pair as
`Jake / Mike`. Put doubles rows in the same tab as singles, or keep them on their own
**Doubles tab**. Each pair is ranked as a team on a separate doubles ladder, so doubles
never changes anyone's singles rating.

### Optional: a Roster tab

Add a tab called `Roster` for player details:

| Name | Team | Grade | Division | Status | Rank |
|---|---|---|---|---|---|
| Jake Whitmore | Boys | 12 | Varsity | Active | 1 |
| Marcus Webb | Boys | 11 | Varsity | Injured | 4 |

- **Status** — `Active`, `Injured` or `Inactive`. Injured players show an **Injury Hold**
  badge and cannot be challenged, while keeping their full match history. A doubles pair is
  on hold when either partner is.
- **Rank** — only needed for challenge ladder mode.
- **Grade** accepts `9`–`12` or `Freshman`–`Senior`.
- **Photo** — optional. A direct `https://` link to an image; players without one show
  their initials.

Players listed here with no `Team` are placed on the ladder of the team they play matches
for. A rostered player with no Team who has not played yet is not shown on any ladder, and
Data health lists them so you can fill it in.

---

## Step 2 — Share the sheet

In Google Sheets: **Share → General access → Anyone with the link → Viewer**.

This is required. The dashboard runs in each person's browser and reads the sheet
directly, so Google must be willing to serve it to them.

> **Viewer, not Editor.** Anyone with the link can *read* the sheet. Only people you
> explicitly give edit access can change anything. Keep student contact details, addresses
> and any other personal information **out of this sheet** — put only what belongs on a
> public scoreboard.

---

## Step 3 — Connect it and publish

1. Open the team site and choose **Coach sign-in** (or **Coach** in the top corner once a
   ladder is published). Enter your name and the coach password. Your name appears to the
   team next to what you change ("Coach Lokesh updated the leaderboard 3 hours ago").
2. Paste the sheet link and press **Preview the ladder**. (If whoever set up the site tied
   it to one sheet, this step is skipped — the sheet is already connected.)
3. Look over the preview. Only you can see it — a **Not published yet** bar says so.
4. In the **Coach console → More tabs**, paste links to your Roster and Doubles tabs, if
   you have them. Click the tab in Google Sheets first, then copy the address bar.
5. Add a note if you like ("Season start") and press **Publish to team**.

Everyone who opens the site now sees that ladder. If the preview says it cannot read the
sheet, it tells you exactly why — almost always the sharing setting in step 2.

Your coach sign-in lasts 7 days on that device. Use **Sign out of coach mode** in the
console on a shared computer.

---

## Day-to-day

### Recording a challenge
When a player issues a challenge, add a row with the challenger in the first player column,
the defender in the second, the date, and **leave the score blank**:

| Date | Team | Person 1 | Person 2 | Score | Status |
|---|---|---|---|---|---|
| 2026-09-03 | Boys | Johnny Park | Ethan Cole | | |

Both players show **Challenge Pending**, neither can be challenged by anyone else until it
is resolved, and the match appears under **Upcoming challenge matches** for parents to see.
When the match is played, type the score into that same row. To withdraw a challenge, set
its Status to `Cancelled`. Doubles challenges work the same way with pairs.

### Recording a result
Type it into the sheet. The ladder updates within 30 seconds on every device that has the
page open. You do not need to publish again — publishing is only for *settings*.

### Refreshing the leaderboard
Open the **Coach console** and press **Refresh as Coach *your name***. The sheet is re-read
right away, and the top of the team page reads "Coach *your name* updated the leaderboard
just now", counting up from there. Publishing settings does the same.

### Verifying results
Add a `Status` column. Put `Pending` on new results, change it to `Verified` once you have
confirmed the score. A checkbox column works too: unticked means pending. In
**Coach console → Ladder rules**, turn off *Count results marked Pending* (and publish) if
you want unverified results held out of the ladder entirely.

Pending results appear in **Awaiting your verification** in the console, with their sheet
row numbers.

### Injuries
Set that player's `Status` to `Injured` on the Roster tab. They keep their record and their
position, show an **Injury Hold** badge, and cannot be challenged.

### Fixing a mistake
Edit the sheet. Everything recomputes, including the historical ladders behind the movement
arrows and the rank-over-time charts.

### Changing settings
Anything you change in the **Coach console** — ladder rules, column mapping, the Roster or
Doubles tab — is a preview only you can see. An **Unpublished changes** bar appears; press
**Publish to team** to make it official, or **Discard** to throw the changes away.

### Undoing a publish
**Coach console → Publish history** lists the last 20 publishes with their notes. Press
**Restore** on one to load it as a preview, then publish it. Changes to the scores
themselves are in Google Sheets under **File → Version history**.

---

## Reading the dashboard

| What you see | What it means |
|---|---|
| **3.87** | Team rating. Higher is stronger. See [RANKING_RULES.md](RANKING_RULES.md). |
| **prov.** | Fewer than 3 matches — the rating is still settling. |
| **—** (rating) | The player is on the roster but has not played a match yet. |
| **▲2 / ▼1** | Places gained or lost over the last 30 days. **·** means unchanged. |
| **–** (movement) | No ranking history yet, or the sheet has no dates. |
| **Available** | Can challenge and be challenged. |
| **Challenge Pending** | Has an open challenge — a row with no score yet. |
| **Injury Hold** | Marked Injured on the Roster tab; cannot be challenged. |

Tap any player to see their win and games-won percentages, streak, a **rank over time**
chart, recent matches, and exactly who they may challenge — with the reason next to anyone
they can't.

Below each ladder: **Download CSV** (opens in Sheets or Excel), **Copy standings** (a text
list for a group chat or an email) and **Print**.

### Why does a player with a worse record rank higher?

Because the engine weighs **who** you played and **by how much**, not just wins and losses
— the same principle USTA's rating system uses. A player who loses 6-7, 6-7 to the team's
best player has shown more than someone who beats the bottom seed 6-0, 6-0.

Watch for the **prov.** marker: a player with one or two matches can sit surprisingly high
on very little evidence. Their position firms up as they play.

---

## Troubleshooting

**"This ladder site is not set up yet"**
The site's storage or `COACH_PASSWORD` has not been added in Vercel. The message names the
missing step; the README's *Deploying* section walks through it.

**"That password is not right"**
Check capitals and spaces. After 8 wrong tries from one network, sign-in is locked for 15
minutes.

**"Your coach session has ended"**
Seven days passed, or the password was changed in Vercel. Sign in again — any unpublished
preview is still there.

**"The sheet is not readable publicly"** or **"Could not read the sheet"**
Sharing is probably not set to *Anyone with the link → Viewer*. Redo step 2. If sharing is
right, check your connection.

**"Google could not find this sheet"**
The link is incomplete or the sheet was deleted. Copy the address from Google Sheets again.

**"The columns in this sheet were not recognized"**
Open **Coach console → Column mapping** and set the player and score columns by hand, then
publish.

**"The Roster tab could not be read"** / **"The Doubles tab could not be read"**
The singles ladder still works without it. Check that the tab still exists, and re-paste its
link in **Coach console → More tabs**.

**A player appears twice**
Two spellings of one name. The app matches names ignoring case and spacing, but
`Jake W.` and `Jake Whitmore` are genuinely different. Make them consistent in the sheet.

**A doubles row is skipped**
Each side needs exactly two players, like `Jake / Marcus`. Data health shows the tab and row.

**Data health flags a score**
It shows the row number and what looks wrong. A `6-5` warning usually means the set was
recorded before it finished. The match still counts unless you turn on strict mode.

**Two separate groups on one ladder**
The app will say so. It means two sets of players have never played anyone from the other
group, so their relative order is not established by results. One cross-group match fixes it.

**Someone is missing from both ladders**
They have no `Team` value. Give them one on the Roster tab, or in a `Team` column on their
match rows. Data health names everyone affected.

**A date shows a warning**
Dates in the future almost always mean a mistyped year. Dates written without a year
(`9/3`) are read as the nearest such day.

---

## Privacy

- The site stores **only** your sheet's link, tab ids and ladder settings, with the time and
  note of each publish. No roster, no results, no student accounts.
- The ladder is computed in each viewer's browser, which reads your sheet directly from
  Google. Your sheet stays in your Google Drive, under your control.
- Each viewer's browser keeps a copy of the sheet so the ladder paints instantly on their
  next visit.
- **Put nothing in the sheet you would not put on a scoreboard** — no contact details,
  addresses, or medical specifics. "Injured" is a status; the reason belongs elsewhere.
