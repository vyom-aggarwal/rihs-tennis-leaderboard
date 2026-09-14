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
}

export interface LadderStatus {
  publishing: PublishingState;
  published: PublishedLadder | null;
}

export interface CoachSession {
  token: string;
  expiresAt: number;
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
const SESSION_KEY = 'rihs:coach-session';

type FetchImpl = typeof fetch;

function isPublishedLadder(value: unknown): value is PublishedLadder {
  const v = value as PublishedLadder | null;
  return (
    !!v && typeof v.query === 'string' && v.query.startsWith('?') && typeof v.publishedAt === 'string' && typeof v.note === 'string'
  );
}

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
    published: isPublishedLadder(body.published) ? body.published : null,
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

export async function coachLogin(password: string, fetchImpl: FetchImpl = fetch): Promise<CoachSession> {
  const result = await post<CoachSession>({ action: 'login', password }, fetchImpl);
  if (typeof result.token !== 'string' || typeof result.expiresAt !== 'number') {
    throw new PublishError('The site sent an unexpected response.', 500);
  }
  return { token: result.token, expiresAt: result.expiresAt };
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
): Promise<PublishedLadder> {
  const result = await post<{ published: PublishedLadder }>({ action: 'publish', token: session.token, query, note }, fetchImpl);
  if (!isPublishedLadder(result.published)) throw new PublishError('The site sent an unexpected response.', 500);
  return result.published;
}

export async function publishHistory(session: CoachSession, fetchImpl: FetchImpl = fetch): Promise<PublishedLadder[]> {
  const result = await post<{ history: PublishedLadder[] }>({ action: 'history', token: session.token }, fetchImpl);
  return Array.isArray(result.history) ? result.history.filter(isPublishedLadder) : [];
}

// ---------------------------------------------------------------------------
// Browser persistence. Every access is guarded: private browsing and blocked site data
// throw, and none of this is essential.
// ---------------------------------------------------------------------------

/** The coach session on this device, or null when absent or expired. */
export function readCoachSession(now = Date.now()): CoachSession | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as CoachSession | null;
    if (!parsed || typeof parsed.token !== 'string' || typeof parsed.expiresAt !== 'number') return null;
    return parsed.expiresAt > now ? parsed : null;
  } catch {
    return null;
  }
}

export function saveCoachSession(session: CoachSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
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
