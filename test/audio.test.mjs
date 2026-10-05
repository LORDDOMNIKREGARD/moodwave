import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSamples, estimateFeatures } from '../src/core/audio.js';

const SR = 22050;

/** A drum-machine-ish click track: noisy kick on every beat, hi-hat on the off-beats, low pad underneath. */
function clickTrack(bpm, seconds = 12, gain = 0.7) {
  const n = SR * seconds;
  const out = new Float32Array(n);
  const beat = (60 / bpm) * SR;
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
  for (let b = 0; b * beat < n; b++) {
    const start = Math.round(b * beat);
    for (let i = 0; i < 2200 && start + i < n; i++) out[start + i] += gain * Math.exp(-i / 500) * (Math.sin(i * 0.12) + 0.6 * rnd());
    const off = Math.round(start + beat / 2);
    for (let i = 0; i < 700 && off + i < n; i++) out[off + i] += gain * 0.35 * Math.exp(-i / 120) * rnd();
  }
  for (let i = 0; i < n; i++) out[i] += 0.05 * Math.sin((2 * Math.PI * 110 * i) / SR);
  return out;
}

// the estimator may report half/double time; what matters is that it is a musically equivalent tempo
const equivalent = (got, want, tol = 0.03) => [1, 2, 0.5].some((k) => Math.abs(got - want * k) / (want * k) < tol);

for (const bpm of [90, 110, 128, 140]) {
  test(`tempo estimate for a ${bpm} BPM click track`, () => {
    const d = analyzeSamples(clickTrack(bpm), SR);
    assert.ok(d, 'analysis returned a result');
    assert.ok(equivalent(d.tempo, bpm), `got ${d.tempo.toFixed(1)}, wanted ~${bpm}`);
  });
}

test('louder audio estimates higher energy than quiet audio', () => {
  const loud = estimateFeatures(analyzeSamples(clickTrack(120, 12, 0.9), SR));
  const quiet = estimateFeatures(analyzeSamples(clickTrack(120, 12, 0.03), SR));
  assert.ok(loud.energy > quiet.energy + 0.015, `${loud.energy} vs ${quiet.energy}`); // sparse clicks sit low on the scale; direction is what matters
});

test('too-short audio is rejected rather than guessed', () => {
  assert.equal(analyzeSamples(new Float32Array(SR), SR), null);
});

test('estimateFeatures leans on the artist prior for valence, and stays in range', () => {
  const d = analyzeSamples(clickTrack(120), SR);
  const happy = estimateFeatures(d, { valence: 0.9, danceability: 0.8, acousticness: 0.1 });
  const sad = estimateFeatures(d, { valence: 0.1, danceability: 0.4, acousticness: 0.8 });
  assert.ok(happy.valence > sad.valence + 0.3);
  for (const f of [happy, sad]) for (const k of ['energy', 'valence', 'danceability', 'acousticness']) assert.ok(f[k] >= 0 && f[k] <= 1);
});
