// Parsers that turn each service's own export format into one normalised shape:
//   { title, artists[], spotifyId?, ytId?, genres?, features?, plays, skips, msPlayed, lastPlayed, liked? }
// Pure text/JSON in, plain objects out. Network resolution happens later (see app.js).

import { artistList, cleanTitle, norm } from './match.js';

const SPOTIFY_URI = /spotify:track:([A-Za-z0-9]{22})|open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/([A-Za-z0-9]{22})/;
const YT_ID = /(?:v=|youtu\.be\/|\/shorts\/)([A-Za-z0-9_-]{11})/;

export const spotifyIdFrom = (s) => {
  const m = SPOTIFY_URI.exec(s ?? '');
  return m ? m[1] ?? m[2] : null;
};
export const youtubeIdFrom = (s) => YT_ID.exec(s ?? '')?.[1] ?? null;

const blank = () => ({ plays: 1, skips: 0, msPlayed: 0, lastPlayed: null });

/** Collapse repeated rows into one entry per song, summing plays. */
export function aggregate(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = r.spotifyId ? `sp:${r.spotifyId}` : r.ytId && !r.title ? `yt:${r.ytId}` : `ta:${cleanTitle(r.title)}|${artistList(r.artists)[0] ?? ''}`;
    const cur = map.get(key);
    if (!cur) { map.set(key, { ...blank(), ...r }); continue; }
    cur.plays += r.plays ?? 1;
    cur.skips += r.skips ?? 0;
    cur.msPlayed += r.msPlayed ?? 0;
    cur.lastPlayed = Math.max(cur.lastPlayed ?? 0, r.lastPlayed ?? 0) || null;
    cur.liked = cur.liked || r.liked;
    cur.spotifyId ??= r.spotifyId;
    cur.features ??= r.features;
    cur.genres ??= r.genres;
  }
  return [...map.values()];
}

// ---------------------------------------------------------------- Spotify

/** Extended streaming history (Streaming_History_Audio_*.json) and the older StreamingHistory*.json. */
export function parseSpotifyHistory(rows) {
  const out = [];
  for (const r of rows) {
    const title = r.master_metadata_track_name ?? r.trackName;
    if (!title) continue; // podcasts / audiobooks
    const ms = r.ms_played ?? r.msPlayed ?? 0;
    const skipped = r.skipped === true || (r.reason_end ?? '').startsWith('fwdbtn') || ms < 30000;
    out.push({
      title,
      artists: [r.master_metadata_album_artist_name ?? r.artistName].filter(Boolean),
      spotifyId: spotifyIdFrom(r.spotify_track_uri),
      plays: skipped ? 0 : 1,
      skips: skipped ? 1 : 0,
      msPlayed: ms,
      lastPlayed: Date.parse(r.ts ?? r.endTime) || null,
    });
  }
  // a track that was only ever skipped should still register as "heard", just lightly
  return aggregate(out).map((t) => ({ ...t, plays: Math.max(t.plays, t.skips ? 1 : 0) }));
}

/** Spotify account-data export: Playlist1.json -> { playlists: [{ name, items: [{ track }] }] } */
export function parseSpotifyPlaylistsExport(json) {
  const lists = json.playlists ?? [];
  return lists.map((pl) => ({
    name: pl.name,
    tracks: (pl.items ?? []).filter((i) => i.track).map((i) => ({
      title: i.track.trackName,
      artists: [i.track.artistName].filter(Boolean),
      spotifyId: spotifyIdFrom(i.track.trackUri),
      ...blank(),
    })),
  }));
}

// ---------------------------------------------------------------- YouTube

const MUSIC_HINT = /official (music )?(video|audio)|lyric|\baudio\b|\(mv\)|\bvevo\b|\bft\.|\bfeat\b/i;

/**
 * YouTube titles come as "Artist - Song" or "Song - Artist". The uploader's channel name settles it:
 * whichever side contains the channel is the artist. Falls back to "Artist - Song".
 */
export function splitYouTubeTitle(title, channel = '') {
  const t = title.replace(/^Watched\s+/i, '').trim();
  const topic = /\s-\sTopic$/i.test(channel);
  const cleanChannel = channel.replace(/\s-\sTopic$/i, '').replace(/VEVO$/i, '').replace(/\s*official$/i, '').trim();
  const done = (artist, song, extra = []) => ({ artist, title: song, artists: [artist, ...extra].filter(Boolean) });

  // Film-music style: `"Song" Lyrical Video | Film | Composer | Singers` uploaded by a label channel.
  const pipes = t.split(/\s\|\s/).map((s) => s.trim()).filter(Boolean);
  if (pipes.length >= 3 && !topic) return done(cleanChannel, pipes[0], pipes.slice(1).flatMap((s) => s.split(/\s*,\s*/)));

  const m = /^(.+?)\s[-–—|]\s(.+)$/.exec(t);
  if (topic || !m) return done(cleanChannel, t);
  const [a, b] = [m[1].trim(), m[2].trim()];
  const ch = norm(cleanChannel);
  if (ch && norm(b).includes(ch) && !norm(a).includes(ch)) return done(b, a);
  return done(a, b);
}

/**
 * Google Takeout "watch-history.json". Keeps YouTube Music entries, "- Topic" auto channels and
 * things that look like music videos; pass {all: true} to keep every video.
 */
export function parseYouTubeTakeout(rows, { all = false } = {}) {
  const out = [];
  for (const r of rows) {
    const rawTitle = r.title ?? '';
    if (!/^Watched /i.test(rawTitle)) continue;
    const channel = r.subtitles?.[0]?.name ?? '';
    if (!channel) continue; // removed videos have no channel and cannot be resolved
    const isMusic = r.header === 'YouTube Music' || /\s-\sTopic$/i.test(channel) || /vevo$/i.test(channel) || MUSIC_HINT.test(rawTitle);
    if (!all && !isMusic) continue;
    const { title, artists } = splitYouTubeTitle(rawTitle, channel);
    out.push({ title, artists, ytId: youtubeIdFrom(r.titleUrl), plays: 1, lastPlayed: Date.parse(r.time) || null });
  }
  return aggregate(out);
}

// ---------------------------------------------------------------- delimited text (CSV / TSV)

export function parseDelimited(text) {
  const src = text.replace(/^﻿/, '');
  const first = src.split(/\r?\n/, 1)[0] ?? '';
  const counts = { '\t': 0, ',': 0, ';': 0 };
  let inQ = false;
  for (const ch of first) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

const col = (headers, ...patterns) => {
  for (const p of patterns) {
    const i = headers.findIndex((h) => p.test(h));
    if (i >= 0) return i;
  }
  return -1;
};

const numOrNull = (v) => (v === '' || v == null || Number.isNaN(+v) ? null : +v);

/**
 * Handles: Apple Music privacy-export CSVs, Music.app / iTunes playlist export (.txt, tab separated),
 * Exportify / Soundiiz / TuneMyMusic CSVs, and YouTube Takeout playlist CSVs (Video ID column only).
 */
export function parseTable(text) {
  const rows = parseDelimited(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  const cTitle = col(headers, /^(song|track) name$/i, /^track description$/i, /^title$/i, /^name$/i, /^track$/i, /^song$/i);
  const cArtist = col(headers, /^artist name\(s\)$/i, /^artist name$/i, /^artist\(s\)$/i, /^artists?$/i, /^album artist$/i, /artist/i);
  const cVideo = col(headers, /^video id$/i);
  const cUri = col(headers, /spotify.*(uri|id)|^track uri$|^uri$/i);
  const cPlays = col(headers, /^plays?$/i, /^play count$/i);
  const cSkips = col(headers, /^skips?$/i, /^skip count$/i);
  const cMs = col(headers, /play duration milliseconds/i);
  const cTs = col(headers, /^last played$/i, /event start timestamp/i, /date played/i, /added at|date added/i);
  const cGenre = col(headers, /^genres?$/i);
  const cEnd = col(headers, /end reason type/i);
  const feat = {
    tempo: col(headers, /^(tempo|bpm|beats per minute)$/i), energy: col(headers, /^energy$/i), valence: col(headers, /^valence$/i),
    danceability: col(headers, /^danceability$/i), acousticness: col(headers, /^acousticness$/i), key: col(headers, /^key$/i), mode: col(headers, /^mode$/i),
    loudness: col(headers, /^loudness$/i), instrumentalness: col(headers, /^instrumentalness$/i), speechiness: col(headers, /^speechiness$/i), liveness: col(headers, /^liveness$/i),
  };
  if (cTitle < 0 && cVideo < 0 && cUri < 0) {
    throw new Error(`Could not find a song-name column. Columns seen: ${headers.slice(0, 12).join(', ')}`);
  }

  const out = [];
  for (const r of rows.slice(1)) {
    let title = cTitle >= 0 ? r[cTitle]?.trim() : '';
    let artists = cArtist >= 0 ? [r[cArtist]?.trim()].filter(Boolean) : [];
    if (cArtist < 0 && /^track description$/i.test(headers[cTitle] ?? '') && title.includes(' - ')) {
      const [a, ...rest] = title.split(' - ');
      artists = [a]; title = rest.join(' - ');
    }
    const spotifyId = cUri >= 0 ? spotifyIdFrom(r[cUri]) ?? (/^[A-Za-z0-9]{22}$/.test(r[cUri] ?? '') ? r[cUri] : null) : null;
    const ytId = cVideo >= 0 ? r[cVideo]?.trim() || null : null;
    if (!title && !spotifyId && !ytId) continue;
    const features = {};
    for (const [k, i] of Object.entries(feat)) if (i >= 0) features[k] = numOrNull(r[i]);
    const hasFeat = features.tempo != null && features.energy != null && features.valence != null;
    const skipped = cEnd >= 0 && /skip/i.test(r[cEnd] ?? '');
    out.push({
      title, artists, spotifyId, ytId,
      genres: cGenre >= 0 && r[cGenre] ? r[cGenre].split(/[,;]/).map((g) => g.trim()).filter(Boolean) : undefined,
      features: hasFeat ? features : undefined,
      plays: cPlays >= 0 ? Math.max(1, numOrNull(r[cPlays]) ?? 1) : skipped ? 0 : 1,
      skips: cSkips >= 0 ? numOrNull(r[cSkips]) ?? 0 : skipped ? 1 : 0,
      msPlayed: cMs >= 0 ? numOrNull(r[cMs]) ?? 0 : 0,
      lastPlayed: cTs >= 0 ? Date.parse(r[cTs]) || null : null,
    });
  }
  return aggregate(out).map((t) => ({ ...t, plays: Math.max(t.plays, 1) }));
}

// ---------------------------------------------------------------- M3U / plain lists

export function parseM3u(text) {
  const out = [];
  let pending = null;
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (l.startsWith('#EXTINF:')) pending = l.slice(l.indexOf(',') + 1).trim();
    else if (l && !l.startsWith('#')) {
      const label = pending ?? l.split(/[\\/]/).pop().replace(/\.[a-z0-9]+$/i, '');
      const m = /^(.+?)\s[-–—]\s(.+)$/.exec(label);
      out.push({ title: m ? m[2] : label, artists: m ? [m[1]] : [], ...blank() });
      pending = null;
    }
  }
  return out;
}

/** One song per line: "Artist - Title", "Title by Artist", or a Spotify / YouTube link. */
export function parsePlainList(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(\d+[.)]\s*|[-*•]\s*)/, '').trim();
    if (!line) continue;
    const spotifyId = spotifyIdFrom(line);
    const ytId = youtubeIdFrom(line);
    if (spotifyId || ytId) { out.push({ title: '', artists: [], spotifyId, ytId, ...blank() }); continue; }
    let m = /^(.+?)\s[-–—]\s(.+)$/.exec(line);
    if (m) { out.push({ title: m[2].trim(), artists: [m[1].trim()], ...blank() }); continue; }
    m = /^(.+?)\s+by\s+(.+)$/i.exec(line);
    if (m) { out.push({ title: m[1].trim(), artists: [m[2].trim()], ...blank() }); continue; }
    out.push({ title: line, artists: [], ...blank() });
  }
  return out;
}

// ---------------------------------------------------------------- sniffing

export function decodeBytes(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8);
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8);
  return new TextDecoder('utf-8').decode(u8);
}

/**
 * Work out what a file is and parse it. Returns { kind, label, tracks, playlists? }.
 * `playlists` is set when the file holds several named lists (Spotify account data).
 */
export function parseAny(fileName, text, opts = {}) {
  const name = fileName.toLowerCase();
  const body = text.replace(/^﻿/, '').trim();
  if (body.startsWith('[') || body.startsWith('{')) {
    let json;
    try { json = JSON.parse(body); } catch { throw new Error(`${fileName} looks like JSON but could not be parsed`); }
    if (Array.isArray(json)) {
      const s = json[0] ?? {};
      if ('master_metadata_track_name' in s || ('trackName' in s && 'msPlayed' in s)) {
        return { kind: 'spotify-history', label: 'Spotify streaming history', tracks: parseSpotifyHistory(json) };
      }
      if ('titleUrl' in s || 'header' in s || /^Watched/.test(s.title ?? '')) {
        return { kind: 'youtube-takeout', label: 'YouTube watch history', tracks: parseYouTubeTakeout(json, opts) };
      }
      if ('trackName' in s && 'artistName' in s) {
        return { kind: 'spotify-history', label: 'Spotify history', tracks: parseSpotifyHistory(json) };
      }
    } else if (json.playlists) {
      const playlists = parseSpotifyPlaylistsExport(json);
      return { kind: 'spotify-playlists', label: 'Spotify playlists', tracks: playlists.flatMap((p) => p.tracks), playlists };
    } else if (Array.isArray(json.tracks)) {
      return { kind: 'playlist-json', label: json.name ?? 'Playlist', tracks: aggregate(json.tracks.map((t) => ({ ...blank(), ...t }))) };
    }
    throw new Error(`${fileName}: JSON format not recognised (expected Spotify history, YouTube watch-history or a Spotify playlists export)`);
  }
  if (body.startsWith('#EXTM3U') || name.endsWith('.m3u') || name.endsWith('.m3u8')) {
    return { kind: 'm3u', label: 'M3U playlist', tracks: parseM3u(body) };
  }
  const firstLine = body.split(/\r?\n/, 1)[0];
  const looksTabular = /[\t,;]/.test(firstLine) && /name|title|track|artist|video id|uri/i.test(firstLine);
  if (looksTabular) {
    const tracks = parseTable(body);
    const hasVideoOnly = tracks.length && tracks.every((t) => t.ytId && !t.title);
    const label = hasVideoOnly ? 'YouTube playlist (video IDs)' : /apple|play/i.test(name) ? 'Apple Music export' : name.endsWith('.txt') ? 'Music app playlist export' : 'Playlist table';
    return { kind: hasVideoOnly ? 'youtube-ids' : 'table', label, tracks };
  }
  return { kind: 'list', label: 'Pasted list', tracks: parsePlainList(body) };
}
