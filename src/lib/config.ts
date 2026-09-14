/**
 * App configuration and URL state.
 *
 * The sheet reference lives in the URL. That is the whole sharing model: the coach sets
 * the app up once, copies the address bar, and sends that one link to the team. Every
 * teammate who opens it reads the same sheet and sees the same ladder, with nothing to
 * install and no account to create.
 *
 * Rule settings and hand-corrected column mappings also live in the URL, so a coach can
 * hand out a link that reads the sheet exactly the way they set it up.
 */

import { EMPTY_MATCH_MAPPING, type MatchField, type MatchMapping } from './schema';
import { DEFAULT_LADDER_CONFIG, type LadderConfig } from './types';

export interface AppState {
  /** Google Sheets doc id, or a publish-to-web id prefixed with "e/". */
  sheetId: string | null;
  /** Tab gid for the matches sheet. */
  gid: string | null;
  /** Optional tab gid for a Roster sheet. */
  rosterGid: string | null;
  /** Optional tab gid for a tab of doubles results. */
  doublesGid: string | null;
  config: LadderConfig;
  /** Coach view unlocked. See the security note in README - this gates UI, not data. */
  coach: boolean;
  /** Seconds between automatic refreshes. */
  refreshSeconds: number;
  /**
   * Columns the coach assigned by hand in Column Mapping. This must travel in the shared
   * link: without it every teammate's browser would re-run auto-detection and fail on
   * exactly the sheet the coach had to fix by hand.
   */
  mapping: Partial<MatchMapping>;
  /**
   * The ladder being viewed - a board id such as "Girls:doubles", or a bare team name from
   * older links. Kept in the address bar, never in shared or published links.
   */
  ladder: string | null;
}

export const DEFAULT_REFRESH_SECONDS = 30;

export const DEFAULT_APP_STATE: AppState = {
  sheetId: null,
  gid: null,
  rosterGid: null,
  doublesGid: null,
  config: { ...DEFAULT_LADDER_CONFIG },
  coach: false,
  refreshSeconds: DEFAULT_REFRESH_SECONDS,
  mapping: {},
  ladder: null,
};

const PARAM = {
  sheet: 'sheet',
  gid: 'gid',
  rosterGid: 'roster',
  doublesGid: 'doubles',
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
  mapping: 'map',
  ladder: 'ladder',
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

const MATCH_FIELDS = Object.keys(EMPTY_MATCH_MAPPING) as MatchField[];

/**
 * Mapping overrides as `field.index` pairs joined by `_`, e.g. `playerA.0_scoreSummary.4`.
 * Those characters are never percent-encoded, so a shared link stays readable.
 */
export function writeMapping(mapping: Partial<MatchMapping>): string {
  return MATCH_FIELDS.filter((field) => mapping[field] !== undefined)
    .map((field) => field + '.' + mapping[field])
    .join('_');
}

export function readMapping(value: string | null): Partial<MatchMapping> {
  const mapping: Partial<MatchMapping> = {};
  if (!value) return mapping;
  for (const pair of value.split('_')) {
    const m = pair.match(/^([A-Za-z]+)\.(-1|\d{1,3})$/);
    if (m && MATCH_FIELDS.includes(m[1] as MatchField)) {
      mapping[m[1] as MatchField] = Number(m[2]);
    }
  }
  return mapping;
}

export function readAppState(search: string): AppState {
  const p = new URLSearchParams(search);
  const d = DEFAULT_LADDER_CONFIG;

  const mode = p.get(PARAM.mode);

  return {
    sheetId: p.get(PARAM.sheet),
    gid: p.get(PARAM.gid),
    rosterGid: p.get(PARAM.rosterGid),
    doublesGid: p.get(PARAM.doublesGid),
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
    mapping: readMapping(p.get(PARAM.mapping)),
    ladder: p.get(PARAM.ladder),
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
  if (state.doublesGid) p.set(PARAM.doublesGid, state.doublesGid);
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

  const mapping = writeMapping(state.mapping);
  if (mapping) p.set(PARAM.mapping, mapping);
  if (state.ladder) p.set(PARAM.ladder, state.ladder);

  // Deliberately not serialized: `coach`. A coach link must not be handed out by
  // accident when the team link is copied from the address bar.
  const query = p.toString();
  return query ? '?' + query : '';
}

/**
 * The link a coach shares with the team: current settings, always read-only. The tab
 * the coach happens to be looking at is left out, so the team link opens on the first
 * ladder rather than on whichever one was open when it was copied.
 */
export function teamShareUrl(state: AppState, origin: string, pathname: string): string {
  return origin + pathname + writeAppState({ ...state, coach: false, ladder: null });
}

/** The coach's own link, which unlocks the admin panel on their device. */
export function coachUrl(state: AppState, origin: string, pathname: string): string {
  const base = writeAppState({ ...state, coach: false, ladder: null });
  return origin + pathname + (base ? base + '&' : '?') + PARAM.coach + '=1';
}

const STORAGE_KEY = 'rihs:last-sheet';

/** Remember the last sheet, with its settings, so a returning coach lands straight on their ladder. */
export function rememberSheet(state: AppState): void {
  try {
    if (!state.sheetId) return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        sheetId: state.sheetId,
        gid: state.gid,
        rosterGid: state.rosterGid,
        query: writeAppState({ ...state, coach: false, ladder: null }),
      }),
    );
  } catch {
    // Private browsing and blocked site data both throw here. Not remembering the
    // sheet is a minor inconvenience, never a reason to break the page.
  }
}

/** The remembered sheet and its settings, or null when there is none. */
export function recallSheet(): AppState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.query === 'string') {
      const state = readAppState(parsed.query);
      if (state.sheetId) return state;
    }
    // Entries saved before settings were remembered hold only the sheet ids.
    if (typeof parsed.sheetId !== 'string') return null;
    return {
      ...DEFAULT_APP_STATE,
      config: { ...DEFAULT_LADDER_CONFIG },
      sheetId: parsed.sheetId,
      gid: typeof parsed.gid === 'string' ? parsed.gid : null,
      rosterGid: typeof parsed.rosterGid === 'string' ? parsed.rosterGid : null,
      doublesGid: null,
    };
  } catch {
    return null;
  }
}
