/**
 * Ladder construction: turning matches + roster into an ordered standings table.
 *
 * Two modes, both grounded in how USTA ladders actually run:
 *
 *   RATING MODE (default)
 *     Order is derived from the NTRP-style rating in rating.ts. This is the mode that
 *     works with a bare results sheet like the supplied sample, which carries no ladder
 *     positions at all - there is nothing to "move" people up and down from, so position
 *     has to be computed from the results themselves.
 *
 *   CHALLENGE MODE
 *     The classic ladder. The coach supplies starting positions on a Roster tab, and
 *     challenge results are replayed in chronological order: when a challenger beats
 *     someone above them they take that player's position and everyone in between slides
 *     down one (DEV-301). Unseeded players are appended below the seeded block, ordered
 *     by rating.
 *
 * Ties are broken with the USTA league standings sequence, and the final tiebreak is
 * alphabetical so the ladder is fully deterministic - the same sheet must always produce
 * the same board for every teammate viewing it.
 */

import { computeRatings, type PlayerRating } from './rating';
import {
  computeStats,
  gamesWonPct,
  headToHead,
  sortChronologically,
  winPct,
  type PlayerStats,
} from './stats';
import type {
  DataIssue,
  DisplayStatus,
  LadderConfig,
  LadderResult,
  Match,
  RosterEntry,
  StandingRow,
  TeamId,
} from './types';

const RATING_TIE_EPSILON = 1e-9;

export interface BuildLadderInput {
  matches: Match[];
  roster: Map<string, RosterEntry>;
  displayNames: Map<string, string>;
  config: LadderConfig;
  /** Keys with an open challenge, for the "Challenge Pending" badge (AC-1.2.3). */
  pendingChallengeKeys?: Set<string>;
  /** Overrides "today" so the dashboard is testable and reproducible. */
  now?: Date;
}

/** Only matches that should count toward the live ladder (PRD 8 / AC-2.2.2). */
export function countableMatches(matches: Match[], config: LadderConfig): Match[] {
  return matches.filter((m) => {
    if (m.approval === 'Rejected') return false;
    if (m.approval === 'Pending' && !config.countPendingMatches) return false;
    return true;
  });
}

/**
 * Order players by rating, then the USTA standings tiebreak sequence.
 *
 * Head-to-head is consulted only when ratings are numerically tied, which is the
 * situation it is meant for. (Head-to-head is not transitive across three or more
 * players, so using it more broadly could make the sort order depend on input order -
 * unacceptable when every teammate must see an identical board.)
 */
export function compareForRank(
  a: string,
  b: string,
  ratings: Map<string, PlayerRating>,
  stats: Map<string, PlayerStats>,
  displayNames: Map<string, string>,
): number {
  const ra = ratings.get(a)?.rating ?? -Infinity;
  const rb = ratings.get(b)?.rating ?? -Infinity;
  if (Math.abs(ra - rb) > RATING_TIE_EPSILON) return rb - ra;

  // 1. Head-to-head between exactly these two players.
  const h2h = headToHead(stats, a, b);
  if (h2h !== 0) return -h2h;

  const sa = stats.get(a);
  const sb = stats.get(b);

  // 2. Win percentage.
  const wa = sa ? winPct(sa.record) : 0;
  const wb = sb ? winPct(sb.record) : 0;
  if (wa !== wb) return wb - wa;

  // 3. Games-won percentage.
  const ga = sa ? gamesWonPct(sa.record) : 0;
  const gb = sb ? gamesWonPct(sb.record) : 0;
  if (ga !== gb) return gb - ga;

  // 4. Total wins, then matches played (more evidence ranks higher).
  const winsA = sa?.record.wins ?? 0;
  const winsB = sb?.record.wins ?? 0;
  if (winsA !== winsB) return winsB - winsA;

  const playedA = sa?.record.matches ?? 0;
  const playedB = sb?.record.matches ?? 0;
  if (playedA !== playedB) return playedB - playedA;

  // 5. Alphabetical - guarantees a deterministic board.
  const na = displayNames.get(a) ?? a;
  const nb = displayNames.get(b) ?? b;
  return na.localeCompare(nb);
}

/**
 * Apply one challenge result to a ladder order (DEV-301).
 *
 * When the challenger (below the defender) wins, they take the defender's position and
 * the defender plus everyone in between slides down exactly one place. Any other outcome
 * leaves the ladder unchanged - including a "challenge" by someone already ranked above
 * the defender, which is not a ladder challenge at all.
 *
 * Returns a new array; the input is not mutated.
 */
export function applyChallengeResult(
  order: string[],
  challenger: string,
  defender: string,
  challengerWon: boolean,
): string[] {
  if (!challengerWon) return order;

  const ci = order.indexOf(challenger);
  const di = order.indexOf(defender);
  if (ci === -1 || di === -1) return order;
  if (ci <= di) return order; // challenger was not below the defender

  const next = order.slice();
  next.splice(ci, 1);
  next.splice(di, 0, challenger);
  return next;
}

/** Seed the challenge-mode ladder: explicit seeds first (in order), then the rest by rating. */
function seedOrder(
  players: string[],
  roster: Map<string, RosterEntry>,
  ratings: Map<string, PlayerRating>,
  stats: Map<string, PlayerStats>,
  displayNames: Map<string, string>,
): string[] {
  const seeded = players
    .filter((p) => roster.get(p)?.seedRank != null)
    .sort((a, b) => {
      const sa = roster.get(a)!.seedRank!;
      const sb = roster.get(b)!.seedRank!;
      if (sa !== sb) return sa - sb;
      return compareForRank(a, b, ratings, stats, displayNames);
    });

  const unseeded = players
    .filter((p) => roster.get(p)?.seedRank == null)
    .sort((a, b) => compareForRank(a, b, ratings, stats, displayNames));

  return [...seeded, ...unseeded];
}

/** Replay every countable match over the seeded order, applying ladder movement rules. */
function challengeModeOrder(
  players: string[],
  matches: Match[],
  roster: Map<string, RosterEntry>,
  ratings: Map<string, PlayerRating>,
  stats: Map<string, PlayerStats>,
  displayNames: Map<string, string>,
): string[] {
  let order = seedOrder(players, roster, ratings, stats, displayNames);
  for (const m of sortChronologically(matches)) {
    // playerA is the challenger by the sheet's column convention.
    order = applyChallengeResult(order, m.playerA, m.playerB, m.winner === 'a');
  }
  return order;
}

function orderPlayers(
  players: string[],
  matches: Match[],
  input: BuildLadderInput,
  ratings: Map<string, PlayerRating>,
  stats: Map<string, PlayerStats>,
): string[] {
  if (input.config.ladderMode === 'challenge') {
    return challengeModeOrder(players, matches, input.roster, ratings, stats, input.displayNames);
  }
  return [...players].sort((a, b) => compareForRank(a, b, ratings, stats, input.displayNames));
}

function displayStatusFor(
  key: string,
  entry: RosterEntry | undefined,
  pending: Set<string>,
): DisplayStatus {
  if (entry?.activeStatus === 'Injured') return 'Injury Hold';
  if (entry?.activeStatus === 'Inactive') return 'Inactive';
  if (pending.has(key)) return 'Challenge Pending';
  return 'Available';
}

/**
 * Reconstruct the ladder order as it stood `days` ago, so movement arrows reflect a real
 * historical position rather than a stored guess (AC-1.2.2).
 *
 * When the sheet has no dates there is no history to reconstruct, so this returns null
 * and the UI shows no arrows rather than inventing movement.
 */
export function historicalOrder(
  matches: Match[],
  input: BuildLadderInput,
  days: number,
): Map<string, number> | null {
  const dated = matches.filter((m) => m.date !== null);
  if (dated.length === 0) return null;

  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - days * 86_400_000);

  const past = matches.filter((m) => m.date !== null && m.date.getTime() <= cutoff.getTime());
  if (past.length === 0) return null;

  const ratings = computeRatings({ matches: past, config: input.config, now: cutoff }).ratings;
  const stats = computeStats(past);
  const players = [...new Set(past.flatMap((m) => [m.playerA, m.playerB]))];
  const order = orderPlayers(players, past, input, ratings, stats);

  const ranks = new Map<string, number>();
  order.forEach((key, i) => ranks.set(key, i + 1));
  return ranks;
}

/**
 * Build a complete standings table for one team.
 *
 * Every player who appears in a countable match is included, plus every rostered player
 * (so a coach's full squad shows even before anyone has played).
 */
export function buildLadder(input: BuildLadderInput): LadderResult {
  const config = input.config;
  const issues: DataIssue[] = [];
  const matches = countableMatches(input.matches, config);

  const played = new Set<string>();
  for (const m of matches) {
    played.add(m.playerA);
    played.add(m.playerB);
  }
  const players = [...new Set([...played, ...input.roster.keys()])];

  const ratingResult = computeRatings({ matches, config, now: input.now ?? null });
  const ratings = ratingResult.ratings;
  const stats = computeStats(matches);

  if (!ratingResult.converged && players.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'rating-convergence',
      message:
        'Ratings stopped just short of full convergence after ' +
        ratingResult.iterations +
        ' passes. The order shown is stable but very close results may be provisional.',
    });
  }

  // Players with no results linking them to the rest of the squad cannot be ordered
  // against it by any amount of computation. Say so rather than implying a comparison.
  if (ratingResult.components.length > 1) {
    const isolated = ratingResult.components
      .slice(1)
      .flat()
      .map((k) => input.displayNames.get(k) ?? k);
    issues.push({
      severity: 'warning',
      code: 'disconnected-ladder',
      message:
        'These players have not played anyone connected to the main group, so their position ' +
        'relative to it is not established by the results: ' +
        isolated.join(', ') +
        '. A single cross-group match will fix this.',
    });
  }

  const order = orderPlayers(players, matches, input, ratings, stats);
  const previous = historicalOrder(input.matches, input, config.movementWindowDays);
  const pending = input.pendingChallengeKeys ?? new Set<string>();

  const standings: StandingRow[] = order.map((key, index) => {
    const rank = index + 1;
    const entry = input.roster.get(key);
    const rating = ratings.get(key);
    const stat = stats.get(key);
    const record = stat?.record ?? {
      wins: 0,
      losses: 0,
      matches: 0,
      gamesWon: 0,
      gamesLost: 0,
      setsWon: 0,
      setsLost: 0,
    };
    const previousRank = previous?.get(key) ?? null;

    return {
      key,
      displayName: entry?.displayName ?? input.displayNames.get(key) ?? key,
      team: entry?.team ?? null,
      grade: entry?.grade ?? null,
      division: entry?.division ?? 'Unassigned',
      activeStatus: entry?.activeStatus ?? 'Active',
      displayStatus: displayStatusFor(key, entry, pending),
      avatarUrl: entry?.avatarUrl ?? null,

      rank,
      previousRank,
      movement: previousRank === null ? null : previousRank - rank,

      rating: rating?.rating ?? config.baseRating,
      provisional: rating?.provisional ?? true,
      confidence: rating?.confidence ?? 0,

      record,
      winPct: winPct(record),
      gamesWonPct: gamesWonPct(record),
      streak: stat?.streak ?? { current: 0, longestWin: 0, last5: [] },

      beat: stat ? [...stat.winsAgainst.keys()] : [],
      lostTo: stat ? [...stat.lossesAgainst.keys()] : [],
    };
  });

  return { team: null, standings, matches, issues };
}

// ---------------------------------------------------------------------------
// Team splitting (PRD 6.1: Boys / Girls ladders)
// ---------------------------------------------------------------------------

/**
 * Determine which team a player belongs to. The Roster tab wins; otherwise the team
 * recorded on the player's matches is used.
 */
export function resolveTeams(
  matches: Match[],
  roster: Map<string, RosterEntry>,
): Map<string, TeamId | null> {
  const teams = new Map<string, TeamId | null>();

  for (const [key, entry] of roster) {
    if (entry.team) teams.set(key, entry.team);
  }
  for (const m of matches) {
    if (!m.team) continue;
    if (!teams.has(m.playerA)) teams.set(m.playerA, m.team);
    if (!teams.has(m.playerB)) teams.set(m.playerB, m.team);
  }
  return teams;
}

/** The distinct teams present, ordered Boys, Girls, then anything else alphabetically. */
export function listTeams(teams: Map<string, TeamId | null>): TeamId[] {
  const set = new Set<TeamId>();
  for (const t of teams.values()) if (t) set.add(t);

  const preferred = ['Boys', 'Girls'];
  const rest = [...set].filter((t) => !preferred.includes(t)).sort();
  return [...preferred.filter((t) => set.has(t)), ...rest];
}

/**
 * Restrict matches to one team. A match counts toward a team when it carries that team
 * label, or when both players belong to it.
 */
export function matchesForTeam(
  matches: Match[],
  team: TeamId,
  teams: Map<string, TeamId | null>,
): Match[] {
  return matches.filter((m) => {
    if (m.team) return m.team === team;
    return teams.get(m.playerA) === team && teams.get(m.playerB) === team;
  });
}
