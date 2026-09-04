/**
 * Core domain types for the RIHS Tennis Ladder Dashboard.
 *
 * Vocabulary note: this project distinguishes three related-but-different numbers.
 *   - rating  : a continuous NTRP-style skill estimate (1.0 - 7.0). Derived from results.
 *   - rank    : the player's integer ladder position (1 = top of the ladder).
 *   - record  : raw wins/losses/games. Never used directly for ordering, only for tiebreaks.
 */

export type TeamId = string;

/** PRD 8: PLAYER ENTITY.  `Novice` is the PRD's term; the user stories say `JV`. Both accepted. */
export type Division = 'Varsity' | 'JV' | 'Novice' | 'Unassigned';

export type ActiveStatus = 'Active' | 'Injured' | 'Inactive';

/** AC-1.2.3 - the badge actually rendered in the standings table. */
export type DisplayStatus = 'Available' | 'Challenge Pending' | 'Injury Hold' | 'Inactive';

export type GradeLevel = 9 | 10 | 11 | 12 | null;

/** One parsed set within a match, e.g. `{ a: 6, b: 4 }` for a 6-4 set won by player A. */
export interface SetScore {
  a: number;
  b: number;
  /** True when this set was decided by a match/super tiebreak (e.g. 10-8) rather than games. */
  isMatchTiebreak: boolean;
}

export type ScoreFormat =
  | 'standard' // first to 6, win by 2, tiebreak at 6-6  -> 6-0..6-4, 7-5, 7-6
  | 'short' // first to 4, win by 2, tiebreak at 3-3  -> 4-0..4-2, 5-3, 5-4, 4-3(tb)
  | 'proset' // first to 8, win by 2, tiebreak at 8-8  -> 8-0..8-6, 9-7, 9-8
  | 'matchTiebreak' // 10+ point deciding tiebreak, win by 2
  | 'unknown';

export interface ParsedScore {
  sets: SetScore[];
  /** Total games won across all non-match-tiebreak sets. Match tiebreaks count as 1 game. */
  gamesA: number;
  gamesB: number;
  setsA: number;
  setsB: number;
  /** 'a' | 'b' | null. Null means the result could not be decided (tie / unparseable). */
  winner: 'a' | 'b' | null;
  /** Original text as supplied, for display and for coach troubleshooting. */
  raw: string;
  formats: ScoreFormat[];
}

export type IssueSeverity = 'error' | 'warning';

/**
 * A data-quality finding tied to a specific source row. The dashboard never silently
 * discards or silently "fixes" a row - every deviation surfaces in the Data Health panel.
 */
export interface DataIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  /** 1-based row number as it appears in the coach's Google Sheet (header = row 1). */
  sheetRow?: number;
  context?: string;
}

/** A single match after parsing and validation. */
export interface Match {
  id: string;
  sheetRow: number;
  playerA: string; // normalized key
  playerB: string; // normalized key
  displayA: string;
  displayB: string;
  score: ParsedScore;
  /** 'a' | 'b'. Matches with no decidable winner are never promoted to a Match. */
  winner: 'a' | 'b';
  date: Date | null;
  team: TeamId | null;
  /** PRD 8 / AC-2.2.2: only Verified matches affect the live ladder. */
  approval: ApprovalStatus;
  /** True when this match was a formal ladder challenge (challenger = playerA). */
  isChallenge: boolean;
  notes?: string;
}

export type ApprovalStatus = 'Pending' | 'Verified' | 'Rejected';

/** Roster metadata, optionally supplied by the coach on a `Roster` tab. */
export interface RosterEntry {
  key: string;
  displayName: string;
  team: TeamId | null;
  grade: GradeLevel;
  division: Division;
  activeStatus: ActiveStatus;
  /** Optional coach-assigned starting ladder position for Challenge Ladder mode. */
  seedRank: number | null;
  avatarUrl: string | null;
  sheetRow?: number;
}

export interface PlayerRecord {
  wins: number;
  losses: number;
  matches: number;
  gamesWon: number;
  gamesLost: number;
  setsWon: number;
  setsLost: number;
}

export interface StreakInfo {
  /** Positive = consecutive wins, negative = consecutive losses, 0 = no matches. */
  current: number;
  longestWin: number;
  /** Most recent results, newest last. */
  last5: Array<'W' | 'L'>;
}

export interface StandingRow {
  key: string;
  displayName: string;
  team: TeamId | null;
  grade: GradeLevel;
  division: Division;
  activeStatus: ActiveStatus;
  displayStatus: DisplayStatus;
  avatarUrl: string | null;

  rank: number;
  /** Rank as of `movementWindowDays` ago; null when the player had no rank then. */
  previousRank: number | null;
  /** previousRank - rank. Positive = climbed. Null when previousRank is null. */
  movement: number | null;

  rating: number;
  /** True until the player meets the minimum-match threshold (USTA uses 3). */
  provisional: boolean;
  /** 0..1 - how much match evidence backs this rating. Drives the confidence pip. */
  confidence: number;

  record: PlayerRecord;
  winPct: number;
  gamesWonPct: number;
  streak: StreakInfo;

  /** Ordered keys of players this player has beaten, for head-to-head tiebreak display. */
  beat: string[];
  lostTo: string[];
}

export interface LadderConfig {
  /** Max spots ahead a player may challenge (PRD 6.3 / AC-2.1.1 -> 3). */
  challengeRange: number;
  /** Days a pair must wait before rematching. USTA ladders commonly use 7-14. */
  coolingOffDays: number;
  /** Matches required before a rating is considered established (USTA year-end uses 3). */
  minMatchesForRating: number;
  /** Window used to compute the movement arrows and Top Climber (PRD 6.2 -> 30 days). */
  movementWindowDays: number;
  /** 'rating' derives the ladder from results; 'challenge' replays challenges over seeds. */
  ladderMode: 'rating' | 'challenge';
  /** Starting NTRP value for a player with no matches. */
  baseRating: number;
  /** Only count Verified matches, or count Pending ones too (useful mid-season). */
  countPendingMatches: boolean;
  /** Reject scores that are not legal completed tennis sets. */
  strictScoreValidation: boolean;
}

export const DEFAULT_LADDER_CONFIG: LadderConfig = {
  challengeRange: 3,
  coolingOffDays: 7,
  minMatchesForRating: 3,
  movementWindowDays: 30,
  ladderMode: 'rating',
  baseRating: 3.5,
  countPendingMatches: true,
  strictScoreValidation: false,
};

export interface LadderResult {
  team: TeamId | null;
  standings: StandingRow[];
  matches: Match[];
  issues: DataIssue[];
}
