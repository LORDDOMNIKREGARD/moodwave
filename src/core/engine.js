// Moodwave's recommendation engine. Pure functions only (no DOM, no network) so it is unit-testable.
//
//   history  --buildProfile-->  taste profile (mood centre, BPM zone, genre affinity)
//   profile + target (+ feedback) --curate--> scored, diversified, arc-ordered playlist
//
// A track is judged on three independent axes the listener can weight separately:
//   mood  - valence x energy (the Russell circumplex), optionally acousticness
//   beat  - tempo against a BPM zone (half/double-time aware) plus danceability
//   genre - affinity learned from history, adjustable per genre family

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const lerp = (a, b, t) => a + (b - a) * t;
const DAY = 864e5;

// ---------------------------------------------------------------- mood / tempo / key

export const MOODS = [
  { id: 'euphoric', label: 'Euphoric', valence: 0.85, energy: 0.85 },
  { id: 'hyped', label: 'Hyped', valence: 0.55, energy: 0.93 },
  { id: 'upbeat', label: 'Upbeat', valence: 0.75, energy: 0.62 },
  { id: 'easygoing', label: 'Easygoing', valence: 0.7, energy: 0.38 },
  { id: 'serene', label: 'Serene', valence: 0.5, energy: 0.14 },
  { id: 'wistful', label: 'Wistful', valence: 0.28, energy: 0.25 },
  { id: 'melancholy', label: 'Melancholy', valence: 0.14, energy: 0.42 },
  { id: 'brooding', label: 'Brooding', valence: 0.22, energy: 0.65 },
  { id: 'intense', label: 'Intense', valence: 0.25, energy: 0.92 },
];

export function moodOf(valence, energy) {
  let best = MOODS[0];
  let bd = Infinity;
  for (const m of MOODS) {
    const d = (m.valence - valence) ** 2 + (m.energy - energy) ** 2;
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}

/** Trackers often report half/double time. Fold into 60-180 BPM when computing taste statistics. */
export function foldTempo(t) {
  if (!t || t <= 0) return null;
  let x = t;
  while (x < 60) x *= 2;
  while (x > 180) x /= 2;
  return x;
}

const MAJOR = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
const MINOR = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];

/** Camelot wheel position, e.g. {n: 8, l: 'A'} for A minor. */
export function camelot(key, mode) {
  if (key == null || key < 0 || mode == null) return null;
  return mode === 1 ? { n: MAJOR[key], l: 'B' } : { n: MINOR[key], l: 'A' };
}

/** Harmonically adjacent keys mix cleanly (same number, or +-1 on the same letter). */
export function keysCompatible(a, b) {
  const ca = camelot(a.features.key, a.features.mode);
  const cb = camelot(b.features.key, b.features.mode);
  if (!ca || !cb) return true;
  if (ca.n === cb.n) return true;
  const step = Math.min((ca.n - cb.n + 12) % 12, (cb.n - ca.n + 12) % 12);
  return step === 1 && ca.l === cb.l;
}

// ---------------------------------------------------------------- genre families

const FAMILY_RULES = [
  ['indian', /bollywood|hindi|desi|indian|filmi|punjabi|bhangra|tollywood|kollywood|tamil|telugu|ghazal|sufi/],
  ['k-pop', /k-?pop|korean/],
  ['j-pop', /j-?pop|japanese|anime|city pop/],
  ['latin', /latin|reggaeton|salsa|bachata|urbano|cumbia|regional mexican|corrido|flamenco/],
  ['afrobeats', /afro|amapiano|naija|highlife/],
  ['hip-hop', /hip.?hop|\brap\b|trap|drill|grime/],
  ['r&b', /r&b|r&amp;b|rnb|soul|funk|motown|disco/],
  ['electronic', /electro|edm|house|techno|trance|dubstep|\bdance\b|synth|drum.?and.?bass|dnb|garage|future bass|idm|downtempo|trip.?hop|club|big room/],
  ['metal', /metal|hardcore|grindcore|screamo|nu.?metal/],
  ['punk', /punk|\bemo\b|\bska\b/],
  ['indie', /indie|lo-?fi|bedroom|dream pop|shoegaze|chillwave|art pop|psychedelic|neo-psych/],
  ['alternative', /alternative|\balt\b|grunge|post-?rock|new wave|britpop|post-punk|new romantic/],
  ['rock', /\brock\b|hard rock|classic rock|blues rock|glam/],
  ['country', /country|nashville|bluegrass|americana/],
  ['folk', /folk|singer.?songwriter|acoustic|roots/],
  ['jazz', /jazz|swing|bebop|bossa|big band/],
  ['classical', /classical|orchestr|piano|opera|baroque|neoclassical|ambient|new age|score|soundtrack|cinematic/],
  ['reggae', /reggae|dancehall|\bdub\b/],
  ['blues', /blues/],
  ['pop', /\bpop\b|top 40|teen/],
  ['oldies', /oldies|easy listening|standards|vocal/],
];

// Memoised per genres array (not per track): enrichment replaces track.genres with a new array,
// which naturally invalidates the entry.
const familyCache = new WeakMap();
const NO_GENRES = Object.freeze([]);

export function familiesOf(track) {
  const genres = track.genres ?? NO_GENRES;
  const hit = familyCache.get(genres);
  if (hit) return hit;
  const out = new Set();
  for (const g of genres) {
    const s = String(g).toLowerCase();
    for (const [fam, re] of FAMILY_RULES) if (re.test(s)) out.add(fam);
  }
  const list = [...out];
  familyCache.set(genres, list);
  return list;
}

export const ALL_FAMILIES = FAMILY_RULES.map(([f]) => f);

// ---------------------------------------------------------------- taste profile

export const hasFeatures = (t) => !!t?.features && t.features.tempo != null && t.features.energy != null && t.features.valence != null;

/** How much one history entry should count. Plays (log), skips, likes, top-rank and recency all matter. */
export function entryWeight(h, now = Date.now(), halfLifeDays = 120) {
  const plays = Math.max(1, h.plays ?? 1);
  let w = 1 + Math.log2(plays);
  const skipRate = Math.min(1, (h.skips ?? 0) / plays);
  w *= 1 - 0.7 * skipRate;
  if (h.liked) w *= 2;
  if (h.rank != null) w *= 1 + Math.max(0, 1 - h.rank / 50);
  if (h.lastPlayed) {
    const days = Math.max(0, (now - h.lastPlayed) / DAY);
    w *= 0.35 + 0.65 * 0.5 ** (days / halfLifeDays);
  }
  return Math.max(0.05, w);
}

function wQuantile(sorted, q) {
  // sorted: [{v, w}] ascending by v
  const total = sorted.reduce((s, x) => s + x.w, 0);
  let acc = 0;
  for (const x of sorted) {
    acc += x.w;
    if (acc >= q * total) return x.v;
  }
  return sorted.at(-1).v;
}

const NEUTRAL = { valence: 0.5, energy: 0.55, danceability: 0.55, acousticness: 0.3, tempo: 112 };

/**
 * entries: [{ track, plays, skips, liked, rank, lastPlayed }]
 * Returns the listener's sonic fingerprint.
 */
export function buildProfile(entries, now = Date.now()) {
  const rows = [];
  const genreMass = new Map();
  let genreTotal = 0;
  for (const e of entries) {
    const w = entryWeight(e, now);
    const fams = familiesOf(e.track);
    for (const f of fams) {
      genreMass.set(f, (genreMass.get(f) ?? 0) + w / fams.length);
      genreTotal += w / fams.length;
    }
    if (hasFeatures(e.track)) rows.push({ t: e.track, w });
  }

  const genres = new Map([...genreMass].map(([f, m]) => [f, m / (genreTotal || 1)]));
  if (!rows.length) {
    return {
      empty: true, n: entries.length, analysed: 0, mean: { ...NEUTRAL }, std: { valence: 0.2, energy: 0.2, danceability: 0.2, acousticness: 0.25 },
      tempoRange: [95, 130], genres, moods: new Map(),
    };
  }

  const total = rows.reduce((s, r) => s + r.w, 0);
  const mean = {};
  const std = {};
  for (const k of ['valence', 'energy', 'danceability', 'acousticness']) {
    const m = rows.reduce((s, r) => s + r.w * (r.t.features[k] ?? NEUTRAL[k]), 0) / total;
    const v = rows.reduce((s, r) => s + r.w * ((r.t.features[k] ?? NEUTRAL[k]) - m) ** 2, 0) / total;
    mean[k] = m;
    std[k] = Math.sqrt(v);
  }
  const tempos = rows.map((r) => ({ v: foldTempo(r.t.features.tempo), w: r.w })).sort((a, b) => a.v - b.v);
  mean.tempo = tempos.reduce((s, x) => s + x.v * x.w, 0) / total;
  const tempoRange = [wQuantile(tempos, 0.25), wQuantile(tempos, 0.75)];

  const moods = new Map();
  for (const r of rows) {
    const id = moodOf(r.t.features.valence, r.t.features.energy).id;
    moods.set(id, (moods.get(id) ?? 0) + r.w / total);
  }
  return { empty: false, n: entries.length, analysed: rows.length, mean, std, tempoRange, genres, moods };
}

// ---------------------------------------------------------------- targets

export const PRESETS = {
  focus: { label: 'Focus', valence: 0.45, energy: 0.35, danceability: 0.4, acousticness: 0.5, tempo: [80, 118] },
  workout: { label: 'Workout', valence: 0.6, energy: 0.9, danceability: 0.7, acousticness: 0.08, tempo: [125, 165] },
  chill: { label: 'Chill', valence: 0.55, energy: 0.25, danceability: 0.5, acousticness: 0.6, tempo: [68, 104] },
  party: { label: 'Party', valence: 0.8, energy: 0.85, danceability: 0.78, acousticness: 0.1, tempo: [112, 134] },
  heartbreak: { label: 'Heartbreak', valence: 0.15, energy: 0.3, danceability: 0.4, acousticness: 0.65, tempo: [58, 100] },
  commute: { label: 'Commute', valence: 0.7, energy: 0.65, danceability: 0.62, acousticness: 0.2, tempo: [98, 128] },
  roadtrip: { label: 'Road trip', valence: 0.75, energy: 0.72, danceability: 0.58, acousticness: 0.2, tempo: [100, 140] },
  latenight: { label: 'Late night', valence: 0.3, energy: 0.42, danceability: 0.55, acousticness: 0.3, tempo: [70, 112] },
  sleep: { label: 'Wind down', valence: 0.35, energy: 0.1, danceability: 0.3, acousticness: 0.85, tempo: [52, 86] },
  rage: { label: 'Release', valence: 0.2, energy: 0.95, danceability: 0.4, acousticness: 0.03, tempo: [120, 180] },
};

export const DEFAULT_TARGET = {
  vibe: null, // {valence, energy, danceability?, acousticness?} - null = follow my taste
  blend: 0.8, // 0 = pure taste, 1 = pure vibe (only applies when a vibe is set)
  tempo: null, // [lo, hi] explicit BPM zone; null = my usual zone
  priorities: { mood: 1, genre: 1, beat: 1 },
  genrePrefs: {}, // family -> 'boost' | 'mute'
  discovery: 0.35, // share of the playlist from tracks not in history
  length: 25,
  arc: 'peak',
  maxPerArtist: 2,
  variety: 0.25, // MMR diversity pressure
};

/** Merge taste profile + manual vibe into the concrete numbers tracks are scored against. */
export function resolveTarget(profile, target) {
  const t = { ...DEFAULT_TARGET, ...target };
  const v = t.vibe;
  const blend = v ? clamp(t.blend, 0, 1) : 0;
  const mix = (taste, manual) => (manual == null ? taste : lerp(taste, manual, blend));
  const m = profile.mean;
  const sigma = (k, fallback) => clamp(lerp(profile.std[k] ?? fallback, fallback, blend), 0.11, 0.3);
  const tasteZone = [profile.tempoRange[0] - 8, profile.tempoRange[1] + 8];
  return {
    valence: mix(m.valence, v?.valence),
    energy: mix(m.energy, v?.energy),
    danceability: mix(m.danceability, v?.danceability),
    acousticness: v?.acousticness == null ? null : mix(m.acousticness, v.acousticness),
    sigmaV: sigma('valence', 0.17),
    sigmaE: sigma('energy', 0.17),
    tempo: t.tempo ?? tasteZone,
    tempoAuto: !t.tempo,
  };
}

// ---------------------------------------------------------------- per-axis fits

export function moodFit(track, eff) {
  const f = track.features;
  let z = ((f.valence - eff.valence) / eff.sigmaV) ** 2 + ((f.energy - eff.energy) / eff.sigmaE) ** 2;
  if (eff.acousticness != null && f.acousticness != null) z += ((f.acousticness - eff.acousticness) / 0.3) ** 2 * 0.6;
  return Math.exp(-0.5 * z);
}

function zoneDistance(bpm, [lo, hi]) {
  return bpm < lo ? lo - bpm : bpm > hi ? bpm - hi : 0;
}

export function tempoFit(bpm, zone) {
  let best = 0;
  for (const [x, pen] of [[bpm, 1], [bpm * 2, 0.9], [bpm / 2, 0.9]]) {
    best = Math.max(best, pen * Math.exp(-0.5 * (zoneDistance(x, zone) / 14) ** 2));
  }
  return best;
}

export function beatFit(track, eff) {
  const f = track.features;
  const tf = tempoFit(f.tempo, eff.tempo);
  const df = f.danceability == null ? 1 : Math.exp(-0.5 * ((f.danceability - eff.danceability) / 0.26) ** 2);
  return 0.8 * tf + 0.2 * df;
}

export function genreFit(track, profile, genrePrefs = {}) {
  const fams = familiesOf(track);
  const boosted = Object.keys(genrePrefs).filter((k) => genrePrefs[k] === 'boost');
  if (!fams.length) return boosted.length ? 0.3 : 0.45; // unknown genre: neutral, never a hard fail
  const top = Math.max(0, ...profile.genres.values());
  let fit = top > 0 ? Math.max(...fams.map((f) => (profile.genres.get(f) ?? 0) / top)) : 0.5;
  fit = 0.12 + 0.88 * fit; // unfamiliar genres are discounted, not banned
  if (boosted.length) fit = fams.some((f) => boosted.includes(f)) ? Math.max(fit, 0.95) : fit * 0.45;
  if (fams.some((f) => genrePrefs[f] === 'mute')) fit *= 0.08;
  return fit;
}

const EPS = 0.005; // small, so a near-zero fit on any axis the listener cares about sinks the track

/** Weighted geometric mean: a track must be roughly right on every axis the listener cares about. */
export function combine(fits, priorities) {
  const p = { mood: 1, genre: 1, beat: 1, ...priorities };
  const sum = p.mood + p.genre + p.beat;
  if (sum <= 0) return 0;
  const lg = (x) => Math.log(x + EPS);
  return Math.exp((p.mood * lg(fits.mood) + p.genre * lg(fits.genre) + p.beat * lg(fits.beat)) / sum) - EPS;
}

// ---------------------------------------------------------------- similarity / feedback

const vec = (t) => {
  const f = t.features;
  return [f.valence, f.energy, f.danceability ?? 0.5, f.acousticness ?? 0.3, (foldTempo(f.tempo) - 60) / 120];
};

/** 0..1 closeness of two tracks in mood/beat space (+ same-artist / same-genre nudges). */
export function similarity(a, b) {
  const va = vec(a);
  const vb = vec(b);
  let d2 = 0;
  for (let i = 0; i < va.length; i++) d2 += (va[i] - vb[i]) ** 2;
  let s = Math.exp(-d2 / (2 * 0.2 ** 2));
  if (a.artists?.[0] && a.artists[0] === b.artists?.[0]) s = Math.min(1, s + 0.4);
  const fa = familiesOf(a);
  if (fa.length && familiesOf(b).some((f) => fa.includes(f))) s = Math.min(1, s + 0.1);
  return s;
}

function dislikePenalty(track, dislikes) {
  if (!dislikes.length) return 1;
  let worst = 0;
  for (const d of dislikes) worst = Math.max(worst, similarity(track, d));
  return 1 - 0.65 * worst;
}

// ---------------------------------------------------------------- arc ordering

const ARCS = {
  steady: () => null,
  build: (x) => x,
  cooldown: (x) => 1 - x,
  peak: (x) => (x < 0.65 ? 0.25 + 0.75 * (x / 0.65) : 1 - 0.65 * ((x - 0.65) / 0.35)),
  wave: (x) => 0.5 + 0.5 * Math.sin(2 * Math.PI * 1.5 * x - Math.PI / 2),
};
export const ARC_LABELS = {
  steady: 'Steady groove', build: 'Slow build', peak: 'Warm-up → peak → cool-down', cooldown: 'Wind down', wave: 'Waves',
};

const intensity = (t) => 0.6 * t.features.energy + 0.4 * clamp((foldTempo(t.features.tempo) - 60) / 120, 0, 1);

function transitionCost(a, b) {
  const dTempo = Math.abs(foldTempo(a.features.tempo) - foldTempo(b.features.tempo)) / 60;
  const dVal = Math.abs(a.features.valence - b.features.valence) * 0.5;
  return dTempo + dVal + (keysCompatible(a, b) ? 0 : 0.08);
}

export function orderByArc(picks, arc) {
  const n = picks.length;
  if (n < 3) return picks.slice();
  const curve = ARCS[arc] ?? ARCS.steady;
  const vals = picks.map((p) => intensity(p.track));
  const lo = Math.min(...vals);
  const span = Math.max(1e-6, Math.max(...vals) - lo);
  const norm = new Map(picks.map((p, i) => [p, (vals[i] - lo) / span]));
  const left = new Set(picks);
  const out = [];
  // steady: start from the strongest match; otherwise the curve picks the opener
  for (let i = 0; i < n; i++) {
    const want = curve(i / (n - 1));
    let best = null;
    let bc = Infinity;
    for (const p of left) {
      const fit = want == null ? 1 - p.score : Math.abs(norm.get(p) - want);
      const cost = fit + (out.length ? 0.35 * transitionCost(out.at(-1).track, p.track) : 0);
      if (cost < bc) { bc = cost; best = p; }
    }
    out.push(best);
    left.delete(best);
  }
  return out;
}

// ---------------------------------------------------------------- explanations

const pct = (x) => Math.round(clamp(x, 0, 1) * 100);

function explain(track, fits, eff, profile, known) {
  const f = track.features;
  const bpm = Math.round(f.tempo);
  const mood = moodOf(f.valence, f.energy);
  const [lo, hi] = eff.tempo.map(Math.round);
  const why = [];
  why.push(fits.beat >= 0.75
    ? `${bpm} BPM sits in your ${lo} to ${hi} BPM zone`
    : `${bpm} BPM is a little outside your ${lo} to ${hi} zone`);
  why.push(`${mood.label} (${pct(f.valence)}% positive, ${pct(f.energy)}% energy)`);
  const fams = familiesOf(track);
  if (fams.length) {
    const rank = [...profile.genres].sort((a, b) => b[1] - a[1]).map(([g]) => g);
    const idx = Math.min(...fams.map((x) => (rank.indexOf(x) < 0 ? 99 : rank.indexOf(x))));
    why.push(idx < 3 ? `${fams[0]} is one of your top genres` : idx < 99 ? `${fams[0]} appears in your history` : `${fams[0]} is new territory for you`);
  }
  why.push(known ? 'From your history' : 'New to you');
  return why;
}

// ---------------------------------------------------------------- curation

function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * candidates: tracks with features.   known: Set of track keys in the user's history.
 * dislikes:   tracks the user thumbed down.  exclude: Set of keys to leave out (e.g. last playlist).
 */
const MIN_SCORE = 0.15; // below this a track is a poor fit on at least one axis: never offered
const GOOD_KNOWN = 0.5; // a familiar track must score at least this to reserve one of the "familiar" slots

/** Score every usable candidate against a target (no selection). Highest score first. */
export function scoreAll({ candidates, profile, target, known = new Set(), dislikes = [], exclude = new Set(), seed = 1, jitter = 0.06 }) {
  const t = { ...DEFAULT_TARGET, ...target };
  const eff = resolveTarget(profile, t);
  const rand = rngFrom(seed);
  const bannedArtists = new Map();
  for (const d of dislikes) for (const a of d.artists ?? []) bannedArtists.set(a, (bannedArtists.get(a) ?? 0) + 1);
  const dislikeKeys = new Set(dislikes.map((d) => d.key));

  const scored = [];
  for (const track of candidates) {
    if (!hasFeatures(track) || exclude.has(track.key) || dislikeKeys.has(track.key)) continue;
    if ((track.artists ?? []).some((a) => (bannedArtists.get(a) ?? 0) >= 2)) continue;
    const fits = { mood: moodFit(track, eff), beat: beatFit(track, eff), genre: genreFit(track, profile, t.genrePrefs) };
    const base = combine(fits, t.priorities) * dislikePenalty(track, dislikes);
    const score = clamp(base + (rand() - 0.5) * jitter, 0, 1);
    scored.push({ track, fits, score, base, known: known.has(track.key) });
  }
  scored.sort((a, b) => b.score - a.score);
  return { scored, eff, target: t };
}

export function curate({ candidates, profile, target, known = new Set(), dislikes = [], exclude = new Set(), seed = 1 }) {
  const { scored, eff, target: t } = scoreAll({ candidates, profile, target, known, dislikes, exclude, seed });

  // Discovery is a target, not a mandate: familiar songs only reserve a slot if they genuinely fit,
  // and nothing below the floor is ever offered just to hit a quota.
  const usable = scored.filter((s) => s.base >= MIN_SCORE); // judged before the variety jitter
  const N = Math.min(t.length, usable.length);
  const wantFresh = Math.round(N * clamp(t.discovery, 0, 1));
  const freshAvail = usable.filter((s) => !s.known).length;
  const goodKnown = usable.filter((s) => s.known && s.score >= GOOD_KNOWN).length;
  const quotaFresh = Math.min(wantFresh, freshAvail);
  const quotaKnown = Math.min(N - quotaFresh, goodKnown);

  const lambda = 1 - clamp(t.variety, 0, 0.6);
  const picked = [];
  const perArtist = new Map();
  let nFresh = 0;
  let nKnown = 0;
  const pool = usable.slice(0, 400);
  while (picked.length < N) {
    const needFresh = nFresh < quotaFresh;
    const needKnown = nKnown < quotaKnown;
    let best = null;
    let bv = -Infinity;
    for (const c of pool) {
      if (picked.includes(c)) continue;
      if (needFresh !== needKnown && (needFresh ? c.known : !c.known)) continue; // enforce discovery quota
      const lead = c.track.artists?.[0];
      if (lead && (perArtist.get(lead) ?? 0) >= t.maxPerArtist) continue;
      let maxSim = 0;
      for (const p of picked) maxSim = Math.max(maxSim, similarity(c.track, p.track));
      const mmr = lambda * c.score - (1 - lambda) * maxSim;
      if (mmr > bv) { bv = mmr; best = c; }
    }
    if (!best) break;
    picked.push(best);
    if (best.known) nKnown++; else nFresh++;
    const lead = best.track.artists?.[0];
    if (lead) perArtist.set(lead, (perArtist.get(lead) ?? 0) + 1);
  }

  const ordered = orderByArc(picked, t.arc);
  const picks = ordered.map((p) => ({ ...p, why: explain(p.track, p.fits, eff, profile, p.known) }));
  const chosen = new Set(picked);
  const rest = scored.filter((s) => !chosen.has(s)).slice(0, 20); // runners-up, for the recommendation web
  return { picks, rest, effective: eff, stats: summarize(picks), poolSize: scored.length };
}

export function summarize(picks) {
  if (!picks.length) return null;
  const avg = (fn) => picks.reduce((s, p) => s + fn(p), 0) / picks.length;
  return {
    bpm: avg((p) => p.track.features.tempo),
    energy: avg((p) => p.track.features.energy),
    valence: avg((p) => p.track.features.valence),
    fresh: picks.filter((p) => !p.known).length,
    match: avg((p) => p.score),
  };
}
