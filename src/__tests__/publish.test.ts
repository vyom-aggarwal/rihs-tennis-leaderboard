import { describe, expect, it, vi } from 'vitest';
import {
  coachLogin,
  fetchLadderStatus,
  PublishError,
  publishHistory,
  publishLadder,
  readCoachSession,
  refreshLadder,
  saveCoachSession,
  verifyCoachSession,
} from '../lib/publish';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

const respond = (response: Response) => (async () => response) as unknown as typeof fetch;

const PUBLISHED = { query: '?sheet=abc123', publishedAt: '2026-09-13T12:00:00.000Z', note: 'Season start', coach: 'Lokesh' };
const LAST_UPDATE = { coach: 'Lokesh', at: '2026-09-13T12:00:00.000Z', kind: 'refresh' as const };
const SESSION = { token: 'v1.1.sig', expiresAt: Date.now() + 60_000, coachName: 'Lokesh' };

describe('fetchLadderStatus', () => {
  it('reports no publishing API on a static host, so the app uses link sharing', async () => {
    expect(await fetchLadderStatus(respond(new Response('Not found', { status: 404 })))).toBeNull();
    // Some static hosts answer every path with the index page.
    const html = new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    expect(await fetchLadderStatus(respond(html))).toBeNull();
  });

  it('returns the published ladder', async () => {
    const status = await fetchLadderStatus(respond(json(200, { publishing: 'ready', published: PUBLISHED })));
    expect(status).toEqual({ publishing: 'ready', published: PUBLISHED, lastUpdate: null, lockedSheet: null });
  });

  it('returns who last refreshed the ladder, and the locked sheet', async () => {
    const lockedSheet = { sheet: 'abc123abc123abc123abc123', gid: '0' };
    const status = await fetchLadderStatus(
      respond(json(200, { publishing: 'ready', published: null, lastUpdate: LAST_UPDATE, lockedSheet })),
    );
    expect(status).toMatchObject({ lastUpdate: LAST_UPDATE, lockedSheet });
  });

  it('ignores a malformed last update, and treats an older published entry as having no coach', async () => {
    const { coach: _coach, ...older } = PUBLISHED;
    const status = await fetchLadderStatus(
      respond(json(200, { publishing: 'ready', published: older, lastUpdate: { coach: '', at: 'nope' } })),
    );
    expect(status).toEqual({ publishing: 'ready', published: { ...older, coach: '' }, lastUpdate: null, lockedSheet: null });
  });

  it('ignores a malformed published entry rather than loading it', async () => {
    const status = await fetchLadderStatus(respond(json(200, { publishing: 'ready', published: { query: 'nope' } })));
    expect(status).toMatchObject({ publishing: 'ready', published: null });
  });

  it('surfaces a storage outage with the server message', async () => {
    await expect(
      fetchLadderStatus(respond(json(502, { error: 'The ladder storage could not be reached.' }))),
    ).rejects.toMatchObject({ status: 502, message: 'The ladder storage could not be reached.' });
  });

  it('reports a network failure distinctly', async () => {
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(fetchLadderStatus(offline)).rejects.toMatchObject({ code: 'network' });
  });
});

describe('coach actions', () => {
  it('passes the server message through on a wrong password', async () => {
    const attempt = coachLogin('nope', 'Lokesh', respond(json(401, { error: 'That password is not right.', code: 'wrong-password' })));
    await expect(attempt).rejects.toBeInstanceOf(PublishError);
    await expect(
      coachLogin('nope', 'Lokesh', respond(json(401, { error: 'That password is not right.', code: 'wrong-password' }))),
    ).rejects.toMatchObject({ status: 401, code: 'wrong-password', message: 'That password is not right.' });
  });

  it('keeps the coach name typed at sign-in on the session, trimmed', async () => {
    const session = await coachLogin('pw', '  Lokesh ', respond(json(200, { token: 'v1.1.sig', expiresAt: 5 })));
    expect(session).toEqual({ token: 'v1.1.sig', expiresAt: 5, coachName: 'Lokesh' });
  });

  it('sends the token, coach name, settings and note when publishing', async () => {
    let sent: Record<string, unknown> = {};
    const capture = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return json(200, { published: PUBLISHED, lastUpdate: { ...LAST_UPDATE, kind: 'publish' } });
    }) as unknown as typeof fetch;
    const result = await publishLadder(SESSION, '?sheet=abc123', 'Season start', capture);
    expect(result.published).toEqual(PUBLISHED);
    expect(result.lastUpdate.kind).toBe('publish');
    expect(sent).toEqual({
      action: 'publish',
      token: SESSION.token,
      name: 'Lokesh',
      query: '?sheet=abc123',
      note: 'Season start',
    });
  });

  it('records a refresh under the coach name', async () => {
    let sent: Record<string, unknown> = {};
    const capture = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return json(200, { lastUpdate: LAST_UPDATE });
    }) as unknown as typeof fetch;
    expect(await refreshLadder(SESSION, capture)).toEqual(LAST_UPDATE);
    expect(sent).toEqual({ action: 'refresh', token: SESSION.token, name: 'Lokesh' });
  });

  it('passes the name-required message through', async () => {
    await expect(
      refreshLadder(SESSION, respond(json(400, { error: 'Enter your name.', code: 'name-required' }))),
    ).rejects.toMatchObject({ status: 400, code: 'name-required' });
  });

  it('treats a 401 on verify as an ended session, and other failures as errors', async () => {
    expect(await verifyCoachSession(SESSION, respond(json(200, { ok: true })))).toBe(true);
    expect(await verifyCoachSession(SESSION, respond(json(401, { error: 'ended' })))).toBe(false);
    await expect(verifyCoachSession(SESSION, respond(json(502, { error: 'down' })))).rejects.toMatchObject({ status: 502 });
  });

  it('keeps only well-formed history entries', async () => {
    const history = await publishHistory(SESSION, respond(json(200, { history: [PUBLISHED, { query: 5 }] })));
    expect(history).toEqual([PUBLISHED]);
  });
});

describe('coach session storage', () => {
  const store = new Map<string, string>();
  const fakeStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  const withStorage = (run: () => void) => {
    store.clear();
    vi.stubGlobal('localStorage', fakeStorage);
    try {
      run();
    } finally {
      vi.unstubAllGlobals();
    }
  };

  it('round-trips the session with its coach name', () =>
    withStorage(() => {
      saveCoachSession(SESSION);
      expect(readCoachSession()).toEqual(SESSION);
    }));

  it('asks a coach saved before names existed to sign in again', () =>
    withStorage(() => {
      store.set('rihs:coach-session', JSON.stringify({ token: SESSION.token, expiresAt: SESSION.expiresAt }));
      expect(readCoachSession()).toBeNull();
    }));
});
