// Estimate tempo / loudness / brightness from raw audio samples (we feed it a 30-second preview).
// Used for brand-new releases that ReccoBeats has not analysed yet. Everything produced here is an
// ESTIMATE and is flagged as such downstream. Pure maths: works on a Float32Array in Node or browser.

const FFT_SIZE = 1024;
const HOP = 512;

function fftInPlace(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

const HANN = Float32Array.from({ length: FFT_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));

const percentile = (arr, p) => {
  const s = Float32Array.from(arr).sort();
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

/**
 * @param {Float32Array} samples mono, -1..1
 * @param {number} sr sample rate
 * @returns {{tempo:number, beatStrength:number, loudnessDb:number, dynamicDb:number, centroid:number, highRatio:number, onsetRate:number} | null}
 */
export function analyzeSamples(samples, sr) {
  const frames = Math.floor((samples.length - FFT_SIZE) / HOP);
  if (frames < 60) return null; // under ~1.5s of audio

  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  const bins = FFT_SIZE / 2;
  const prev = new Float32Array(bins);
  const flux = new Float32Array(frames);
  const rms = new Float32Array(frames);
  let centroidSum = 0;
  let highSum = 0;
  let totalSum = 0;
  const binHz = sr / FFT_SIZE;

  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    let e = 0;
    for (let i = 0; i < FFT_SIZE; i++) {
      const v = samples[off + i];
      e += v * v;
      re[i] = v * HANN[i];
      im[i] = 0;
    }
    rms[f] = Math.sqrt(e / FFT_SIZE);
    fftInPlace(re, im);
    let fl = 0;
    let wsum = 0;
    let msum = 0;
    for (let k = 1; k < bins; k++) {
      const mag = Math.hypot(re[k], im[k]);
      const lg = Math.log1p(mag * 30);
      const d = lg - prev[k];
      if (d > 0 && k * binHz < 9000) fl += d;
      prev[k] = lg;
      wsum += k * binHz * mag;
      msum += mag;
      if (k * binHz > 4000) highSum += mag;
    }
    flux[f] = fl;
    centroidSum += msum > 0 ? wsum / msum : 0;
    totalSum += msum;
  }

  // onset envelope: flux minus its local mean, rectified
  const w = Math.round(0.4 * (sr / HOP));
  const env = new Float32Array(frames);
  let run = 0;
  for (let i = 0; i < frames; i++) {
    run += flux[i];
    if (i >= w) run -= flux[i - w];
    const mean = run / Math.min(i + 1, w);
    env[i] = Math.max(0, flux[i] - mean);
  }

  // Smooth over ~3 frames: onsets rarely land on an exact frame, and sharp spikes make the
  // autocorrelation peak at whichever lag happens to be an integer (often a 3:2 subdivision).
  const smooth = new Float32Array(frames);
  const K = [1, 2, 3, 2, 1];
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let k = -2; k <= 2; k++) s += (env[Math.min(frames - 1, Math.max(0, i + k))] ?? 0) * K[k + 2];
    smooth[i] = s / 9;
  }
  env.set(smooth);

  const fps = sr / HOP;
  const lagMin = Math.floor((fps * 60) / 200);
  const lagMax = Math.ceil((fps * 60) / 55);
  const ac = new Float32Array(lagMax + 2);
  for (let L = 0; L <= lagMax + 1; L++) {
    let s = 0;
    for (let i = 0; i + L < frames; i++) s += env[i] * env[i + L];
    ac[L] = s / (frames - L);
  }
  let best = -1;
  let bestScore = -Infinity;
  for (let L = lagMin; L <= lagMax; L++) {
    const bpm = (60 * fps) / L;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 118) / 0.85) ** 2); // humans cluster near ~120 BPM
    const score = ac[L] * prior;
    if (score > bestScore) { bestScore = score; best = L; }
  }
  // parabolic refinement of the peak lag
  let lag = best;
  if (best > lagMin && best < lagMax) {
    const a = ac[best - 1];
    const b = ac[best];
    const c = ac[best + 1];
    const denom = a - 2 * b + c;
    if (denom !== 0) lag = best + (0.5 * (a - c)) / denom;
  }
  const tempo = (60 * fps) / lag;
  const beatStrength = ac[0] > 0 ? Math.min(1, ac[best] / ac[0]) : 0;

  const db = (x) => 20 * Math.log10(x + 1e-9);
  const meanRms = rms.reduce((s, x) => s + x, 0) / frames;
  const loud = percentile(rms, 0.75);
  return {
    tempo,
    beatStrength,
    loudnessDb: db(loud),
    dynamicDb: db(percentile(rms, 0.9)) - db(percentile(rms, 0.1) + 1e-6),
    centroid: centroidSum / frames,
    highRatio: totalSum > 0 ? highSum / totalSum : 0,
    onsetRate: env.reduce((s, x) => s + (x > 0 ? 1 : 0), 0) / frames,
    meanRms,
  };
}

const norm = (x, lo, hi) => Math.min(1, Math.max(0, (x - lo) / (hi - lo)));

/**
 * Descriptors -> Spotify-style features. Tempo and energy come from the audio itself; valence,
 * danceability and acousticness lean on priors (artist / genre means) because they cannot be read
 * reliably from 30 seconds of signal. The weights in CAL are hand-set heuristics: they have NOT been
 * fitted against real feature values yet. Tempo is checked by tests on synthetic click tracks only.
 * Everything built from this is flagged `estimated` in the UI.
 */
export const CAL = {
  energy: { loud: 0.5, bright: 0.3, onset: 0.2, loudLo: -28, loudHi: -9, brLo: 1200, brHi: 4200 },
};

export function estimateFeatures(d, prior = {}) {
  const c = CAL.energy;
  const energy = Math.min(1, Math.max(0,
    c.loud * norm(d.loudnessDb, c.loudLo, c.loudHi) + c.bright * norm(d.centroid, c.brLo, c.brHi) + c.onset * norm(d.onsetRate, 0.05, 0.4)));
  const pr = (k, fallback) => (prior[k] != null ? prior[k] : fallback);
  const danceHeur = 0.3 + 0.55 * d.beatStrength + 0.15 * norm(d.tempo, 85, 130);
  return {
    tempo: Math.round(d.tempo * 10) / 10,
    energy: Math.round(energy * 1000) / 1000,
    valence: Math.round(Math.min(1, Math.max(0, 0.75 * pr('valence', 0.5) + 0.25 * (0.3 + 0.5 * energy))) * 1000) / 1000,
    danceability: Math.round(Math.min(1, Math.max(0, 0.5 * pr('danceability', danceHeur) + 0.5 * danceHeur)) * 1000) / 1000,
    acousticness: Math.round(Math.min(1, Math.max(0, 0.6 * pr('acousticness', 0.3) + 0.4 * (1 - norm(d.centroid, 900, 4000)))) * 1000) / 1000,
    instrumentalness: null, speechiness: null, liveness: null, loudness: Math.round(d.loudnessDb * 10) / 10, key: null, mode: null,
  };
}

// ---------------------------------------------------------------- browser-only decoding

/** Fetch an audio preview and decode it to mono 22.05 kHz samples. Needs a browser (Web Audio). */
export async function decodePreview(url) {
  const bytes = await (await fetch(url)).arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 22050);
  const buf = await ctx.decodeAudioData(bytes);
  const ch0 = buf.getChannelData(0);
  if (buf.numberOfChannels < 2) return { samples: ch0, sr: buf.sampleRate };
  const ch1 = buf.getChannelData(1);
  const mono = new Float32Array(ch0.length);
  for (let i = 0; i < mono.length; i++) mono[i] = (ch0[i] + ch1[i]) / 2;
  return { samples: mono, sr: buf.sampleRate };
}

export async function analyzePreview(url) {
  const { samples, sr } = await decodePreview(url);
  return analyzeSamples(samples, sr);
}
