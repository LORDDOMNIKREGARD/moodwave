import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, parseSpotifyEmbed, parseAppleMusic, parseYouTubePlaylist, parseYouTubeMix, PlaylistError } from '../server/playlists.mjs';
import { linkFor, playlistToCsv, playlistToM3u, playlistToText, youtubeQueueUrl, isDirect } from '../src/core/links.js';

const page = (script) => `<html><body>${script}</body></html>`;

test('classify recognises each service and rejects everything else', () => {
  assert.equal(classify('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=x').url, 'https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M');
  assert.equal(classify('https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb').source, 'apple');
  assert.equal(classify('https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI').url, 'https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI');
  assert.equal(classify('https://music.youtube.com/playlist?list=PLabc123').source, 'youtube');
  for (const bad of ['https://example.com/x', 'ftp://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', 'not a url', 'https://evil.com/?u=https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M']) {
    assert.throws(() => classify(bad), PlaylistError);
  }
});

test('classify: a YouTube Mix is read through its watch page, seeded by the video id', () => {
  const a = classify('https://www.youtube.com/watch?v=fJ9rUzIMcZQ&list=RDfJ9rUzIMcZQ&start_radio=1');
  assert.equal(a.kind, 'mix');
  assert.equal(a.url, 'https://www.youtube.com/watch?v=fJ9rUzIMcZQ&list=RDfJ9rUzIMcZQ');
  // seed recoverable from the list id alone
  assert.equal(classify('https://www.youtube.com/playlist?list=RDfJ9rUzIMcZQ').url, 'https://www.youtube.com/watch?v=fJ9rUzIMcZQ&list=RDfJ9rUzIMcZQ');
  // a personal "My Mix" with no seed cannot be read, and we say what to do
  assert.throws(() => classify('https://www.youtube.com/playlist?list=RDMM'), /address bar/);
});

test('Spotify embed page -> tracks with ids', () => {
  const data = { props: { pageProps: { state: { data: { entity: { name: 'Gym', trackList: [
    { uri: 'spotify:track:7w9bgPAmPTtrkt2v16QWvQ', title: 'Lose Yourself', subtitle: 'Eminem', duration: 326000 },
    { uri: 'spotify:track:0VjIjW4GlUZAMYd2vXMi3b', title: 'Blinding Lights', subtitle: 'The Weeknd, Someone' },
  ] } } } } } };
  const r = parseSpotifyEmbed(page(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`));
  assert.equal(r.name, 'Gym');
  assert.equal(r.tracks[0].spotifyId, '7w9bgPAmPTtrkt2v16QWvQ');
  assert.deepEqual(r.tracks[1].artists, ['The Weeknd', 'Someone']);
  assert.throws(() => parseSpotifyEmbed('<html></html>'), PlaylistError);
});

test('Apple Music page -> tracks from the serialized data', () => {
  const sd = { data: [{ items: [
    { id: '1', title: 'Solar Eclipse', artistName: 'Drake & Don Toliver', contentDescriptor: { kind: 'song', identifiers: { storeAdamID: '6818209989' } } },
    { id: '2', title: 'Patient Zero', artistName: 'Taylor Swift', contentDescriptor: { kind: 'song', identifiers: { storeAdamID: '6814997425' } } },
    { id: '3', title: 'Not a song', artistName: 'X', contentDescriptor: { kind: 'album' } },
  ] }] };
  const html = page(`<script type="application/ld+json">{"@type":"MusicPlaylist","name":"Today's Hits"}</script><script type="application/json" id="serialized-server-data">${JSON.stringify(sd)}</script>`);
  const r = parseAppleMusic(html);
  assert.equal(r.name, "Today's Hits");
  assert.equal(r.tracks.length, 2);
  assert.equal(r.tracks[0].appleId, '6818209989');
});

const lockup = (id, title, channel) => ({ lockupViewModel: { contentType: 'LOCKUP_CONTENT_TYPE_VIDEO', contentId: id, metadata: { lockupMetadataViewModel: { title: { content: title }, metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: channel } }] }] } } } } } });

test('YouTube playlist page -> tracks, with "Song - Artist" order fixed by the channel', () => {
  const data = { metadata: { playlistMetadataRenderer: { title: 'Popular' } }, items: [
    lockup('fOT0BUpITw8', 'BELLAKEO (Video Oficial) - Peso Pluma, Anitta', 'Peso Pluma'),
    lockup('NFvDHYMzj9U', 'Arcángel - FN8 ( Video Lyric )', 'Arcángel'),
  ] };
  const r = parseYouTubePlaylist(page(`<script>var ytInitialData = ${JSON.stringify(data)};</script>`));
  assert.equal(r.name, 'Popular');
  assert.equal(r.tracks[0].title, 'BELLAKEO (Video Oficial)');
  assert.equal(r.tracks[0].artists[0], 'Peso Pluma, Anitta');
  assert.equal(r.tracks[1].ytId, 'NFvDHYMzj9U');
});

test('YouTube Mix watch page -> the Mix panel songs, flagged as a Mix', () => {
  const panelItem = (id, title, ch) => ({ playlistPanelVideoRenderer: { videoId: id, title: { simpleText: title }, shortBylineText: { runs: [{ text: ch }] } } });
  const data = { contents: { twoColumnWatchNextResults: { playlist: { playlist: { title: 'Mix - Queen', contents: [
    panelItem('fJ9rUzIMcZQ', 'Queen – Bohemian Rhapsody (Official Video Remastered)', 'Queen Official'),
    panelItem('09839DpTctU', 'Eagles - Hotel California (Live 1977) (Official Video) [HD]', 'Eagles'),
  ] } } } } };
  const r = parseYouTubeMix(page(`<script>var ytInitialData = ${JSON.stringify(data)};</script>`));
  assert.equal(r.isMix, true);
  assert.equal(r.tracks.length, 2);
  assert.equal(r.tracks[0].artists[0], 'Queen');
  assert.equal(r.tracks[1].ytId, '09839DpTctU');
  assert.match(r.note, /never ends/);
  assert.throws(() => parseYouTubeMix(page('<script>var ytInitialData = {};</script>')), PlaylistError);
});

test('links: direct where the id is known, search otherwise', () => {
  const known = { title: 'Yellow', artists: ['Coldplay'], spotifyId: '3AJwUDP919kvQ9QcozQPxg', appleUrl: 'https://music.apple.com/x', ytId: 'yKNxeF4KMsY' };
  const bare = { title: 'Yellow', artists: ['Coldplay'] };
  assert.equal(linkFor.spotify(known), 'https://open.spotify.com/track/3AJwUDP919kvQ9QcozQPxg');
  assert.match(linkFor.spotify(bare), /open\.spotify\.com\/search\/Coldplay%20Yellow/);
  assert.match(linkFor.youtube(bare), /results\?search_query=Coldplay%20Yellow/);
  assert.ok(isDirect.spotify(known) && !isDirect.spotify(bare));
});

test('exports', () => {
  const tracks = [{ title: 'Say "Hi"', artists: ['A', 'B'], spotifyId: 'x'.repeat(22), features: { tempo: 120.4, energy: 0.5, valence: 0.7 }, genres: ['Pop'], durationMs: 200000 }];
  const csv = playlistToCsv(tracks).split('\r\n');
  assert.equal(csv.length, 2);
  assert.match(csv[1], /"Say ""Hi"""/);
  assert.match(csv[1], /"120"/);
  assert.match(playlistToM3u('Mix', tracks), /#EXTINF:200,A - Say "Hi"/);
  assert.equal(playlistToText(tracks), '1. A, B - Say "Hi"');
  assert.equal(youtubeQueueUrl(Array.from({ length: 60 }, (_, i) => `id${i}`)).split(',').length, 50);
});
