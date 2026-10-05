// Network clients for the two keyless services Moodwave leans on:
//   * ReccoBeats  - audio features (tempo / energy / valence ...) + similar-track discovery.
//     Spotify switched those endpoints off for new apps in Nov 2024; ReccoBeats serves the same
//     vector, addressable by Spotify ID or ISRC, with no API key.
//   * iTunes Search - genre, artwork, 30s preview, Apple Music link.
// Works in the browser and in Node (the catalog build script). Caching is injectable.

import { bestMatch, cleanTitle, artistList } from './match.js';

const RB = 'https://api.reccobeats.com/v1';
const ITUNES = 'https://itunes.apple.com/search';
const SPOTIFY_ID = /track\/([A-Za-z0-9]{22})/;

export const spotifyIdFromHref = (href) => SPOTIFY_ID.exec(href ?? '')?.[1] ?? null;

export function memoryCache() {
  const m = new Map();
  return { get: (k) => m.get(k), set: (k, v) => void m.set(k, v) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run at most `max` jobs at once, starting no two jobs closer than `gap` ms (ReccoBeats 429s on bursts). */
export function createLimiter(max, gap = 0) {
  let active = 0;
  let nextStart = 0;
  let timer = null;
  const waiting = [];
  const pump = () => {
    if (timer || active >= max || !waiting.length) return;
    const wait = nextStart - Date.now();
    if (wait > 0) { timer = setTimeout(() => { timer = null; pump(); }, wait); return; }
    nextStart = Date.now() + gap;
    active++;
    const { fn, resolve, reject } = waiting.shift();
    fn().then(resolve, reject).finally(() => { active--; pump(); });
    pump();
  };
  return (fn) => new Promise((resolve, reject) => { waiting.push({ fn, resolve, reject }); pump(); });
}

async function getJson(url, { fetchImpl, tries = 4 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
      if (res.status === 429 || res.status === 403 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after')) || 0;
        lastErr = new Error(`HTTP ${res.status}`);
        if (i < tries - 1) await sleep(Math.max(retryAfter * 1000, 1500 * 2 ** i));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return JSON.parse(await res.text()); // iTunes serves JSON as text/javascript
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await sleep(400 * 2 ** i);
    }
  }
  throw lastErr;
}

const num = (v) => (Number.isFinite(+v) ? +v : null);

export function normFeatures(r) {
  return {
    tempo: num(r.tempo),
    energy: num(r.energy),
    valence: num(r.valence),
    danceability: num(r.danceability),
    acousticness: num(r.acousticness),
    instrumentalness: num(r.instrumentalness),
    speechiness: num(r.speechiness),
    liveness: num(r.liveness),
    loudness: num(r.loudness),
    key: num(r.key),
    mode: num(r.mode),
  };
}

const hasCore = (f) => f && f.tempo != null && f.energy != null && f.valence != null;

export function createApi({ fetchImpl = globalThis.fetch.bind(globalThis), cache = memoryCache() } = {}) {
  const limit = createLimiter(2, 450);
  const itunesLimit = createLimiter(1, 800); // iTunes answers 403 when hammered; background work stays gentle
  let itunesPausedUntil = 0;
  const urgentLimit = createLimiter(2, 350); // a hover preview someone is waiting for goes through its own lane
  const get = (url) => limit(() => getJson(url, { fetchImpl }));

  const cached = async (key, producer) => {
    const hit = cache.get(key);
    if (hit !== undefined) return hit === 0 ? null : hit;
    const val = await producer();
    cache.set(key, val ?? 0);
    return val ?? null;
  };

  const mapRbTrack = (t) => ({
    recId: t.id,
    title: t.trackTitle,
    artists: (t.artists ?? []).map((a) => a.name),
    spotifyId: spotifyIdFromHref(t.href),
    isrc: t.isrc ?? null,
    durationMs: t.durationMs ?? null,
    popularity: t.popularity ?? 0,
  });

  /** Spotify IDs -> Map<spotifyId, features>. Unknown ids are simply absent. */
  async function featuresBySpotifyIds(ids) {
    const out = new Map();
    const todo = [];
    for (const id of new Set(ids.filter(Boolean))) {
      const hit = cache.get(`rbf:${id}`);
      if (hit === undefined) todo.push(id);
      else if (hit !== 0) out.set(id, hit);
    }
    const chunks = [];
    for (let i = 0; i < todo.length; i += 40) chunks.push(todo.slice(i, i + 40));
    await Promise.all(chunks.map(async (chunk) => {
      const got = new Set();
      try {
        const j = await get(`${RB}/audio-features?ids=${chunk.join(',')}`);
        for (const row of j.content ?? []) {
          const id = spotifyIdFromHref(row.href);
          const f = normFeatures(row);
          if (id && hasCore(f)) { out.set(id, f); cache.set(`rbf:${id}`, f); got.add(id); }
        }
        for (const id of chunk) if (!got.has(id)) cache.set(`rbf:${id}`, 0);
      } catch { /* network hiccup: leave uncached so a later call retries */ }
    }));
    return out;
  }

  /** Metadata (title, artists, ISRC) for bare Spotify IDs, e.g. when someone pastes only links. */
  async function tracksBySpotifyIds(ids) {
    const out = new Map();
    const unique = [...new Set(ids.filter(Boolean))];
    for (let i = 0; i < unique.length; i += 40) {
      const chunk = unique.slice(i, i + 40);
      try {
        const j = await get(`${RB}/track?ids=${chunk.join(',')}`);
        for (const t of j.content ?? []) { const m = mapRbTrack(t); if (m.spotifyId) out.set(m.spotifyId, m); }
      } catch { /* skip chunk */ }
    }
    return out;
  }

  /** ReccoBeats track search is title-only; we filter by artist ourselves. */
  async function searchTitle(title, size = 25) {
    const q = cleanTitle(title);
    if (!q) return [];
    return cached(`rbs:${q}`, async () => {
      const j = await get(`${RB}/track/search?searchText=${encodeURIComponent(q)}&size=${size}`);
      return (j.content ?? []).map(mapRbTrack).filter((t) => t.spotifyId);
    }).then((r) => r ?? []);
  }

  /** {title, artists} -> {spotifyId, isrc, title, artists, features} | null */
  async function resolveTrack(want, opts) {
    const results = await searchTitle(want.title);
    const best = bestMatch(want, results, opts);
    if (!best) return null;
    const f = (await featuresBySpotifyIds([best.item.spotifyId])).get(best.item.spotifyId);
    return f ? { ...best.item, features: f } : null;
  }

  /** Similar-track discovery. Targets are soft hints; Moodwave re-ranks everything itself. */
  async function recommend({ seeds, size = 40, targets = {} }) {
    const p = new URLSearchParams({ size: String(size), seeds: seeds.slice(0, 5).join(',') });
    for (const k of ['energy', 'valence', 'danceability', 'acousticness', 'tempo']) {
      if (targets[k] != null) p.set(k, String(targets[k]));
    }
    const j = await get(`${RB}/track/recommendation?${p}`);
    return (j.content ?? []).map(mapRbTrack).filter((t) => t.spotifyId);
  }

  /** Genre / artwork / preview / Apple Music link for one track. */
  function enrich(want, { urgent = false } = {}) {
    const key = `it:${cleanTitle(want.title)}|${artistList(want.artists)[0] ?? ''}`;
    const lane = urgent ? urgentLimit : itunesLimit;
    return cached(key, () => lane(async () => {
      const lead = [].concat(want.artists)[0] ?? '';
      const term = `${lead} ${cleanTitle(want.title)}`.trim();
      // rate limited a moment ago: skip. Throwing (not returning null) keeps this out of the cache, so it is retried later.
      if (Date.now() < itunesPausedUntil) throw new Error('iTunes paused');
      let j;
      try {
        j = await getJson(`${ITUNES}?term=${encodeURIComponent(term)}&entity=song&limit=6`, { fetchImpl, tries: 1 });
      } catch (e) {
        if (/403|429/.test(e.message)) itunesPausedUntil = Date.now() + 30_000;
        throw e;
      }
      const cands = (j.results ?? []).map((r) => ({
        title: r.trackName, artists: [r.artistName], raw: r,
      }));
      const best = bestMatch(want, cands);
      if (!best) return null;
      const r = best.item.raw;
      return {
        appleId: String(r.trackId),
        appleArtistId: r.artistId ? String(r.artistId) : null,
        appleUrl: r.trackViewUrl,
        preview: r.previewUrl ?? null,
        art: r.artworkUrl100?.replace('100x100bb', '300x300bb') ?? null,
        genre: r.primaryGenreName ?? null,
        year: r.releaseDate ? +r.releaseDate.slice(0, 4) : null,
        durationMs: r.trackTimeMillis ?? null,
      };
    })).catch(() => null);
  }

  return { featuresBySpotifyIds, tracksBySpotifyIds, searchTitle, resolveTrack, recommend, enrich };
}
