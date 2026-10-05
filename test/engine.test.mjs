import test from 'node:test';
import assert from 'node:assert/strict';
import {
  foldTempo, moodOf, camelot, keysCompatible, familiesOf, entryWeight, buildProfile, tempoFit, genreFit, resolveTarget, curate, scoreAll,
  DEFAULT_TARGET, PRESETS, orderByArc, similarity,
} from '../src/core/engine.js';

let n = 0;
const T = (title, artist, f, genres = ['Pop'], extra = {}) => ({
  key: `k${n++}`, title, artists: [artist], genres, features: { tempo: 120, energy: 0.6, valence: 0.6, danceability: 0.6, acousticness: 0.2, key: 0, mode: 1, ...f }, ...extra,
});

test('foldTempo maps half/double time into 60-180', () => {
  assert.equal(foldTempo(70), 70);
  assert.equal(foldTempo(40), 80);
  assert.equal(foldTempo(200), 100);
  assert.equal(foldTempo(0), null);
});

test('moodOf returns the nearest mood anchor', () => {
  assert.equal(moodOf(0.9, 0.9).id, 'euphoric');
  assert.equal(moodOf(0.1, 0.4).id, 'melancholy');
  assert.equal(moodOf(0.5, 0.1).id, 'serene');
});

test('camelot wheel: A minor sits next to C major and E minor', () => {
  assert.deepEqual(camelot(9, 0), { n: 8, l: 'A' });
  assert.deepEqual(camelot(0, 1), { n: 8, l: 'B' });
  const a = T('a', 'x', { key: 9, mode: 0 });
  assert.ok(keysCompatible(a, T('b', 'x', { key: 0, mode: 1 })), 'relative major');
  assert.ok(keysCompatible(a, T('c', 'x', { key: 4, mode: 0 })), 'adjacent minor');
  assert.ok(!keysCompatible(a, T('d', 'x', { key: 6, mode: 1 })));
});

test('genre families normalise iTunes and Spotify vocabularies', () => {
  assert.deepEqual(familiesOf({ genres: ['Hip-Hop/Rap'] }), ['hip-hop']);
  assert.ok(familiesOf({ genres: ['modern bollywood', 'Pop'] }).includes('indian'));
  assert.ok(familiesOf({ genres: ['Indie Pop'] }).includes('indie'));
  assert.deepEqual(familiesOf({ genres: ['Underwater Basket Weaving'] }), []);
});

test('entryWeight: more plays, likes and recency count more; skips count less', () => {
  const now = Date.now();
  const base = entryWeight({ plays: 1, lastPlayed: now }, now);
  assert.ok(entryWeight({ plays: 10, lastPlayed: now }, now) > base);
  assert.ok(entryWeight({ plays: 1, liked: true, lastPlayed: now }, now) > base);
  assert.ok(entryWeight({ plays: 4, skips: 4, lastPlayed: now }, now) < entryWeight({ plays: 4, lastPlayed: now }, now));
  assert.ok(entryWeight({ plays: 1, lastPlayed: now - 900 * 864e5 }, now) < base);
});

test('buildProfile finds the centre, the BPM zone and the genre mix', () => {
  const entries = [
    { track: T('a', 'x', { energy: 0.9, valence: 0.8, tempo: 128 }, ['Dance']), plays: 5 },
    { track: T('b', 'y', { energy: 0.85, valence: 0.7, tempo: 124 }, ['Dance']), plays: 5 },
    { track: T('c', 'z', { energy: 0.8, valence: 0.9, tempo: 130 }, ['Pop']), plays: 1 },
  ];
  const p = buildProfile(entries);
  assert.ok(p.mean.energy > 0.8 && p.mean.valence > 0.7);
  assert.ok(p.tempoRange[0] >= 122 && p.tempoRange[1] <= 131);
  assert.ok(p.genres.get('electronic') > p.genres.get('pop'));
  assert.equal(p.analysed, 3);
  assert.equal(buildProfile([]).empty, true);
});

test('tempoFit: in zone is perfect, half/double time still works, far away fails', () => {
  assert.equal(tempoFit(120, [110, 130]), 1);
  assert.ok(tempoFit(60, [110, 130]) > 0.85, '60 BPM feels like 120');
  assert.ok(tempoFit(240, [110, 130]) > 0.85);
  assert.ok(tempoFit(90, [150, 170]) > 0.5, '90 BPM is close to double time of a 150-170 zone');
  assert.ok(tempoFit(100, [150, 170]) < 0.2, '100 BPM (or 50, or 200) is genuinely far from 150-170');
});

test('genreFit: unknown is neutral, boost lifts, mute buries', () => {
  const profile = buildProfile([{ track: T('a', 'x', {}, ['Rock']), plays: 3 }, { track: T('b', 'y', {}, ['Pop']), plays: 1 }]);
  const rock = T('r', 'r', {}, ['Rock']);
  const jazz = T('j', 'j', {}, ['Jazz']);
  const unknown = T('u', 'u', {}, []);
  assert.ok(genreFit(rock, profile) > genreFit(jazz, profile));
  assert.equal(genreFit(unknown, profile), 0.45);
  assert.ok(genreFit(jazz, profile, { jazz: 'boost' }) > 0.9);
  assert.ok(genreFit(rock, profile, { rock: 'mute' }) < 0.1);
});

test('resolveTarget blends taste with a manual vibe', () => {
  const profile = buildProfile([{ track: T('a', 'x', { energy: 0.2, valence: 0.2 }), plays: 3 }]);
  const taste = resolveTarget(profile, { ...DEFAULT_TARGET });
  const vibe = resolveTarget(profile, { ...DEFAULT_TARGET, vibe: { valence: 0.9, energy: 0.9 }, blend: 1 });
  const half = resolveTarget(profile, { ...DEFAULT_TARGET, vibe: { valence: 0.9, energy: 0.9 }, blend: 0.5 });
  assert.ok(taste.energy < 0.3);
  assert.ok(Math.abs(vibe.energy - 0.9) < 1e-9);
  assert.ok(half.energy > taste.energy && half.energy < vibe.energy);
});

function lab() {
  const calm = Array.from({ length: 8 }, (_, i) => T(`calm${i}`, `ca${i}`, { energy: 0.2 + i * 0.01, valence: 0.5, tempo: 75 + i, danceability: 0.4 }, ['Classical']));
  const hype = Array.from({ length: 8 }, (_, i) => T(`hype${i}`, `hy${i}`, { energy: 0.9 - i * 0.01, valence: 0.8, tempo: 140 + i, danceability: 0.8 }, ['Dance']));
  return { calm, hype, all: [...calm, ...hype] };
}

test('curate: a workout vibe picks the hype tracks, a sleep vibe picks the calm ones', () => {
  const { all } = lab();
  const profile = buildProfile([]);
  const w = PRESETS.workout;
  const workout = curate({ candidates: all, profile, target: { vibe: { valence: w.valence, energy: w.energy, danceability: w.danceability }, tempo: w.tempo, length: 6, blend: 1 } });
  assert.ok(workout.picks.every((p) => p.track.title.startsWith('hype')), 'workout picks only hype');
  const s = PRESETS.sleep;
  const sleep = curate({ candidates: all, profile, target: { vibe: { valence: s.valence, energy: s.energy, danceability: s.danceability }, tempo: s.tempo, length: 6, blend: 1 } });
  assert.ok(sleep.picks.every((p) => p.track.title.startsWith('calm')));
});

test('curate respects length, max-per-artist, exclusions and dislikes', () => {
  const same = Array.from({ length: 6 }, (_, i) => T(`s${i}`, 'SameArtist', { energy: 0.6 }));
  const others = Array.from({ length: 6 }, (_, i) => T(`o${i}`, `other${i}`, { energy: 0.6 }));
  const profile = buildProfile([]);
  const res = curate({ candidates: [...same, ...others], profile, target: { length: 8, maxPerArtist: 2 } });
  assert.equal(res.picks.length, 8);
  assert.ok(res.picks.filter((p) => p.track.artists[0] === 'SameArtist').length <= 2);

  const excl = curate({ candidates: others, profile, target: { length: 6 }, exclude: new Set([others[0].key, others[1].key]) });
  assert.ok(!excl.picks.some((p) => [others[0].key, others[1].key].includes(p.track.key)));

  const disliked = curate({ candidates: others, profile, target: { length: 6 }, dislikes: [others[2]] });
  assert.ok(!disliked.picks.some((p) => p.track.key === others[2].key));
});

test('discovery slider controls how many songs come from outside the history', () => {
  // mid-energy tracks all fit a neutral profile, so the quality floor does not interfere with the quota
  const all = Array.from({ length: 16 }, (_, i) => T(`m${i}`, `mid${i}`, { energy: 0.55 + (i % 4) * 0.02, valence: 0.5, tempo: 110 + i, danceability: 0.55 }));
  const known = new Set(all.slice(0, 8).map((t) => t.key));
  const profile = buildProfile([]);
  const count = (d) => curate({ candidates: all, profile, target: { length: 8, discovery: d, maxPerArtist: 5 }, known }).picks.filter((p) => !p.known).length;
  assert.equal(count(0), 0);
  assert.equal(count(1), 8);
  assert.equal(count(0.5), 4);
});

test('arc ordering: "build" rises in intensity, "cooldown" falls', () => {
  const picks = Array.from({ length: 10 }, (_, i) => ({ track: T(`t${i}`, `a${i}`, { energy: 0.1 + i * 0.09, tempo: 70 + i * 9 }), score: 0.5 }));
  const shuffled = [...picks].sort((a, b) => ((a.track.title.charCodeAt(1) * 7) % 5) - ((b.track.title.charCodeAt(1) * 7) % 5));
  const build = orderByArc(shuffled, 'build').map((p) => p.track.features.energy);
  assert.ok(build[0] < build[4] && build[4] < build[9]);
  const down = orderByArc(shuffled, 'cooldown').map((p) => p.track.features.energy);
  assert.ok(down[0] > down[4] && down[4] > down[9]);
  const peak = orderByArc(shuffled, 'peak').map((p) => p.track.features.energy);
  const maxAt = peak.indexOf(Math.max(...peak));
  assert.ok(maxAt > 3 && maxAt < 9, 'peak sits mid-late, not at the ends');
});

test('similarity: identical tracks are 1, opposites are small, same artist nudges up', () => {
  const a = T('a', 'X', { energy: 0.9, valence: 0.9, tempo: 140 });
  const b = T('b', 'Y', { energy: 0.1, valence: 0.1, tempo: 70 }, ['Jazz']);
  assert.ok(similarity(a, a) > 0.99);
  assert.ok(similarity(a, b) < 0.1);
  assert.ok(similarity(a, T('c', 'X', { energy: 0.7, valence: 0.7, tempo: 130 })) > similarity(a, T('d', 'Z', { energy: 0.7, valence: 0.7, tempo: 130 })));
});

test('scoreAll skips tracks without usable features and sorts best-first', () => {
  const good = T('good', 'g', { energy: 0.6 });
  const bad = { key: 'bad', title: 'bad', artists: ['b'], features: null };
  const { scored } = scoreAll({ candidates: [bad, good], profile: buildProfile([]), target: {}, jitter: 0 });
  assert.equal(scored.length, 1);
  assert.equal(scored[0].track.title, 'good');
});

test('familiar songs that fit badly are not forced in, and nothing under the quality floor is offered', () => {
  const fits = Array.from({ length: 6 }, (_, i) => T(`fit${i}`, `f${i}`, { energy: 0.9, valence: 0.8, tempo: 140, danceability: 0.8 }, ['Dance']));
  const poorKnown = Array.from({ length: 4 }, (_, i) => T(`poor${i}`, `p${i}`, { energy: 0.1, valence: 0.1, tempo: 60, danceability: 0.2 }, ['Classical']));
  const known = new Set(poorKnown.map((t) => t.key));
  const w = PRESETS.workout;
  const res = curate({
    candidates: [...fits, ...poorKnown], profile: buildProfile([]), known,
    target: { vibe: { valence: w.valence, energy: w.energy, danceability: w.danceability }, tempo: w.tempo, blend: 1, length: 10, discovery: 0.3, maxPerArtist: 5 },
  });
  assert.ok(res.picks.length >= 6);
  assert.ok(res.picks.every((p) => p.track.title.startsWith('fit')), 'poor familiar songs stay out');
});
