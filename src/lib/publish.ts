/**
 * Client for the coach publishing API (api/ladder.js).
 *
 * Deployed on Vercel with publishing configured, the site's plain address shows the
 * ladder the coach last published, and changing it needs the coach password. Anywhere the
 * API does not exist - `npm run dev`, or a purely static host - the app falls back to
 * link-based sharing, where the ladder settings travel in the URL.
 */

export type PublishingState = 'ready' | 'needs-storage' | 'needs-password' | 'weak-password';

export interface PublishedLadder {
  /** The same query string a shared ladder link carries, e.g. "?sheet=…&gid=0". */
  query: string;
  publishedAt: string;
  note: string;
  /** Who published it. Empty for versions published before names were recorded. */
  coach: string;
}

/** The most recent time a coach refreshed or published the ladder, and who. */
export interface LastUpdate {
  coach: string;
  at: string;
  kind: 'refresh' | 'publish';
}

/** The sheet this deployment is permanently tied to (LADDER_SHEET), when it is. */
export interface LockedSheet {
  sheet: string;
  gid: string | null;
}

export interface LadderStatus {
  publishing: PublishingState;
  published: PublishedLadder | null;
  lastUpdate: LastUpdate | null;
  lockedSheet: LockedSheet | null;
}

export interface CoachSession {
  token: string;
  expiresAt: number;
  /** The name typed at sign-in; shown to the team as "Coach <name>". */
  coachName: string;
}

export class PublishError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = 'PublishError';
    this.status = status;
    this.code = code;
  }
}

export const LADDER_ENDPOINT = '/api/ladder';

const PUBLISHED_CACHE_KEY = 'rihs:published';
const LAST_UPDATE_CACHE_KEY = 'rihs:last-update';
const SESSION_KEY = 'rihs:coach-session';
const COACH_NAME_KEY = 'rihs:coach-name';

type FetchImpl = typeof fetch;

function isPublishedLadder(value: unknown): value is PublishedLadder {
  const v = value as PublishedLadder | null;
  return (
    !!v && typeof v.query === 'string' && v.query.startsWith('?') && typeof v.publishedAt === 'string' && typeof v.note === 'string'
  );
}

function isLastUpdate(value: unknown): value is LastUpdate {
  const v = value as LastUpdate | null;
  return !!v && typeof v.coach === 'string' && v.coach !== '' && typeof v.at === 'string' && !Number.isNaN(Date.parse(v.at));
}

function isLockedSheet(value: unknown): value is LockedSheet {
  const v = value as LockedSheet | null;
  return !!v && typeof v.sheet === 'string' && v.sheet !== '' && (v.gid === null || typeof v.gid === 'string');
}

/** Entries stored before coach names were recorded have no `coach`. */
const withCoach = (entry: PublishedLadder): PublishedLadder => ({
  ...entry,
  coach: typeof entry.coach === 'string' ? entry.coach : '',
});

const STATES: PublishingState[] = ['ready', 'needs-storage', 'needs-password', 'weak-password'];

/**
 * The publishing status of this deployment, or null when there is no publishing API at
 * all (a static host or the Vite dev server) and the app should use link-based sharing.
 */
export async function fetchLadderStatus(fetchImpl: FetchImpl = fetch, signal?: AbortSignal): Promise<LadderStatus | null> {
  let response: Response;
  try {
    response = await fetchImpl(LADDER_ENDPOINT, { cache: 'no-store', signal, headers: { Accept: 'application/json' } });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new PublishError('Could not reach the site to load the ladder.', 0, 'network');
  }

  // A static host answers with 404, or with its index page as HTML.
  const type = response.headers.get('content-type') ?? '';
  if (response.status === 404 || response.status === 405 || !type.includes('application/json')) return null;

  const body = (await response.json().catch(() => null)) as Partial<LadderStatus> & { error?: string } | null;
  if (!response.ok || !body) {
    throw new PublishError(body?.error ?? 'The ladder could not be loaded.', response.status);
  }
  if (!STATES.includes(body.publishing as PublishingState)) return null;
  return {
    publishing: body.publishing as PublishingState,
    published: isPublishedLadder(body.published) ? withCoach(body.published) : null,
    lastUpdate: isLastUpdate(body.lastUpdate) ? body.lastUpdate : null,
    lockedSheet: isLockedSheet(body.lockedSheet) ? body.lockedSheet : null,
  };
}

async function post<T>(body: Record<string, unknown>, fetchImpl: FetchImpl): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(LADDER_ENDPOINT, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new PublishError('Could not reach the site. Check your connection and try again.', 0, 'network');
  }
  const payload = (await response.json().catch(() => null)) as (T & { error?: string; code?: string }) | null;
  if (!response.ok || !payload) {
    throw new PublishError(payload?.error ?? 'The request failed (HTTP ' + response.status + ').', response.status, payload?.code ?? null);
  }
  return payload;
}

export async function coachLogin(password: string, coachName: string, fetchImpl: FetchImpl = fetch): Promise<CoachSession> {
  const result = await post<{ token: string; expiresAt: number }>({ action: 'login', password }, fetchImpl);
  if (typeof result.token !== 'string' || typeof result.expiresAt !== 'number') {
    throw new PublishError('The site sent an unexpected response.', 500);
  }
  return { token: result.token, expiresAt: result.expiresAt, coachName: coachName.trim() };
}

export async function verifyCoachSession(session: CoachSession, fetchImpl: FetchImpl = fetch): Promise<boolean> {
  try {
    await post<{ ok: true }>({ action: 'verify', token: session.token }, fetchImpl);
    return true;
  } catch (err) {
    if (err instanceof PublishError && err.status === 401) return false;
    throw err;
  }
}

export async function publishLadder(
  session: CoachSession,
  query: string,
  note: string,
  fetchImpl: FetchImpl = fetch,
): Promise<{ published: PublishedLadder; lastUpdate: LastUpdate }> {
  const result = await post<{ published: PublishedLadder; lastUpdate: LastUpdate }>(
    { action: 'publish', token: session.token, name: session.coachName, query, note },
    fetchImpl,
  );
  if (!isPublishedLadder(result.published) || !isLastUpdate(result.lastUpdate)) {
    throw new PublishError('The site sent an unexpected response.', 500);
  }
  return { published: withCoach(result.published), lastUpdate: result.lastUpdate };
}

/** Record that this coach just refreshed the ladder, so the team sees who and when. */
export async function refreshLadder(session: CoachSession, fetchImpl: FetchImpl = fetch): Promise<LastUpdate> {
  const result = await post<{ lastUpdate: LastUpdate }>(
    { action: 'refresh', token: session.token, name: session.coachName },
    fetchImpl,
  );
  if (!isLastUpdate(result.lastUpdate)) throw new PublishError('The site sent an unexpected response.', 500);
  return result.lastUpdate;
}

export async function publishHistory(session: CoachSession, fetchImpl: FetchImpl = fetch): Promise<PublishedLadder[]> {
  const result = await post<{ history: PublishedLadder[] }>({ action: 'history', token: session.token }, fetchImpl);
  return Array.isArray(result.history) ? result.history.filter(isPublishedLadder).map(withCoach) : [];
}

// ---------------------------------------------------------------------------
// Browser persistence. Every access is guarded: private browsing and blocked site data
// throw, and none of this is essential.
// ---------------------------------------------------------------------------

/**
 * The coach session on this device, or null when absent, expired, or saved before names
 * were recorded (that coach signs in once more and is asked for a name).
 */
export function readCoachSession(now = Date.now()): CoachSession | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as CoachSession | null;
    if (!parsed || typeof parsed.token !== 'string' || typeof parsed.expiresAt !== 'number') return null;
    if (typeof parsed.coachName !== 'string' || !parsed.coachName.trim()) return null;
    return parsed.expiresAt > now ? parsed : null;
  } catch {
    return null;
  }
}

/** The name this browser's coach last signed in with, to prefill the next sign-in. */
export function readCoachName(): string {
  try {
    return localStorage.getItem(COACH_NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveCoachSession(session: CoachSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    localStorage.setItem(COACH_NAME_KEY, session.coachName);
  } catch {
    // The coach just has to enter the password again next visit.
  }
}

export function clearCoachSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** The last published ladder this browser saw, so the board still opens offline. */
export function readCachedPublished(): PublishedLadder | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(PUBLISHED_CACHE_KEY) ?? 'null') as unknown;
    return isPublishedLadder(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function cachePublished(published: PublishedLadder | null): void {
  try {
    if (published) localStorage.setItem(PUBLISHED_CACHE_KEY, JSON.stringify(published));
    else localStorage.removeItem(PUBLISHED_CACHE_KEY);
  } catch {
    // Offline fallback is a convenience only.
  }
}

/** The last "who refreshed it, and when" this browser saw, so it still shows offline. */
export function readCachedLastUpdate(): LastUpdate | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(LAST_UPDATE_CACHE_KEY) ?? 'null') as unknown;
    return isLastUpdate(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function cacheLastUpdate(lastUpdate: LastUpdate | null): void {
  try {
    if (lastUpdate) localStorage.setItem(LAST_UPDATE_CACHE_KEY, JSON.stringify(lastUpdate));
    else localStorage.removeItem(LAST_UPDATE_CACHE_KEY);
  } catch {
    // Offline fallback is a convenience only.
  }
}
