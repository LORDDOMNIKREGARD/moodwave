import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSpotifyHistory, parseYouTubeTakeout, splitYouTubeTitle, parseDelimited, parseTable, parseM3u, parsePlainList, parseAny, spotifyIdFrom, youtubeIdFrom, decodeBytes,
} from '../src/core/importers.js';

test('spotifyIdFrom / youtubeIdFrom read ids from uris and links', () => {
  assert.equal(spotifyIdFrom('spotify:track:3n3Ppam7vgaVa1iaRUc9Lp'), '3n3Ppam7vgaVa1iaRUc9Lp');
  assert.equal(spotifyIdFrom('https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b?si=abc'), '0VjIjW4GlUZAMYd2vXMi3b');
  assert.equal(spotifyIdFrom('nonsense'), null);
  assert.equal(youtubeIdFrom('https://www.youtube.com/watch?v=fJ9rUzIMcZQ&list=RD'), 'fJ9rUzIMcZQ');
  assert.equal(youtubeIdFrom('https://youtu.be/fJ9rUzIMcZQ'), 'fJ9rUzIMcZQ');
});

test('Spotify extended history: aggregates plays, counts skips, ignores podcasts', () => {
  const rows = [
    { ts: '2026-01-01T10:00:00Z', ms_played: 200000, master_metadata_track_name: 'Song A', master_metadata_album_artist_name: 'Artist', spotify_track_uri: 'spotify:track:3n3Ppam7vgaVa1iaRUc9Lp', skipped: false },
    { ts: '2026-02-01T10:00:00Z', ms_played: 190000, master_metadata_track_name: 'Song A', master_metadata_album_artist_name: 'Artist', spotify_track_uri: 'spotify:track:3n3Ppam7vgaVa1iaRUc9Lp', skipped: false },
    { ts: '2026-02-02T10:00:00Z', ms_played: 4000, master_metadata_track_name: 'Song A', master_metadata_album_artist_name: 'Artist', spotify_track_uri: 'spotify:track:3n3Ppam7vgaVa1iaRUc9Lp', skipped: true },
    { ts: '2026-02-03T10:00:00Z', ms_played: 3000, master_metadata_track_name: 'Only skipped', master_metadata_album_artist_name: 'B', spotify_track_uri: 'spotify:track:0VjIjW4GlUZAMYd2vXMi3b', skipped: true },
    { ts: '2026-02-03T10:00:00Z', ms_played: 600000, master_metadata_track_name: null, episode_name: 'A podcast' },
  ];
  const out = parseSpotifyHistory(rows);
  assert.equal(out.length, 2);
  const a = out.find((t) => t.title === 'Song A');
  assert.equal(a.plays, 2);
  assert.equal(a.skips, 1);
  assert.equal(a.spotifyId, '3n3Ppam7vgaVa1iaRUc9Lp');
  assert.equal(a.lastPlayed, Date.parse('2026-02-02T10:00:00Z'));
  assert.equal(out.find((t) => t.title === 'Only skipped').plays, 1, 'a skipped-only track still registers as heard');
});

test('splitYouTubeTitle: order is settled by the channel name', () => {
  assert.deepEqual(splitYouTubeTitle('Arcángel - FN8 ( Video Lyric )', 'Arcángel').artists[0], 'Arcángel');
  const swapped = splitYouTubeTitle('BELLAKEO (Video Oficial) - Peso Pluma, Anitta', 'Peso Pluma');
  assert.equal(swapped.title, 'BELLAKEO (Video Oficial)');
  assert.equal(swapped.artist, 'Peso Pluma, Anitta');
  const topic = splitYouTubeTitle('Yellow', 'Coldplay - Topic');
  assert.equal(topic.artist, 'Coldplay');
  assert.equal(topic.title, 'Yellow');
  assert.equal(splitYouTubeTitle('Watched Queen – Bohemian Rhapsody (Official Video Remastered)', 'Queen Official').artist, 'Queen');
});

test('splitYouTubeTitle: film-music "Song | Film | Composer | Singers" keeps every credit for matching', () => {
  const r = splitYouTubeTitle('"Pee Loon" Lyrical Song | Once Upon A Time in Mumbai | Pritam | Emraan Hashmi, Prachi Desai', 'T-Series');
  assert.equal(r.title, '"Pee Loon" Lyrical Song');
  assert.ok(r.artists.includes('Pritam') && r.artists.includes('Emraan Hashmi') && r.artists.includes('T-Series'));
});

test('YouTube Takeout: keeps music, drops ordinary videos and removed videos', () => {
  const rows = [
    { header: 'YouTube Music', title: 'Watched Yellow', titleUrl: 'https://music.youtube.com/watch?v=yKNxeF4KMsY', subtitles: [{ name: 'Coldplay - Topic' }], time: '2026-03-01T00:00:00Z' },
    { header: 'YouTube Music', title: 'Watched Yellow', titleUrl: 'https://music.youtube.com/watch?v=yKNxeF4KMsY', subtitles: [{ name: 'Coldplay - Topic' }], time: '2026-03-02T00:00:00Z' },
    { header: 'YouTube', title: 'Watched How to bake bread', titleUrl: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', subtitles: [{ name: 'Baker' }], time: '2026-03-01T00:00:00Z' },
    { header: 'YouTube', title: 'Watched Daft Punk - Get Lucky (Official Audio)', titleUrl: 'https://www.youtube.com/watch?v=5NV6Rdv1a3I', subtitles: [{ name: 'Daft Punk' }], time: '2026-03-01T00:00:00Z' },
    { header: 'YouTube', title: 'Watched https://www.youtube.com/watch?v=zzzzzzzzzzz', titleUrl: 'https://www.youtube.com/watch?v=zzzzzzzzzzz', time: '2026-03-01T00:00:00Z' },
  ];
  const out = parseYouTubeTakeout(rows);
  assert.equal(out.length, 2);
  assert.equal(out.find((t) => t.title === 'Yellow').plays, 2);
  assert.equal(out.find((t) => t.title === 'Get Lucky (Official Audio)').artists[0], 'Daft Punk');
  assert.equal(parseYouTubeTakeout(rows, { all: true }).length, 3);
});

test('parseDelimited handles quotes, embedded commas and tab files', () => {
  assert.deepEqual(parseDelimited('a,b\n"x, y","he said ""hi"""\n'), [['a', 'b'], ['x, y', 'he said "hi"']]);
  assert.deepEqual(parseDelimited('Name\tArtist\nSong\tBand\n'), [['Name', 'Artist'], ['Song', 'Band']]);
});

test('Apple Music "Play History Daily Tracks": splits "Artist - Title" and reads skips', () => {
  const csv = 'Date Played,Track Description,Play Duration Milliseconds,Skip Count\n20260105,Coldplay - Yellow,260000,0\n20260106,Coldplay - Yellow,255000,0\n20260107,Adele - Hello,1000,1\n';
  const out = parseTable(csv);
  const y = out.find((t) => t.title === 'Yellow');
  assert.equal(y.artists[0], 'Coldplay');
  assert.equal(y.plays, 2);
  assert.equal(out.length, 2);
});

test('Music.app / iTunes playlist export (tab separated, UTF-16) carries genre and counts', () => {
  const tsv = 'Name\tArtist\tGenre\tPlays\tSkips\nYellow\tColdplay\tAlternative\t42\t3\n';
  const u16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(tsv, 'utf16le')]);
  const r = parseAny('Library.txt', decodeBytes(u16));
  assert.equal(r.kind, 'table');
  assert.equal(r.tracks[0].title, 'Yellow');
  assert.deepEqual(r.tracks[0].genres, ['Alternative']);
  assert.equal(r.tracks[0].plays, 42);
  assert.equal(r.tracks[0].skips, 3);
});

test('Exportify-style CSV with audio features needs no lookup', () => {
  const csv = 'Track URI,Track Name,Artist Name(s),Tempo,Energy,Valence,Danceability,Acousticness\nspotify:track:3n3Ppam7vgaVa1iaRUc9Lp,Mr. Brightside,The Killers,148.1,0.918,0.24,0.355,0.0012\n';
  const t = parseTable(csv)[0];
  assert.equal(t.spotifyId, '3n3Ppam7vgaVa1iaRUc9Lp');
  assert.equal(t.features.tempo, 148.1);
  assert.equal(t.features.energy, 0.918);
});

test('YouTube Takeout playlist CSV (video ids only) is recognised', () => {
  const r = parseAny('Chill-videos.csv', 'Video ID,Playlist Video Creation Timestamp\nfJ9rUzIMcZQ,2026-01-01T00:00:00+00:00\n09839DpTctU,2026-01-02T00:00:00+00:00\n');
  assert.equal(r.kind, 'youtube-ids');
  assert.deepEqual(r.tracks.map((t) => t.ytId), ['fJ9rUzIMcZQ', '09839DpTctU']);
});

test('Spotify account-data playlists export yields one list per playlist', () => {
  const json = JSON.stringify({ playlists: [{ name: 'Gym', items: [{ track: { trackName: 'Lose Yourself', artistName: 'Eminem', trackUri: 'spotify:track:7w9bgPAmPTtrkt2v16QWvQ' } }] }] });
  const r = parseAny('Playlist1.json', json);
  assert.equal(r.kind, 'spotify-playlists');
  assert.equal(r.playlists[0].name, 'Gym');
  assert.equal(r.tracks[0].spotifyId, '7w9bgPAmPTtrkt2v16QWvQ');
});

test('M3U and plain lists', () => {
  const m3u = parseM3u('#EXTM3U\n#EXTINF:200,Queen - Bohemian Rhapsody\nhttp://x/1.mp3\n');
  assert.deepEqual([m3u[0].artists[0], m3u[0].title], ['Queen', 'Bohemian Rhapsody']);
  const list = parsePlainList('1. Coldplay - Yellow\nHello by Adele\nhttps://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b\n\nJust A Title');
  assert.equal(list.length, 4);
  assert.equal(list[0].title, 'Yellow');
  assert.equal(list[1].artists[0], 'Adele');
  assert.equal(list[2].spotifyId, '0VjIjW4GlUZAMYd2vXMi3b');
  assert.equal(list[3].title, 'Just A Title');
});

test('parseAny explains unknown formats instead of guessing', () => {
  assert.throws(() => parseAny('x.json', '{"foo": 1}'), /not recognised/);
  assert.throws(() => parseTable('A,B\n1,2\n'), /song-name column/);
});
