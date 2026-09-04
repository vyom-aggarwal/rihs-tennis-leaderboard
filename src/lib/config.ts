/**
 * App configuration and URL state.
 *
 * The sheet reference lives in the URL. That is the whole sharing model: the coach sets
 * the app up once, copies the address bar, and sends that one link to the team. Every
 * teammate who opens it reads the same sheet and sees the same ladder, with nothing to
 * install and no account to create.
 *
 * Rule settings also live in the URL so a coach can hand out a link with the team's own
 * challenge range or scoring rules already applied.
 */

import { DEFAULT_LADDER_CONFIG, type LadderConfig } from './types';

export interface AppState {
  /** Google Sheets doc id, or a publish-to-web id prefixed with "e/". */
  sheetId: string | null;
  /** Tab gid for the matches sheet. */
  gid: string | null;
  /** Optional tab gid for a Roster sheet. */
  rosterGid: string | null;
  config: LadderConfig;
  /** Coach view unlocked. See the security note in README - this gates UI, not data. */
  coach: boolean;
  /** Seconds between automatic refreshes. */
  refreshSeconds: number;
}

export const DEFAULT_REFRESH_SECONDS = 30;

export const DEFAULT_APP_STATE: AppState = {
  sheetId: null,
  gid: null,
  rosterGid: null,
  config: { ...DEFAULT_LADDER_CONFIG },
  coach: false,
  refreshSeconds: DEFAULT_REFRESH_SECONDS,
};

const PARAM = {
  sheet: 'sheet',
  gid: 'gid',
  rosterGid: 'roster',
  coach: 'coach',
  refresh: 'refresh',
  challengeRange: 'range',
  coolingOff: 'cool',
  minMatches: 'min',
  movementWindow: 'window',
  mode: 'mode',
  base: 'base',
  pending: 'pending',
  strict: 'strict',
} as const;

function num(value: string | null, fallback: number, lo: number, hi: number): number {
  if (value === null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function bool(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback;
  return value === '1' || value === 'true' || value === 'yes';
}

export function readAppState(search: string): AppState {
  const p = new URLSearchParams(search);
  const d = DEFAULT_LADDER_CONFIG;

  const mode = p.get(PARAM.mode);

  return {
    sheetId: p.get(PARAM.sheet),
    gid: p.get(PARAM.gid),
    rosterGid: p.get(PARAM.rosterGid),
    coach: bool(p.get(PARAM.coach), false),
    refreshSeconds: num(p.get(PARAM.refresh), DEFAULT_REFRESH_SECONDS, 10, 3600),
    config: {
      challengeRange: num(p.get(PARAM.challengeRange), d.challengeRange, 1, 50),
      coolingOffDays: num(p.get(PARAM.coolingOff), d.coolingOffDays, 0, 365),
      minMatchesForRating: num(p.get(PARAM.minMatches), d.minMatchesForRating, 0, 50),
      movementWindowDays: num(p.get(PARAM.movementWindow), d.movementWindowDays, 1, 365),
      ladderMode: mode === 'challenge' ? 'challenge' : 'rating',
      baseRating: num(p.get(PARAM.base), d.baseRating, 1, 7),
      countPendingMatches: bool(p.get(PARAM.pending), d.countPendingMatches),
      strictScoreValidation: bool(p.get(PARAM.strict), d.strictScoreValidation),
    },
  };
}

/**
 * Serialize state back to a query string, omitting anything left at its default so the
 * shared link stays short and readable.
 */
export function writeAppState(state: AppState): string {
  const p = new URLSearchParams();
  const d = DEFAULT_LADDER_CONFIG;
  const c = state.config;

  if (state.sheetId) p.set(PARAM.sheet, state.sheetId);
  if (state.gid) p.set(PARAM.gid, state.gid);
  if (state.rosterGid) p.set(PARAM.rosterGid, state.rosterGid);
  if (state.refreshSeconds !== DEFAULT_REFRESH_SECONDS) {
    p.set(PARAM.refresh, String(state.refreshSeconds));
  }

  if (c.challengeRange !== d.challengeRange) p.set(PARAM.challengeRange, String(c.challengeRange));
  if (c.coolingOffDays !== d.coolingOffDays) p.set(PARAM.coolingOff, String(c.coolingOffDays));
  if (c.minMatchesForRating !== d.minMatchesForRating) p.set(PARAM.minMatches, String(c.minMatchesForRating));
  if (c.movementWindowDays !== d.movementWindowDays) p.set(PARAM.movementWindow, String(c.movementWindowDays));
  if (c.ladderMode !== d.ladderMode) p.set(PARAM.mode, c.ladderMode);
  if (c.baseRating !== d.baseRating) p.set(PARAM.base, String(c.baseRating));
  if (c.countPendingMatches !== d.countPendingMatches) p.set(PARAM.pending, c.countPendingMatches ? '1' : '0');
  if (c.strictScoreValidation !== d.strictScoreValidation) p.set(PARAM.strict, c.strictScoreValidation ? '1' : '0');

  // Deliberately not serialized: `coach`. A coach link must not be handed out by
  // accident when the team link is copied from the address bar.
  const query = p.toString();
  return query ? '?' + query : '';
}

/** The link a coach shares with the team: current settings, always read-only. */
export function teamShareUrl(state: AppState, origin: string, pathname: string): string {
  return origin + pathname + writeAppState({ ...state, coach: false });
}

/** The coach's own link, which unlocks the admin panel on their device. */
export function coachUrl(state: AppState, origin: string, pathname: string): string {
  const base = writeAppState({ ...state, coach: false });
  return origin + pathname + (base ? base + '&' : '?') + PARAM.coach + '=1';
}

const STORAGE_KEY = 'rihs:last-sheet';

/** Remember the last sheet so a returning coach lands straight on their ladder. */
export function rememberSheet(state: AppState): void {
  try {
    if (!state.sheetId) return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ sheetId: state.sheetId, gid: state.gid, rosterGid: state.rosterGid }),
    );
  } catch {
    // Private browsing and blocked site data both throw here. Not remembering the
    // sheet is a minor inconvenience, never a reason to break the page.
  }
}

export function recallSheet(): Pick<AppState, 'sheetId' | 'gid' | 'rosterGid'> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.sheetId !== 'string') return null;
    return {
      sheetId: parsed.sheetId,
      gid: typeof parsed.gid === 'string' ? parsed.gid : null,
      rosterGid: typeof parsed.rosterGid === 'string' ? parsed.rosterGid : null,
    };
  } catch {
    return null;
  }
}
