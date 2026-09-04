# Coach's guide

Everything you need to run the ladder. No technical background assumed.

---

## The short version

1. Keep recording match results in a Google Sheet, the way you already do.
2. Share the sheet as **Anyone with the link → Viewer**.
3. Paste the sheet link into the dashboard once.
4. Send your team the link the dashboard gives you back.

From then on: **you type a score into the sheet, and the team's ladder updates by itself.**
There is nothing to install, no accounts to create, and nothing to pay for.

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
| `Date` | Movement arrows (↑ ↓) and the Top Climber board |
| `Team` | Separate **Boys Ladder** and **Girls Ladder** tabs |
| `Score` | One column like `6-4, 7-5` instead of two number columns |
| `Status` | A verification workflow — `Pending` / `Verified` / `Rejected` |
| `Winner` | An explicit winner, if your scores are ever recorded loser-first |
| `Notes` | Anything you want; shown only to you |

Example:

| Date | Team | Person 1 | Person 2 | Score | Status |
|---|---|---|---|---|---|
| 2026-08-14 | Boys | Ravi Menon | Adrian Foster | 6-4, 7-5 | Verified |
| 2026-08-15 | Girls | Zara Haddad | Ava Thompson | 6-3, 4-6, 10-8 | Pending |

**Column names are flexible.** `Player 1`, `Challenger`, `Home`, `P1` and `Person 1` all
work. If anything is read wrong, fix it in **Coach console → Column mapping** — no need to
rename anything in your sheet.

### Optional: a Roster tab

Add a second tab called `Roster` for player details:

| Name | Team | Grade | Division | Status | Rank |
|---|---|---|---|---|---|
| Jake Whitmore | Boys | 12 | Varsity | Active | 1 |
| Marcus Webb | Boys | 11 | Varsity | Injured | 4 |

- **Status** — `Active`, `Injured` or `Inactive`. Injured players show an **Injury Hold**
  badge and cannot be challenged, while keeping their full match history.
- **Rank** — only needed for challenge ladder mode.
- **Grade** accepts `9`–`12` or `Freshman`–`Senior`.

To connect the Roster tab, open it in Google Sheets, copy the `gid=` number from the
address bar, and add `&roster=<that number>` to your dashboard link.

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

## Step 3 — Connect it

Open the dashboard, paste the sheet link, press **Build the ladder**. That is the whole
setup.

If it cannot read the sheet it will tell you exactly why — almost always the sharing
setting in step 2.

---

## Step 4 — Share with the team

Open **Coach console** and copy the **Team link**. Send it to players, parents, and the
athletic director. It is read-only and always current.

Also copy **Your coach link** and bookmark it. That one reopens the coach console.

> **What the coach link does and doesn't do:** it controls what *you see* — the console,
> the mapping tools, the settings. It is not a password and it does not protect your data.
> Your sheet's own Google sharing settings are the real access control. Someone who gets
> your coach link can change dashboard settings on their own screen; they cannot change a
> single score.

---

## Day-to-day

### Recording a result
Type it into the sheet. The ladder updates within 30 seconds on every device watching.

### Verifying results
Add a `Status` column. Put `Pending` on new results, change it to `Verified` once you have
confirmed the score. In **Coach console → Ladder rules**, turn off *Count results marked
Pending* if you want unverified results held out of the ladder entirely.

Pending results appear in **Awaiting your verification** in the console, with their sheet
row numbers.

### Injuries
Set that player's `Status` to `Injured` on the Roster tab. They keep their record and their
position, show an **Injury Hold** badge, and cannot be challenged.

### Fixing a mistake
Edit the sheet. Everything recomputes, including the historical ladder the movement arrows
compare against.

### Adjusting the rules
**Coach console → Ladder rules** covers challenge range, cooling-off period, the movement
window, and how many matches make a rating established. These settings travel in the link
you share, so your team sees the ladder under the same rules you set.

---

## Reading the dashboard

| What you see | What it means |
|---|---|
| **3.87** | Team rating. Higher is stronger. See [RANKING_RULES.md](RANKING_RULES.md). |
| **Provisional** | Fewer than 3 matches — the rating is still settling. |
| **↑2 / ↓1** | Places gained or lost over the last 30 days. |
| **–** (movement) | No ranking history yet, or the sheet has no dates. |
| **107–54 66%** | Games won–lost, and games-won percentage. |
| **W W L W W** | The last five results, oldest first. |

### Why does a player with a worse record rank higher?

Because the engine weighs **who** you played and **by how much**, not just wins and losses
— the same principle USTA's rating system uses. A player who loses 6-7, 6-7 to the team's
best player has shown more than someone who beats the bottom seed 6-0, 6-0.

Watch for the **Provisional** badge: a player with one or two matches can sit surprisingly
high on very little evidence. Their position firms up as they play.

---

## Troubleshooting

**"The sheet is not readable publicly"**
Sharing is not set to *Anyone with the link → Viewer*. Redo step 2.

**"The columns in this sheet were not recognised"**
Open **Coach console → Column mapping** and set the player and score columns by hand.

**A player appears twice**
Two spellings of one name. The app matches names ignoring case and spacing, but
`Jake W.` and `Jake Whitmore` are genuinely different. Make them consistent in the sheet.

**Data health flags a score**
It shows the sheet row number and what looks wrong. A `6-5` warning usually means the set
was recorded before it finished. The match still counts unless you turn on strict mode.

**Two separate groups on one ladder**
The app will say so. It means two sets of players have never played anyone from the other
group, so their relative order is not established by results. One cross-group match fixes it.

**Someone is missing from both ladders**
They have no `Team` value. Add a `Team` column, or list them on the Roster tab.

---

## Privacy

- The dashboard has **no server and no database**. It runs in the browser and reads your
  sheet directly from Google. No copy of your roster is stored by this app.
- Your sheet stays in your Google Drive, under your control.
- The only thing cached is a copy of the sheet in each viewer's own browser, so the ladder
  paints instantly on their next visit.
- **Put nothing in the sheet you would not put on a scoreboard** — no contact details,
  addresses, or medical specifics. "Injured" is a status; the reason belongs elsewhere.
