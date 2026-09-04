/**
 * Google Sheets ingestion.
 *
 * The coach's spreadsheet *is* the database. There is no server in this architecture:
 * the coach edits the sheet, every teammate's browser fetches the same published CSV,
 * so the whole team sees identical data within one refresh interval. That keeps the
 * app free to run, impossible to get out of sync with the coach's own records, and
 * survivable if this repository is ever unmaintained - the data stays in the sheet.
 *
 * Google exposes several CSV endpoints with different sharing requirements, and which
 * one works depends on how the coach shared the file. We try them in order and report
 * precisely which failed, because "it just says error" is the worst possible outcome
 * for a coach five minutes before a match.
 */

export interface SheetRef {
  /** Document id from /spreadsheets/d/<id>/ */
  docId: string;
  /** Publish-to-web id from /spreadsheets/d/e/<pubId>/ - mutually exclusive with docId. */
  pubId: string | null;
  /** Tab id. Null means "first tab". */
  gid: string | null;
}

export class SheetError extends Error {
  readonly kind: 'invalid-url' | 'not-shared' | 'network' | 'empty' | 'not-found';
  readonly attempts: string[];

  constructor(
    kind: SheetError['kind'],
    message: string,
    attempts: string[] = [],
  ) {
    super(message);
    this.name = 'SheetError';
    this.kind = kind;
    this.attempts = attempts;
  }
}

/**
 * Accepts anything a coach is likely to paste:
 *   https://docs.google.com/spreadsheets/d/<id>/edit#gid=0
 *   https://docs.google.com/spreadsheets/d/<id>/edit?gid=123456
 *   https://docs.google.com/spreadsheets/d/e/2PACX-.../pubhtml?gid=0
 *   https://docs.google.com/spreadsheets/d/e/2PACX-.../pub?output=csv
 *   <id>                                    (the bare document id)
 */
export function parseSheetUrl(input: string): SheetRef {
  const text = (input ?? '').trim();
  if (!text) throw new SheetError('invalid-url', 'Paste a Google Sheets link to get started.');

  // Publish-to-web form: /spreadsheets/d/e/<pubId>/
  const pub = text.match(/\/spreadsheets\/d\/e\/([A-Za-z0-9_-]+)/);
  if (pub) {
    return { docId: '', pubId: pub[1]!, gid: extractGid(text) };
  }

  // Standard form: /spreadsheets/d/<docId>/
  const doc = text.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (doc) {
    return { docId: doc[1]!, pubId: null, gid: extractGid(text) };
  }

  // A bare document id. Google ids are long; the length guard avoids treating a typo
  // or a stray word as an id and then reporting a confusing network failure.
  if (/^[A-Za-z0-9_-]{20,}$/.test(text)) {
    return { docId: text, pubId: null, gid: null };
  }

  throw new SheetError(
    'invalid-url',
    'That does not look like a Google Sheets link. It should look like ' +
      'https://docs.google.com/spreadsheets/d/…/edit',
  );
}

function extractGid(text: string): string | null {
  const m = text.match(/[#?&]gid=([0-9]+)/);
  return m ? m[1]! : null;
}

/** Candidate CSV endpoints, in the order we try them. */
export function csvEndpoints(ref: SheetRef): string[] {
  const gidParam = ref.gid ? '&gid=' + ref.gid : '';
  const urls: string[] = [];

  if (ref.pubId) {
    urls.push(
      'https://docs.google.com/spreadsheets/d/e/' + ref.pubId + '/pub?output=csv' + gidParam,
    );
    return urls;
  }

  // gviz is the most permissive endpoint for "anyone with the link can view" sheets.
  urls.push(
    'https://docs.google.com/spreadsheets/d/' + ref.docId + '/gviz/tq?tqx=out:csv' + gidParam,
  );
  // The plain export endpoint works for link-shared sheets and returns cleaner CSV.
  urls.push(
    'https://docs.google.com/spreadsheets/d/' +
      ref.docId +
      '/export?format=csv' +
      (ref.gid ? '&gid=' + ref.gid : ''),
  );
  // Finally the publish-to-web endpoint, in case the coach published the doc id itself.
  urls.push('https://docs.google.com/spreadsheets/d/' + ref.docId + '/pub?output=csv' + gidParam);
  return urls;
}

/**
 * Google serves its "you need permission" page as HTML with a 200 status, so a naive
 * fetch happily returns a sign-in page and the app would try to parse it as CSV.
 */
function looksLikeHtml(body: string): boolean {
  const head = body.slice(0, 400).toLowerCase();
  return head.includes('<!doctype html') || head.includes('<html') || head.includes('<head>');
}

export interface FetchOptions {
  signal?: AbortSignal;
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Fetch a sheet tab as CSV text, trying each endpoint until one returns usable CSV.
 * Throws a SheetError whose `kind` tells the UI which remedy to suggest.
 */
export async function fetchSheetCsv(ref: SheetRef, options: FetchOptions = {}): Promise<string> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw new SheetError('network', 'This browser does not support fetch.');
  }

  const attempts: string[] = [];
  let sawHtml = false;

  for (const url of csvEndpoints(ref)) {
    // Cache-bust so a teammate refreshing mid-match is never served a stale copy by
    // the browser or an intermediate CDN.
    const busted = url + (url.includes('?') ? '&' : '?') + '_cb=' + Date.now();
    try {
      const res = await doFetch(busted, {
        signal: options.signal,
        redirect: 'follow',
        cache: 'no-store',
      });

      if (!res.ok) {
        attempts.push(endpointLabel(url) + ' -> HTTP ' + res.status);
        if (res.status === 401 || res.status === 403) sawHtml = true;
        continue;
      }

      const body = await res.text();

      if (looksLikeHtml(body)) {
        sawHtml = true;
        attempts.push(endpointLabel(url) + ' -> returned a sign-in page, not CSV');
        continue;
      }
      if (body.trim() === '') {
        attempts.push(endpointLabel(url) + ' -> empty response');
        continue;
      }
      return body;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      attempts.push(endpointLabel(url) + ' -> ' + (err as Error).message);
    }
  }

  if (sawHtml) {
    throw new SheetError(
      'not-shared',
      'The sheet is not readable publicly. In Google Sheets choose Share -> General access -> ' +
        '"Anyone with the link" -> Viewer, then try again.',
      attempts,
    );
  }
  throw new SheetError(
    'network',
    'Could not reach the sheet. Check the link and your connection, then try again.',
    attempts,
  );
}

function endpointLabel(url: string): string {
  if (url.includes('gviz')) return 'gviz CSV';
  if (url.includes('export?format=csv')) return 'export CSV';
  return 'published CSV';
}

/** Build the coach-facing sheet URL for a ref, for "Open in Google Sheets" links. */
export function sheetEditUrl(ref: SheetRef): string {
  if (ref.pubId) return 'https://docs.google.com/spreadsheets/d/e/' + ref.pubId + '/pubhtml';
  return (
    'https://docs.google.com/spreadsheets/d/' +
    ref.docId +
    '/edit' +
    (ref.gid ? '#gid=' + ref.gid : '')
  );
}

/** Stable identity for caching - the same sheet+tab always yields the same key. */
export function sheetCacheKey(ref: SheetRef): string {
  return 'rihs:sheet:' + (ref.pubId ? 'e/' + ref.pubId : ref.docId) + ':' + (ref.gid ?? 'first');
}
