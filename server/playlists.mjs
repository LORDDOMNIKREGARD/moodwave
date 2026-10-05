// Reads PUBLIC playlist share links from Spotify, Apple Music and YouTube.
// Browsers can't fetch these pages (no CORS), so the local server does it.
// Best effort: these are web pages, not APIs, so a site redesign can break a parser.
// Only the three allow-listed hosts are ever contacted.

import { splitYouTubeTitle } from '../src/core/importers.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export class PlaylistError extends Error {}

/** Work out which service a link belongs to and normalise it. Throws PlaylistError if unsupported. */
export function classify(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl).trim()); } catch { throw new PlaylistError('That does not look like a link.'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new PlaylistError('Only web links are supported.');
  const host = u.hostname.replace(/^www\./, '').replace(/^music\./, '');

  if (host === 'open.spotify.com') {
    const m = /\/(playlist|album)\/([A-Za-z0-9]{22})/.exec(u.pathname);
    if (!m) throw new PlaylistError('Paste a Spotify playlist or album link (open.spotify.com/playlist/…).');
    return { source: 'spotify', url: `https://open.spotify.com/embed/${m[1]}/${m[2]}` };
  }
  if (host === 'youtube.com' || host === 'youtu.be') {
    const id = u.searchParams.get('list');
    if (!id) throw new PlaylistError('Paste a YouTube playlist or Mix link (it contains list=…).');
    if (/^RD/.test(id)) {
      // A Mix is generated from a seed song, so it is only readable through the watch page.
      const seed = /^[A-Za-z0-9_-]{11}$/.test(u.searchParams.get('v') ?? '') ? u.searchParams.get('v') : /^RD([A-Za-z0-9_-]{11})$/.exec(id)?.[1];
      if (!seed) throw new PlaylistError('Open the Mix, start a song, and copy the link from the address bar (it must contain v=… and list=RD…).');
      return { source: 'youtube', kind: 'mix', url: `https://www.youtube.com/watch?v=${seed}&list=${encodeURIComponent(id)}` };
    }
    return { source: 'youtube', url: `https://www.youtube.com/playlist?list=${encodeURIComponent(id)}` };
  }
  if (host === 'apple.com' && u.hostname === 'music.apple.com') {
    if (!/\/(playlist|album)\//.test(u.pathname)) throw new PlaylistError('Paste an Apple Music playlist or album link.');
    return { source: 'apple', url: `https://music.apple.com${u.pathname}` };
  }
  throw new PlaylistError('Supported links: open.spotify.com, music.apple.com, youtube.com playlists.');
}

async function fetchText(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...headers },
    signal: AbortSignal.timeout(20000),
    redirect: 'follow',
  });
  if (res.status === 404) throw new PlaylistError('Not found. Is the playlist public?');
  if (!res.ok) throw new PlaylistError(`The site answered HTTP ${res.status}.`);
  return res.text();
}

function walk(node, fn) {
  if (Array.isArray(node)) { for (const x of node) walk(x, fn); return; }
  if (node && typeof node === 'object') {
    fn(node);
    for (const v of Object.values(node)) walk(v, fn);
  }
}

const jsonBetween = (html, re) => {
  const m = re.exec(html);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
};

// ---------------------------------------------------------------- per-service parsers (pure; unit-tested)

export function parseSpotifyEmbed(html) {
  const data = jsonBetween(html, /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  const entity = data?.props?.pageProps?.state?.data?.entity;
  if (!entity?.trackList) throw new PlaylistError('Could not read that Spotify playlist. It may be private or the page layout changed.');
  const tracks = entity.trackList
    .filter((t) => t.title)
    .map((t) => ({
      title: t.title,
      artists: String(t.subtitle ?? '').split(/,\s*/).filter(Boolean),
      spotifyId: /spotify:track:([A-Za-z0-9]{22})/.exec(t.uri ?? '')?.[1] ?? null,
      durationMs: t.duration ?? null,
    }));
  return { name: entity.name ?? entity.title ?? 'Spotify playlist', tracks };
}

export function parseAppleMusic(html) {
  const ld = jsonBetween(html, /<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/s);
  const sd = jsonBetween(html, /<script type="application\/json" id="serialized-server-data">(.*?)<\/script>/s);
  const tracks = [];
  const seen = new Set();
  if (sd) {
    walk(sd, (o) => {
      if (typeof o.artistName !== 'string' || typeof o.title !== 'string') return;
      const id = o.contentDescriptor?.identifiers?.storeAdamID ?? o.id;
      if (o.contentDescriptor?.kind && o.contentDescriptor.kind !== 'song') return;
      if (seen.has(id ?? o.title + o.artistName)) return;
      seen.add(id ?? o.title + o.artistName);
      tracks.push({ title: o.title, artists: [o.artistName], appleId: id ? String(id) : null });
    });
  }
  if (!tracks.length) throw new PlaylistError('Could not read that Apple Music playlist. It may be private or the page layout changed.');
  return { name: ld?.name ?? 'Apple Music playlist', tracks };
}

export function parseYouTubePlaylist(html) {
  const data = jsonBetween(html, /var ytInitialData = (\{.*?\});<\/script>/s);
  if (!data) throw new PlaylistError('Could not read that YouTube playlist. It may be private.');
  const tracks = [];
  const add = (id, title, channel) => {
    if (!id || !title) return;
    const { artists, title: song } = splitYouTubeTitle(title, channel ?? '');
    tracks.push({ title: song, artists, ytId: id });
  };
  walk(data, (o) => {
    const l = o.lockupViewModel;
    if (l?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
      const md = l.metadata?.lockupMetadataViewModel;
      add(l.contentId, md?.title?.content, md?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text?.content);
    }
    const v = o.playlistVideoRenderer; // older layout
    if (v) add(v.videoId, v.title?.runs?.[0]?.text, v.shortBylineText?.runs?.[0]?.text);
  });
  if (!tracks.length) throw new PlaylistError('That YouTube playlist looks empty or private.');
  const truncated = tracks.length >= 100 && JSON.stringify(data).includes('continuationCommand');
  return { name: data.metadata?.playlistMetadataRenderer?.title ?? 'YouTube playlist', tracks, truncated };
}

/** A YouTube Mix is endless; its watch page shows the first ~25 songs in a side panel. */
export function parseYouTubeMix(html) {
  const data = jsonBetween(html, /var ytInitialData = (\{.*?\});<\/script>/s);
  const panel = data?.contents?.twoColumnWatchNextResults?.playlist?.playlist;
  if (!panel?.contents) throw new PlaylistError('Could not read that Mix. Open it, start a song, and copy the link from the address bar.');
  const tracks = [];
  for (const c of panel.contents) {
    const v = c.playlistPanelVideoRenderer;
    if (!v?.videoId) continue;
    const title = v.title?.simpleText ?? v.title?.runs?.map((r) => r.text).join('') ?? '';
    const channel = v.shortBylineText?.runs?.[0]?.text ?? '';
    const { artists, title: song } = splitYouTubeTitle(title, channel);
    if (song) tracks.push({ title: song, artists, ytId: v.videoId });
  }
  if (!tracks.length) throw new PlaylistError('That Mix looks empty.');
  return {
    name: panel.title ?? 'YouTube Mix', tracks, isMix: true,
    note: 'A YouTube Mix never ends, so this is its first songs. A personal “My Mix” differs per account; for that one, start a Mix from a song you like and share that link.',
  };
}

// ---------------------------------------------------------------- public entry

const cache = new Map();

export async function importPlaylist(rawUrl) {
  const { source, url, kind } = classify(rawUrl);
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.value;

  let parsed;
  if (source === 'spotify') parsed = parseSpotifyEmbed(await fetchText(url));
  else if (source === 'apple') parsed = parseAppleMusic(await fetchText(url));
  else if (kind === 'mix') parsed = parseYouTubeMix(await fetchText(url, { Cookie: 'CONSENT=YES+1; SOCS=CAI' }));
  else parsed = parseYouTubePlaylist(await fetchText(url, { Cookie: 'CONSENT=YES+1; SOCS=CAI' }));

  const value = { source, truncated: false, ...parsed };
  if (source === 'spotify' && parsed.tracks.length >= 100) value.truncated = true; // embed page caps at 100
  cache.set(url, { at: Date.now(), value });
  return value;
}
