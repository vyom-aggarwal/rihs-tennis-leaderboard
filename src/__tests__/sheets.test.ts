import { describe, expect, it } from 'vitest';
import { csvEndpoints, fetchSheetCsv, parseSheetUrl, sheetCacheKey, sheetEditUrl, SheetError } from '../lib/sheets';

const DOC = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
const PUB = '2PACX-1vQx7Yk3nFMdKvBdBZjgmUUqptlbs74OgvE2upms';

describe('parseSheetUrl', () => {
  it('reads a standard edit link', () => {
    const ref = parseSheetUrl('https://docs.google.com/spreadsheets/d/' + DOC + '/edit#gid=0');
    expect(ref.docId).toBe(DOC);
    expect(ref.gid).toBe('0');
    expect(ref.pubId).toBeNull();
  });

  it('reads a gid from a query string as well as a fragment', () => {
    expect(parseSheetUrl('https://docs.google.com/spreadsheets/d/' + DOC + '/edit?gid=123456').gid).toBe('123456');
    expect(parseSheetUrl('https://docs.google.com/spreadsheets/d/' + DOC + '/edit#gid=789').gid).toBe('789');
  });

  it('reads a publish-to-web link', () => {
    const ref = parseSheetUrl('https://docs.google.com/spreadsheets/d/e/' + PUB + '/pubhtml?gid=0');
    expect(ref.pubId).toBe(PUB);
    expect(ref.docId).toBe('');
  });

  it('accepts a bare document id', () => {
    expect(parseSheetUrl(DOC).docId).toBe(DOC);
  });

  it('accepts a link with no gid', () => {
    expect(parseSheetUrl('https://docs.google.com/spreadsheets/d/' + DOC + '/edit').gid).toBeNull();
  });

  it('trims surrounding whitespace from a pasted link', () => {
    expect(parseSheetUrl('  https://docs.google.com/spreadsheets/d/' + DOC + '/edit  ').docId).toBe(DOC);
  });

  it('rejects an empty or non-Sheets string with a helpful message', () => {
    expect(() => parseSheetUrl('')).toThrow(SheetError);
    expect(() => parseSheetUrl('hello')).toThrow(/does not look like a Google Sheets link/i);
    expect(() => parseSheetUrl('https://example.com/foo')).toThrow(SheetError);
  });
});

describe('csvEndpoints', () => {
  it('tries gviz, export and pub for a standard doc', () => {
    const urls = csvEndpoints({ docId: DOC, pubId: null, gid: '0' });
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain('gviz/tq?tqx=out:csv');
    expect(urls[1]).toContain('export?format=csv');
    expect(urls.every((u) => u.includes('gid=0'))).toBe(true);
  });

  it('uses only the published endpoint for a publish-to-web id', () => {
    const urls = csvEndpoints({ docId: '', pubId: PUB, gid: null });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('/d/e/' + PUB + '/pub?output=csv');
  });
});

describe('fetchSheetCsv', () => {
  const ref = { docId: DOC, pubId: null, gid: '0' };
  const ok = (body: string) => ({ ok: true, status: 200, text: async () => body }) as Response;

  it('returns CSV from the first endpoint that works', async () => {
    const calls: string[] = [];
    const csv = await fetchSheetCsv(ref, {
      fetchImpl: (async (url: string) => {
        calls.push(url);
        return ok('a,b\n1,2');
      }) as unknown as typeof fetch,
    });
    expect(csv).toBe('a,b\n1,2');
    expect(calls).toHaveLength(1);
  });

  it('cache-busts every request so a teammate never sees a stale ladder', async () => {
    let seen = '';
    await fetchSheetCsv(ref, {
      fetchImpl: (async (url: string) => {
        seen = url;
        return ok('a\n1');
      }) as unknown as typeof fetch,
    });
    expect(seen).toMatch(/_cb=\d+/);
  });

  it('falls through to the next endpoint on an HTTP error', async () => {
    let n = 0;
    const csv = await fetchSheetCsv(ref, {
      fetchImpl: (async () => {
        n += 1;
        if (n === 1) return { ok: false, status: 400, text: async () => '' } as Response;
        return ok('a\n1');
      }) as unknown as typeof fetch,
    });
    expect(csv).toBe('a\n1');
    expect(n).toBe(2);
  });

  it('treats a returned sign-in page as a sharing problem, not a parse error', async () => {
    // Google serves its permission page as HTML with status 200, so this is the case
    // that would otherwise reach the CSV parser and produce nonsense.
    await expect(
      fetchSheetCsv(ref, {
        fetchImpl: (async () => ok('<!DOCTYPE html><html><head><title>Sign in</title>')) as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ kind: 'not-shared' });
  });

  it('explains how to fix sharing when every endpoint returns HTML', async () => {
    try {
      await fetchSheetCsv(ref, {
        fetchImpl: (async () => ok('<html><body>Request access</body></html>')) as unknown as typeof fetch,
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as SheetError).message).toMatch(/Anyone with the link/i);
      expect((err as SheetError).attempts.length).toBeGreaterThan(0);
    }
  });

  it('reports a network failure distinctly from a sharing failure', async () => {
    await expect(
      fetchSheetCsv(ref, {
        fetchImpl: (async () => {
          throw new Error('Failed to fetch');
        }) as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ kind: 'network' });
  });

  it('skips an empty response and keeps trying', async () => {
    let n = 0;
    const csv = await fetchSheetCsv(ref, {
      fetchImpl: (async () => {
        n += 1;
        return ok(n === 1 ? '   ' : 'a\n1');
      }) as unknown as typeof fetch,
    });
    expect(csv).toBe('a\n1');
  });
});

describe('sheet helpers', () => {
  it('builds an edit URL for both link shapes', () => {
    expect(sheetEditUrl({ docId: DOC, pubId: null, gid: '5' })).toBe(
      'https://docs.google.com/spreadsheets/d/' + DOC + '/edit#gid=5',
    );
    expect(sheetEditUrl({ docId: '', pubId: PUB, gid: null })).toContain('/d/e/' + PUB + '/pubhtml');
  });

  it('produces a stable cache key per sheet and tab', () => {
    const a = sheetCacheKey({ docId: DOC, pubId: null, gid: '0' });
    const b = sheetCacheKey({ docId: DOC, pubId: null, gid: '1' });
    expect(a).toBe(sheetCacheKey({ docId: DOC, pubId: null, gid: '0' }));
    expect(a).not.toBe(b);
  });
});
