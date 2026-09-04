/**
 * Win/loss records, streaks, and head-to-head - the numbers behind the leaderboards in
 * PRD 6.2 (Most Wins, Longest Active Streak) and the standings tiebreakers.
 *
 * Chronology note: coaches frequently leave the date column out entirely (the supplied
 * sample sheet has no dates). Sheets are appended to over time, so when a match has no
 * date its sheet row order is used as the chronology. That is the only defensible
 * reading of an undated sheet, and it is what makes streaks work on the sample data.
 */

import type { Match, PlayerRecord, StreakInfo } from './types';

export interface PlayerStats {
  key: string;
  record: PlayerRecord;
  streak: StreakInfo;
  /** Opponent key -> wins by this player against them. */
  winsAgainst: Map<string, number>;
  /** Opponent key -> losses by this player to them. */
  lossesAgainst: Map<string, number>;
  lastPlayed: Date | null;
}

export function emptyRecord(): PlayerRecord {
  return { wins: 0, losses: 0, matches: 0, gamesWon: 0, gamesLost: 0, setsWon: 0, setsLost: 0 };
}

/**
 * Chronological order: dated matches by date, undated matches by sheet row.
 * Dated and undated are interleaved by treating an undated match as occurring in its
 * sheet position, which keeps a partially-dated sheet sensible.
 */
export function sortChronologically(matches: Match[]): Match[] {
  return [...matches].sort((a, b) => {
    if (a.date && b.date) {
      const diff = a.date.getTime() - b.date.getTime();
      if (diff !== 0) return diff;
    }
    return a.sheetRow - b.sheetRow;
  });
}

export function computeStats(matches: Match[]): Map<string, PlayerStats> {
  const stats = new Map<string, PlayerStats>();
  const ordered = sortChronologically(matches);
  // Results per player in chronological order, used for streaks after the main pass.
  const sequence = new Map<string, Array<'W' | 'L'>>();

  const ensure = (key: string): PlayerStats => {
    let s = stats.get(key);
    if (!s) {
      s = {
        key,
        record: emptyRecord(),
        streak: { current: 0, longestWin: 0, last5: [] },
        winsAgainst: new Map(),
        lossesAgainst: new Map(),
        lastPlayed: null,
      };
      stats.set(key, s);
      sequence.set(key, []);
    }
    return s;
  };

  const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);

  for (const m of ordered) {
    const a = ensure(m.playerA);
    const b = ensure(m.playerB);
    const { gamesA, gamesB, setsA, setsB } = m.score;

    a.record.matches++;
    b.record.matches++;
    a.record.gamesWon += gamesA;
    a.record.gamesLost += gamesB;
    b.record.gamesWon += gamesB;
    b.record.gamesLost += gamesA;
    a.record.setsWon += setsA;
    a.record.setsLost += setsB;
    b.record.setsWon += setsB;
    b.record.setsLost += setsA;

    if (m.winner === 'a') {
      a.record.wins++;
      b.record.losses++;
      bump(a.winsAgainst, m.playerB);
      bump(b.lossesAgainst, m.playerA);
      sequence.get(m.playerA)!.push('W');
      sequence.get(m.playerB)!.push('L');
    } else {
      b.record.wins++;
      a.record.losses++;
      bump(b.winsAgainst, m.playerA);
      bump(a.lossesAgainst, m.playerB);
      sequence.get(m.playerB)!.push('W');
      sequence.get(m.playerA)!.push('L');
    }

    if (m.date) {
      if (!a.lastPlayed || m.date > a.lastPlayed) a.lastPlayed = m.date;
      if (!b.lastPlayed || m.date > b.lastPlayed) b.lastPlayed = m.date;
    }
  }

  for (const [key, results] of sequence) {
    stats.get(key)!.streak = summarizeStreak(results);
  }

  return stats;
}

/**
 * `current` is positive for consecutive wins, negative for consecutive losses.
 * `longestWin` is the best win run at any point in the season (PRD 6.2).
 */
export function summarizeStreak(results: Array<'W' | 'L'>): StreakInfo {
  let current = 0;
  let longestWin = 0;
  let run = 0;

  for (const r of results) {
    if (r === 'W') {
      run = run > 0 ? run + 1 : 1;
      longestWin = Math.max(longestWin, run);
    } else {
      run = run < 0 ? run - 1 : -1;
    }
    current = run;
  }

  return { current, longestWin, last5: results.slice(-5) };
}

export function winPct(record: PlayerRecord): number {
  return record.matches === 0 ? 0 : record.wins / record.matches;
}

/** Games-won percentage - a standard USTA league standings tiebreaker. */
export function gamesWonPct(record: PlayerRecord): number {
  const total = record.gamesWon + record.gamesLost;
  return total === 0 ? 0 : record.gamesWon / total;
}

export function setsWonPct(record: PlayerRecord): number {
  const total = record.setsWon + record.setsLost;
  return total === 0 ? 0 : record.setsWon / total;
}

/**
 * Head-to-head between two players.
 * Returns > 0 when `a` leads the series, < 0 when `b` leads, 0 when level or unplayed.
 */
export function headToHead(stats: Map<string, PlayerStats>, a: string, b: string): number {
  const sa = stats.get(a);
  if (!sa) return 0;
  const aWins = sa.winsAgainst.get(b) ?? 0;
  const aLosses = sa.lossesAgainst.get(b) ?? 0;
  return aWins - aLosses;
}
