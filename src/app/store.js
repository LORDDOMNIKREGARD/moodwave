// Moodwave application state. No DOM in here: React components read `S` through useStore() and call `actions`.
// Pure logic lives in src/core (engine, importers, fresh, api...). This file owns state, persistence and orchestration.

import { createApi } from '../core/api.js';
import { store, persistentCache, slimTrack } from '../core/store.js';
import {
  buildProfile, curate, scoreAll, entryWeight, hasFeatures, similarity, PRESETS, DEFAULT_TARGET,
} from '../core/engine.js';
import { trackKey, artistList, cleanTitle, makeExclusion, isExcluded } from '../core/match.js';
import { splitYouTubeTitle } from '../core/importers.js';
import * as spotify from '../core/spotify.js';
import { createPreviewPlayer } from '../core/preview.js';
import { discoverFresh, attachFeatures, buildPriors } from '../core/fresh.js';

export { spotify, store };

const cache = persistentCache('api');
export const api = createApi({ cache });

const REGIONS = ['in', 'us', 'gb', 'ca', 'au', 'de', 'fr', 'br', 'mx', 'jp', 'kr', 'ae'];
export const REGION_NAMES = {
  in: 'India', us: 'United States', gb: 'United Kingdom', ca: 'Canada', au: 'Australia', de: 'Germany',
  fr: 'France', br: 'Brazil', mx: 'Mexico', jp: 'Japan', kr: 'South Korea', ae: 'UAE',
};
const localeRegion = (() => { try { return new Intl.Locale(navigator.language).region?.toLowerCase(); } catch { return null; } })();

export const S = {
  ready: false,
  catalog: [],
  discovered: new Map(),
  history: new Map(), // key -> { track, plays, skips, liked, rank, lastPlayed, source }
  likes: new Set(),
  dislikes: new Map(), // key -> track
  profile: buildProfile([]),
  similar: null, // the last shared playlist we analysed
  unmatched: 0,
  tabs: {},
  activeTab: 'foryou',
  view: 'playlist',
  playing: null, // { status, track, pinned }
  dialog: null, // { type: 'import' | 'export', tab?, autoSync? }
  toasts: [],
  busy: { more: false },
  spotifyConnected: false,
  settings: {
    country: REGIONS.includes(localeRegion) ? localeRegion : 'us', days: 30, auto: true, chart: true, strong: false, notify: false,
    hoverAudio: true, volume: 0.7, ytKey: '', ...store.get('settings', {}),
  },
  fresh: { items: [], lastChecked: 0, loading: false, seen: new Set(store.get('freshSeen', [])), progress: '' },
};

// ---------------------------------------------------------------- subscription (React reads this via useSyncExternalStore)

let version = 0;
const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const getVersion = () => version;
export function emit() { version++; for (const l of listeners) l(); }

// ---------------------------------------------------------------- tabs

export const TAB_DEFS = [
  { id: 'foryou', label: 'For you', hint: 'Tuned to your listening history' },
  { id: 'similar', label: 'Playlist match', hint: 'New songs in the style of a playlist you shared, minus the ones already in it' },
  ...Object.entries(PRESETS).map(([id, p]) => ({
    id, label: p.label, hint: `${p.label}: ${p.tempo[0]} to ${p.tempo[1]} BPM, ${p.energy > 0.6 ? 'high' : p.energy > 0.3 ? 'medium' : 'low'} energy`,
  })),
  { id: 'custom', label: 'Custom', hint: 'Drag the mood plane to set your own' },
];
export const defOf = (id) => TAB_DEFS.find((t) => t.id === id);
export const visibleTabs = () => TAB_DEFS.filter((d) => d.id !== 'similar' || S.similar);

const saveSettings = () => store.set('settings', S.settings);

export function toast(message, { kind = 'info', ms = 4200 } = {}) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  S.toasts = [...S.toasts, { id, message, kind, ms }].slice(-4);
  emit();
  return id;
}
export function dismissToast(id) { S.toasts = S.toasts.filter((t) => t.id !== id); emit(); }

// ---------------------------------------------------------------- tracks & catalog

const catalogBySid = new Map();
const catalogByTa = new Map();

export function makeTrack(raw) {
  const t = { ...raw, artists: (raw.artists ?? []).filter(Boolean) };
  t.key ??= trackKey(t);
  return t;
}

async function loadCatalog() {
  try {
    const res = await fetch('data/catalog.json');
    const json = await res.json();
    S.catalog = json.tracks.map((c) => makeTrack({ ...c, spotifyId: c.id, source: 'catalog' }));
  } catch {
    S.catalog = [];
    toast('The starter catalog is missing. Run "npm run build-catalog" once, or import your own music.', { kind: 'error', ms: 9000 });
  }
  for (const t of S.catalog) {
    catalogBySid.set(t.spotifyId, t);
    catalogByTa.set(`ta:${cleanTitle(t.title)}|${artistList(t.artists)[0] ?? ''}`, t);
  }
}

export function applyMeta(track, m) {
  if (!m) return false;
  track.art ||= m.art;
  track.preview ||= m.preview;
  track.appleUrl ||= m.appleUrl;
  track.appleId ||= m.appleId;
  track.year ||= m.year;
  if (m.genre && !(track.genres ?? []).includes(m.genre)) track.genres = [...(track.genres ?? []), m.genre];
  return true;
}

// ---------------------------------------------------------------- history & profile

function addToHistory(track, st = {}) {
  const cur = S.history.get(track.key);
  if (!cur) {
    S.history.set(track.key, {
      track, plays: st.plays ?? 1, skips: st.skips ?? 0, liked: !!st.liked, rank: st.rank ?? null, lastPlayed: st.lastPlayed ?? null, source: st.source ?? 'import',
    });
    return;
  }
  cur.plays += st.plays ?? 1;
  cur.skips += st.skips ?? 0;
  cur.liked ||= !!st.liked;
  if (st.rank != null) cur.rank = Math.min(cur.rank ?? 99, st.rank);
  cur.lastPlayed = Math.max(cur.lastPlayed ?? 0, st.lastPlayed ?? 0) || null;
}

const historyKeys = () => new Set(S.history.keys());

function persistHistory() {
  const rows = [...S.history.values()].sort((a, b) => entryWeight(b) - entryWeight(a)).slice(0, 1500);
  store.set('history', rows.map((e) => ({ t: slimTrack(e.track), plays: e.plays, skips: e.skips, liked: e.liked, rank: e.rank, lastPlayed: e.lastPlayed, source: e.source })));
  store.set('unmatched', S.unmatched);
}
const persistFeedback = () => store.set('feedback', { likes: [...S.likes], dislikes: [...S.dislikes.values()].map(slimTrack) });
const persistTargets = () => store.set('targets', Object.fromEntries(Object.entries(S.tabs).map(([id, t]) => [id, t.target])));

function restore() {
  for (const e of store.get('history', [])) {
    const track = makeTrack(e.t);
    S.history.set(track.key, { track, plays: e.plays, skips: e.skips, liked: e.liked, rank: e.rank, lastPlayed: e.lastPlayed, source: e.source });
  }
  S.unmatched = store.get('unmatched', 0);
  const fb = store.get('feedback', { likes: [], dislikes: [] });
  S.likes = new Set(fb.likes);
  for (const t of fb.dislikes) { const tr = makeTrack(t); S.dislikes.set(tr.key, tr); }
  for (const t of store.get('discovered', [])) { const tr = makeTrack({ ...t, source: 'live' }); S.discovered.set(tr.key, tr); }
  restoreSimilar();
}

function refreshProfile({ regen = true } = {}) {
  S.profile = buildProfile([...S.history.values()]);
  if (regen) generateAll();
  persistHistory();
  emit();
}

export const profileFor = (id) => (id === 'similar' && S.similar ? S.similar.profile : S.profile);

// ---------------------------------------------------------------- generation

export function defaultTarget(id) {
  const p = PRESETS[id];
  const base = { ...DEFAULT_TARGET, priorities: { ...DEFAULT_TARGET.priorities }, genrePrefs: {} };
  if (id === 'similar') return { ...base, discovery: 0.85, arc: 'steady' };
  if (!p) return base;
  return { ...base, vibe: { valence: p.valence, energy: p.energy, danceability: p.danceability, acousticness: p.acousticness }, tempo: [...p.tempo], blend: 0.85 };
}

function initTabs() {
  const saved = store.get('targets', {});
  TAB_DEFS.forEach((d, i) => {
    const base = defaultTarget(d.id);
    S.tabs[d.id] = {
      target: { ...base, ...(saved[d.id] ?? {}), priorities: { ...base.priorities, ...(saved[d.id]?.priorities ?? {}) } },
      picks: [], rest: [], stats: null, score: null, seed: 17 + i * 101,
    };
  });
  S.activeTab = store.get('activeTab', 'foryou');
  if (!S.tabs[S.activeTab] || (S.activeTab === 'similar' && !S.similar)) S.activeTab = 'foryou';
}

export function pool() {
  const map = new Map();
  for (const t of S.catalog) map.set(t.key, t);
  for (const t of S.discovered.values()) map.set(t.key, t);
  for (const e of S.history.values()) if (hasFeatures(e.track)) map.set(e.track.key, e.track);
  return [...map.values()];
}

function generate(id, { reseed = false } = {}) {
  const tab = S.tabs[id];
  if (reseed) tab.seed = ((tab.seed * 1103515245 + 12345) >>> 0) || 1;
  const sim = id === 'similar' ? S.similar : null;
  if (id === 'similar' && !sim) { Object.assign(tab, { picks: [], rest: [], stats: null, score: null, effective: null }); return; }
  // the "Playlist match" tab never offers a song that is already in the shared playlist
  const all = pool();
  const candidates = sim ? all.filter((t) => !isExcluded(sim.exclusion, t)) : all;
  if (sim) sim.skipped = all.length - candidates.length;
  const res = curate({
    candidates, profile: profileFor(id), target: tab.target, known: historyKeys(), dislikes: [...S.dislikes.values()], seed: tab.seed,
  });
  tab.picks = res.picks;
  tab.rest = res.rest;
  tab.stats = res.stats;
  tab.effective = res.effective;
  tab.score = res.stats?.match ?? null;
}

function generateAll() { for (const d of TAB_DEFS) generate(d.id); }

let regenTimer;
function scheduleRegen() {
  clearTimeout(regenTimer);
  regenTimer = setTimeout(() => { generate(S.activeTab); persistTargets(); emit(); enrichPicksSoon(); }, 90);
}

/** The tracks the current tab is "about": your history, or the shared playlist on the match tab. */
export function topSeeds(n, { perArtist = 99 } = {}) {
  const seen = new Map();
  const source = S.activeTab === 'similar' && S.similar
    ? S.similar.tracks.map((track) => ({ track, weight: 1 }))
    : [...S.history.values()].map((e) => ({ track: e.track, weight: entryWeight(e) }));
  return source.filter((x) => hasFeatures(x.track))
    .sort((a, b) => b.weight - a.weight)
    .filter((x) => { const a = x.track.artists[0] ?? ''; const c = seen.get(a) ?? 0; seen.set(a, c + 1); return c < perArtist; })
    .slice(0, n);
}

/** Data for the recommendation web: your seeds, what we would add, and the runners-up. */
export function webData() {
  const tab = S.tabs[S.activeTab];
  const seeds = topSeeds(18, { perArtist: 2 });
  const seedKeys = new Set(seeds.map((s) => s.track.key));
  return {
    seeds,
    recs: tab.picks.filter((p) => !seedKeys.has(p.track.key)),
    extras: tab.rest.filter((p) => !seedKeys.has(p.track.key)).slice(0, 14),
  };
}

// ---------------------------------------------------------------- playback

const player = createPreviewPlayer({
  resolveUrl: async (track) => {
    const m = await api.enrich(track, { urgent: true });
    if (applyMeta(track, m)) emit();
    return track.preview ?? null;
  },
  onState: (st) => { S.playing = st; emit(); },
});
player.setVolume(S.settings.volume);
export { player };

export const playingKey = () => (S.playing?.status === 'playing' ? S.playing.track.key : null);

let hoverTimer;

// ---------------------------------------------------------------- import pipeline

const MAX_ANALYSE = 250;

const trackFrom = (r, extra = {}) => makeTrack({
  title: extra.title ?? r.title, artists: extra.artists ?? r.artists, spotifyId: extra.spotifyId ?? r.spotifyId ?? null, ytId: r.ytId ?? null,
  isrc: extra.isrc ?? r.isrc ?? null, features: extra.features ?? r.features, genres: r.genres ?? [], art: r.art ?? null, durationMs: extra.durationMs ?? r.durationMs ?? null,
  appleId: r.appleId ?? null, source: r.source,
});

async function fillSpotifyMeta(rows) {
  const need = rows.filter((r) => r.spotifyId && !r.title);
  if (!need.length) return;
  const meta = await api.tracksBySpotifyIds(need.map((r) => r.spotifyId));
  for (const r of need) { const m = meta.get(r.spotifyId); if (m) { r.title = m.title; r.artists = m.artists; r.isrc = m.isrc; } }
}

async function fillYouTubeMeta(rows, onProgress) {
  const need = rows.filter((r) => r.ytId && !r.title);
  let i = 0;
  const worker = async () => {
    while (i < need.length) {
      const r = need[i++];
      onProgress(i / need.length, `Reading YouTube titles ${i}/${need.length}`);
      try {
        const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${r.ytId}`)}&format=json`);
        if (!res.ok) continue;
        const j = await res.json();
        const s = splitYouTubeTitle(j.title, j.author_name);
        r.title = s.title; r.artists = s.artists;
      } catch { /* deleted or private video */ }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

/**
 * Turn parsed rows into tracks with audio features (no side effects on the history).
 * Catalog hits are free; Spotify IDs are batched; everything else is matched by title + artist.
 */
export async function resolveRows(raw, { source, liked = false, onProgress = () => {}, shouldCancel = () => false }) {
  const rows = raw.map((r) => ({ ...r, artists: (r.artists ?? []).filter(Boolean), liked: r.liked ?? liked, source }));
  onProgress(0, 'Reading track details');
  await fillSpotifyMeta(rows);
  await fillYouTubeMeta(rows, onProgress);

  const ranked = rows.filter((r) => r.title || r.spotifyId).map((r) => ({ r, w: entryWeight(r) })).sort((a, b) => b.w - a.w);
  const batch = ranked.slice(0, MAX_ANALYSE).map((x) => x.r);
  const beyondCap = ranked.length - batch.length;
  const resolved = [];
  const needFeatures = [];
  const needSearch = [];
  for (const r of batch) {
    const cat = (r.spotifyId && catalogBySid.get(r.spotifyId)) || catalogByTa.get(trackKey({ title: r.title, artists: r.artists }));
    if (cat) resolved.push({ track: cat, r });
    else if (r.features) resolved.push({ track: trackFrom(r), r });
    else if (r.spotifyId) needFeatures.push(r);
    else needSearch.push(r);
  }
  if (needFeatures.length) {
    onProgress(0.1, 'Fetching audio features');
    const feats = await api.featuresBySpotifyIds(needFeatures.map((r) => r.spotifyId));
    for (const r of needFeatures) {
      const f = feats.get(r.spotifyId);
      if (f) resolved.push({ track: trackFrom(r, { features: f }), r });
      else if (r.title) needSearch.push(r);
    }
  }
  let unmatched = batch.length - resolved.length - needSearch.length;
  let done = 0;
  for (const r of needSearch) {
    if (shouldCancel()) break;
    onProgress(done / needSearch.length, `Matching ${done + 1} of ${needSearch.length}: ${r.title}`);
    done++;
    if (!r.title) { unmatched++; continue; }
    let hit = await api.resolveTrack({ title: r.title, artists: r.artists }).catch(() => null);
    if (!hit && source === 'youtube') {
      if (r.artists[0]) hit = await api.resolveTrack({ title: r.artists[0], artists: [r.title] }).catch(() => null); // "Song - Artist" order
      // Film-music uploads ("Song | Film | Composer | Singers" from a label channel) carry no usable artist, so accept a famous exact title.
      // Only for those: for a normal row the same fallback picks cover versions.
      if (!hit && r.artists.length >= 3) hit = await api.resolveTrack({ title: r.title, artists: r.artists }, { titleOnly: true }).catch(() => null);
    }
    if (!hit) { unmatched++; continue; }
    const cat = catalogBySid.get(hit.spotifyId);
    resolved.push({ track: cat ?? trackFrom(r, hit), r });
  }
  return { resolved, rows: ranked.map((x) => x.r), unmatched, beyondCap, total: ranked.length };
}

/** Merge parsed rows into the listening history (this is what "taste" is built from). */
export async function ingest(raw, opts) {
  const { source } = opts;
  const { resolved, unmatched, beyondCap, total } = await resolveRows(raw, opts);
  for (const { track, r } of resolved) addToHistory(track, { plays: r.plays ?? 1, skips: r.skips ?? 0, liked: r.liked, rank: r.rank, lastPlayed: r.lastPlayed, source });
  S.unmatched += unmatched;
  refreshProfile();
  enrichHistory();
  return { added: resolved.length, unmatched, beyondCap, total };
}

let enriching = false;
/** Fill genre, artwork and preview from iTunes for the tracks that matter most. Runs quietly in the background. */
async function enrichHistory(limit = 80) {
  if (enriching) return;
  enriching = true;
  try {
    const todo = [...S.history.values()].filter((e) => !e.track.art || !(e.track.genres ?? []).length)
      .sort((a, b) => entryWeight(b) - entryWeight(a)).slice(0, limit);
    let n = 0;
    for (const e of todo) {
      applyMeta(e.track, await api.enrich(e.track));
      if (++n % 20 === 0) refreshProfile();
    }
    if (n) refreshProfile();
  } finally { enriching = false; }
}

/** Artwork, preview and genre for the songs on screen. Only what is visible, a few at a time, so we stay under iTunes' rate limit. */
let picksTimer;
let enrichingPicks = false;
function enrichPicksSoon() {
  clearTimeout(picksTimer);
  picksTimer = setTimeout(async () => {
    if (enrichingPicks) return;
    enrichingPicks = true;
    try {
      const todo = S.tabs[S.activeTab].picks.map((p) => p.track).filter((t) => !t.art).slice(0, 30);
      let n = 0;
      for (const t of todo) {
        applyMeta(t, await api.enrich(t));
        if (++n % 6 === 0) emit();
      }
      if (n) emit();
    } finally { enrichingPicks = false; }
  }, 500);
}

// ---------------------------------------------------------------- online discovery (ReccoBeats)

async function discoverOnline() {
  const tab = S.tabs[S.activeTab];
  const seeds = tab.picks.map((p) => p.track.spotifyId).filter(Boolean).slice(0, 5);
  if (!seeds.length) { toast('Import some music first, so there is something to base recommendations on.'); return; }
  S.busy.more = true;
  emit();
  try {
    const e = tab.effective;
    const zone = e.tempo;
    const recs = await api.recommend({ seeds, size: 60, targets: { energy: e.energy, valence: e.valence, danceability: e.danceability, tempo: Math.round((zone[0] + zone[1]) / 2) } });
    const feats = await api.featuresBySpotifyIds(recs.map((r) => r.spotifyId));
    let added = 0;
    const fresh = [];
    for (const r of recs) {
      const f = feats.get(r.spotifyId);
      if (!f) continue;
      const key = `sp:${r.spotifyId}`;
      if (S.discovered.has(key) || catalogBySid.has(r.spotifyId) || S.history.has(key)) continue;
      const t = makeTrack({ title: r.title, artists: r.artists, spotifyId: r.spotifyId, isrc: r.isrc, features: f, genres: [], popularity: r.popularity, durationMs: r.durationMs, source: 'live' });
      S.discovered.set(key, t);
      fresh.push(t);
      added++;
    }
    for (const t of fresh.slice(0, 40)) applyMeta(t, await api.enrich(t, { urgent: true })); // genre matters to the score
    store.set('discovered', [...S.discovered.values()].slice(-250).map(slimTrack));
    refreshProfile();
    toast(added ? `Found ${added} new songs online and folded them into your playlists.` : 'Nothing new turned up for this mood. Try another tab or widen the BPM zone.', { kind: added ? 'good' : 'info' });
  } catch (err) {
    toast(`Online search failed (${err.message}). The bundled catalog still works.`, { kind: 'error' });
  } finally {
    S.busy.more = false;
    emit();
  }
}

// ---------------------------------------------------------------- "match a playlist"
// Share any playlist (a YouTube Mix, a Spotify / Apple / YouTube playlist, a pasted list). We learn its
// mood, tempo and genre fingerprint, look for songs that fit it, and never suggest anything it already contains.

function persistSimilar() {
  const s = S.similar;
  if (!s) { store.del('similar'); return; }
  store.set('similar', { name: s.name, source: s.source, count: s.count, matched: s.matched, note: s.note, at: s.at, exList: s.exList, tracks: s.tracks.map(slimTrack) });
}

function restoreSimilar() {
  const s = store.get('similar', null);
  if (!s?.tracks?.length) return;
  const tracks = s.tracks.map(makeTrack);
  S.similar = { ...s, tracks, profile: buildProfile(tracks.map((t) => ({ track: t, plays: 1, liked: false }))), exclusion: makeExclusion(s.exList ?? []), skipped: 0 };
}

/** Ask ReccoBeats for songs like the playlist's most representative tracks and add them to the pool. */
async function findCandidates(tracks, profile, onProgress = () => {}, shouldCancel = () => false) {
  const m = profile.mean;
  const center = { features: { ...m }, artists: [], genres: [] };
  const seedIds = tracks.filter((t) => t.spotifyId).sort((a, b) => similarity(b, center) - similarity(a, center)).slice(0, 20).map((t) => t.spotifyId);
  const groups = [];
  for (let i = 0; i < seedIds.length; i += 5) groups.push(seedIds.slice(i, i + 5));
  const found = new Map();
  let failures = 0;
  for (const [gi, seeds] of groups.entries()) {
    if (shouldCancel()) break;
    onProgress(0.25 + (0.35 * gi) / Math.max(1, groups.length), `Looking for songs like these (${gi + 1} of ${groups.length})`);
    try {
      const recs = await api.recommend({ seeds, size: 50, targets: { energy: m.energy, valence: m.valence, danceability: m.danceability, tempo: Math.round(m.tempo) } });
      for (const r of recs) found.set(r.spotifyId, r);
    } catch { failures++; }
  }
  const ex = S.similar.exclusion;
  const fresh = [...found.values()].filter((r) => !S.discovered.has(`sp:${r.spotifyId}`) && !catalogBySid.has(r.spotifyId)
    && !isExcluded(ex, { key: `sp:${r.spotifyId}`, spotifyId: r.spotifyId, isrc: r.isrc, title: r.title, artists: r.artists }));
  onProgress(0.65, 'Reading the audio of the candidates');
  const feats = await api.featuresBySpotifyIds(fresh.map((r) => r.spotifyId));
  const added = [];
  for (const r of fresh) {
    const f = feats.get(r.spotifyId);
    if (!f) continue;
    const t = makeTrack({ title: r.title, artists: r.artists, spotifyId: r.spotifyId, isrc: r.isrc, features: f, genres: [], popularity: r.popularity, durationMs: r.durationMs, source: 'live' });
    S.discovered.set(t.key, t);
    added.push(t);
  }
  // genre is part of the score, so tag the most promising candidates before ranking
  const { scored } = scoreAll({ candidates: added, profile, target: DEFAULT_TARGET, jitter: 0 });
  const best = scored.slice(0, 50);
  for (const [i, s] of best.entries()) {
    if (shouldCancel()) break;
    if (i % 5 === 0) onProgress(0.7 + (0.28 * i) / best.length, `Tagging genres ${i + 1} of ${best.length}`);
    applyMeta(s.track, await api.enrich(s.track, { urgent: true }));
  }
  store.set('discovered', [...S.discovered.values()].slice(-250).map(slimTrack));
  return { added: added.length, failures, groups: groups.length };
}

/**
 * Analyse a shared playlist and open the "Playlist match" tab.
 * rows: [{ title, artists, spotifyId?, ytId? }] from a link, a file or pasted text.
 */
export async function analyzePlaylist({ name, source, rows, note = '', onProgress = () => {}, shouldCancel = () => false }) {
  const res = await resolveRows(rows, { source, liked: true, onProgress: (p, msg) => onProgress(p * 0.2, msg), shouldCancel });
  const seen = new Set();
  const tracks = res.resolved.map((x) => x.track).filter((t) => !seen.has(t.key) && seen.add(t.key));
  if (tracks.length < 3) throw new Error(`Only ${tracks.length} of ${rows.length} songs could be matched to audio data, which is too few to find a pattern.`);

  onProgress(0.2, 'Reading genres');
  for (const t of tracks.slice(0, 30)) if (!t.art || !(t.genres ?? []).length) applyMeta(t, await api.enrich(t, { urgent: true }));
  const profile = buildProfile(tracks.map((t) => ({ track: t, plays: 1, liked: false })));
  const exList = [
    ...rows.map((r) => ({ title: r.title, artists: r.artists, spotifyId: r.spotifyId })),
    ...tracks.map((t) => ({ key: t.key, title: t.title, artists: t.artists, spotifyId: t.spotifyId, isrc: t.isrc })),
  ];
  S.similar = { name, source, count: rows.length, matched: tracks.length, tracks, profile, exList, exclusion: makeExclusion(exList), note, at: Date.now(), skipped: 0 };
  S.tabs.similar.target = defaultTarget('similar');
  persistSimilar();

  const cand = await findCandidates(tracks, profile, onProgress, shouldCancel);
  generate('similar');
  actions.selectTab('similar');
  return { matched: tracks.length, total: rows.length, found: cand.added, skipped: S.similar.skipped, offline: cand.failures === cand.groups && cand.groups > 0 };
}

function clearSimilar() {
  S.similar = null;
  persistSimilar();
  generate('similar');
  if (S.activeTab === 'similar') actions.selectTab('foryou');
  emit();
}

// ---------------------------------------------------------------- fresh drops (live)

const FRESH_EVERY_MS = 15 * 60_000;
let freshTimer;

function followedArtists(n = 25) {
  const weights = new Map();
  for (const e of S.history.values()) {
    const a = e.track.artists[0];
    if (a) weights.set(a, (weights.get(a) ?? 0) + entryWeight(e));
  }
  return [...weights].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name]) => ({ name }));
}

async function refreshFresh({ manual = false } = {}) {
  const F = S.fresh;
  if (F.loading) return;
  F.loading = true;
  emit();
  const before = new Set(F.items.map((i) => i.track.key));
  const priors = buildPriors(pool());
  try {
    const items = await discoverFresh({
      followed: followedArtists(), country: S.settings.country, days: S.settings.days, includeChart: S.settings.chart, cache,
      onProgress: (msg) => { F.progress = msg; emit(); },
      onItems: (list) => { F.items = list.map((t) => ({ track: t, score: null, isNew: !F.seen.has(t.key) })); emit(); },
    });
    F.items = items.map((t) => ({ track: t, score: null, isNew: !F.seen.has(t.key) }));
    F.lastChecked = Date.now();
    emit();
    // measure the audio for new songs (two at a time) and re-score as results arrive
    let finished = 0;
    await Promise.all(F.items.map(async (it) => {
      if (hasFeatures(it.track)) return;
      it.track = await attachFeatures(it.track, { api, priors, cache });
      if (++finished % 3 === 0) emit();
    }));
    F.progress = '';
    emit();
    const newStrong = scoredFresh().filter((i) => !before.has(i.track.key) && i.score >= 0.7);
    if (!manual && newStrong.length) notifyFresh(newStrong);
  } catch (err) {
    F.progress = `Could not check for new releases: ${err.message}`;
  } finally {
    F.loading = false;
    emit();
  }
}

/** Fresh items scored against the active tab, best first. Mutates `score` on each item. */
export function scoredFresh() {
  const sim = S.activeTab === 'similar' ? S.similar : null;
  const withF = S.fresh.items.filter((i) => hasFeatures(i.track) && !(sim && isExcluded(sim.exclusion, i.track)));
  const { scored } = scoreAll({ candidates: withF.map((i) => i.track), profile: profileFor(S.activeTab), target: S.tabs[S.activeTab].target, known: new Set(), dislikes: [...S.dislikes.values()], jitter: 0 });
  const byKey = new Map(scored.map((s) => [s.track.key, s.score]));
  for (const i of S.fresh.items) i.score = byKey.get(i.track.key) ?? null;
  return S.fresh.items.filter((i) => i.score != null).sort((a, b) => b.score - a.score);
}

export function freshRows() {
  const F = S.fresh;
  const ranked = scoredFresh();
  const unscored = F.items.filter((i) => i.score == null).sort((a, b) => Date.parse(b.track.releaseDate) - Date.parse(a.track.releaseDate));
  return S.settings.strong ? ranked.filter((i) => i.score >= 0.6) : [...ranked, ...unscored];
}

export function freshBadgeCount() {
  scoredFresh();
  return S.fresh.items.filter((i) => i.isNew && i.score != null && i.score >= 0.6).length;
}

function markFreshSeen() {
  for (const i of S.fresh.items) { S.fresh.seen.add(i.track.key); i.isNew = false; }
  store.set('freshSeen', [...S.fresh.seen].slice(-1500));
}

function notifyFresh(items) {
  const body = `${items.length} new ${items.length === 1 ? 'song fits' : 'songs fit'} your ${defOf(S.activeTab).label} mood: ${items.slice(0, 3).map((i) => `${i.track.title}, ${i.track.artists[0]}`).join('; ')}`;
  toast(body, { kind: 'good', ms: 9000 });
  if (S.settings.notify && 'Notification' in window && Notification.permission === 'granted') new Notification('Moodwave fresh drops', { body });
}

function startFreshScheduler() {
  clearInterval(freshTimer);
  freshTimer = setInterval(() => { if (S.settings.auto && !document.hidden) refreshFresh(); }, FRESH_EVERY_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && S.settings.auto && Date.now() - S.fresh.lastChecked > FRESH_EVERY_MS) refreshFresh();
  });
}

// ---------------------------------------------------------------- actions (the only way components change state)

export const actions = {
  selectTab(id) {
    S.activeTab = id;
    store.set('activeTab', id);
    emit();
    enrichPicksSoon();
  },
  selectView(view) {
    if (S.view === 'fresh' && view !== 'fresh') markFreshSeen();
    S.view = view;
    if (view !== 'web') player.stop();
    emit();
  },
  patchTarget(patch) {
    Object.assign(S.tabs[S.activeTab].target, patch);
    emit();
    scheduleRegen();
  },
  resetTab() {
    S.tabs[S.activeTab].target = defaultTarget(S.activeTab);
    emit();
    scheduleRegen();
    toast('Reset to this mood’s defaults.', { ms: 1800 });
  },
  regenerate() { generate(S.activeTab, { reseed: true }); emit(); enrichPicksSoon(); },
  setSetting(key, value) {
    S.settings[key] = value;
    saveSettings();
    if (key === 'volume') player.setVolume(value);
    if (key === 'hoverAudio' && !value) player.stop({ force: true });
    emit();
    if (['country', 'days', 'chart'].includes(key)) refreshFresh({ manual: true });
  },
  async setNotify(on) {
    if (on && 'Notification' in window && Notification.permission === 'default') {
      const r = await Notification.requestPermission();
      if (r !== 'granted') { toast('Notifications are blocked in this browser. In-page alerts still work.'); return; }
    }
    actions.setSetting('notify', on);
  },

  like(track) {
    if (S.likes.has(track.key)) {
      S.likes.delete(track.key);
      const e = S.history.get(track.key);
      if (e) { if (e.source === 'feedback') S.history.delete(track.key); else e.liked = false; }
    } else {
      S.likes.add(track.key);
      S.dislikes.delete(track.key);
      if (hasFeatures(track)) addToHistory(track, { plays: 2, liked: true, source: 'feedback', lastPlayed: Date.now() });
      toast(`Noted. More like “${track.title}” coming up.`, { kind: 'good', ms: 2400 });
    }
    persistFeedback();
    refreshProfile();
  },
  dislike(track) {
    if (S.dislikes.has(track.key)) S.dislikes.delete(track.key);
    else {
      S.dislikes.set(track.key, track);
      S.likes.delete(track.key);
      const e = S.history.get(track.key);
      if (e?.source === 'feedback') S.history.delete(track.key);
      if (S.playing?.track?.key === track.key) player.stop({ force: true });
      toast(`Got it. Fewer songs like “${track.title}”.`, { ms: 2400 });
    }
    persistFeedback();
    refreshProfile();
  },

  /** Play pins the preview. Pressing it again on a pinned preview stops it; on a hover preview it just pins it. */
  togglePlay(track) {
    const p = S.playing;
    if (p?.status === 'playing' && p.track.key === track.key && p.pinned) player.stop({ force: true });
    else player.play(track, { pin: true });
  },
  stopPlayback() { player.stop({ force: true }); },
  /** Hover preview: waits a beat so sweeping across the web does not fire a request per node. */
  hoverPlay(track) {
    clearTimeout(hoverTimer);
    if (!S.settings.hoverAudio) return;
    hoverTimer = setTimeout(() => player.play(track), 140);
  },
  hoverStop() {
    clearTimeout(hoverTimer);
    if (S.settings.hoverAudio) player.stop();
  },

  openDialog(dialog) { S.dialog = dialog; emit(); },
  closeDialog() { S.dialog = null; emit(); },
  discoverOnline,
  refreshFresh,
  clearSimilar,
  markFreshSeen() { markFreshSeen(); emit(); },
  spotifyChanged() { S.spotifyConnected = spotify.isConnected(); emit(); },
  dismissToast,
  toast,
};

export const activePicks = () => S.tabs[S.activeTab].picks.map((p) => p.track);

// ---------------------------------------------------------------- boot

export async function boot() {
  restore();
  S.profile = buildProfile([...S.history.values()]); // saved history -> taste profile before the first render
  S.spotifyConnected = spotify.isConnected();
  initTabs();
  await loadCatalog();
  generateAll();
  S.ready = true;
  emit();
  enrichHistory();
  enrichPicksSoon();
  startFreshScheduler();
  setTimeout(() => refreshFresh({ manual: true }), 1200);

  // returning from Spotify's consent screen
  const sp = await spotify.handleRedirect();
  if (sp === 'connected') {
    S.spotifyConnected = true;
    toast('Spotify connected.', { kind: 'good' });
    actions.openDialog({ type: 'import', tab: 'spotify', autoSync: true });
  } else if (sp?.startsWith('error:')) toast(`Spotify sign-in failed: ${sp.slice(6)}`, { kind: 'error', ms: 8000 });
}
