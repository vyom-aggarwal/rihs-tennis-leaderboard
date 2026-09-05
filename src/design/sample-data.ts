/**
 * Hand-authored sample data for the draw-sheet leaderboard design review.
 *
 * This is NOT wired to the real ranking engine (src/lib) - these numbers are typed
 * against the real StandingRow shape so the component can be dropped into the live
 * app later with zero prop changes, but the values themselves are made up to
 * demonstrate specific states: ties, provisional players, movement in every
 * direction, and an injury hold.
 */

import type { DataIssue, StandingRow } from '../lib/types';
import type { MatchLogEntry } from './DrawSheetLeaderboard';

function row(partial: {
  key: string;
  name: string;
  grade: 9 | 10 | 11 | 12;
  division: 'Varsity' | 'JV';
  rank: number;
  previousRank: number | null;
  rating: number;
  wins: number;
  losses: number;
  gamesWon: number;
  gamesLost: number;
  last5: Array<'W' | 'L'>;
  provisional?: boolean;
  activeStatus?: 'Active' | 'Injured';
}): StandingRow {
  const {
    key, name, grade, division, rank, previousRank, rating,
    wins, losses, gamesWon, gamesLost, last5, provisional, activeStatus,
  } = partial;
  const matches = wins + losses;
  const movement = previousRank === null ? null : previousRank - rank;
  const displayStatus =
    activeStatus === 'Injured' ? 'Injury Hold' : 'Available';
  return {
    key,
    displayName: name,
    team: division === 'Varsity' || division === 'JV' ? null : null,
    grade,
    division,
    activeStatus: activeStatus ?? 'Active',
    displayStatus,
    avatarUrl: null,
    rank,
    previousRank,
    movement,
    rating,
    provisional: Boolean(provisional),
    confidence: Math.min(1, matches / 3),
    record: {
      wins,
      losses,
      matches,
      gamesWon,
      gamesLost,
      setsWon: wins * 2,
      setsLost: losses * 2,
    },
    winPct: matches ? wins / matches : 0,
    gamesWonPct: gamesWon + gamesLost ? gamesWon / (gamesWon + gamesLost) : 0,
    streak: {
      current: last5.length ? (last5[last5.length - 1] === 'W' ? 1 : -1) : 0,
      longestWin: 0,
      last5,
    },
    beat: [],
    lostTo: [],
  };
}

export const BOYS_STANDINGS: StandingRow[] = [
  row({ key: 'jake-whitmore', name: 'Jake Whitmore', grade: 12, division: 'Varsity', rank: 1, previousRank: 1, rating: 4.38, wins: 9, losses: 1, gamesWon: 112, gamesLost: 54, last5: ['W', 'W', 'W', 'L', 'W'] }),
  row({ key: 'ethan-cole', name: 'Ethan Cole', grade: 11, division: 'Varsity', rank: 2, previousRank: 4, rating: 4.21, wins: 8, losses: 3, gamesWon: 108, gamesLost: 71, last5: ['W', 'W', 'L', 'W', 'W'] }),
  row({ key: 'marcus-webb', name: 'Marcus Webb', grade: 11, division: 'Varsity', rank: 3, previousRank: 5, rating: 4.05, wins: 7, losses: 3, gamesWon: 96, gamesLost: 58, last5: ['L', 'W', 'W', 'W', 'W'] }),
  row({ key: 'diego-ramirez', name: 'Diego Ramirez', grade: 10, division: 'Varsity', rank: 3, previousRank: 1, rating: 4.05, wins: 7, losses: 4, gamesWon: 101, gamesLost: 77, last5: ['W', 'L', 'W', 'L', 'W'] }),
  row({ key: 'mike-sullivan', name: 'Mike Sullivan', grade: 12, division: 'Varsity', rank: 5, previousRank: 5, rating: 3.96, wins: 6, losses: 4, gamesWon: 89, gamesLost: 63, last5: ['W', 'W', 'L', 'L', 'W'] }),
  row({ key: 'johnny-park', name: 'Johnny Park', grade: 12, division: 'Varsity', rank: 6, previousRank: 6, rating: 3.88, wins: 6, losses: 5, gamesWon: 94, gamesLost: 88, last5: ['L', 'W', 'W', 'L', 'W'] }),
  row({ key: 'adrian-foster', name: 'Adrian Foster', grade: 10, division: 'JV', rank: 7, previousRank: 9, rating: 3.71, wins: 5, losses: 5, gamesWon: 78, gamesLost: 74, last5: ['W', 'W', 'L', 'W', 'L'] }),
  row({ key: 'pedro-alvarez', name: 'Pedro Alvarez', grade: 11, division: 'JV', rank: 8, previousRank: 6, rating: 3.60, wins: 4, losses: 6, gamesWon: 70, gamesLost: 82, last5: ['L', 'L', 'W', 'L', 'W'] }),
  row({ key: 'ravi-menon', name: 'Ravi Menon', grade: 9, division: 'JV', rank: 9, previousRank: 8, rating: 3.44, wins: 3, losses: 7, gamesWon: 61, gamesLost: 90, last5: ['L', 'L', 'L', 'W', 'L'] }),
  row({ key: 'tyler-brooks', name: 'Tyler Brooks', grade: 9, division: 'JV', rank: 10, previousRank: null, rating: 3.30, wins: 2, losses: 6, gamesWon: 48, gamesLost: 70, last5: ['L', 'L', 'W', 'L', 'L'] }),
  row({ key: 'sam-okafor', name: 'Sam Okafor', grade: 9, division: 'JV', rank: 11, previousRank: null, rating: 3.50, wins: 1, losses: 1, gamesWon: 14, gamesLost: 12, last5: ['W', 'L'], provisional: true }),
  row({ key: 'leo-bianchi', name: 'Leo Bianchi', grade: 9, division: 'JV', rank: 12, previousRank: null, rating: 3.50, wins: 0, losses: 1, gamesWon: 4, gamesLost: 6, last5: ['L'], provisional: true }),
];

export const GIRLS_STANDINGS: StandingRow[] = [
  row({ key: 'maya-lindqvist', name: 'Maya Lindqvist', grade: 11, division: 'Varsity', rank: 1, previousRank: 1, rating: 4.30, wins: 9, losses: 2, gamesWon: 118, gamesLost: 66, last5: ['W', 'W', 'W', 'W', 'L'] }),
  row({ key: 'chloe-bennett', name: 'Chloe Bennett', grade: 12, division: 'Varsity', rank: 2, previousRank: 3, rating: 4.10, wins: 8, losses: 3, gamesWon: 104, gamesLost: 73, last5: ['W', 'L', 'W', 'W', 'W'] }),
  row({ key: 'priya-raman', name: 'Priya Raman', grade: 10, division: 'Varsity', rank: 3, previousRank: 2, rating: 3.95, wins: 7, losses: 4, gamesWon: 97, gamesLost: 80, last5: ['W', 'W', 'L', 'W', 'L'] }),
  row({ key: 'nina-kowalski', name: 'Nina Kowalski', grade: 11, division: 'Varsity', rank: 4, previousRank: 4, rating: 3.80, wins: 6, losses: 5, gamesWon: 90, gamesLost: 84, last5: ['L', 'W', 'W', 'L', 'W'] }),
  row({ key: 'zara-haddad', name: 'Zara Haddad', grade: 9, division: 'JV', rank: 5, previousRank: 7, rating: 3.65, wins: 5, losses: 5, gamesWon: 79, gamesLost: 77, last5: ['W', 'W', 'W', 'L', 'W'] }),
  row({ key: 'ava-thompson', name: 'Ava Thompson', grade: 10, division: 'JV', rank: 6, previousRank: 5, rating: 3.55, wins: 4, losses: 6, gamesWon: 71, gamesLost: 85, last5: ['L', 'W', 'L', 'L', 'W'] }),
  row({ key: 'sofia-ramos', name: 'Sofia Ramos', grade: 12, division: 'Varsity', rank: 7, previousRank: 6, rating: 3.50, wins: 4, losses: 6, gamesWon: 68, gamesLost: 83, last5: ['L', 'L', 'W', 'L', 'W'] }),
  row({ key: 'bella-moreau', name: 'Bella Moreau', grade: 10, division: 'JV', rank: 8, previousRank: 8, rating: 3.40, wins: 3, losses: 7, gamesWon: 60, gamesLost: 89, last5: ['L', 'L', 'L', 'W', 'L'] }),
  row({ key: 'lena-fischer', name: 'Lena Fischer', grade: 11, division: 'JV', rank: 9, previousRank: null, rating: 3.20, wins: 2, losses: 8, gamesWon: 50, gamesLost: 96, last5: ['L', 'L', 'L', 'L', 'W'], activeStatus: 'Injured' }),
  row({ key: 'hana-suzuki', name: 'Hana Suzuki', grade: 9, division: 'JV', rank: 10, previousRank: null, rating: 3.50, wins: 1, losses: 1, gamesWon: 12, gamesLost: 15, last5: ['L', 'W'], provisional: true }),
];

/** Named so the parse-error state can point at a specific, plausible sheet row. */
export const SAMPLE_DATA_ISSUE: DataIssue = {
  severity: 'error',
  code: 'bad-score',
  message: 'Score "6-4, ret." is not a valid set score, so this match was left out of the standings.',
  sheetRow: 34,
  context: 'Diego Ramirez vs. Pedro Alvarez',
};

const OPPONENT_POOL = [
  'M. Webb', 'E. Cole', 'J. Park', 'P. Alvarez', 'R. Menon',
  'D. Ramirez', 'T. Brooks', 'M. Sullivan', 'J. Whitmore', 'A. Foster',
];

/** Builds a plausible match log for a player from their last5 streak, for the tap-to-expand state. */
export function matchLogFor(r: StandingRow): MatchLogEntry[] {
  const days = [2, 5, 9, 13, 18];
  const initials = r.displayName[0] + '. ' + r.displayName.split(' ').slice(-1)[0];
  const pool = OPPONENT_POOL.filter((name) => name !== initials);
  return [...r.streak.last5].reverse().map((result, i) => {
    const opponent = pool[(r.displayName.length + i) % pool.length]!;
    const score = result === 'W' ? '6-4, 6-3' : '4-6, 3-6';
    return {
      date: days[i]! + 'd ago',
      opponent,
      score,
      result,
    };
  });
}
