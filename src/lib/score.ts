/**
 * Tennis score parsing and validation.
 *
 * Two input shapes are supported, because coaches use both:
 *
 *  1. Two numeric columns - the shape of the supplied sample sheet:
 *       Person 1 | Person 2 | Person 1 Score | Person 2 Score
 *       Jake     | Marcus   | 6              | 1
 *     Interpreted as the games won by each player in a one-set match.
 *
 *  2. A single score-summary string - the shape the PRD data model uses
 *     (PRD 8: `score_summary (String, e.g. "6-3, 7-5")`):
 *       "6-4, 7-5"          two standard sets
 *       "6-3, 4-6, 10-8"    two sets split, decided by a match tiebreak (AC-2.2.1)
 *       "7-6(5), 6-4"       tiebreak point-scores in parentheses are ignored
 *
 * Validation is deliberately separate from parsing. Parsing extracts whatever
 * structure it can; validation decides whether that structure is a legal completed
 * tennis match. The dashboard runs parsing in lenient mode (so an unusual format still
 * produces a leaderboard, with a warning) while the in-app score-entry form runs strict
 * mode (so a typo like "10-2" is blocked at the source, per TC-2.2.1).
 */

import type { ParsedScore, ScoreFormat, SetScore } from './types';

/** Hyphen, en dash, em dash, minus sign, colon, and the word "to". */
const SEPARATOR = /\s*(?:[-‐-―−:]|\bto\b)\s*/i;

const RETIREMENT =
  /\b(ret(?:ired|\.)?|rtd|conc(?:eded)?|def(?:ault(?:ed)?|\.)?|w\/?o|walkover|inj(?:ury|ured)?)\b/i;

export interface SetValidation {
  valid: boolean;
  format: ScoreFormat;
  reason?: string;
}

/**
 * Is `a`-`b` a legal *completed* tennis set?
 *
 * Accepted formats:
 *   standard       first to 6, win by 2, tiebreak at 6-6   6-0..6-4, 7-5, 7-6
 *   short          first to 4, win by 2, tiebreak at 3-3   4-0..4-3, 5-3, 5-4
 *   proset         first to 8, win by 2, tiebreak at 8-8   8-0..8-6, 9-7, 9-8
 *   matchTiebreak  first to 10, win by 2 - ONLY legal as a deciding set
 *
 * `isDecider` is true only for the final set of a multi-set match whose earlier sets
 * are split - i.e. the set that actually settles the match. This is what makes
 * "6-3, 4-6, 10-8" legal while a bare "10-2" is not: a match tiebreak cannot stand
 * alone as an entire match score (TC-2.2.1 step 1).
 */
export function validateSet(a: number, b: number, isDecider = false): SetValidation {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) {
    return {
      valid: false,
      format: 'unknown',
      reason: 'Set scores must be whole, non-negative numbers.',
    };
  }
  if (a === b) {
    return {
      valid: false,
      format: 'unknown',
      reason: a + '-' + b + ' is tied - a completed set cannot end level.',
    };
  }

  const w = Math.max(a, b);
  const l = Math.min(a, b);

  // Standard set to 6.
  if ((w === 6 && l <= 4) || (w === 7 && (l === 5 || l === 6))) {
    return { valid: true, format: 'standard' };
  }
  // Short set to 4 (common in high-school dual matches and ladder play).
  if ((w === 4 && l <= 3) || (w === 5 && (l === 3 || l === 4))) {
    return { valid: true, format: 'short' };
  }
  // Pro set to 8.
  if ((w === 8 && l <= 6) || (w === 9 && (l === 7 || l === 8))) {
    return { valid: true, format: 'proset' };
  }
  // Match / super tiebreak - deciding sets only.
  if (w >= 10 && w - l >= 2) {
    if (isDecider) return { valid: true, format: 'matchTiebreak' };
    return {
      valid: false,
      format: 'matchTiebreak',
      reason:
        a +
        '-' +
        b +
        ' looks like a match tiebreak. A tiebreak is only valid as the deciding set of a split match (e.g. "6-3, 4-6, 10-8").',
    };
  }

  if (w === 6 && l === 5) {
    return {
      valid: false,
      format: 'standard',
      reason: '6-5 is not a completed set - play continues to 7-5 or 7-6.',
    };
  }
  if (w - l < 2 && w < 10) {
    return {
      valid: false,
      format: 'unknown',
      reason:
        a + '-' + b + ' is not a completed set - a set must be won by two games (or by a tiebreak).',
    };
  }
  return {
    valid: false,
    format: 'unknown',
    reason:
      a +
      '-' +
      b +
      ' is not a recognized tennis set score (expected: to 6, to 4, pro set to 8, or a deciding tiebreak to 10).',
  };
}

/** Strip tiebreak point-scores like the "(5)" in 7-6(5), plus bracketed annotations. */
function stripAnnotations(token: string): string {
  return token
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .trim();
}

/**
 * A set is a "decider" when it is the last set AND the preceding sets are level.
 * Only deciders may legally be match tiebreaks.
 */
function isDeciderIndex(sets: SetScore[], index: number): boolean {
  if (index !== sets.length - 1) return false;
  if (sets.length < 2) return false;
  let a = 0;
  let b = 0;
  for (let i = 0; i < index; i++) {
    const s = sets[i]!;
    if (s.a > s.b) a++;
    else if (s.b > s.a) b++;
  }
  return a === b;
}

function buildResult(sets: SetScore[], raw: string): ParsedScore {
  let gamesA = 0;
  let gamesB = 0;
  let setsA = 0;
  let setsB = 0;

  for (const s of sets) {
    if (s.isMatchTiebreak) {
      // A match tiebreak substitutes for a whole set. Counting its raw points (e.g. 10)
      // as games would swamp the game differential the rating engine relies on, so it
      // contributes a single game to its winner - the convention USTA and UTR both use.
      if (s.a > s.b) gamesA += 1;
      else if (s.b > s.a) gamesB += 1;
    } else {
      gamesA += s.a;
      gamesB += s.b;
    }
    if (s.a > s.b) setsA += 1;
    else if (s.b > s.a) setsB += 1;
  }

  // Sets decide the match; games are the fallback for a single-set / games-only entry.
  let winner: 'a' | 'b' | null = null;
  if (setsA > setsB) winner = 'a';
  else if (setsB > setsA) winner = 'b';
  else if (gamesA > gamesB) winner = 'a';
  else if (gamesB > gamesA) winner = 'b';

  const formats = sets.map((s, i) => validateSet(s.a, s.b, isDeciderIndex(sets, i)).format);

  return { sets, gamesA, gamesB, setsA, setsB, winner, raw, formats };
}

/**
 * Parse a score-summary string such as "6-4, 7-5" or "6-3, 4-6, 10-8".
 * Returns null when no set-shaped token can be found at all.
 */
export function parseScoreString(raw: string): ParsedScore | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;

  const retired = RETIREMENT.test(text);
  const cleaned = text.replace(RETIREMENT, ' ');

  // Split on commas / semicolons / slashes, then on whitespace between set-shaped tokens
  // so that both "6-4, 7-5" and "6-4 7-5" parse identically.
  const tokens = cleaned
    .split(/[,;/|]+/)
    .flatMap((chunk) =>
      chunk.trim().split(/\s+(?=\d+\s*(?:[-‐-―−:]|\bto\b))/i),
    )
    .map(stripAnnotations)
    .filter(Boolean);

  const sets: SetScore[] = [];
  for (const token of tokens) {
    const parts = token.split(SEPARATOR).filter((p) => p !== '');
    if (parts.length !== 2) continue;
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    sets.push({ a, b, isMatchTiebreak: false });
  }

  if (sets.length === 0) return null;

  // Mark deciding-set tiebreaks so their points are not counted as games.
  for (let i = 0; i < sets.length; i++) {
    const s = sets[i]!;
    if (Math.max(s.a, s.b) >= 10 && isDeciderIndex(sets, i)) s.isMatchTiebreak = true;
  }

  const result = buildResult(sets, text);
  if (retired && result.winner === null && result.gamesA !== result.gamesB) {
    // "6-4, 2-1 ret." - whoever was ahead when the opponent retired takes the match.
    result.winner = result.gamesA > result.gamesB ? 'a' : 'b';
  }
  return result;
}

/**
 * Parse the two-numeric-column shape used by the sample sheet, where each column holds
 * the games won by that player in a single-set match.
 */
export function parseGameColumns(aRaw: unknown, bRaw: unknown): ParsedScore | null {
  const aText = String(aRaw ?? '').trim();
  const bText = String(bRaw ?? '').trim();
  if (!aText && !bText) return null;

  // Tolerate a coach pasting a whole summary into the first score column.
  if (SEPARATOR.test(aText) && !bText) return parseScoreString(aText);

  const a = Number(aText);
  const b = Number(bText);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  return buildResult([{ a, b, isMatchTiebreak: false }], aText + '-' + bText);
}

/** Human-readable summary, e.g. "6-4, 7-5". */
export function formatScore(score: ParsedScore): string {
  return score.sets.map((s) => s.a + '-' + s.b).join(', ');
}

/** The same summary written from one player's point of view. */
export function formatScoreFor(score: ParsedScore, perspective: 'a' | 'b'): string {
  return score.sets
    .map((s) => (perspective === 'a' ? s.a + '-' + s.b : s.b + '-' + s.a))
    .join(', ');
}

export interface ScoreValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a parsed score as a completed tennis match.
 *
 * `strict` promotes set-shape problems from warnings to errors. The score-entry form
 * uses strict mode (AC-2.2.1); the sheet importer stays lenient so that an unfamiliar
 * but internally consistent format still ranks, with the anomaly reported to the coach.
 */
export function validateScore(score: ParsedScore, strict: boolean): ScoreValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (score.sets.length === 0) {
    errors.push('No set scores found.');
    return { valid: false, errors, warnings };
  }
  if (score.sets.length > 5) {
    warnings.push(score.sets.length + ' sets recorded - more than a best-of-five match.');
  }

  score.sets.forEach((s, i) => {
    const check = validateSet(s.a, s.b, isDeciderIndex(score.sets, i));
    if (!check.valid) {
      const label = score.sets.length > 1 ? 'Set ' + (i + 1) + ': ' : '';
      const text = label + (check.reason ?? s.a + '-' + s.b + ' is not a valid set.');
      if (strict) errors.push(text);
      else warnings.push(text);
    }
  });

  // A level match can never be scored, in either mode.
  if (score.winner === null) {
    errors.push('The score does not identify a winner - the match is level.');
  }

  // Mixed set formats in one match usually mean a typo (e.g. "6-4, 4-1").
  const distinct = new Set(score.formats.filter((f) => f !== 'unknown' && f !== 'matchTiebreak'));
  if (distinct.size > 1) {
    warnings.push(
      'Mixed set formats in one match (' +
        [...distinct].join(', ') +
        ') - check the score is recorded correctly.',
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}
