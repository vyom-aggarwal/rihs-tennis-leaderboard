/**
 * Column detection and row mapping.
 *
 * Coaches do not use a fixed header vocabulary. The supplied sample sheet uses
 * "Person 1 / Person 2 / Person 1 Score / Person 2 Score"; the PRD data model uses
 * "challenger_id / defender_id / score_summary". Both, and the obvious variants in
 * between, must import without the coach editing anything.
 *
 * Detection is scored rather than exact-matched, and every decision it makes is shown
 * back to the coach in the Column Mapping panel where it can be overridden. Auto-detection
 * that cannot be corrected is worse than no auto-detection at all.
 */

import type { OpenChallenge } from './challenge';
import type { CsvTable } from './csv';
import { parseGameColumns, parseScoreString, validateScore } from './score';
import type {
  ActiveStatus,
  ApprovalStatus,
  DataIssue,
  Division,
  GradeLevel,
  Match,
  MatchFormat,
  RosterEntry,
} from './types';

export type MatchField =
  | 'playerA'
  | 'playerB'
  | 'scoreA'
  | 'scoreB'
  | 'scoreSummary'
  | 'winner'
  | 'date'
  | 'team'
  | 'format'
  | 'approval'
  | 'isChallenge'
  | 'notes';

/** Column index for each recognized field; -1 means "not present". */
export type MatchMapping = Record<MatchField, number>;

interface Pattern {
  field: MatchField;
  /** Higher wins when several patterns match the same header. */
  score: number;
  test: (h: string) => boolean;
}

const eq = (...names: string[]) => (h: string) => names.includes(h);
const has = (...parts: string[]) => (h: string) => parts.every((p) => h.includes(p));

/**
 * Ordered by specificity. "person 1 score" must beat "person 1", so score columns are
 * tested with higher weights than the bare name columns they contain as a prefix.
 */
const MATCH_PATTERNS: Pattern[] = [
  // --- Score columns (checked with high weight so they win over name columns) ---
  { field: 'scoreA', score: 100, test: eq('person 1 score', 'player 1 score', 'p1 score', 'score 1', 'games 1', 'winner games') },
  { field: 'scoreB', score: 100, test: eq('person 2 score', 'player 2 score', 'p2 score', 'score 2', 'games 2', 'loser games') },
  { field: 'scoreA', score: 90, test: (h) => /(^|\b)(1|a|one|challenger|home)\b/.test(h) && /(score|games|gms|pts|points)/.test(h) },
  { field: 'scoreB', score: 90, test: (h) => /(^|\b)(2|b|two|defender|away|opponent)\b/.test(h) && /(score|games|gms|pts|points)/.test(h) },

  // --- Full score summary ---
  { field: 'scoreSummary', score: 85, test: eq('score', 'score summary', 'scores', 'result', 'set scores', 'final score', 'match score', 'score_summary') },
  { field: 'scoreSummary', score: 70, test: has('set', 'score') },

  // --- Player name columns ---
  { field: 'playerA', score: 80, test: eq('person 1', 'player 1', 'p1', 'player a', 'challenger', 'home', 'name 1', 'player one') },
  { field: 'playerB', score: 80, test: eq('person 2', 'player 2', 'p2', 'player b', 'defender', 'away', 'opponent', 'name 2', 'player two') },
  // Doubles sheets name sides as pairs or teams.
  { field: 'playerA', score: 80, test: eq('pair 1', 'pair a', 'team 1', 'team a', 'side 1', 'doubles team 1') },
  { field: 'playerB', score: 80, test: eq('pair 2', 'pair b', 'team 2', 'team b', 'side 2', 'doubles team 2') },
  { field: 'playerA', score: 60, test: (h) => /(player|person|name|athlete)/.test(h) && /\b(1|a|one)\b/.test(h) },
  { field: 'playerB', score: 60, test: (h) => /(player|person|name|athlete)/.test(h) && /\b(2|b|two)\b/.test(h) },
  { field: 'playerA', score: 55, test: eq('challenger id', 'challenger name') },
  { field: 'playerB', score: 55, test: eq('defender id', 'defender name') },

  // --- Metadata ---
  { field: 'winner', score: 75, test: eq('winner', 'won by', 'match winner', 'winner id', 'winner name') },
  { field: 'date', score: 75, test: eq('date', 'match date', 'played', 'played on', 'when', 'timestamp', 'match_date', 'day') },
  { field: 'team', score: 75, test: eq('team', 'gender', 'program', 'ladder', 'squad', 'team gender', 'boys girls', 'group') },
  { field: 'approval', score: 75, test: eq('status', 'approval', 'approval status', 'verified', 'coach approval', 'approved') },
  { field: 'format', score: 75, test: eq('format', 'match type', 'type', 'event', 'singles doubles', 'singles or doubles', 'category') },
  { field: 'isChallenge', score: 75, test: eq('challenge', 'is challenge', 'ladder challenge') },
  { field: 'notes', score: 70, test: eq('notes', 'note', 'comment', 'comments', 'remarks', 'court') },
];

export const EMPTY_MATCH_MAPPING: MatchMapping = {
  playerA: -1,
  playerB: -1,
  scoreA: -1,
  scoreB: -1,
  scoreSummary: -1,
  winner: -1,
  date: -1,
  team: -1,
  format: -1,
  approval: -1,
  isChallenge: -1,
  notes: -1,
};

/** Auto-detect which column plays which role. Ties resolve to the leftmost column. */
export function detectMatchMapping(table: CsvTable): MatchMapping {
  const mapping: MatchMapping = { ...EMPTY_MATCH_MAPPING };
  const best: Partial<Record<MatchField, number>> = {};

  table.normalizedHeaders.forEach((header, index) => {
    if (!header) return;
    let winner: { field: MatchField; score: number } | null = null;
    for (const p of MATCH_PATTERNS) {
      if (p.test(header) && (!winner || p.score > winner.score)) {
        winner = { field: p.field, score: p.score };
      }
    }
    if (!winner) return;
    const previous = best[winner.field];
    if (previous === undefined || winner.score > previous) {
      best[winner.field] = winner.score;
      mapping[winner.field] = index;
    }
  });

  // Fallback: an unlabelled sheet whose first two columns are names and next two numbers.
  if (mapping.playerA === -1 && mapping.playerB === -1 && table.rows.length > 0) {
    const first = table.rows[0]!;
    const numeric = first.map((c) => c.trim() !== '' && Number.isFinite(Number(c)));
    if (first.length >= 4 && !numeric[0] && !numeric[1] && numeric[2] && numeric[3]) {
      mapping.playerA = 0;
      mapping.playerB = 1;
      mapping.scoreA = 2;
      mapping.scoreB = 3;
    }
  }

  return mapping;
}

/** Which required fields are still missing? Empty array means the sheet can be imported. */
export function validateMapping(mapping: MatchMapping): string[] {
  const missing: string[] = [];
  if (mapping.playerA === -1) missing.push('the first player name');
  if (mapping.playerB === -1) missing.push('the second player name');
  const hasPairScores = mapping.scoreA !== -1 && mapping.scoreB !== -1;
  if (!hasPairScores && mapping.scoreSummary === -1) {
    missing.push('the score (either two score columns, or one score-summary column)');
  }
  return missing;
}

// ---------------------------------------------------------------------------
// Player name normalization
// ---------------------------------------------------------------------------

/**
 * Canonical key for a player name. Case, extra spaces, and surrounding punctuation are
 * ignored so "jake ", "Jake" and "JAKE" are one person - a very common sheet artifact.
 * Accents are preserved rather than stripped, because they are part of the name.
 */
export function playerKey(name: string): string {
  return String(name ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s'"“”‘’.,]+|[\s'"“”‘’.,]+$/g, '')
    .trim()
    .toLowerCase();
}

export function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === '';
}

/**
 * How much a spelling reads as a written name, used to choose between variants that
 * appear equally often. "Jake" should beat "jake" and "JAKE" on the scoreboard, and a
 * coach typing quickly courtside produces all three in one season.
 */
function spellingQuality(name: string): number {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const titleCase = words.every((w) => /^[\p{Lu}][\p{Ll}'’.-]*$/u.test(w));
  if (titleCase) return 3;
  const allCaps = name === name.toUpperCase() && /\p{Lu}/u.test(name);
  const allLower = name === name.toLowerCase() && /\p{Ll}/u.test(name);
  if (allCaps || allLower) return 0;
  return 1; // mixed case that is not clean title case
}

// ---------------------------------------------------------------------------
// Value coercion
// ---------------------------------------------------------------------------

/** A calendar date, or null when the parts do not name a real day (Feb 30, month 13). */
function calendarDate(year: number, month: number, day: number): Date | null {
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

/**
 * A date typed without a year ("9/3", "Sep 3") means the nearest such day to today, so
 * a December result read in January lands in the right season.
 */
function nearestYear(month: number, day: number, reference: Date): Date | null {
  const year = reference.getFullYear();
  const candidate = calendarDate(year, month, day);
  if (!candidate) return null;
  const halfYear = 183 * 86_400_000;
  const diff = candidate.getTime() - reference.getTime();
  if (diff > halfYear) return calendarDate(year - 1, month, day);
  if (diff < -halfYear) return calendarDate(year + 1, month, day);
  return candidate;
}

/** Google Sheets serial day numbers count from 1899-12-30. */
const SHEETS_EPOCH = { year: 1899, month: 12, day: 30 };

export function parseDate(value: string | undefined, reference: Date = new Date()): Date | null {
  if (isBlank(value)) return null;
  const text = value!.trim();

  // Prefer explicit ISO, which sorts and parses unambiguously.
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // A date cell formatted as a plain number exports as its serial day count. Without
  // this, `new Date("46268")` would read it as the year 46268.
  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Math.floor(Number(text));
    if (serial < 20000 || serial > 80000) return null; // 1954..2119 - anything else is not a date
    return new Date(SHEETS_EPOCH.year, SHEETS_EPOCH.month - 1, SHEETS_EPOCH.day + serial);
  }

  // M/D/YYYY, which is what Google Sheets exports for US locales. A first number above
  // 12 can only be a day, so D/M/YYYY sheets from other locales still read correctly
  // instead of rolling "25/12" over into the following year.
  const slash = text.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?(?![\d/-])/);
  if (slash) {
    let month = Number(slash[1]);
    let day = Number(slash[2]);
    if (month > 12 && day <= 12) [month, day] = [day, month];
    if (!slash[3]) return nearestYear(month, day, reference);
    let year = Number(slash[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    return calendarDate(year, month, day);
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  // Engines fill a missing year with 2001 ("Sep 3" -> 2001-09-03), which would make a
  // current result look decades old.
  if (!/\d{4}/.test(text)) return nearestYear(parsed.getMonth() + 1, parsed.getDate(), reference);
  return parsed;
}

/** Map any of the ways a coach writes a team onto a stable label. */
export function parseTeam(value: string | undefined): string | null {
  if (isBlank(value)) return null;
  const t = value!.trim().toLowerCase();
  if (/^(b|boys?|male|men|mens|boys ladder|boys team)$/.test(t)) return 'Boys';
  if (/^(g|girls?|female|women|womens|girls ladder|girls team)$/.test(t)) return 'Girls';
  return value!.trim();
}

export function parseDivision(value: string | undefined): Division {
  if (isBlank(value)) return 'Unassigned';
  const t = value!.trim().toLowerCase();
  if (/^(v|varsity)$/.test(t)) return 'Varsity';
  if (/^(jv|junior varsity|j\.?v\.?)$/.test(t)) return 'JV';
  if (/^(n|novice)$/.test(t)) return 'Novice';
  return 'Unassigned';
}

export function parseGrade(value: string | undefined): GradeLevel {
  if (isBlank(value)) return null;
  const t = value!.trim().toLowerCase();
  if (/fresh/.test(t)) return 9;
  if (/soph/.test(t)) return 10;
  if (/jun/.test(t)) return 11;
  if (/sen/.test(t)) return 12;
  const n = Number(t.replace(/[^0-9]/g, ''));
  if (n === 9 || n === 10 || n === 11 || n === 12) return n;
  return null;
}

export function parseActiveStatus(value: string | undefined): ActiveStatus {
  if (isBlank(value)) return 'Active';
  const t = value!.trim().toLowerCase();
  // Whole words only: a substring test would put "Active without restrictions" on
  // injury hold because it contains "out".
  if (/\binjur|\bhurt\b|\bhold\b|\bout\b/.test(t)) return 'Injured';
  if (/\binactive\b|\bnot active\b|\bquit\b|\bleft\b|\bremoved\b|\boff\b|\bsuspend/.test(t)) {
    return 'Inactive';
  }
  return 'Active';
}

export function parseApproval(value: string | undefined): ApprovalStatus {
  if (isBlank(value)) return 'Verified'; // no status column => the coach's sheet is the record
  const t = value!.trim().toLowerCase();
  if (/reject|denied|declin|void|invalid|disput|cancel|withdr/.test(t)) return 'Rejected';
  // An unticked "Verified" checkbox exports as FALSE, and "No" in an "Approved" column
  // means exactly that. Neither may count as a verified result.
  if (/^(no|n|false|0|unchecked)$/.test(t) || /\bnot\b/.test(t)) return 'Pending';
  if (/pend|await|review|unverified|submitted|\bnew\b/.test(t)) return 'Pending';
  return 'Verified';
}

function parseBoolish(value: string | undefined): boolean {
  if (isBlank(value)) return false;
  return /^(y|yes|true|1|challenge|ladder challenge|x)$/i.test(value!.trim());
}

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

/** "Doubles", "D", "Mixed doubles" -> doubles; "Singles", "S" -> singles; anything else unknown. */
export function parseFormat(value: string | undefined): MatchFormat | null {
  if (isBlank(value)) return null;
  const t = value!.trim().toLowerCase();
  if (/^(d|dbl|dbls)$/.test(t) || /double/.test(t)) return 'doubles';
  if (/^(s|sgl|sgls)$/.test(t) || /single/.test(t)) return 'singles';
  return null;
}

/**
 * Split a doubles side written as "Jake Whitmore / Marcus Webb" (also "&" or "+").
 * Returns null when the cell names one player, and 'invalid' when it uses a separator
 * but does not name exactly two people.
 */
export function splitPair(name: string): [string, string] | 'invalid' | null {
  if (!/[/&+]/.test(name)) return null;
  const parts = name.split(/\s*[/&+]\s*/).map((p) => p.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1]) return 'invalid';
  return [parts[0], parts[1]];
}

/**
 * Stable key for a doubles pair. Partner order does not matter - "Jake / Marcus" and
 * "Marcus / Jake" are the same pair - and the prefix keeps pair keys from ever colliding
 * with an individual player's key.
 */
export function pairKey(partners: readonly [string, string]): string {
  return 'pair:' + [...partners].sort().join(' + ');
}

/** Which side a Winner cell names: a whole pair, one partner of a pair, or a singles player. */
function winnerSide(
  text: string,
  keyA: string,
  keyB: string,
  partnersA?: [string, string],
  partnersB?: [string, string],
): 'a' | 'b' | null {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (partnersA && partnersB) {
    const pair = splitPair(clean);
    if (Array.isArray(pair)) {
      const key = pairKey([playerKey(pair[0]), playerKey(pair[1])]);
      return key === keyA ? 'a' : key === keyB ? 'b' : null;
    }
    const key = playerKey(clean);
    if (partnersA.includes(key)) return 'a';
    if (partnersB.includes(key)) return 'b';
    return null;
  }
  const key = playerKey(clean);
  return key === keyA ? 'a' : key === keyB ? 'b' : null;
}

// ---------------------------------------------------------------------------
// Match row mapping
// ---------------------------------------------------------------------------

export interface MappedMatches {
  matches: Match[];
  /** Rows naming two players with no score yet - issued challenges awaiting a result. */
  openChallenges: OpenChallenge[];
  issues: DataIssue[];
  /** Display name chosen for each player key (the most frequent spelling seen), and for each pair key. */
  displayNames: Map<string, string>;
  /** Doubles: each pair key's two partner keys, in sorted order. */
  pairPartners: Map<string, [string, string]>;
}

export interface MapMatchesOptions {
  strictScores: boolean;
  now?: Date;
  /** Format for rows with no Format column value - 'doubles' on a dedicated Doubles tab. */
  format?: MatchFormat;
  /** Match id prefix, so rows from two tabs never share an id. Defaults to "r". */
  idPrefix?: string;
  /** Tab name recorded on every issue, when this is not the main match tab. */
  tab?: string;
}

/**
 * Convert raw CSV rows into validated Match objects.
 *
 * Rows that cannot yield a winner are never silently dropped - each one produces a
 * DataIssue that the Data Health panel shows the coach, with its sheet row number.
 *
 * A row is doubles when its Format column says so, when it is on the Doubles tab, or
 * when either side is written as a pair ("Jake / Marcus"); otherwise it is singles.
 */
export function mapMatches(
  table: CsvTable,
  mapping: MatchMapping,
  options: MapMatchesOptions,
): MappedMatches {
  const matches: Match[] = [];
  const openChallenges: OpenChallenge[] = [];
  const issues: DataIssue[] = [];
  const nameCounts = new Map<string, Map<string, number>>();
  const pairPartners = new Map<string, [string, string]>();
  const reference = options.now ?? new Date();

  const cell = (row: string[], index: number): string | undefined =>
    index >= 0 ? row[index] : undefined;

  const noteName = (key: string, display: string) => {
    let counts = nameCounts.get(key);
    if (!counts) {
      counts = new Map();
      nameCounts.set(key, counts);
    }
    counts.set(display, (counts.get(display) ?? 0) + 1);
  };

  table.rows.forEach((row, index) => {
    const sheetRow = table.sheetRowFor(index);
    const rawA = cell(row, mapping.playerA);
    const rawB = cell(row, mapping.playerB);

    if (isBlank(rawA) && isBlank(rawB)) return; // genuinely empty row, nothing to report

    if (isBlank(rawA) || isBlank(rawB)) {
      issues.push({
        severity: 'error',
        code: 'missing-player',
        sheetRow,
        message: 'Row skipped: one of the two player names is blank.',
        context: (rawA ?? '') + ' vs ' + (rawB ?? ''),
      });
      return;
    }

    const displayA = rawA!.replace(/\s+/g, ' ').trim();
    const displayB = rawB!.replace(/\s+/g, ' ').trim();
    const context = displayA + ' vs ' + displayB;

    const sideA = splitPair(displayA);
    const sideB = splitPair(displayB);
    const format: MatchFormat =
      parseFormat(cell(row, mapping.format)) ?? options.format ?? (sideA || sideB ? 'doubles' : 'singles');

    let keyA: string;
    let keyB: string;
    let partnersA: [string, string] | undefined;
    let partnersB: [string, string] | undefined;
    // Every individual spelling on this row, counted toward that player's display name.
    const spellings: Array<[string, string]> = [];

    if (format === 'doubles') {
      if (!Array.isArray(sideA) || !Array.isArray(sideB)) {
        issues.push({
          severity: 'error',
          code: 'doubles-needs-pairs',
          sheetRow,
          message:
            'Row skipped: a doubles match needs two players on each side, written like "Jake Whitmore / Marcus Webb".',
          context,
        });
        return;
      }
      partnersA = [playerKey(sideA[0]), playerKey(sideA[1])];
      partnersB = [playerKey(sideB[0]), playerKey(sideB[1])];
      const everyone = [...partnersA, ...partnersB];
      if (new Set(everyone).size !== everyone.length) {
        issues.push({
          severity: 'error',
          code: 'self-match',
          sheetRow,
          message: 'Row skipped: the same player is listed twice in this doubles match.',
          context,
        });
        return;
      }
      keyA = pairKey(partnersA);
      keyB = pairKey(partnersB);
      pairPartners.set(keyA, [...partnersA].sort() as [string, string]);
      pairPartners.set(keyB, [...partnersB].sort() as [string, string]);
      spellings.push([partnersA[0], sideA[0]], [partnersA[1], sideA[1]], [partnersB[0], sideB[0]], [partnersB[1], sideB[1]]);
    } else {
      if (sideA || sideB) {
        issues.push({
          severity: 'error',
          code: 'singles-has-pair',
          sheetRow,
          message: 'Row skipped: this row is marked Singles but lists two players on one side.',
          context,
        });
        return;
      }
      keyA = playerKey(displayA);
      keyB = playerKey(displayB);
      if (keyA === keyB) {
        issues.push({
          severity: 'error',
          code: 'self-match',
          sheetRow,
          message: 'Row skipped: both columns name the same player.',
          context: displayA,
        });
        return;
      }
      spellings.push([keyA, displayA], [keyB, displayB]);
    }

    const summary = cell(row, mapping.scoreSummary);
    const scoreCellA = cell(row, mapping.scoreA);
    const scoreCellB = cell(row, mapping.scoreB);
    const winnerCell = cell(row, mapping.winner);

    const dateCell = cell(row, mapping.date);
    const date = parseDate(dateCell, reference);
    if (!isBlank(dateCell) && date === null) {
      issues.push({
        severity: 'warning',
        code: 'bad-date',
        sheetRow,
        message: 'Could not read the date "' + dateCell!.trim() + '". This match is treated as undated.',
        context,
      });
    }

    // Two names and no result at all is a challenge that has been issued but not yet
    // played - the only way a read-only sheet can record one. It gives both sides the
    // "Challenge Pending" badge until a score is typed into the same row.
    if (isBlank(summary) && isBlank(scoreCellA) && isBlank(scoreCellB) && isBlank(winnerCell)) {
      if (parseApproval(cell(row, mapping.approval)) !== 'Rejected') {
        for (const [key, spelling] of spellings) noteName(key, spelling);
        openChallenges.push({ challengerKey: keyA, defenderKey: keyB, createdAt: date, sheetRow });
      }
      return;
    }

    // Score: prefer a summary string when present, else the two numeric columns.
    const score = !isBlank(summary)
      ? parseScoreString(summary!)
      : parseGameColumns(scoreCellA, scoreCellB);

    if (!score) {
      issues.push({
        severity: 'error',
        code: 'unparseable-score',
        sheetRow,
        message: 'Row skipped: no score could be read for this match.',
        context,
      });
      return;
    }

    const check = validateScore(score, options.strictScores);
    for (const warning of check.warnings) {
      issues.push({
        severity: 'warning',
        code: 'score-format',
        sheetRow,
        message: warning,
        context: context + ' (' + score.raw + ')',
      });
    }
    if (!check.valid) {
      for (const error of check.errors) {
        issues.push({
          severity: 'error',
          code: 'invalid-score',
          sheetRow,
          message: 'Row skipped: ' + error,
          context: context + ' (' + score.raw + ')',
        });
      }
      return;
    }

    // An explicit Winner column overrides the score, but a disagreement is reported -
    // it almost always means the score columns are the wrong way round.
    let winner = score.winner!;
    if (!isBlank(winnerCell)) {
      const stated = winnerSide(winnerCell!, keyA, keyB, partnersA, partnersB);
      if (stated) {
        if (stated !== winner) {
          issues.push({
            severity: 'warning',
            code: 'winner-mismatch',
            sheetRow,
            message:
              'The Winner column says ' +
              winnerCell!.trim() +
              ' but the score ' +
              score.raw +
              ' favours the other side. Using the Winner column.',
            context,
          });
        }
        winner = stated;
      } else {
        issues.push({
          severity: 'warning',
          code: 'unknown-winner',
          sheetRow,
          message:
            'The Winner column names "' +
            winnerCell!.trim() +
            (format === 'doubles'
              ? '", who is not on either pair in this row. Using the score instead.'
              : '", who is not one of the two players in this row. Using the score instead.'),
          context,
        });
      }
    }

    // A result cannot have been played in the future; this is nearly always a mistyped
    // year, which would otherwise distort recency weighting and the movement arrows.
    if (date && date.getTime() - reference.getTime() > 86_400_000) {
      issues.push({
        severity: 'warning',
        code: 'future-date',
        sheetRow,
        message:
          'The date "' + dateCell!.trim() + '" is in the future - check the year. The match still counts.',
        context,
      });
    }

    for (const [key, spelling] of spellings) noteName(key, spelling);

    matches.push({
      id: (options.idPrefix ?? 'r') + sheetRow,
      sheetRow,
      playerA: keyA,
      playerB: keyB,
      displayA,
      displayB,
      format,
      ...(partnersA && partnersB ? { partnersA, partnersB } : {}),
      score,
      winner,
      date,
      team: parseTeam(cell(row, mapping.team)),
      approval: parseApproval(cell(row, mapping.approval)),
      isChallenge: parseBoolish(cell(row, mapping.isChallenge)),
      notes: cell(row, mapping.notes)?.trim() || undefined,
    });
  });

  // Pick each player's display name: most frequent spelling wins, then the
  // best-capitalized one, then alphabetical so the choice is always deterministic.
  const displayNames = new Map<string, string>();
  for (const [key, counts] of nameCounts) {
    const best = [...counts].sort(
      (x, y) =>
        y[1] - x[1] || // most frequently written
        spellingQuality(y[0]) - spellingQuality(x[0]) || // then the one that reads as a name
        x[0].localeCompare(y[0]), // then deterministic
    )[0];
    displayNames.set(key, best ? best[0] : key);
  }
  for (const [key, partners] of pairPartners) {
    displayNames.set(key, partners.map((k) => displayNames.get(k) ?? k).join(' / '));
  }

  const tagged = options.tab ? issues.map((issue) => ({ ...issue, tab: options.tab })) : issues;
  return { matches, openChallenges, issues: tagged, displayNames, pairPartners };
}

// ---------------------------------------------------------------------------
// Optional Roster tab
// ---------------------------------------------------------------------------

export type RosterField = 'name' | 'team' | 'grade' | 'division' | 'status' | 'seedRank' | 'avatar';
export type RosterMapping = Record<RosterField, number>;

const ROSTER_PATTERNS: Array<{ field: RosterField; score: number; test: (h: string) => boolean }> = [
  { field: 'name', score: 90, test: eq('name', 'player', 'player name', 'athlete', 'full name', 'person') },
  { field: 'name', score: 60, test: has('name') },
  { field: 'team', score: 90, test: eq('team', 'gender', 'program', 'ladder', 'squad', 'team gender') },
  { field: 'grade', score: 90, test: eq('grade', 'grade level', 'year', 'class', 'class year', 'grade_level') },
  { field: 'division', score: 90, test: eq('division', 'level', 'varsity', 'varsity jv', 'squad level') },
  { field: 'status', score: 90, test: eq('status', 'active', 'active status', 'availability', 'injury', 'active_status') },
  { field: 'seedRank', score: 90, test: eq('rank', 'seed', 'seed rank', 'starting rank', 'position', 'ladder position', 'current rank') },
  { field: 'avatar', score: 90, test: eq('avatar', 'photo', 'image', 'picture', 'headshot', 'photo url') },
];

export const EMPTY_ROSTER_MAPPING: RosterMapping = {
  name: -1,
  team: -1,
  grade: -1,
  division: -1,
  status: -1,
  seedRank: -1,
  avatar: -1,
};

export function detectRosterMapping(table: CsvTable): RosterMapping {
  const mapping: RosterMapping = { ...EMPTY_ROSTER_MAPPING };
  const best: Partial<Record<RosterField, number>> = {};

  table.normalizedHeaders.forEach((header, index) => {
    if (!header) return;
    let winner: { field: RosterField; score: number } | null = null;
    for (const p of ROSTER_PATTERNS) {
      if (p.test(header) && (!winner || p.score > winner.score)) {
        winner = { field: p.field, score: p.score };
      }
    }
    if (!winner) return;
    const previous = best[winner.field];
    if (previous === undefined || winner.score > previous) {
      best[winner.field] = winner.score;
      mapping[winner.field] = index;
    }
  });

  if (mapping.name === -1 && table.headers.length > 0) mapping.name = 0;
  return mapping;
}

export function mapRoster(
  table: CsvTable,
  mapping: RosterMapping,
): { entries: RosterEntry[]; issues: DataIssue[] } {
  const entries: RosterEntry[] = [];
  const issues: DataIssue[] = [];
  const seen = new Set<string>();

  const cell = (row: string[], index: number): string | undefined =>
    index >= 0 ? row[index] : undefined;

  table.rows.forEach((row, index) => {
    const sheetRow = table.sheetRowFor(index);
    const rawName = cell(row, mapping.name);
    if (isBlank(rawName)) return;

    const displayName = rawName!.replace(/\s+/g, ' ').trim();
    const key = playerKey(displayName);

    if (seen.has(key)) {
      issues.push({
        severity: 'warning',
        code: 'duplicate-roster',
        sheetRow,
        message: 'Duplicate roster entry for "' + displayName + '". The first entry is used.',
      });
      return;
    }
    seen.add(key);

    const seedRaw = cell(row, mapping.seedRank);
    const seedNum = isBlank(seedRaw) ? NaN : Number(seedRaw!.trim());

    entries.push({
      key,
      displayName,
      team: parseTeam(cell(row, mapping.team)),
      grade: parseGrade(cell(row, mapping.grade)),
      division: parseDivision(cell(row, mapping.division)),
      activeStatus: parseActiveStatus(cell(row, mapping.status)),
      seedRank: Number.isFinite(seedNum) && seedNum > 0 ? seedNum : null,
      avatarUrl: isBlank(cell(row, mapping.avatar)) ? null : cell(row, mapping.avatar)!.trim(),
      sheetRow,
    });
  });

  return { entries, issues };
}
