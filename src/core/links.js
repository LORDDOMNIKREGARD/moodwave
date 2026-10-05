// Deep links and export formats. Pure functions (unit-tested).
// Spotify/Apple/YouTube each get a direct link when we know the track's ID there, otherwise a search link.

const enc = encodeURIComponent;
const query = (t) => `${(t.artists ?? [])[0] ?? ''} ${t.title ?? ''}`.trim();

export const linkFor = {
  spotify: (t) => (t.spotifyId ? `https://open.spotify.com/track/${t.spotifyId}` : `https://open.spotify.com/search/${enc(query(t))}`),
  apple: (t) => t.appleUrl ?? `https://music.apple.com/search?term=${enc(query(t))}`,
  youtube: (t) => (t.ytId ? `https://www.youtube.com/watch?v=${t.ytId}` : `https://www.youtube.com/results?search_query=${enc(`${query(t)} official audio`)}`),
};

/** True when the link goes straight to the song instead of a search page. */
export const isDirect = {
  spotify: (t) => !!t.spotifyId,
  apple: (t) => !!t.appleUrl,
  youtube: (t) => !!t.ytId,
};

const cell = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;

export function playlistToCsv(tracks) {
  const head = ['#', 'Title', 'Artist', 'BPM', 'Energy', 'Valence', 'Genre', 'Spotify', 'Apple Music', 'YouTube'];
  const rows = tracks.map((t, i) => [
    i + 1, t.title, (t.artists ?? []).join(', '), Math.round(t.features?.tempo ?? 0) || '', t.features?.energy ?? '', t.features?.valence ?? '',
    (t.genres ?? []).join(' / '), linkFor.spotify(t), linkFor.apple(t), linkFor.youtube(t),
  ]);
  return [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

export function playlistToM3u(name, tracks) {
  const lines = ['#EXTM3U', `#PLAYLIST:${name}`];
  for (const t of tracks) {
    lines.push(`#EXTINF:${Math.round((t.durationMs ?? 0) / 1000) || -1},${(t.artists ?? [])[0] ?? ''} - ${t.title}`);
    lines.push(linkFor.spotify(t));
  }
  return lines.join('\n');
}

export const playlistToText = (tracks) => tracks.map((t, i) => `${i + 1}. ${(t.artists ?? []).join(', ')} - ${t.title}`).join('\n');

/** YouTube's anonymous queue: works for up to 50 video IDs and needs no login. */
export const youtubeQueueUrl = (ids) => `https://www.youtube.com/watch_videos?video_ids=${ids.slice(0, 50).join(',')}`;
