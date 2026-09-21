/**
 * Coach publishing API - the only server code in the project.
 *
 * The ladder is still computed entirely in each viewer's browser from the coach's Google
 * Sheet. What lives here is just the answer to "which sheet, under which settings, is the
 * team's official ladder?" - so that everyone who opens the site's plain address sees the
 * same board, and only someone who knows the coach password can change it.
 *
 *   GET  /api/ladder                          public: the published ladder settings, who last
 *                                             refreshed it and when, and the locked sheet if any
 *   POST /api/ladder  { action: "login" }     password -> a signed, expiring coach token
 *   POST /api/ladder  { action: "verify" }    is this token still valid?
 *   POST /api/ladder  { action: "refresh" }   token + coach name -> "Coach X refreshed the ladder now"
 *   POST /api/ladder  { action: "publish" }   token + coach name + settings -> the new official ladder
 *   POST /api/ladder  { action: "history" }   token -> the last 20 publishes, newest first
 *
 * No accounts, no student data. The stored value is the same query string a shared
 * ladder link carries (sheet id, tab ids, rule settings, column mapping) plus a timestamp,
 * the coach's note and the coach's name, in an Upstash Redis store connected through the
 * Vercel Marketplace. The coach password is a Vercel environment variable and is never
 * stored. The coach name is typed at sign-in: everyone shares one password, so it says who
 * to ask, not who proved they were whom.
 *
 * LADDER_SHEET (optional): the Google Sheets link or id this deployment is permanently
 * tied to. When set, nobody can publish a different sheet and the team never sees a
 * "connect a sheet" screen.
 *
 * Plain JavaScript on purpose: Vercel runs it as-is, with no compile step to get wrong.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const HISTORY_LIMIT = 20;
export const MAX_LOGIN_FAILURES = 8;
export const FAILURE_WINDOW_SECONDS = 15 * 60;
export const MIN_PASSWORD_LENGTH = 10;

const PUBLISHED_KEY = 'rihs:published';
const HISTORY_KEY = 'rihs:publish-history';
const LAST_UPDATE_KEY = 'rihs:last-update';
const FAILURE_KEY_PREFIX = 'rihs:login-failures:';
const MAX_BODY_BYTES = 10_000;
const MAX_QUERY_LENGTH = 2_000;
const MAX_NOTE_LENGTH = 200;
const MAX_NAME_LENGTH = 40;

/** Settings a published ladder may carry - exactly what a shared ladder link carries. */
const ALLOWED_PARAMS = new Set([
  'sheet', 'gid', 'roster', 'doubles', 'refresh', 'range', 'cool', 'min', 'window',
  'mode', 'base', 'pending', 'strict', 'map',
]);

/**
 * @typedef {object} Env
 * @property {string} [COACH_PASSWORD]
 * @property {string} [KV_REST_API_URL]
 * @property {string} [KV_REST_API_TOKEN]
 * @property {string} [UPSTASH_REDIS_REST_URL]
 * @property {string} [UPSTASH_REDIS_REST_TOKEN]
 * @property {string} [LADDER_SHEET]
 *
 * @typedef {{ query: string, publishedAt: string, note: string, coach: string }} PublishedLadder
 * @typedef {{ coach: string, at: string, kind: 'refresh' | 'publish' }} LastUpdate
 * @typedef {{ sheet: string, gid: string | null }} LockedSheet
 * @typedef {'ready' | 'needs-storage' | 'needs-password' | 'weak-password'} PublishingState
 */

class StoreError extends Error {}

/** @param {number} status @param {unknown} body */
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Every visitor must see a publish the moment it happens.
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** @param {Env} env */
function storeFor(env) {
  // The Vercel Marketplace Upstash integration injects the KV_* names; a store created
  // directly in Upstash uses the UPSTASH_* names. Either works.
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

/** @param {Env} env @returns {PublishingState} */
export function publishingState(env) {
  if (!storeFor(env)) return 'needs-storage';
  if (!env.COACH_PASSWORD) return 'needs-password';
  if (env.COACH_PASSWORD.length < MIN_PASSWORD_LENGTH) return 'weak-password';
  return 'ready';
}

/**
 * Run Redis commands in one round trip through Upstash's REST pipeline.
 * @param {{ url: string, token: string }} store
 * @param {string[][]} commands
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<unknown[]>}
 */
async function redis(store, commands, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(store.url + '/pipeline', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + store.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
    });
  } catch (error) {
    throw new StoreError('Storage unreachable: ' + (error instanceof Error ? error.message : String(error)));
  }
  if (!response.ok) throw new StoreError('Storage responded with HTTP ' + response.status);
  const results = await response.json().catch(() => null);
  if (!Array.isArray(results) || results.length !== commands.length) {
    throw new StoreError('Storage returned an unexpected response');
  }
  return results.map((entry) => {
    if (entry && typeof entry.error === 'string') throw new StoreError(entry.error);
    return entry ? entry.result : null;
  });
}

/**
 * Accept only the settings a ladder link can carry, with values in a safe character set.
 * Anything else - including the coach flag and the viewer's open tab - is dropped.
 * @param {unknown} raw
 * @returns {string | null} a normalized "?..." query, or null when invalid
 */
export function normalizeQuery(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_QUERY_LENGTH) return null;
  const params = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
  const out = new URLSearchParams();
  for (const [key, value] of params) {
    if (!ALLOWED_PARAMS.has(key)) continue;
    const valid =
      key === 'sheet'
        ? /^(e\/)?[A-Za-z0-9_-]{20,200}$/.test(value)
        : /^[A-Za-z0-9._-]{1,500}$/.test(value);
    if (!valid) return null;
    out.set(key, value);
  }
  if (!out.get('sheet')) return null;
  return '?' + out.toString();
}

/**
 * A coach's display name: letters, digits, spaces and a few name punctuation marks. A
 * leading "Coach" is dropped because the page adds it ("Coach Lokesh").
 * @param {unknown} raw
 * @returns {string | null} the cleaned name, or null when missing or unusable
 */
export function sanitizeCoachName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim().replace(/^coach(\s+|$)/i, '').slice(0, MAX_NAME_LENGTH).trim();
  return name && /^[\p{L}\p{M}0-9 .'’-]+$/u.test(name) ? name : null;
}

/**
 * The sheet this deployment is permanently tied to, from LADDER_SHEET (a Google Sheets
 * link or a bare id), or null when the coach may choose any sheet.
 * @param {Env} env
 * @returns {LockedSheet | null}
 */
export function lockedSheet(env) {
  const raw = (env.LADDER_SHEET ?? '').trim();
  if (!raw) return null;
  const published = raw.match(/\/spreadsheets\/d\/e\/([A-Za-z0-9_-]{20,200})/);
  const doc = raw.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,200})/);
  const bare = /^(e\/)?[A-Za-z0-9_-]{20,200}$/.test(raw);
  const sheet = published ? 'e/' + published[1] : doc ? doc[1] : bare ? raw : null;
  if (!sheet) return null;
  const gid = raw.match(/[#?&]gid=(\d+)/);
  return { sheet, gid: gid ? gid[1] : null };
}

/**
 * Point a ladder query at the locked sheet, whatever it said before.
 * @param {string} query a normalized "?..." query
 * @param {LockedSheet | null} lock
 */
function applyLock(query, lock) {
  if (!lock) return query;
  const params = new URLSearchParams(query.slice(1));
  params.set('sheet', lock.sheet);
  if (lock.gid) params.set('gid', lock.gid);
  return normalizeQuery('?' + params.toString()) ?? query;
}

/** @param {unknown} value @returns {PublishedLadder | null} */
function parseEntry(value) {
  if (typeof value !== 'string') return null;
  try {
    const entry = JSON.parse(value);
    const query = normalizeQuery(entry?.query);
    if (!query || typeof entry.publishedAt !== 'string') return null;
    return {
      query,
      publishedAt: entry.publishedAt,
      note: typeof entry.note === 'string' ? entry.note : '',
      coach: sanitizeCoachName(entry.coach) ?? '',
    };
  } catch {
    return null;
  }
}

/** @param {unknown} value @returns {LastUpdate | null} */
function parseLastUpdate(value) {
  if (typeof value !== 'string') return null;
  try {
    const entry = JSON.parse(value);
    const coach = sanitizeCoachName(entry?.coach);
    if (!coach || typeof entry.at !== 'string' || Number.isNaN(Date.parse(entry.at))) return null;
    return { coach, at: entry.at, kind: entry.kind === 'publish' ? 'publish' : 'refresh' };
  } catch {
    return null;
  }
}

/** @param {string} password */
function tokenKey(password) {
  // Derived from the password, so changing COACH_PASSWORD in Vercel signs every coach out.
  return createHash('sha256').update('rihs-coach-token:' + password).digest();
}

/** @param {string} password @param {number} now */
export function issueToken(password, now) {
  const expires = String(now + TOKEN_TTL_MS);
  const signature = createHmac('sha256', tokenKey(password)).update(expires).digest('base64url');
  return { token: 'v1.' + expires + '.' + signature, expiresAt: Number(expires) };
}

/** @param {unknown} token @param {string} password @param {number} now */
export function verifyToken(token, password, now) {
  if (typeof token !== 'string') return false;
  const match = token.match(/^v1\.(\d{13,16})\.([A-Za-z0-9_-]{43})$/);
  if (!match) return false;
  if (Number(match[1]) <= now) return false;
  const expected = createHmac('sha256', tokenKey(password)).update(match[1]).digest();
  const given = Buffer.from(match[2], 'base64url');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Constant-time comparison: hashing first makes both sides the same length. */
function passwordMatches(input, actual) {
  const a = createHash('sha256').update(String(input)).digest();
  const b = createHash('sha256').update(String(actual)).digest();
  return timingSafeEqual(a, b);
}

/** @param {Request} request */
function clientAddress(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim().slice(0, 64);
  return (request.headers.get('x-real-ip') || 'unknown').slice(0, 64);
}

const SETUP_MESSAGES = {
  'needs-storage':
    'Publishing is not set up yet: connect an Upstash Redis store to this project in Vercel (Storage tab).',
  'needs-password':
    'Publishing is not set up yet: add a COACH_PASSWORD environment variable in Vercel, then redeploy.',
  'weak-password':
    'COACH_PASSWORD must be at least ' + MIN_PASSWORD_LENGTH + ' characters. Change it in Vercel, then redeploy.',
};

/**
 * @param {Request} request
 * @param {Env} env
 * @param {{ fetchImpl?: typeof fetch, now?: number }} [options]
 * @returns {Promise<Response>}
 */
export async function handleLadderRequest(request, env, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now();
  const state = publishingState(env);
  const store = storeFor(env);

  try {
    if (request.method === 'GET' || request.method === 'HEAD') {
      const lock = lockedSheet(env);
      let published = null;
      let lastUpdate = null;
      if (store) {
        const [value, updated] = await redis(store, [['GET', PUBLISHED_KEY], ['GET', LAST_UPDATE_KEY]], fetchImpl);
        published = parseEntry(value);
        lastUpdate = parseLastUpdate(updated);
      }
      // A changed LADDER_SHEET takes effect at once, even for an older published version.
      if (published && lock) published = { ...published, query: applyLock(published.query, lock) };
      return json(200, { publishing: state, published, lastUpdate, lockedSheet: lock });
    }

    if (request.method !== 'POST') {
      const response = json(405, { error: 'Method not allowed.' });
      response.headers.set('Allow', 'GET, POST');
      return response;
    }

    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json(413, { error: 'Request too large.' });
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return json(400, { error: 'Request body must be JSON.' });
    }
    const action = body && typeof body.action === 'string' ? body.action : '';

    if (state !== 'ready' || !store || !env.COACH_PASSWORD) {
      return json(503, { error: SETUP_MESSAGES[state], code: state });
    }
    const password = env.COACH_PASSWORD;

    if (action === 'login') {
      const failureKey = FAILURE_KEY_PREFIX + clientAddress(request);
      const [failures] = await redis(store, [['GET', failureKey]], fetchImpl);
      if (Number(failures) >= MAX_LOGIN_FAILURES) {
        return json(429, {
          error: 'Too many wrong passwords from this network. Wait 15 minutes and try again.',
          code: 'rate-limited',
        });
      }
      if (typeof body.password !== 'string' || !passwordMatches(body.password, password)) {
        const [count] = await redis(store, [['INCR', failureKey]], fetchImpl);
        if (Number(count) === 1) {
          await redis(store, [['EXPIRE', failureKey, String(FAILURE_WINDOW_SECONDS)]], fetchImpl);
        }
        return json(401, { error: 'That password is not right.', code: 'wrong-password' });
      }
      await redis(store, [['DEL', failureKey]], fetchImpl);
      return json(200, issueToken(password, now));
    }

    if (!verifyToken(body.token, password, now)) {
      return json(401, { error: 'Your coach session has ended. Enter the password again.', code: 'signed-out' });
    }

    if (action === 'verify') return json(200, { ok: true });

    if (action === 'history') {
      const [values] = await redis(store, [['LRANGE', HISTORY_KEY, '0', String(HISTORY_LIMIT - 1)]], fetchImpl);
      const history = (Array.isArray(values) ? values : []).map(parseEntry).filter(Boolean);
      return json(200, { history });
    }

    if (action === 'refresh' || action === 'publish') {
      const coach = sanitizeCoachName(body.name);
      if (!coach) {
        return json(400, { error: 'Enter your name so the team can see who made this change.', code: 'name-required' });
      }
      const at = new Date(now).toISOString();

      if (action === 'refresh') {
        /** @type {LastUpdate} */
        const lastUpdate = { coach, at, kind: 'refresh' };
        await redis(store, [['SET', LAST_UPDATE_KEY, JSON.stringify(lastUpdate)]], fetchImpl);
        return json(200, { lastUpdate });
      }

      const normalized = normalizeQuery(body.query);
      if (!normalized) return json(400, { error: 'Those ladder settings are not valid.', code: 'invalid-settings' });
      /** @type {PublishedLadder} */
      const entry = {
        query: applyLock(normalized, lockedSheet(env)),
        publishedAt: at,
        note: typeof body.note === 'string' ? body.note.trim().slice(0, MAX_NOTE_LENGTH) : '',
        coach,
      };
      /** @type {LastUpdate} */
      const lastUpdate = { coach, at, kind: 'publish' };
      const serialized = JSON.stringify(entry);
      await redis(
        store,
        [
          ['SET', PUBLISHED_KEY, serialized],
          ['SET', LAST_UPDATE_KEY, JSON.stringify(lastUpdate)],
          ['LPUSH', HISTORY_KEY, serialized],
          ['LTRIM', HISTORY_KEY, '0', String(HISTORY_LIMIT - 1)],
        ],
        fetchImpl,
      );
      return json(200, { published: entry, lastUpdate });
    }

    return json(400, { error: 'Unknown action.' });
  } catch (error) {
    if (error instanceof StoreError) {
      console.error('ladder storage error:', error.message);
      return json(502, { error: 'The ladder storage could not be reached. Try again in a moment.', code: 'storage-error' });
    }
    console.error('ladder api error:', error);
    return json(500, { error: 'Something went wrong. Try again.' });
  }
}

export default {
  /** @param {Request} request */
  fetch(request) {
    return handleLadderRequest(request, /** @type {Env} */ (process.env));
  },
};
