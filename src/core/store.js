// localStorage persistence. Everything stays in the browser: history, feedback, per-mood settings and
// a size-capped cache of API lookups. Every access is wrapped because storage can be blocked
// (private windows, cleared site data) and the app must still run without it.

const PREFIX = 'mw.';
const VERSION = 2;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}

function write(key, value) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; } catch { return false; }
}

export const store = {
  get: read,
  set: write,
  del(key) { try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ } },
  clearAll() {
    try { Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
  },
};

/** Cache with the Map-ish shape api.js expects, persisted and capped so it never fills the quota. */
export function persistentCache(name, maxEntries = 4000) {
  const key = `cache.${name}.v${VERSION}`;
  const data = new Map(Object.entries(read(key, {})));
  let timer = null;
  const flush = () => {
    timer = null;
    while (data.size > maxEntries) data.delete(data.keys().next().value); // oldest first
    if (!write(key, Object.fromEntries(data))) { // quota hit: drop half and try once more
      [...data.keys()].slice(0, data.size >> 1).forEach((k) => data.delete(k));
      write(key, Object.fromEntries(data));
    }
  };
  return {
    get: (k) => data.get(k),
    set(k, v) { data.set(k, v); if (!timer) timer = setTimeout(flush, 800); },
    clear() { data.clear(); flush(); },
    get size() { return data.size; },
  };
}

/** What we keep per history track (slim: art and genres included so the UI works offline). */
export const slimTrack = (t) => ({
  key: t.key, spotifyId: t.spotifyId ?? null, appleId: t.appleId ?? null, ytId: t.ytId ?? null, title: t.title, artists: t.artists,
  genres: t.genres ?? [], features: t.features ?? null, art: t.art ?? null, preview: t.preview ?? null, appleUrl: t.appleUrl ?? null,
  isrc: t.isrc ?? null, year: t.year ?? null, estimated: !!t.estimated,
});
