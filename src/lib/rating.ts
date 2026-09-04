/**
 * NTRP-style dynamic rating engine.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS, AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 * USTA's National Tennis Rating Program (NTRP) places players on a 1.0-7.0 scale in
 * 0.5 increments, and USTA computes an internal "dynamic" rating that updates after
 * every match from the opponent's rating and the score. The exact coefficients of that
 * algorithm are not published by USTA.
 *
 * This module therefore implements a transparent engine with the same *structure* as
 * dynamic NTRP - the part that is publicly documented and is what makes the system fair:
 *
 *   1. Every match produces a "match rating" for each player, anchored on the
 *      opponent's current rating and adjusted by the game differential. Beating a
 *      stronger player counts for more than beating a weaker one, and the margin of
 *      victory matters, not just the win.
 *   2. A player's rating is the recency-weighted average of their match ratings.
 *   3. A rating is provisional until the player has enough matches to be meaningful
 *      (USTA uses a three-match minimum for a year-end rating).
 *
 * Two honest caveats, surfaced in the UI and in docs/RANKING_RULES.md:
 *
 *   - These are NOT official USTA NTRP ratings and must never be reported as such.
 *     They are computed only from the matches in the coach's sheet.
 *   - Because the sheet contains only intra-team results, the ratings are *relative*.
 *     Nothing in the data fixes the team's absolute level, so the engine anchors the
 *     squad's mean rating at `baseRating` (default 3.5). Only the gaps between players
 *     are meaningful; set `baseRating` to your squad's true average to make the numbers
 *     read realistically.
 *
 * ---------------------------------------------------------------------------
 * THE MATH
 * ---------------------------------------------------------------------------
 * For a match where player p won `gp` games and opponent o won `go`, define the
 * normalized game margin from p's perspective:
 *
 *     m = (gp - go) / (gp + go)          m is in [-1, +1]
 *
 * The match rating p earned is:
 *
 *     matchRating(p) = rating(o) + SPREAD * m
 *
 * SPREAD is calibrated to 1.0 against how NTRP levels play out in practice: players a
 * half-level apart typically produce roughly a 6-2, 6-2 scoreline (m = 0.5, giving a
 * 0.5 rating gap), and a full level apart produces roughly a double bagel (m = 1.0,
 * giving a 1.0 gap). The mapping is linear between those anchors.
 *
 * Because every player's rating depends on their opponents' ratings, and no player has
 * a known starting rating, the system is solved as a fixed point: start everyone at
 * `baseRating` and iterate to convergence with damping. This is the standard way to
 * solve a self-referential rating system, and with damping it is numerically stable.
 * After each sweep the mean is re-anchored, because adding a constant to every rating
 * would otherwise also be a solution.
 */

import type { LadderConfig, Match } from './types';

/** Rating points between players whose games split with margin m = 1.0. See header. */
export const SPREAD = 1.0;

/** NTRP scale bounds. Ratings are clamped here so one freak result cannot escape. */
export const MIN_RATING = 1.0;
export const MAX_RATING = 7.0;

/** Older results still count, but less. 60 days ~ half a high-school season. */
export const RECENCY_HALF_LIFE_DAYS = 60;

const MAX_ITERATIONS = 200;
const CONVERGENCE_EPSILON = 1e-7;
const DAMPING = 0.5;

export interface RatingInput {
  matches: Match[];
  config: Pick<LadderConfig, 'baseRating' | 'minMatchesForRating'>;
  /** Matches after this date are ignored. Used to reconstruct a past ladder. */
  asOf?: Date | null;
  /** Reference point for recency weighting. Defaults to the latest match date. */
  now?: Date | null;
}

export interface PlayerRating {
  key: string;
  rating: number;
  matches: number;
  distinctOpponents: number;
  provisional: boolean;
  /** 0..1 - how much evidence backs this rating. */
  confidence: number;
}

export interface RatingOutput {
  ratings: Map<string, PlayerRating>;
  iterations: number;
  converged: boolean;
  /**
   * Groups of players connected by results. More than one group means the ladder
   * contains players who have never played anyone in the other group, directly or
   * indirectly - their relative order is not determined by the data.
   */
  components: string[][];
}

interface WeightedMatch {
  opponent: string;
  /** Normalized game margin from this player's perspective, in [-1, +1]. */
  margin: number;
  weight: number;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Normalized game margin from A's perspective.
 * Falls back to a set-count margin if a match somehow recorded no games.
 */
export function gameMargin(match: Match): number {
  const { gamesA, gamesB, setsA, setsB } = match.score;
  const totalGames = gamesA + gamesB;
  if (totalGames > 0) return (gamesA - gamesB) / totalGames;
  const totalSets = setsA + setsB;
  if (totalSets > 0) return (setsA - setsB) / totalSets;
  return match.winner === 'a' ? 1 : -1;
}

function recencyWeight(matchDate: Date | null, now: Date | null): number {
  if (!matchDate || !now) return 1; // undated matches are treated as current
  const ageMs = now.getTime() - matchDate.getTime();
  if (ageMs <= 0) return 1;
  const ageDays = ageMs / 86_400_000;
  return Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
}

/** Latest date among the given matches, or null when none are dated. */
export function latestDate(matches: Match[]): Date | null {
  let latest: Date | null = null;
  for (const m of matches) {
    if (m.date && (!latest || m.date > latest)) latest = m.date;
  }
  return latest;
}

/**
 * Find groups of players connected by having played each other (transitively).
 * Uses union-find; the result is sorted for deterministic output.
 */
export function connectedComponents(matches: Match[], players: string[]): string[][] {
  const parent = new Map<string, string>();
  for (const p of players) parent.set(p, p);

  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // Path compression keeps repeated lookups cheap on large rosters.
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };

  for (const m of matches) {
    if (!parent.has(m.playerA) || !parent.has(m.playerB)) continue;
    const ra = find(m.playerA);
    const rb = find(m.playerB);
    if (ra !== rb) parent.set(ra, rb);
  }

  const groups = new Map<string, string[]>();
  for (const p of players) {
    const root = find(p);
    const list = groups.get(root);
    if (list) list.push(p);
    else groups.set(root, [p]);
  }

  return [...groups.values()]
    .map((g) => g.sort())
    .sort((a, b) => b.length - a.length || a[0]!.localeCompare(b[0]!));
}

/**
 * Solve the rating fixed point.
 *
 * The iteration is: each player's target rating is the weighted mean of
 * (opponent rating + SPREAD * margin) across their matches; move each rating a damped
 * step toward its target; re-anchor the mean; repeat until stable.
 */
export function computeRatings(input: RatingInput): RatingOutput {
  const { config } = input;
  const base = config.baseRating;

  const cutoff = input.asOf ?? null;
  const matches = cutoff
    ? input.matches.filter((m) => m.date === null || m.date.getTime() <= cutoff.getTime())
    : input.matches;

  const now = input.now ?? latestDate(matches) ?? cutoff;

  // Build each player's weighted match list once; the iteration then only reads it.
  const perPlayer = new Map<string, WeightedMatch[]>();
  const opponents = new Map<string, Set<string>>();

  const add = (player: string, opponent: string, margin: number, weight: number) => {
    let list = perPlayer.get(player);
    if (!list) {
      list = [];
      perPlayer.set(player, list);
    }
    list.push({ opponent, margin, weight });

    let set = opponents.get(player);
    if (!set) {
      set = new Set();
      opponents.set(player, set);
    }
    set.add(opponent);
  };

  for (const m of matches) {
    const margin = gameMargin(m);
    const weight = recencyWeight(m.date, now);
    add(m.playerA, m.playerB, margin, weight);
    add(m.playerB, m.playerA, -margin, weight);
  }

  const players = [...perPlayer.keys()].sort();
  const ratings = new Map<string, number>();
  for (const p of players) ratings.set(p, base);

  let iterations = 0;
  let converged = false;

  for (; iterations < MAX_ITERATIONS; iterations++) {
    const next = new Map<string, number>();
    let maxDelta = 0;

    for (const player of players) {
      const list = perPlayer.get(player)!;
      let weightSum = 0;
      let ratingSum = 0;

      for (const wm of list) {
        const opponentRating = ratings.get(wm.opponent) ?? base;
        const matchRating = opponentRating + SPREAD * wm.margin;
        ratingSum += matchRating * wm.weight;
        weightSum += wm.weight;
      }

      const current = ratings.get(player)!;
      const target = weightSum > 0 ? ratingSum / weightSum : current;
      const moved = current + DAMPING * (target - current);
      next.set(player, moved);
      maxDelta = Math.max(maxDelta, Math.abs(moved - current));
    }

    // Re-anchor: a uniform shift of every rating is also a fixed point of the update
    // rule above, so without this the whole squad could drift off the NTRP scale.
    if (players.length > 0) {
      let sum = 0;
      for (const p of players) sum += next.get(p)!;
      const shift = base - sum / players.length;
      if (shift !== 0) for (const p of players) next.set(p, next.get(p)! + shift);
    }

    for (const [k, v] of next) ratings.set(k, v);

    if (maxDelta < CONVERGENCE_EPSILON) {
      converged = true;
      iterations++;
      break;
    }
  }

  const result = new Map<string, PlayerRating>();
  for (const player of players) {
    const list = perPlayer.get(player)!;
    const distinct = opponents.get(player)?.size ?? 0;
    const count = list.length;

    // Evidence comes from both volume and variety: three matches against three
    // different opponents says far more than three matches against the same one.
    const volume = Math.min(1, count / Math.max(1, config.minMatchesForRating));
    const variety = Math.min(1, distinct / Math.max(1, config.minMatchesForRating));
    const confidence = clamp(0.5 * volume + 0.5 * variety, 0, 1);

    result.set(player, {
      key: player,
      rating: clamp(ratings.get(player)!, MIN_RATING, MAX_RATING),
      matches: count,
      distinctOpponents: distinct,
      provisional: count < config.minMatchesForRating,
      confidence,
    });
  }

  return {
    ratings: result,
    iterations,
    converged,
    components: connectedComponents(matches, players),
  };
}

/** Round to the nearest published NTRP step (1.0, 1.5, ... 7.0). */
export function toNtrpLevel(rating: number): number {
  return clamp(Math.round(rating * 2) / 2, MIN_RATING, MAX_RATING);
}

/** Display form, e.g. "3.72". Two decimals is the precision the data can support. */
export function formatRating(rating: number): string {
  return rating.toFixed(2);
}
