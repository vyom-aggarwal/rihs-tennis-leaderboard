/**
 * Live sheet polling.
 *
 * "Live" here means: the coach types a result into the Google Sheet and every phone
 * watching the ladder shows it within one refresh interval, with nobody pressing
 * anything. Three things drive a refresh:
 *
 *   1. A timer, every `refreshSeconds`.
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
  /** True only for the very first load, so the UI can show a skeleton once. */
  loading: boolean;
  /** True while a background revalidation is in flight. */
  refreshing: boolean;
  error: SheetError | null;
  lastUpdated: Date | null;
  /** True when the rendered data came from cache and has not been revalidated yet. */
  fromCache: boolean;
  refresh: () => void;
}

interface CachedSheet {
  matchesCsv: string;
  rosterCsv: string | null;
  savedAt: number;
}

function readCache(key: string): CachedSheet | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedSheet>;
    if (typeof parsed.matchesCsv !== 'string' || typeof parsed.savedAt !== 'number') return null;
    return {
      matchesCsv: parsed.matchesCsv,
      rosterCsv: typeof parsed.rosterCsv === 'string' ? parsed.rosterCsv : null,
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

export function useLiveSheet(
  sheetId: string | null,
  gid: string | null,
  rosterGid: string | null,
  refreshSeconds: number,
): LiveSheetState {
  const [matchesCsv, setMatchesCsv] = useState<string | null>(null);
  const [rosterCsv, setRosterCsv] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(sheetId));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<SheetError | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [nonce, setNonce] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  // Guards against a slow response from a previous sheet overwriting a newer one.
  const requestRef = useRef(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!sheetId) {
      setMatchesCsv(null);
      setRosterCsv(null);
      setLoading(false);
      setError(null);
      return;
    }

    let ref: SheetRef;
    try {
      ref = sheetId.startsWith('e/')
        ? { docId: '', pubId: sheetId.slice(2), gid }
        : { docId: sheetId, pubId: null, gid };
    } catch {
      setError(new SheetError('invalid-url', 'That sheet link could not be read.'));
      setLoading(false);
      return;
    }

    const cacheKey = sheetCacheKey(ref);
    const cached = readCache(cacheKey);
    if (cached && matchesCsv === null) {
      // Paint immediately from cache, then revalidate in the background.
      setMatchesCsv(cached.matchesCsv);
      setRosterCsv(cached.rosterCsv);
      setLastUpdated(new Date(cached.savedAt));
      setFromCache(true);
      setLoading(false);
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestRef.current;

    setRefreshing(true);

    (async () => {
      try {
        const matches = await fetchSheetCsv(ref, { signal: controller.signal });

        let roster: string | null = null;
        if (rosterGid) {
          try {
            roster = await fetchSheetCsv(
              { ...ref, gid: rosterGid },
              { signal: controller.signal },
            );
          } catch {
            // A missing or unreadable roster tab must not take the ladder down with
            // it - the matches sheet alone is enough to rank the team.
            roster = null;
          }
        }

        if (requestId !== requestRef.current) return; // superseded by a newer request

        setMatchesCsv(matches);
        setRosterCsv(roster);
        setError(null);
        setFromCache(false);
        setLastUpdated(new Date());
        writeCache(cacheKey, { matchesCsv: matches, rosterCsv: roster, savedAt: Date.now() });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (requestId !== requestRef.current) return;
        // Keep showing the last good ladder; surface the error alongside it rather
        // than blanking the board mid-match.
        setError(
          err instanceof SheetError
            ? err
            : new SheetError('network', (err as Error).message ?? 'Could not load the sheet.'),
        );
      } finally {
        if (requestId === requestRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();

    return () => controller.abort();
    // `matchesCsv` is deliberately excluded: it is written by this effect, and
    // including it would re-run the fetch on every successful load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetId, gid, rosterGid, nonce]);

  // Timer-driven refresh.
  useEffect(() => {
    if (!sheetId) return;
    const id = setInterval(refresh, Math.max(10, refreshSeconds) * 1000);
    return () => clearInterval(id);
  }, [sheetId, refreshSeconds, refresh]);

  // Refresh when the tab regains focus or the network returns.
  useEffect(() => {
    if (!sheetId) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', refresh);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', refresh);
    };
  }, [sheetId, refresh]);

  return { matchesCsv, rosterCsv, loading, refreshing, error, lastUpdated, fromCache, refresh };
}

/** Parse a pasted link into the id form stored in the URL. */
export function sheetIdFromUrl(input: string): { sheetId: string; gid: string | null } {
  const ref = parseSheetUrl(input);
  return {
    sheetId: ref.pubId ? 'e/' + ref.pubId : ref.docId,
    gid: ref.gid,
  };
}
