// "Fresh drops": a live feed of new releases scored against your taste and the active mood tab.
//
// Sources (all keyless):
//   * artists you follow  - iTunes lookup, sorted by release date (latest songs per artist)
//   * the country chart   - Apple's most-played feed, kept only if released within the window
// Audio features for brand-new songs:
//   * ReccoBeats has none for tracks only days old, so we measure the 30-second preview in the
//     browser (audio.js) and mark the result `estimated`.
//   * Older releases are looked up in ReccoBeats first and keep real features.

import { artistList, cleanTitle } from './match.js';
import { analyzePreview, estimateFeatures } from './audio.js';
import { createLimiter } from './api.js';
import { API_BASE } from './apiBase.js';
import { familiesOf, hasFeatures } from './engine.js';

const ITUNES = 'https://itunes.apple.com';
// DJ-mix edits ("... (Mixed)"), karaoke and the like are not what anyone means by a new release
const SKIP_TITLE = /\b(karaoke|tribute|instrumental|dj mix)\b|[(\[]\s*mixed\s*[)\]]/i;
const REAL_FEATURES_AFTER_DAYS = 45; // ReccoBeats coverage of recent releases lags by weeks

const itunesLimit = createLimiter(1, 700);
const analysisLimit = createLimiter(2);
const daysSince = (iso) => (Date.now() - Date.parse(iso)) / 864e5;

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(await res.text());
}

const hi = (u) => u?.replace('100x100bb', '300x300bb') ?? null;

function fromITunesTrack(r, extra = {}) {
  return {
    key: `ap:${r.trackId}`,
    appleId: String(r.trackId),
    appleArtistId: String(r.artistId ?? ''),
    title: r.trackName,
    artists: [r.artistName],
    genres: [r.primaryGenreName].filter(Boolean),
    art: hi(r.artworkUrl100),
    preview: r.previewUrl ?? null,
    appleUrl: r.trackViewUrl,
    releaseDate: r.releaseDate,
    year: r.releaseDate ? +r.releaseDate.slice(0, 4) : null,
    source: 'fresh',
    ...extra,
  };
}

/** Apple artist id for a name (cached by the caller via `cache`). */
export async function appleArtistId(name, cache) {
  const key = `aid:${name.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit === 0 ? null : hit;
  const j = await itunesLimit(() => getJson(`${ITUNES}/search?term=${encodeURIComponent(name)}&entity=musicArtist&limit=3`));
  const want = artistList(name);
  const found = (j.results ?? []).find((a) => artistList(a.artistName).some((x) => want.includes(x)));
  const id = found ? String(found.artistId) : null;
  cache.set(key, id ?? 0);
  return id;
}

export async function latestByArtist(artistId, days, country) {
  const j = await itunesLimit(() => getJson(`${ITUNES}/lookup?id=${artistId}&entity=song&sort=recent&limit=12&country=${country}`));
  return (j.results ?? [])
    .filter((r) => r.wrapperType === 'track' && r.kind === 'song' && r.releaseDate && daysSince(r.releaseDate) <= days && !SKIP_TITLE.test(r.trackName))
    .map((r) => fromITunesTrack(r, { via: 'artist' }));
}

/** Chart songs released within `days`; previews are fetched in one batched lookup. */
export async function recentFromChart(country, days) {
  const res = await fetch(`${API_BASE}/api/chart?country=${country}`);
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new Error(j?.error ?? 'the chart needs the Moodwave server, which this deployment does not have');
  }
  const chart = await res.json();
  const recent = chart.songs.filter((s) => s.releaseDate && daysSince(s.releaseDate) <= days && !SKIP_TITLE.test(s.title));
  if (!recent.length) return [];
  const byId = new Map();
  for (let i = 0; i < recent.length; i += 50) {
    const ids = recent.slice(i, i + 50).map((s) => s.appleId).join(',');
    const j = await itunesLimit(() => getJson(`${ITUNES}/lookup?id=${ids}&country=${country}`));
    for (const r of j.results ?? []) if (r.wrapperType === 'track') byId.set(String(r.trackId), r);
  }
  return recent.map((s) => {
    const r = byId.get(s.appleId);
    return r ? fromITunesTrack(r, { via: 'chart' }) : {
      key: `ap:${s.appleId}`, appleId: s.appleId, title: s.title, artists: s.artists, genres: s.genres, art: s.art, preview: null,
      appleUrl: s.appleUrl, releaseDate: s.releaseDate, year: +s.releaseDate.slice(0, 4), source: 'fresh', via: 'chart',
    };
  });
}

/**
 * One refresh cycle. `followed` = [{ name }] (your most-played artists).
 * Emits partial results through onItems so the UI fills in as artists resolve.
 */
export async function discoverFresh({ followed, country = 'us', days = 30, includeChart = true, cache, onItems = () => {}, onProgress = () => {} }) {
  const byKey = new Map();
  const seenSong = new Set(); // the same song often ships as a single and again on an album
  const push = (items) => {
    let added = 0;
    for (const it of items) {
      const song = `${cleanTitle(it.title)}|${artistList(it.artists)[0] ?? ''}`;
      if (byKey.has(it.key) || seenSong.has(song)) continue;
      byKey.set(it.key, it);
      seenSong.add(song);
      added++;
    }
    if (added) onItems([...byKey.values()]);
  };
  if (includeChart) {
    onProgress('Reading the chart…');
    try { push(await recentFromChart(country, days)); } catch (e) { onProgress(`Chart unavailable: ${e.message}`); }
  }
  let done = 0;
  await Promise.all(followed.map(async (a) => {
    try {
      const id = a.appleArtistId ?? await appleArtistId(a.name, cache);
      if (id) push((await latestByArtist(id, days, country)).map((x) => ({ ...x, followedArtist: a.name })));
    } catch { /* one artist failing should not stop the feed */ }
    onProgress(`Checked ${++done}/${followed.length} artists`);
  }));
  return [...byKey.values()].sort((a, b) => Date.parse(b.releaseDate) - Date.parse(a.releaseDate));
}

// ---------------------------------------------------------------- features for new songs

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Artist- and genre-level averages from tracks whose features are real. */
export function buildPriors(tracks) {
  const byArtist = new Map();
  const byFamily = new Map();
  const add = (map, k, f) => { if (!map.has(k)) map.set(k, []); map.get(k).push(f); };
  for (const t of tracks) {
    if (!hasFeatures(t) || t.estimated) continue;
    for (const a of artistList(t.artists)) add(byArtist, a, t.features);
    for (const fam of familiesOf(t)) add(byFamily, fam, t.features);
  }
  const avg = (rows) => ({
    valence: mean(rows.map((r) => r.valence)), danceability: mean(rows.map((r) => r.danceability ?? 0.55)), acousticness: mean(rows.map((r) => r.acousticness ?? 0.3)),
  });
  return {
    artist: new Map([...byArtist].map(([k, v]) => [k, avg(v)])),
    family: new Map([...byFamily].filter(([, v]) => v.length >= 3).map(([k, v]) => [k, avg(v)])),
  };
}

function priorFor(item, priors) {
  for (const a of artistList(item.artists)) if (priors.artist.has(a)) return { ...priors.artist.get(a), from: 'artist' };
  for (const fam of familiesOf(item)) if (priors.family.has(fam)) return { ...priors.family.get(fam), from: 'genre' };
  return { from: 'none' };
}

/**
 * Attach features to a fresh item. Returns the item with `features`, `estimated`, `featureNote`
 * (or without features if nothing worked). Results are cached per Apple track id.
 */
export function attachFeatures(item, { api, priors, cache }) {
  const ck = `fz:${item.appleId}`;
  const hit = cache.get(ck);
  if (hit) return Promise.resolve({ ...item, ...hit });
  return analysisLimit(async () => {
    let result = null;
    if (daysSince(item.releaseDate) > REAL_FEATURES_AFTER_DAYS) {
      const r = await api.resolveTrack({ title: item.title, artists: item.artists }).catch(() => null);
      if (r) result = { features: r.features, estimated: false, spotifyId: r.spotifyId, isrc: r.isrc, featureNote: 'Audio features from ReccoBeats' };
    }
    if (!result && item.preview) {
      try {
        const desc = await analyzePreview(item.preview);
        if (desc) {
          const prior = priorFor(item, priors);
          result = {
            features: estimateFeatures(desc, prior), estimated: true,
            featureNote: `Estimated from the 30s preview (tempo and energy measured; mood from ${prior.from === 'none' ? 'a neutral prior' : `your ${prior.from} history`})`,
          };
        }
      } catch { /* decoding blocked or unsupported */ }
    }
    if (result) cache.set(ck, result);
    return result ? { ...item, ...result } : item;
  });
}
