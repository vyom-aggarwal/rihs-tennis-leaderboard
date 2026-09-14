import { describe, expect, it } from 'vitest';
import {
  FAILURE_WINDOW_SECONDS,
  handleLadderRequest,
  HISTORY_LIMIT,
  issueToken,
  MAX_LOGIN_FAILURES,
  normalizeQuery,
  TOKEN_TTL_MS,
  verifyToken,
} from '../../api/ladder.js';

const PASSWORD = 'correct horse battery';
const NOW = Date.UTC(2026, 8, 13, 12);
const SHEET = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';

/** A tiny in-memory stand-in for Upstash's REST pipeline endpoint. */
function fakeRedis() {
  const strings = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const expiries = new Map<string, number>();
  let down = false;

  const run = (cmd: string[]): unknown => {
    const [name, key = '', ...args] = cmd;
    switch (name) {
      case 'GET':
        return strings.get(key) ?? null;
      case 'SET':
        strings.set(key, args[0]!);
        return 'OK';
      case 'DEL':
        return strings.delete(key) ? 1 : 0;
      case 'INCR': {
        const next = Number(strings.get(key) ?? 0) + 1;
        strings.set(key, String(next));
        return next;
      }
      case 'EXPIRE':
        expiries.set(key, Number(args[0]));
        return 1;
      case 'LPUSH': {
        const list = lists.get(key) ?? [];
        list.unshift(...args);
        lists.set(key, list);
        return list.length;
      }
      case 'LTRIM': {
        const list = lists.get(key) ?? [];
        lists.set(key, list.slice(Number(args[0]), Number(args[1]) + 1));
        return 'OK';
      }
      case 'LRANGE':
        return (lists.get(key) ?? []).slice(Number(args[0]), Number(args[1]) + 1);
      default:
        return { error: 'unknown command ' + name };
    }
  };

  const fetchImpl = (async (url: string, init: RequestInit) => {
    if (down) throw new TypeError('fetch failed');
    expect(url).toBe('https://store.example.upstash.io/pipeline');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer store-token');
    const commands = JSON.parse(String(init.body)) as string[][];
    const results = commands.map((c) => {
      const r = run(c);
      return r && typeof r === 'object' && 'error' in (r as object) ? r : { result: r };
    });
    return new Response(JSON.stringify(results), { status: 200 });
  }) as unknown as typeof fetch;

  return { fetchImpl, strings, lists, expiries, setDown: (v: boolean) => (down = v) };
}

const readyEnv = {
  COACH_PASSWORD: PASSWORD,
  KV_REST_API_URL: 'https://store.example.upstash.io/',
  KV_REST_API_TOKEN: 'store-token',
};

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://ladder.example/api/ladder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.7', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const get = () => new Request('https://ladder.example/api/ladder');

async function call(request: Request, env: Record<string, string>, redis = fakeRedis(), now = NOW) {
  const response = await handleLadderRequest(request, env, { fetchImpl: redis.fetchImpl, now });
  return { status: response.status, body: (await response.json()) as Record<string, any>, response };
}

describe('publishing status', () => {
  it('reports what is missing before publishing can work', async () => {
    expect((await call(get(), {})).body).toEqual({ publishing: 'needs-storage', published: null });
    const noPassword = { KV_REST_API_URL: readyEnv.KV_REST_API_URL, KV_REST_API_TOKEN: 'store-token' };
    expect((await call(get(), noPassword)).body.publishing).toBe('needs-password');
    expect((await call(get(), { ...readyEnv, COACH_PASSWORD: 'short' })).body.publishing).toBe('weak-password');
    expect((await call(get(), readyEnv)).body).toEqual({ publishing: 'ready', published: null });
  });

  it('accepts the Upstash variable names as well as the Vercel Marketplace ones', async () => {
    const env = {
      COACH_PASSWORD: PASSWORD,
      UPSTASH_REDIS_REST_URL: 'https://store.example.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'store-token',
    };
    expect((await call(get(), env)).body.publishing).toBe('ready');
  });

  it('is never cached, so a publish reaches everyone at once', async () => {
    const { response } = await call(get(), readyEnv);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('refuses coach actions until setup is complete', async () => {
    const r = await call(post({ action: 'login', password: PASSWORD }), { COACH_PASSWORD: PASSWORD });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('needs-storage');
  });
});

describe('coach password', () => {
  it('issues a token for the right password and refuses the wrong one', async () => {
    const redis = fakeRedis();
    const wrong = await call(post({ action: 'login', password: 'guess' }), readyEnv, redis);
    expect(wrong.status).toBe(401);
    expect(wrong.body.token).toBeUndefined();

    const right = await call(post({ action: 'login', password: PASSWORD }), readyEnv, redis);
    expect(right.status).toBe(200);
    expect(right.body.expiresAt).toBe(NOW + TOKEN_TTL_MS);
    expect(verifyToken(right.body.token, PASSWORD, NOW)).toBe(true);
    // A successful sign-in clears the failure count.
    expect(redis.strings.has('rihs:login-failures:203.0.113.7')).toBe(false);
  });

  it(`locks a network out for 15 minutes after ${MAX_LOGIN_FAILURES} wrong passwords`, async () => {
    const redis = fakeRedis();
    for (let i = 0; i < MAX_LOGIN_FAILURES; i++) {
      expect((await call(post({ action: 'login', password: 'nope' + i }), readyEnv, redis)).status).toBe(401);
    }
    expect(redis.expiries.get('rihs:login-failures:203.0.113.7')).toBe(FAILURE_WINDOW_SECONDS);
    // Even the right password is refused while locked, so guessing gains nothing.
    const locked = await call(post({ action: 'login', password: PASSWORD }), readyEnv, redis);
    expect(locked.status).toBe(429);
    // Another network is unaffected.
    const other = await call(post({ action: 'login', password: PASSWORD }, { 'x-forwarded-for': '198.51.100.2' }), readyEnv, redis);
    expect(other.status).toBe(200);
  });

  it('rejects expired, tampered and other-password tokens', () => {
    const { token } = issueToken(PASSWORD, NOW);
    expect(verifyToken(token, PASSWORD, NOW + TOKEN_TTL_MS - 1)).toBe(true);
    expect(verifyToken(token, PASSWORD, NOW + TOKEN_TTL_MS)).toBe(false);
    expect(verifyToken(token, 'a different password', NOW)).toBe(false);
    expect(verifyToken(token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), PASSWORD, NOW)).toBe(false);
    expect(verifyToken('v1.9999999999999.forged', PASSWORD, NOW)).toBe(false);
    expect(verifyToken(undefined, PASSWORD, NOW)).toBe(false);
  });
});

describe('publishing', () => {
  const login = async (redis: ReturnType<typeof fakeRedis>) =>
    (await call(post({ action: 'login', password: PASSWORD }), readyEnv, redis)).body.token as string;

  it('requires a valid coach token', async () => {
    const r = await call(post({ action: 'publish', token: 'nope', query: '?sheet=' + SHEET }), readyEnv);
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('signed-out');
  });

  it('publishes the ladder every visitor then sees', async () => {
    const redis = fakeRedis();
    const token = await login(redis);
    const r = await call(post({ action: 'publish', token, query: '?sheet=' + SHEET + '&gid=0&range=4', note: '  Season start  ' }), readyEnv, redis);
    expect(r.status).toBe(200);
    expect(r.body.published).toEqual({
      query: '?sheet=' + SHEET + '&gid=0&range=4',
      publishedAt: new Date(NOW).toISOString(),
      note: 'Season start',
    });
    expect((await call(get(), readyEnv, redis)).body.published).toEqual(r.body.published);
  });

  it('strips the coach flag and viewer tab, and rejects unsafe values', () => {
    expect(normalizeQuery('?sheet=' + SHEET + '&coach=1&ladder=Girls&map=playerA.0_scoreSummary.4')).toBe(
      '?sheet=' + SHEET + '&map=playerA.0_scoreSummary.4',
    );
    expect(normalizeQuery('?sheet=e/2PACX-1vQx7Yk3nFMdKvBdBZjgmUUqptlbs74')).toBe('?sheet=e%2F2PACX-1vQx7Yk3nFMdKvBdBZjgmUUqptlbs74');
    expect(normalizeQuery('?gid=0')).toBeNull(); // no sheet
    expect(normalizeQuery('?sheet=__demo__')).toBeNull(); // the demo is not a real sheet
    expect(normalizeQuery('?sheet=' + SHEET + '&range=<script>')).toBeNull();
    expect(normalizeQuery('?sheet=' + SHEET + '&x=' + 'a'.repeat(3000))).toBeNull();
    expect(normalizeQuery(42)).toBeNull();
  });

  it('keeps the last 20 publishes, newest first', async () => {
    const redis = fakeRedis();
    const token = await login(redis);
    for (let i = 1; i <= HISTORY_LIMIT + 3; i++) {
      await call(post({ action: 'publish', token, query: '?sheet=' + SHEET + '&range=' + i }), readyEnv, redis, NOW + i);
    }
    const r = await call(post({ action: 'history', token }), readyEnv, redis);
    expect(r.body.history).toHaveLength(HISTORY_LIMIT);
    expect(r.body.history[0].query).toContain('range=23');
    expect(r.body.history[HISTORY_LIMIT - 1].query).toContain('range=4');
  });

  it('caps the note length', async () => {
    const redis = fakeRedis();
    const token = await login(redis);
    const r = await call(post({ action: 'publish', token, query: '?sheet=' + SHEET, note: 'x'.repeat(500) }), readyEnv, redis);
    expect(r.body.published.note).toHaveLength(200);
  });
});

describe('request handling', () => {
  it('rejects other methods, malformed JSON, oversized bodies and unknown actions', async () => {
    const put = new Request('https://ladder.example/api/ladder', { method: 'PUT', body: '{}' });
    const r = await call(put, readyEnv);
    expect(r.status).toBe(405);
    expect(r.response.headers.get('allow')).toBe('GET, POST');
    expect((await call(post('{not json'), readyEnv)).status).toBe(400);
    expect((await call(post('x'.repeat(20_000)), readyEnv)).status).toBe(413);
    const redis = fakeRedis();
    const token = (await call(post({ action: 'login', password: PASSWORD }), readyEnv, redis)).body.token;
    expect((await call(post({ action: 'explode', token }), readyEnv, redis)).status).toBe(400);
  });

  it('reports a storage outage without leaking details', async () => {
    const redis = fakeRedis();
    redis.setDown(true);
    const r = await call(get(), readyEnv, redis);
    expect(r.status).toBe(502);
    expect(r.body.code).toBe('storage-error');
    expect(JSON.stringify(r.body)).not.toContain('fetch failed');
  });
});
