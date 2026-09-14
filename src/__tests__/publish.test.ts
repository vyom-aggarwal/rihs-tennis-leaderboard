import { describe, expect, it } from 'vitest';
import {
  coachLogin,
  fetchLadderStatus,
  PublishError,
  publishHistory,
  publishLadder,
  verifyCoachSession,
} from '../lib/publish';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

const respond = (response: Response) => (async () => response) as unknown as typeof fetch;

const PUBLISHED = { query: '?sheet=abc123', publishedAt: '2026-09-13T12:00:00.000Z', note: 'Season start' };
const SESSION = { token: 'v1.1.sig', expiresAt: Date.now() + 60_000 };

describe('fetchLadderStatus', () => {
  it('reports no publishing API on a static host, so the app uses link sharing', async () => {
    expect(await fetchLadderStatus(respond(new Response('Not found', { status: 404 })))).toBeNull();
    // Some static hosts answer every path with the index page.
    const html = new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    expect(await fetchLadderStatus(respond(html))).toBeNull();
  });

  it('returns the published ladder', async () => {
    const status = await fetchLadderStatus(respond(json(200, { publishing: 'ready', published: PUBLISHED })));
    expect(status).toEqual({ publishing: 'ready', published: PUBLISHED });
  });

  it('ignores a malformed published entry rather than loading it', async () => {
    const status = await fetchLadderStatus(respond(json(200, { publishing: 'ready', published: { query: 'nope' } })));
    expect(status).toEqual({ publishing: 'ready', published: null });
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
    const attempt = coachLogin('nope', respond(json(401, { error: 'That password is not right.', code: 'wrong-password' })));
    await expect(attempt).rejects.toBeInstanceOf(PublishError);
    await expect(
      coachLogin('nope', respond(json(401, { error: 'That password is not right.', code: 'wrong-password' }))),
    ).rejects.toMatchObject({ status: 401, code: 'wrong-password', message: 'That password is not right.' });
  });

  it('sends the token, settings and note when publishing', async () => {
    let sent: Record<string, unknown> = {};
    const capture = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return json(200, { published: PUBLISHED });
    }) as unknown as typeof fetch;
    expect(await publishLadder(SESSION, '?sheet=abc123', 'Season start', capture)).toEqual(PUBLISHED);
    expect(sent).toEqual({ action: 'publish', token: SESSION.token, query: '?sheet=abc123', note: 'Season start' });
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
