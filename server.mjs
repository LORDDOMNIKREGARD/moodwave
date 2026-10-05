// Moodwave local server: serves the built app (./dist) and exposes /api/playlist for importing public playlist links.
// Zero dependencies. Listens on 127.0.0.1 only (Spotify's OAuth also requires the loopback IP, not "localhost").
//   node server.mjs            ->  http://127.0.0.1:8787

import http from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importPlaylist, PlaylistError } from './server/playlists.mjs';
import { appleChart } from './server/charts.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'dist'); // `npm run build` writes this
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 8787;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json',
};

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  if (url.pathname === '/api/playlist') {
    try {
      send(res, 200, await importPlaylist(url.searchParams.get('url') ?? ''));
    } catch (e) {
      const known = e instanceof PlaylistError;
      send(res, known ? 400 : 502, { error: known ? e.message : `Could not reach the site (${e.message}).` });
    }
    return;
  }

  if (url.pathname === '/api/chart') {
    try {
      send(res, 200, await appleChart(url.searchParams.get('country') ?? 'us'));
    } catch (e) {
      send(res, 502, { error: `Could not load the chart (${e.message}).` });
    }
    return;
  }

  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(ROOT, rel));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) return send(res, 403, 'Forbidden', 'text/plain');
  try {
    send(res, 200, await readFile(file), MIME[extname(file)] ?? 'application/octet-stream');
  } catch {
    const built = await access(join(ROOT, 'index.html')).then(() => true, () => false);
    send(res, built ? 404 : 503, built ? 'Not found' : 'The app has not been built yet. Run: npm install && npm run build', 'text/plain');
  }
});

server.listen(PORT, HOST, () => console.log(`Moodwave running at http://${HOST}:${PORT}`));
