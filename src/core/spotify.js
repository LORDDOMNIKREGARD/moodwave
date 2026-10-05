// Spotify Web API client: OAuth Authorization Code + PKCE (no client secret, no backend needed).
// Only endpoints that still work for new apps are used. Audio features / recommendations are NOT
// among them (403 since Nov 2024); those come from ReccoBeats instead (see api.js).
// Spotify requires the redirect URI to be a loopback IP, e.g. http://127.0.0.1:8787/

const AUTH = 'https://accounts.spotify.com/authorize';
const TOKEN = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';
const SCOPES = [
  'user-top-read', 'user-read-recently-played', 'user-library-read',
  'playlist-read-private', 'playlist-modify-private', 'playlist-modify-public',
].join(' ');

const LS = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(`mw.sp.${k}`)); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(`mw.sp.${k}`, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  del: (k) => { try { localStorage.removeItem(`mw.sp.${k}`); } catch { /* storage unavailable */ } },
};

// the exact address you registered in the Spotify dashboard: loopback IP locally, https on a deployed site
export const redirectUri = () => `${location.origin}${location.pathname.replace(/index.html$/, '')}`;
export const savedClientId = () => LS.get('clientId') ?? '';
export const isConnected = () => !!LS.get('token')?.refresh_token || !!LS.get('token')?.access_token;

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomString = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export async function login(clientId) {
  if (!clientId) throw new Error('Enter your Spotify Client ID first.');
  LS.set('clientId', clientId);
  const verifier = randomString(64);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = randomString(16);
  sessionStorage.setItem('mw.sp.verifier', verifier);
  sessionStorage.setItem('mw.sp.state', state);
  const p = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri(), scope: SCOPES,
    code_challenge_method: 'S256', code_challenge: challenge, state,
  });
  location.assign(`${AUTH}?${p}`);
}

async function tokenRequest(body) {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description ?? json.error ?? `Spotify token error ${res.status}`);
  const prev = LS.get('token') ?? {};
  LS.set('token', {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? prev.refresh_token,
    expires_at: Date.now() + (json.expires_in - 30) * 1000,
  });
}

/** Call on page load. Returns 'connected', 'error:<msg>' or null (nothing to do). */
export async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return null;
  history.replaceState({}, '', location.pathname);
  if (q.has('error')) return `error:${q.get('error')}`;
  if (q.get('state') !== sessionStorage.getItem('mw.sp.state')) return 'error:state mismatch';
  try {
    await tokenRequest({
      grant_type: 'authorization_code', code: q.get('code'), redirect_uri: redirectUri(),
      client_id: savedClientId(), code_verifier: sessionStorage.getItem('mw.sp.verifier') ?? '',
    });
    return 'connected';
  } catch (e) {
    return `error:${e.message}`;
  }
}

export function logout() { LS.del('token'); }

async function accessToken() {
  const t = LS.get('token');
  if (!t) throw new Error('Not connected to Spotify.');
  if (Date.now() < t.expires_at) return t.access_token;
  if (!t.refresh_token) { LS.del('token'); throw new Error('Spotify session expired. Connect again.'); }
  await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: savedClientId() });
  return LS.get('token').access_token;
}

async function call(path, { method = 'GET', body, tries = 3 } = {}) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await accessToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, (Number(res.headers.get('retry-after')) || 2) * 1000)); continue; }
    if (res.status === 204) return null;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json.error?.message ?? `Spotify error ${res.status}`;
      if (res.status === 403) throw new Error(`${msg} (if this says the user is not registered, add your account under User Management in the Spotify dashboard)`);
      throw new Error(msg);
    }
    return json;
  }
  throw new Error('Spotify rate limit: try again in a moment.');
}

const toTrack = (t) => (t?.id ? {
  title: t.name,
  artists: (t.artists ?? []).map((a) => a.name),
  artistIds: (t.artists ?? []).map((a) => a.id),
  spotifyId: t.id,
  art: t.album?.images?.[1]?.url ?? t.album?.images?.[0]?.url ?? null,
  durationMs: t.duration_ms ?? null,
} : null);

export const me = () => call('/me');

/**
 * Pull "what I actually listen to": top tracks across three windows, top artists (for genres),
 * recent plays, and a slice of saved tracks. Returns tracks in the importer shape.
 */
export async function fetchTaste(onProgress = () => {}) {
  const ranges = ['short_term', 'medium_term', 'long_term'];
  const byId = new Map();
  const touch = (t, patch) => {
    if (!t) return;
    const cur = byId.get(t.spotifyId) ?? { ...t, plays: 0, skips: 0, msPlayed: 0, lastPlayed: null };
    byId.set(t.spotifyId, { ...cur, ...patch(cur) });
  };

  onProgress('Reading your top tracks…');
  for (const r of ranges) {
    const j = await call(`/me/top/tracks?limit=50&time_range=${r}`);
    j.items.forEach((raw, rank) => touch(toTrack(raw), (c) => ({
      liked: true, plays: c.plays + 1.5, rank: Math.min(c.rank ?? 99, rank),
      lastPlayed: r === 'short_term' ? Date.now() - 7 * 864e5 : c.lastPlayed,
    })));
  }

  onProgress('Reading your top artists…');
  const artistGenres = new Map();
  for (const r of ranges) {
    const j = await call(`/me/top/artists?limit=50&time_range=${r}`);
    for (const a of j.items) artistGenres.set(a.name, a.genres ?? []);
  }

  onProgress('Reading recent plays…');
  try {
    const j = await call('/me/player/recently-played?limit=50');
    for (const it of j.items) touch(toTrack(it.track), (c) => ({ plays: c.plays + 1, lastPlayed: Math.max(c.lastPlayed ?? 0, Date.parse(it.played_at)) }));
  } catch { /* optional */ }

  onProgress('Reading saved tracks…');
  try {
    for (let offset = 0; offset < 200; offset += 50) {
      const j = await call(`/me/tracks?limit=50&offset=${offset}`);
      for (const it of j.items) touch(toTrack(it.track), (c) => ({ liked: true, plays: Math.max(c.plays, 1), lastPlayed: c.lastPlayed ?? Date.parse(it.added_at) }));
      if (j.items.length < 50) break;
    }
  } catch { /* optional */ }

  const tracks = [...byId.values()].map((t) => ({
    ...t,
    genres: [...new Set(t.artists.flatMap((a) => artistGenres.get(a) ?? []))],
  }));
  return { tracks, artistGenres };
}

export async function listPlaylists() {
  const out = [];
  for (let offset = 0; offset < 300; offset += 50) {
    const j = await call(`/me/playlists?limit=50&offset=${offset}`);
    out.push(...j.items.filter(Boolean).map((p) => ({
      id: p.id, name: p.name, owner: p.owner?.display_name ?? '', count: p.items?.total ?? p.tracks?.total ?? null,
    })));
    if (j.items.length < 50) break;
  }
  return out;
}

export async function playlistTracks(id) {
  const out = [];
  for (let offset = 0; offset < 1000; offset += 50) {
    const j = await call(`/playlists/${id}/items?limit=50&offset=${offset}`);
    for (const it of j.items) {
      const t = toTrack(it.item ?? it.track); // field was renamed in Feb 2026
      if (t) out.push({ ...t, plays: 1, skips: 0, msPlayed: 0, lastPlayed: Date.parse(it.added_at) || null, liked: true });
    }
    if (j.items.length < 50) break;
  }
  return out;
}

/** Create a private playlist holding the given Spotify track IDs; returns its web URL. */
export async function createPlaylist({ name, description, spotifyIds, isPublic = false }) {
  const pl = await call('/me/playlists', { method: 'POST', body: { name, description, public: isPublic } });
  for (let i = 0; i < spotifyIds.length; i += 100) {
    await call(`/playlists/${pl.id}/items`, { method: 'POST', body: { uris: spotifyIds.slice(i, i + 100).map((id) => `spotify:track:${id}`) } });
  }
  return pl.external_urls?.spotify ?? `https://open.spotify.com/playlist/${pl.id}`;
}

/** Title/artist -> Spotify track (used to find Spotify IDs for Apple/YouTube history). */
export async function searchTrack(title, artist) {
  const q = `track:${title}${artist ? ` artist:${artist}` : ''}`;
  const j = await call(`/search?type=track&limit=5&q=${encodeURIComponent(q)}`);
  return (j.tracks?.items ?? []).map(toTrack).filter(Boolean);
}
