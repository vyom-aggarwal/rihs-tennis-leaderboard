/**
 * Live sheet polling.
 *
 * "Live" here means: the coach types a result into the Google Sheet and every phone
 * watching the ladder shows it within one refresh interval, with nobody pressing
 * anything. Three things drive a refresh:
 *
 *   1. A timer, every `refreshSeconds` - but only while the page is visible. A tab left
 *      open in the background has nobody looking at it, and a whole team's worth of
 *      forgotten tabs polling Google every 30 seconds is how a sheet gets rate-limited.
 *   2. The tab becoming visible again - phones aggressively freeze background timers,
 *      so a player pulling the app out of their pocket must not see a stale board.
 *   3. The network coming back after an outage.
 *
 * A cached copy renders instantly on load and is then revalidated, which is what keeps
 * repeat visits inside the PRD's 2-second budget on 4G.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchSheetCsv, parseSheetUrl, sheetCacheKey, SheetError, type SheetRef } from '../lib/sheets';

export interface LiveSheetState {
  matchesCsv: string | null;
  rosterCsv: string | null;
  doublesCsv: string | null;
  /** True only until the first copy of the sheet is available, so the UI shows a skeleton once. */
  loading: boolean;
  /** True while a background revalidation is in flight. */
  refreshing: boolean;
  error: SheetError | null;
  /** Set when a roster tab is configured but could not be read. The ladder still loads. */
  rosterError: SheetError | null;
  /** Set when a doubles tab is configured but could not be read. The ladder still loads. */
  doublesError: SheetError | null;
  lastUpdated: Date | null;
  /** True when the rendered data came from cache and has not been revalidated yet. */
  fromCache: boolean;
  refresh: () => void;
}

interface CachedSheet {
  matchesCsv: string;
  rosterCsv: string | null;
  doublesCsv: string | null;
  savedAt: number;
}

/** One loaded copy of the sheet, tagged with the source it was read from. */
interface LoadedSheet {
  source: string;
  matchesCsv: string;
  rosterCsv: string | null;
  doublesCsv: string | null;
  updatedAt: Date;
  fromCache: boolean;
}

interface Failure {
  source: string;
  error: SheetError | null;
  rosterError: SheetError | null;
  doublesError: SheetError | null;
}

interface TabResult {
  csv: string | null;
  error: SheetError | null;
}

/** A visibility change within this long of the last fetch does not trigger another. */
const REFOCUS_DEBOUNCE_MS = 5_000;

function readCache(key: string): CachedSheet | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedSheet>;
    if (typeof parsed.matchesCsv !== 'string' || typeof parsed.savedAt !== 'number') return null;
    return {
      matchesCsv: parsed.matchesCsv,
      rosterCsv: typeof parsed.rosterCsv === 'string' ? parsed.rosterCsv : null,
      doublesCsv: typeof parsed.doublesCsv === 'string' ? parsed.doublesCsv : null,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

function writeCache(key: string, value: CachedSheet): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded, private browsing, or blocked site data. The app works without
    // the cache; it just loses the instant first paint on repeat visits.
  }
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function toSheetError(err: unknown): SheetError {
  if (err instanceof SheetError) return err;
  return new SheetError('network', (err as Error)?.message || 'Could not load the sheet.');
}

export function refFromSheetId(sheetId: string, gid: string | null): SheetRef {
  return sheetId.startsWith('e/')
    ? { docId: '', pubId: sheetId.slice(2), gid }
    : { docId: sheetId, pubId: null, gid };
}

export function useLiveSheet(
  sheetId: string | null,
  gid: string | null,
  rosterGid: string | null,
  doublesGid: string | null,
  refreshSeconds: number,
): LiveSheetState {
  // Everything loaded is tagged with its source, so switching sheets or tabs can never
  // show one sheet's ladder under another's link, even for a single render.
  const source = sheetId ? [sheetId, gid ?? '', rosterGid ?? '', doublesGid ?? ''].join('|') : null;

  const [loaded, setLoaded] = useState<LoadedSheet | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [nonce, setNonce] = useState(0);

  const loadedRef = useRef<LoadedSheet | null>(null);
  // Guards against a slow response from a previous request overwriting a newer one.
  const requestRef = useRef(0);
  const lastFetchRef = useRef(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!sheetId || !source) {
      loadedRef.current = null;
      setLoaded(null);
      setFailure(null);
      setRefreshing(false);
      return;
    }

    const ref = refFromSheetId(sheetId, gid);
    const cacheKey =
      sheetCacheKey(ref) + ':roster=' + (rosterGid ?? 'none') + ':doubles=' + (doublesGid ?? 'none');

    if (loadedRef.current?.source !== source) {
      // A different sheet or tab: paint its cached copy immediately if there is one,
      // then revalidate in the background.
      const cached = readCache(cacheKey);
      const next: LoadedSheet | null = cached
        ? {
            source,
            matchesCsv: cached.matchesCsv,
            rosterCsv: cached.rosterCsv,
            doublesCsv: cached.doublesCsv,
            updatedAt: new Date(cached.savedAt),
            fromCache: true,
          }
        : null;
      loadedRef.current = next;
      setLoaded(next);
      setFailure(null);
    }

    const controller = new AbortController();
    const requestId = ++requestRef.current;
    lastFetchRef.current = Date.now();
    setRefreshing(true);

    // Optional tabs are fetched alongside the matches, not after them, so they cost no
    // extra time on first load. A missing or unreadable optional tab must not take the
    // ladder down with it - the matches tab alone is enough to rank the team.
    const optionalTab = (tabGid: string | null): Promise<TabResult> =>
      tabGid
        ? fetchSheetCsv({ ...ref, gid: tabGid }, { signal: controller.signal }).then(
            (csv): TabResult => ({ csv, error: null }),
            (err: unknown): TabResult => {
              if (isAbort(err)) throw err;
              return { csv: null, error: toSheetError(err) };
            },
          )
        : Promise.resolve({ csv: null, error: null });

    (async () => {
      try {
        const [matchesCsv, roster, doubles] = await Promise.all([
          fetchSheetCsv(ref, { signal: controller.signal }),
          optionalTab(rosterGid),
          optionalTab(doublesGid),
        ]);
        if (requestId !== requestRef.current) return; // superseded by a newer request

        // One failed read of an optional tab should not strip roster details or the
        // doubles ladder off the board until the next poll; keep the last copy that loaded.
        const previous = loadedRef.current?.source === source ? loadedRef.current : null;
        const rosterCsv = roster.csv ?? (roster.error ? (previous?.rosterCsv ?? null) : null);
        const doublesCsv = doubles.csv ?? (doubles.error ? (previous?.doublesCsv ?? null) : null);

        const next: LoadedSheet = {
          source,
          matchesCsv,
          rosterCsv,
          doublesCsv,
          updatedAt: new Date(),
          fromCache: false,
        };
        loadedRef.current = next;
        setLoaded(next);
        setFailure(
          roster.error || doubles.error
            ? { source, error: null, rosterError: roster.error, doublesError: doubles.error }
            : null,
        );
        writeCache(cacheKey, { matchesCsv, rosterCsv, doublesCsv, savedAt: Date.now() });
      } catch (err) {
        if (isAbort(err) || requestId !== requestRef.current) return;
        // Keep showing the last good ladder; surface the error alongside it rather
        // than blanking the board mid-match.
        setFailure((f) => ({
          source,
          error: toSheetError(err),
          rosterError: f?.source === source ? f.rosterError : null,
          doublesError: f?.source === source ? f.doublesError : null,
        }));
      } finally {
        if (requestId === requestRef.current) setRefreshing(false);
      }
    })();

    return () => controller.abort();
  }, [sheetId, gid, rosterGid, doublesGid, source, nonce]);

  // Timer-driven refresh while visible, plus refresh on refocus and reconnect.
  useEffect(() => {
    if (!sheetId) return;
    const id = setInterval(() => {
      if (document.visibilityState !== 'hidden') refresh();
    }, Math.max(10, refreshSeconds) * 1000);

    const onVisible = () => {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - lastFetchRef.current > REFOCUS_DEBOUNCE_MS
      ) {
        refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', refresh);
    };
  }, [sheetId, refreshSeconds, refresh]);

  const current = loaded && loaded.source === source ? loaded : null;
  const currentFailure = failure && failure.source === source ? failure : null;

  return {
    matchesCsv: current?.matchesCsv ?? null,
    rosterCsv: current?.rosterCsv ?? null,
    doublesCsv: current?.doublesCsv ?? null,
    loading: Boolean(source) && !current && !currentFailure?.error,
    refreshing,
    error: currentFailure?.error ?? null,
    rosterError: currentFailure?.rosterError ?? null,
    doublesError: currentFailure?.doublesError ?? null,
    lastUpdated: current?.updatedAt ?? null,
    fromCache: current?.fromCache ?? false,
    refresh,
  };
}

/** Parse a pasted link into the id form stored in the URL. */
export function sheetIdFromUrl(input: string): { sheetId: string; gid: string | null } {
  const ref = parseSheetUrl(input);
  return {
    sheetId: ref.pubId ? 'e/' + ref.pubId : ref.docId,
    gid: ref.gid,
  };
}
