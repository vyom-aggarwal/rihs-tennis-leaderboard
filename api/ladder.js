/**
 * Coach publishing API - the only server code in the project.
 *
 * The ladder is still computed entirely in each viewer's browser from the coach's Google
 * Sheet. What lives here is just the answer to "which sheet, under which settings, is the
 * team's official ladder?" - so that everyone who opens the site's plain address sees the
 * same board, and only someone who knows the coach password can change it.
 *
 *   GET  /api/ladder                          public: the published ladder settings
 *   POST /api/ladder  { action: "login" }     password -> a signed, expiring coach token
 *   POST /api/ladder  { action: "verify" }    is this token still valid?
 *   POST /api/ladder  { action: "publish" }   token + settings -> the new official ladder
 *   POST /api/ladder  { action: "history" }   token -> the last 20 publishes, newest first
 *
 * No accounts, no student data. The stored value is the same query string a shared
 * ladder link carries (sheet id, tab ids, rule settings, column mapping) plus a timestamp
 * and the coach's note, in an Upstash Redis store connected through the Vercel
 * Marketplace. The coach password is a Vercel environment variable and is never stored.
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
const FAILURE_KEY_PREFIX = 'rihs:login-failures:';
const MAX_BODY_BYTES = 10_000;
const MAX_QUERY_LENGTH = 2_000;
const MAX_NOTE_LENGTH = 200;

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
 *
 * @typedef {{ query: string, publishedAt: string, note: string }} PublishedLadder
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

/** @param {unknown} value @returns {PublishedLadder | null} */
function parseEntry(value) {
  if (typeof value !== 'string') return null;
  try {
    const entry = JSON.parse(value);
    const query = normalizeQuery(entry?.query);
    if (!query || typeof entry.publishedAt !== 'string') return null;
    return { query, publishedAt: entry.publishedAt, note: typeof entry.note === 'string' ? entry.note : '' };
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
      let published = null;
      if (store) {
        const [value] = await redis(store, [['GET', PUBLISHED_KEY]], fetchImpl);
        published = parseEntry(value);
      }
      return json(200, { publishing: state, published });
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

    if (action === 'publish') {
      const query = normalizeQuery(body.query);
      if (!query) return json(400, { error: 'Those ladder settings are not valid.', code: 'invalid-settings' });
      /** @type {PublishedLadder} */
      const entry = {
        query,
        publishedAt: new Date(now).toISOString(),
        note: typeof body.note === 'string' ? body.note.trim().slice(0, MAX_NOTE_LENGTH) : '',
      };
      const serialized = JSON.stringify(entry);
      await redis(
        store,
        [
          ['SET', PUBLISHED_KEY, serialized],
          ['LPUSH', HISTORY_KEY, serialized],
          ['LTRIM', HISTORY_KEY, '0', String(HISTORY_LIMIT - 1)],
        ],
        fetchImpl,
      );
      return json(200, { published: entry });
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
