/**
 * Leaders Spotlight metrics (PRD 6.2).
 *
 * Every leaderboard here resolves ties deterministically and reports the full tied set
 * rather than silently picking one player - "Most Wins" showing one name when two players
 * are level is the kind of small unfairness that makes a team stop trusting a board.
 */

import type { StandingRow } from './types';

export interface LeaderEntry {
  key: string;
  displayName: string;
  rank: number;
  value: number;
  /** Rendered under the value, e.g. "12-3 record". */
  detail: string;
  /** True when at least one other player shares this exact value. */
  tied: boolean;
}

export interface Leaders {
  topThree: StandingRow[];
  mostWins: LeaderEntry[];
  longestStreak: LeaderEntry[];
  topClimber: LeaderEntry[];
}

/** Top of the ladder - the spotlight cards (PRD 6.2). */
export function topThree(standings: StandingRow[]): StandingRow[] {
  return standings.slice(0, 3);
}

function pickLeaders(
  standings: StandingRow[],
  value: (row: StandingRow) => number | null,
  detail: (row: StandingRow) => string,
  limit: number,
): LeaderEntry[] {
  const scored = standings
    .map((row) => ({ row, v: value(row) }))
    .filter((x): x is { row: StandingRow; v: number } => x.v !== null && x.v > 0)
    .sort((a, b) => b.v - a.v || a.row.rank - b.row.rank);

  if (scored.length === 0) return [];

  const counts = new Map<number, number>();
  for (const s of scored) counts.set(s.v, (counts.get(s.v) ?? 0) + 1);

  return scored.slice(0, limit).map(({ row, v }) => ({
    key: row.key,
    displayName: row.displayName,
    rank: row.rank,
    value: v,
    detail: detail(row),
    tied: (counts.get(v) ?? 0) > 1,
  }));
}

/** Most Wins: overall challenge match wins (PRD 6.2). */
export function mostWins(standings: StandingRow[], limit = 3): LeaderEntry[] {
  return pickLeaders(
    standings,
    (r) => r.record.wins,
    (r) => r.record.wins + '-' + r.record.losses + ' record',
    limit,
  );
}

/**
 * Longest Active Streak: consecutive victories, still running (PRD 6.2).
 * A player who has since lost is not on an active streak, so only positive current
 * streaks qualify - which is what "Active" means here.
 */
export function longestActiveStreak(standings: StandingRow[], limit = 3): LeaderEntry[] {
  return pickLeaders(
    standings,
    (r) => (r.streak.current > 0 ? r.streak.current : null),
    (r) => r.streak.current + ' in a row',
    limit,
  );
}

/**
 * Top Climber: highest net position gain over the movement window (PRD 6.2, 30 days).
 * Returns an empty list when the sheet has no dates, since without them there is no
 * history to measure movement against.
 */
export function topClimber(standings: StandingRow[], windowDays: number, limit = 3): LeaderEntry[] {
  return pickLeaders(
    standings,
    (r) => (r.movement !== null && r.movement > 0 ? r.movement : null),
    (r) =>
      'Up ' +
      r.movement +
      ' spot' +
      (r.movement === 1 ? '' : 's') +
      ' in ' +
      windowDays +
      ' days',
    limit,
  );
}

export function computeLeaders(standings: StandingRow[], windowDays: number): Leaders {
  return {
    topThree: topThree(standings),
    mostWins: mostWins(standings),
    longestStreak: longestActiveStreak(standings),
    topClimber: topClimber(standings, windowDays),
  };
}
