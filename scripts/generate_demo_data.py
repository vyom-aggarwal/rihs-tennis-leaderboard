"""
Generate the demo dataset for the RIHS Tennis Ladder Dashboard.

The supplied sample sheet was seven rows with no dates, no teams and no roster, which
is not enough to exercise movement arrows, the Boys/Girls split, injury holds, or the
provisional-rating threshold. This script produces a season-shaped dataset that does,
while staying internally consistent: each player has a latent skill, results are
simulated from the skill gap, and scorelines follow that gap. Hand-typing sixty rows
would have produced a ladder that contradicts itself.

Deterministic by design - a fixed seed means the committed CSVs are reproducible and
the tests that assert against them stay stable.

Usage:  python scripts/generate_demo_data.py
"""

import csv
import random
from datetime import date, timedelta
from pathlib import Path

SEED = 20260904
random.seed(SEED)

OUT = Path(__file__).resolve().parent.parent / "sample-data"

# Season window. "Today" for the demo is 2026-09-04, so this gives roughly eleven weeks
# of history: enough for a 30-day movement window to have real data on both sides of it.
SEASON_START = date(2026, 6, 15)
SEASON_END = date(2026, 9, 2)
MOVEMENT_CUTOFF = date(2026, 8, 5)  # 30 days before "today"

# (name, team, grade, division, latent skill, late-season skill delta, status)
#
# `delta` is applied to matches played after MOVEMENT_CUTOFF, which is what creates a
# believable Top Climber rather than a player who was always going to be there.
PLAYERS = [
    # --- Boys ---------------------------------------------------------------
    ("Jake Whitmore",   "Boys",  12, "Varsity", 4.60,  0.00, "Active"),
    ("Ethan Cole",      "Boys",  11, "Varsity", 4.05,  0.55, "Active"),   # late surge
    ("Mike Sullivan",   "Boys",  12, "Varsity", 4.30,  0.00, "Active"),
    ("Diego Ramirez",   "Boys",  10, "Varsity", 4.15,  0.05, "Active"),
    ("Marcus Webb",     "Boys",  11, "Varsity", 3.95,  0.00, "Injured"),  # injury hold
    ("Johnny Park",     "Boys",  12, "Varsity", 3.80, -0.10, "Active"),
    ("Adrian Foster",   "Boys",  10, "JV",      3.60,  0.10, "Active"),
    ("Pedro Alvarez",   "Boys",  11, "JV",      3.50,  0.00, "Active"),
    ("Ravi Menon",      "Boys",   9, "JV",      3.35,  0.20, "Active"),
    ("Tyler Brooks",    "Boys",   9, "JV",      3.70,  0.00, "Active"),   # joins late
    # --- Girls --------------------------------------------------------------
    ("Sofia Ramos",     "Girls", 12, "Varsity", 4.55,  0.00, "Active"),
    ("Maya Lindqvist",  "Girls", 11, "Varsity", 4.40,  0.05, "Active"),
    ("Priya Raman",     "Girls", 10, "Varsity", 3.95,  0.50, "Active"),   # late surge
    ("Chloe Bennett",   "Girls", 12, "Varsity", 4.20,  0.00, "Active"),
    ("Nina Kowalski",   "Girls", 11, "Varsity", 4.00, -0.05, "Active"),
    ("Ava Thompson",    "Girls", 10, "JV",      3.75,  0.00, "Active"),
    ("Zara Haddad",     "Girls",  9, "JV",      3.55,  0.15, "Active"),
    ("Lena Fischer",    "Girls", 11, "JV",      3.45,  0.00, "Injured"),  # injury hold
    ("Bella Moreau",    "Girls", 10, "JV",      3.30,  0.00, "Active"),
    ("Hana Suzuki",     "Girls",  9, "JV",      3.60,  0.00, "Active"),   # joins late
]

# Players who only appear in the back half of the season, so they finish with few
# matches and stay provisional - the state the UI needs to be able to show.
LATE_JOINERS = {"Tyler Brooks", "Hana Suzuki"}

BY_NAME = {p[0]: p for p in PLAYERS}


def skill(name: str, when: date) -> float:
    _, _, _, _, base, delta, _ = BY_NAME[name]
    return base + (delta if when > MOVEMENT_CUTOFF else 0.0)


def play_set(gap: float) -> tuple[int, int]:
    """
    Simulate one standard set. `gap` is the stronger player's skill advantage in NTRP
    units, from player A's perspective (positive = A stronger).

    Calibrated to match how NTRP levels actually play out: level players trade 7-5 and
    7-6 sets, a half-level gap produces roughly 6-2, a full level roughly 6-1 / 6-0.
    """
    # Probability A wins the set.
    p_a = 1.0 / (1.0 + 10 ** (-gap * 1.15))
    a_wins = random.random() < p_a

    # Dominance must follow the actual result, not the skill gap alone. When the
    # underdog pulls off an upset it should be tight (7-5, 7-6) - scoring it from the
    # raw gap would hand out 6-0 upsets and make the ladder contradict itself.
    favourite_won = (a_wins and gap >= 0) or (not a_wins and gap < 0)
    edge = abs(gap) if favourite_won else max(0.0, 0.30 - abs(gap) * 0.20)

    # Loser's game count shrinks as the edge widens; noise keeps it from looking synthetic.
    lam = max(0.0, 4.6 - edge * 3.4) + random.gauss(0, 0.9)
    loser_games = max(0, min(6, int(round(lam))))

    if loser_games <= 4:
        winner_games = 6
    elif loser_games == 5:
        winner_games = 7
    else:  # 6-6 -> tiebreak
        winner_games, loser_games = 7, 6

    return (winner_games, loser_games) if a_wins else (loser_games, winner_games)


def play_match(a: str, b: str, when: date) -> str:
    """Best of three, third set replaced by a 10-point match tiebreak."""
    gap = skill(a, when) - skill(b, when)
    sets: list[str] = []
    wins_a = wins_b = 0

    for _ in range(2):
        ga, gb = play_set(gap)
        sets.append(f"{ga}-{gb}")
        if ga > gb:
            wins_a += 1
        else:
            wins_b += 1

    if wins_a == wins_b:
        # Deciding match tiebreak to 10, win by 2. A tiebreak that goes the distance is
        # by nature close, so the margin skews tight regardless of who takes it.
        p_a = 1.0 / (1.0 + 10 ** (-gap * 1.15))
        a_takes_it = random.random() < p_a
        loser = random.choice([4, 5, 6, 6, 7, 8, 8])
        winner = 10
        sets.append(f"{winner}-{loser}" if a_takes_it else f"{loser}-{winner}")

    return ", ".join(sets)


def random_date(start: date, end: date) -> date:
    """A weekday during the season - high-school ladder matches are not played Sundays."""
    span = (end - start).days
    for _ in range(20):
        d = start + timedelta(days=random.randint(0, span))
        if d.weekday() < 6:
            return d
    return start


def generate_team(team: str) -> list[dict]:
    squad = [p[0] for p in PLAYERS if p[1] == team]
    rows: list[dict] = []

    # Round-robin-ish schedule: every pair has a chance to meet, close pairs more often
    # (ladder challenges cluster among neighbours), plus a few repeat meetings.
    late_counts: dict[str, int] = {name: 0 for name in LATE_JOINERS}

    for i, a in enumerate(squad):
        for b in squad[i + 1 :]:
            closeness = abs(BY_NAME[a][4] - BY_NAME[b][4])
            # Near-neighbours on the ladder meet more often than distant ones.
            n = 2 if closeness < 0.30 else (1 if closeness < 0.75 else (1 if random.random() < 0.55 else 0))

            # A player who joined in the back half has only had time for a couple of
            # matches. Capping them here is what leaves them under the three-match
            # minimum, so the dashboard has a genuinely provisional rating to show.
            late = [p for p in (a, b) if p in LATE_JOINERS]
            if late:
                if any(late_counts[p] >= 2 for p in late):
                    continue
                n = min(n, 1)

            for _ in range(n):
                late_only = bool(late)
                start = MOVEMENT_CUTOFF + timedelta(days=3) if late_only else SEASON_START
                when = random_date(start, SEASON_END)
                for p in late:
                    late_counts[p] += 1

                # The sheet's first column is the challenger; on a ladder that is
                # usually the weaker player calling out the stronger one.
                if BY_NAME[a][4] < BY_NAME[b][4]:
                    challenger, defender = a, b
                else:
                    challenger, defender = b, a
                if random.random() < 0.25:
                    challenger, defender = defender, challenger

                rows.append(
                    {
                        "Date": when.isoformat(),
                        "Team": team,
                        "Person 1": challenger,
                        "Person 2": defender,
                        "Score": play_match(challenger, defender, when),
                        "Status": "Verified",
                        "Notes": "",
                    }
                )

    rows.sort(key=lambda r: r["Date"])
    return rows


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    rows = generate_team("Boys") + generate_team("Girls")
    rows.sort(key=lambda r: (r["Date"], r["Team"]))

    # A couple of very recent results left awaiting coach verification, so the
    # verification queue and the "pending" path are visible in the demo.
    for r in rows[-3:]:
        r["Status"] = "Pending"
    rows[-1]["Notes"] = "Court 3, finished after dark"

    matches_path = OUT / "demo-matches.csv"
    with matches_path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["Date", "Team", "Person 1", "Person 2", "Score", "Status", "Notes"])
        w.writeheader()
        w.writerows(rows)

    roster_path = OUT / "demo-roster.csv"
    with roster_path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["Name", "Team", "Grade", "Division", "Status"])
        for name, team, grade, division, _, _, status in PLAYERS:
            w.writerow([name, team, grade, division, status])

    played = sum(1 for _ in rows)
    print(f"Wrote {matches_path.name}: {played} matches")
    print(f"Wrote {roster_path.name}: {len(PLAYERS)} players")

    counts: dict[str, int] = {}
    for r in rows:
        for key in ("Person 1", "Person 2"):
            counts[r[key]] = counts.get(r[key], 0) + 1
    thin = {n: c for n, c in counts.items() if c < 3}
    print("Matches per player:", dict(sorted(counts.items(), key=lambda kv: -kv[1])))
    if thin:
        print("Provisional (under 3 matches):", thin)


if __name__ == "__main__":
    main()
