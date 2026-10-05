import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanTitle, artistList, matchScore, bestMatch, trackKey, makeExclusion, isExcluded, titleSim } from '../src/core/match.js';

test('cleanTitle strips video/remaster noise but keeps the song', () => {
  assert.equal(cleanTitle('Bohemian Rhapsody (Official Video Remastered)'), 'bohemian rhapsody');
  assert.equal(cleanTitle('Hotel California - 2013 Remaster'), 'hotel california');
  assert.equal(cleanTitle('Levitating (feat. DaBaby)'), 'levitating');
  assert.equal(cleanTitle('"Subhanallah"  Full Video Song'), 'subhanallah');
  assert.equal(cleanTitle('Pee Loon Lyrical Video Song'), 'pee loon');
});

test('artistList splits collaborations and drops YouTube decorations', () => {
  assert.deepEqual(artistList('Drake & Don Toliver'), ['drake', 'don toliver']);
  assert.deepEqual(artistList('Queen Official'), ['queen']);
  assert.deepEqual(artistList('Coldplay - Topic'), ['coldplay']);
  assert.deepEqual(artistList(['Mithoon & Arijit Singh']), ['mithoon', 'arijit singh']);
});

test('matchScore prefers the real artist and penalises covers', () => {
  const want = { title: 'Yellow', artists: ['Coldplay'] };
  const real = matchScore(want, { title: 'Yellow', artists: ['Coldplay'] });
  const cover = matchScore(want, { title: 'Yellow', artists: ['Vitamin String Quartet'] });
  const karaoke = matchScore(want, { title: 'Yellow (Karaoke Version)', artists: ['Coldplay'] });
  assert.ok(real > 0.95);
  assert.ok(cover < 0.4);
  assert.ok(karaoke < real * 0.5);
});

test('bestMatch picks the original and rejects weak matches', () => {
  const results = [
    { title: 'Blinding Lights', artists: ['Kidz Bop Kids'], popularity: 44 },
    { title: 'Blinding Lights', artists: ['The Weeknd'], popularity: 87 },
    { title: 'Blinding Lights', artists: ['Revelries', 'Victoria Voss'], popularity: 61 },
  ];
  assert.equal(bestMatch({ title: 'Blinding Lights', artists: ['The Weeknd'] }, results).item.artists[0], 'The Weeknd');
  assert.equal(bestMatch({ title: 'Blinding Lights', artists: ['Some Nobody'] }, results), null);
});

test('titleOnly fallback accepts a famous exact title when the uploader is a record label', () => {
  const results = [{ title: 'Pee Loon', artists: ['Mohit Chauhan'], popularity: 62 }, { title: 'Pee Loon (Cover)', artists: ['X'], popularity: 5 }];
  const want = { title: 'Pee Loon', artists: ['T-Series'] };
  assert.equal(bestMatch(want, results), null);
  assert.equal(bestMatch(want, results, { titleOnly: true }).item.artists[0], 'Mohit Chauhan');
  assert.equal(bestMatch(want, [{ title: 'Pee Loon', artists: ['Nobody'], popularity: 3 }], { titleOnly: true }), null);
});

test('trackKey prefers the Spotify id, otherwise a title+artist key that ignores decoration', () => {
  assert.equal(trackKey({ spotifyId: 'abc', title: 'x', artists: ['y'] }), 'sp:abc');
  assert.equal(trackKey({ title: 'Hotel California (Live)', artists: ['Eagles'] }), trackKey({ title: 'Hotel California', artists: ['The Eagles'.replace('The ', '')] }));
});

// The behaviour the "more like my playlist" feature depends on.
test('exclusion: the shared playlist can never be suggested back, even across services', () => {
  const ex = makeExclusion([
    { title: 'Bohemian Rhapsody (Official Video Remastered)', artists: ['Queen Official'] }, // as read from a YouTube Mix
    { key: 'sp:111', title: 'Dream On', artists: ['Aerosmith'], spotifyId: '111', isrc: 'USSM17400002' },
    { title: 'Mystery Song', artists: [] }, // artist unknown: exclude on title alone
  ]);
  // same song, Spotify metadata and ID the YouTube upload never had
  assert.ok(isExcluded(ex, { key: 'sp:999', spotifyId: '999', title: 'Bohemian Rhapsody - Remastered 2011', artists: ['Queen'] }));
  assert.ok(isExcluded(ex, { key: 'sp:111', spotifyId: '111', title: 'Dream On', artists: ['Aerosmith'] }), 'same id');
  assert.ok(isExcluded(ex, { key: 'sp:222', spotifyId: '222', isrc: 'USSM17400002', title: 'Dream On (2020 mix)', artists: ['Aerosmith'] }), 'same isrc');
  assert.ok(isExcluded(ex, { key: 'x', title: 'Mystery Song', artists: ['Anyone'] }));
  // different songs / same title by a different artist stay available
  assert.ok(!isExcluded(ex, { key: 'sp:333', spotifyId: '333', title: 'We Will Rock You', artists: ['Queen'] }));
  assert.ok(!isExcluded(ex, { key: 'sp:444', spotifyId: '444', title: 'Dream On', artists: ['Depeche Mode'] }));
});

test('titleSim handles containment sensibly', () => {
  assert.equal(titleSim('Yesterday', 'Yesterday'), 1);
  assert.ok(titleSim('Love', 'Love Story (Taylor’s Version) extended') < 0.7);
});

test('exclusion: catches a song whose YouTube title embeds the artist and was parsed into the wrong fields', () => {
  // read from a Mix as: title "twenty one pilots Stressed Out", uploader "Fueled By Ramen"
  const ex = makeExclusion([{ title: 'twenty one pilots Stressed Out', artists: ['Fueled By Ramen', 'twenty one pilots'] }]);
  assert.ok(isExcluded(ex, { key: 'sp:1', spotifyId: '1', title: 'Stressed Out', artists: ['Twenty One Pilots'] }));
  // whole-word matching only: a short title must not match inside a longer one
  assert.ok(!isExcluded(makeExclusion([{ title: 'Heroes and Villains', artists: ['Beach Boys'] }]), { key: 'x', title: 'Heroes', artists: ['Beach Boys'] }));
  // the title alone is not enough, the artist has to be there too
  assert.ok(!isExcluded(ex, { key: 'sp:2', spotifyId: '2', title: 'Stressed Out', artists: ['Some Cover Band'] }));
});
