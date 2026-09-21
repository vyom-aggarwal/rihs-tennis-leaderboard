/**
 * Which ladder is the team's official one?
 *
 * On a deployment with the publishing API, the answer comes from the server and is the
 * same for every visitor. It is re-checked every two minutes while the page is visible
 * (and when a phone wakes), so a coach's publish reaches boards that are already open.
 * Without the API - a static host or `npm run dev` - `api` is false and the app uses
 * link-based sharing instead.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cacheLastUpdate,
  cachePublished,
  fetchLadderStatus,
  readCachedLastUpdate,
  readCachedPublished,
  type LastUpdate,
  type LockedSheet,
  type PublishedLadder,
  type PublishingState,
} from '../lib/publish';

export interface PublishedSite {
  phase: 'checking' | 'ready' | 'error';
  /** False when this host has no publishing API, so ladders are shared by link. */
  api: boolean;
  publishing: PublishingState | null;
  published: PublishedLadder | null;
  /** Who last refreshed or published the ladder, and when. */
  lastUpdate: LastUpdate | null;
  /** The one sheet this deployment is tied to, when the host has fixed it. */
  lockedSheet: LockedSheet | null;
  error: string | null;
  /** True when the published ladder came from this browser's saved copy, not the server. */
  offline: boolean;
  refresh: () => void;
  setPublished: (published: PublishedLadder, lastUpdate: LastUpdate) => void;
  setLastUpdate: (lastUpdate: LastUpdate) => void;
}

type SiteState = Omit<PublishedSite, 'refresh' | 'setPublished' | 'setLastUpdate'>;

const RECHECK_MS = 120_000;
const REFOCUS_RECHECK_MS = 60_000;

export function usePublishedLadder(): PublishedSite {
  // A returning visitor starts from the published ladder this browser saw last time and
  // confirms it in the background, so the board paints from cache without waiting on the
  // server. `publishing` stays null until the server has actually answered.
  const [state, setState] = useState<SiteState>(() => {
    const cached = readCachedPublished();
    return cached
      ? {
          phase: 'ready',
          api: true,
          publishing: null,
          published: cached,
          lastUpdate: readCachedLastUpdate(),
          lockedSheet: null,
          error: null,
          offline: false,
        }
      : {
          phase: 'checking',
          api: false,
          publishing: null,
          published: null,
          lastUpdate: null,
          lockedSheet: null,
          error: null,
          offline: false,
        };
  });
  const [nonce, setNonce] = useState(0);
  const lastCheckRef = useRef(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    lastCheckRef.current = Date.now();

    fetchLadderStatus(fetch, controller.signal).then(
      (status) => {
        if (!status) {
          setState({
            phase: 'ready',
            api: false,
            publishing: null,
            published: null,
            lastUpdate: null,
            lockedSheet: null,
            error: null,
            offline: false,
          });
          return;
        }
        cachePublished(status.published);
        cacheLastUpdate(status.lastUpdate);
        setState({
          phase: 'ready',
          api: true,
          publishing: status.publishing,
          published: status.published,
          lastUpdate: status.lastUpdate,
          lockedSheet: status.lockedSheet,
          error: null,
          offline: false,
        });
      },
      (err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message = err instanceof Error && err.message ? err.message : 'The ladder could not be loaded.';
        setState((s) => {
          // A failing check leaves the ladder already on screen in place. If the server
          // has never answered this visit, that ladder is this browser's saved copy.
          if (s.phase === 'ready' && s.api) return { ...s, error: message, offline: s.publishing === null };
          // A first check failing falls back to the copy this browser saw last time.
          const cached = readCachedPublished();
          if (cached) {
            return {
              phase: 'ready',
              api: true,
              publishing: null,
              published: cached,
              lastUpdate: readCachedLastUpdate(),
              lockedSheet: null,
              error: message,
              offline: true,
            };
          }
          return { ...s, phase: 'error', error: message };
        });
      },
    );

    return () => controller.abort();
  }, [nonce]);

  useEffect(() => {
    if (!state.api) return;
    const id = setInterval(() => {
      if (document.visibilityState !== 'hidden') refresh();
    }, RECHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastCheckRef.current > REFOCUS_RECHECK_MS) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [state.api, refresh]);

  const setPublished = useCallback((published: PublishedLadder, lastUpdate: LastUpdate) => {
    cachePublished(published);
    cacheLastUpdate(lastUpdate);
    setState((s) => ({ ...s, published, lastUpdate, offline: false, error: null }));
  }, []);

  const setLastUpdate = useCallback((lastUpdate: LastUpdate) => {
    cacheLastUpdate(lastUpdate);
    setState((s) => ({ ...s, lastUpdate }));
  }, []);

  return { ...state, refresh, setPublished, setLastUpdate };
}
