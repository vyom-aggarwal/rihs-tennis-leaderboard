/**
 * A local stand-in for the Vercel deployment, used by the browser tests.
 *
 * It serves the production build from dist/, runs the real publishing function
 * (api/ladder.js) against an in-memory Redis, and serves a fixture "Google Sheet" so the
 * tests never touch the network. Not part of the deployed app.
 *
 *   node e2e/server.mjs                 publishing configured (password below)
 *   PUBLISHING=unconfigured node ...    the API exists but storage is not connected
 *   PUBLISHING=off node ...             no API at all, as on a static host
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleLadderRequest } from '../api/ladder.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const port = Number(process.env.PORT ?? 4173);
const publishing = process.env.PUBLISHING ?? 'on';

export const E2E_PASSWORD = 'rihs-e2e-password';
export const E2E_SHEET_ID = 'E2EFixtureSheet00000000000000000000000000';

const env =
  publishing === 'on'
    ? { COACH_PASSWORD: E2E_PASSWORD, KV_REST_API_URL: 'http://memory.local', KV_REST_API_TOKEN: 'memory' }
    : { COACH_PASSWORD: E2E_PASSWORD };

// --- In-memory Redis speaking Upstash's REST pipeline protocol -------------
const strings = new Map();
const lists = new Map();

function runCommand([name, key, ...args]) {
  switch (name) {
    case 'GET': return strings.get(key) ?? null;
    case 'SET': strings.set(key, args[0]); return 'OK';
    case 'DEL': return strings.delete(key) ? 1 : 0;
    case 'INCR': { const n = Number(strings.get(key) ?? 0) + 1; strings.set(key, String(n)); return n; }
    case 'EXPIRE': return 1;
    case 'LPUSH': { const l = lists.get(key) ?? []; l.unshift(...args); lists.set(key, l); return l.length; }
    case 'LTRIM': { const l = lists.get(key) ?? []; lists.set(key, l.slice(Number(args[0]), Number(args[1]) + 1)); return 'OK'; }
    case 'LRANGE': return (lists.get(key) ?? []).slice(Number(args[0]), Number(args[1]) + 1);
    default: throw new Error('unsupported command ' + name);
  }
}

const memoryRedis = async (_url, init) => {
  const commands = JSON.parse(String(init.body));
  return new Response(JSON.stringify(commands.map((c) => ({ result: runCommand(c) }))), { status: 200 });
};

// --- Fixture sheet tabs -----------------------------------------------------
const FIXTURE_TABS = {
  '0': 'sample-data/demo-matches.csv',
  '111': 'sample-data/demo-roster.csv',
  '222': 'sample-data/demo-doubles.csv',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.csv': 'text/csv; charset=utf-8',
};

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/api/ladder') {
      if (publishing === 'off') {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
        return;
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      }
      headers.set('x-forwarded-for', req.socket.remoteAddress ?? '127.0.0.1');
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      const request = new Request('http://localhost' + req.url, {
        method: req.method,
        headers,
        body: hasBody ? await readBody(req) : undefined,
      });
      const response = await handleLadderRequest(request, env, { fetchImpl: memoryRedis });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    if (url.pathname.startsWith('/__e2e__/sheet/')) {
      const file = FIXTURE_TABS[url.pathname.slice('/__e2e__/sheet/'.length)];
      if (!file) {
        res.writeHead(404, { 'Content-Type': 'text/html' }).end('<html>not found</html>');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME['.csv'] }).end(await readFile(join(root, file)));
      return;
    }

    if (url.pathname === '/__e2e__/fixture-sheets.js') {
      res.writeHead(200, { 'Content-Type': MIME['.js'] }).end(await readFile(join(root, 'e2e', 'fixture-sheets.js')));
      return;
    }

    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const path = normalize(join(dist, relative));
    if (!path.startsWith(dist + sep)) {
      res.writeHead(403).end();
      return;
    }
    let body = await readFile(path);
    if (relative === 'index.html') {
      // Route the fixture sheet's Google requests to this server before the app starts.
      body = Buffer.from(
        body.toString('utf8').replace('<head>', '<head><script src="/__e2e__/fixture-sheets.js"></script>'),
      );
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream' }).end(body);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    console.error(error);
    res.writeHead(500, { 'Content-Type': 'text/plain' }).end('Server error');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`e2e server on http://127.0.0.1:${port} (publishing: ${publishing})`);
});
