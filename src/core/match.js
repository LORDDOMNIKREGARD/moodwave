// Fuzzy matching of "title + artist" pairs across services (YouTube titles, Apple CSVs,
// ReccoBeats, iTunes ...). Pure functions: no DOM, no network, usable from Node and the browser.

const VERSION_JUNK = /\b(karaoke|tribute|parody|kidz bop|lullaby|lullabies|rockabye baby|music box|8[- ]?bit|midi|made famous|string quartet|originally performed|workout|piano cover|acoustic cover|instrumental version)\b/i;

export function norm(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip Latin diacritics only; keeps Devanagari/Hangul/Kana intact
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\p{M} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Remove "(Official Video)", "[Lyrics]", "feat. X", "- Remastered 2011" and friends. */
export function cleanTitle(raw) {
  let s = String(raw ?? '');
  s = s.replace(/[(\[{][^)\]}]*[)\]}]/g, ' ');
  s = s.replace(/\s[-–—]\s*(remaster(ed)?|\d{4} remaster|radio edit|single version|album version|live|mono|stereo|from\b|official|lyrics?|audio|video).*$/i, ' ');
  s = s.replace(/\b(feat\.?|ft\.?|featuring)\s.*$/i, ' ');
  s = s.replace(/\b(official (music )?(video|audio)|lyric(al)? (video )?(song)?|(full )?(video|audio) song|lyrics?|visuali[sz]er|full (video )?song|hd|4k|mv|m\/v)\b/gi, ' ');
  return norm(s);
}

const ARTIST_SPLIT = /\s*(?:,|&|\/|;|\+|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bwith\b|\bx\b|\band\b)\s*/i;

export function artistList(raw) {
  const list = Array.isArray(raw) ? raw : [raw];
  const out = new Set();
  for (const item of list) {
    String(item ?? '')
      .replace(/\s*-\s*topic$/i, '')
      .replace(/vevo$/i, '')
      .replace(/\bofficial\b/gi, '')
      .split(ARTIST_SPLIT)
      .map(norm)
      .filter(Boolean)
      .forEach((a) => out.add(a));
  }
  return [...out];
}

const tokens = (s) => new Set(s.split(' ').filter((t) => t.length > 1));

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export function titleSim(a, b) {
  const x = cleanTitle(a);
  const y = cleanTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) {
    const ratio = Math.min(x.length, y.length) / Math.max(x.length, y.length);
    return ratio >= 0.6 ? 0.88 : 0.6;
  }
  return jaccard(tokens(x), tokens(y));
}

export function artistSim(wanted, candidate) {
  const a = artistList(wanted);
  const b = artistList(candidate);
  if (!a.length || !b.length) return 0;
  let best = 0;
  for (const x of a) {
    for (const y of b) {
      if (x === y) return 1;
      if (x.includes(y) || y.includes(x)) best = Math.max(best, 0.8);
      else best = Math.max(best, jaccard(tokens(x), tokens(y)) * 0.7);
    }
  }
  return best;
}

/**
 * Score how well a candidate record matches what we are looking for.
 * want / cand: { title, artists: string[] | string }
 * Returns 0..1 (>= 0.75 is a confident match).
 */
export function matchScore(want, cand) {
  const t = titleSim(want.title, cand.title);
  const hasArtist = artistList(want.artists).length > 0;
  const a = hasArtist ? artistSim(want.artists, cand.artists) : 0.5;
  let score = t * (0.3 + 0.7 * a);
  const wantsJunk = VERSION_JUNK.test(want.title ?? '');
  if (!wantsJunk && VERSION_JUNK.test(`${cand.title} ${[].concat(cand.artists).join(' ')}`)) score *= 0.4;
  return score;
}

export const GOOD_MATCH = 0.75;

/**
 * titleOnly: when the artist we were given is unreliable (a record label's YouTube channel such as
 * "T-Series"), accept an exact title match if it is a well-known track. Used only as a fallback.
 */
export function bestMatch(want, candidates, { titleOnly = false } = {}) {
  let best = null;
  for (const c of candidates) {
    const s = matchScore(want, c) + (c.popularity ?? 0) / 10000; // tie-break toward the popular original
    if (!best || s > best.score) best = { score: s, item: c };
  }
  if (best && best.score >= GOOD_MATCH) return best;
  if (!titleOnly) return null;
  const exact = candidates
    .filter((c) => titleSim(want.title, c.title) === 1 && !VERSION_JUNK.test(`${c.title} ${[].concat(c.artists).join(' ')}`) && (c.popularity ?? 0) >= 40)
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
  return exact.length ? { score: GOOD_MATCH, item: exact[0] } : null;
}

// ---------------------------------------------------------------- "never suggest what is already there"

/** Index everything in a shared playlist (matched or not) so none of it can be suggested back. */
export function makeExclusion(list) {
  const ex = { keys: new Set(), sids: new Set(), isrcs: new Set(), titles: new Map(), blobs: [] };
  for (const x of list) {
    if (x.key) ex.keys.add(x.key);
    if (x.spotifyId) ex.sids.add(x.spotifyId);
    if (x.isrc) ex.isrcs.add(x.isrc);
    const ct = cleanTitle(x.title);
    if (!ct) continue;
    // YouTube titles often carry the artist ("twenty one pilots Stressed Out"), so keep the raw text too
    const artistText = norm([].concat(x.artists ?? []).join(' '));
    ex.blobs.push({ titleTokens: norm(x.title).split(' ').filter(Boolean), artistTokens: new Set(artistText.split(' ')), full: ` ${norm(x.title)} ${artistText} ` });
    if (!ex.titles.has(ct)) ex.titles.set(ct, []);
    ex.titles.get(ct).push(x.artists ?? []);
  }
  return ex;
}

/**
 * True for the same ID or ISRC, or the same title by an overlapping artist. The second rule is what
 * catches the YouTube upload of a song that is also on Spotify (different IDs, same song).
 */
export function isExcluded(ex, t) {
  if (ex.keys.has(t.key) || (t.spotifyId && ex.sids.has(t.spotifyId)) || (t.isrc && ex.isrcs.has(t.isrc))) return true;
  const ct = cleanTitle(t.title);
  const lists = ex.titles.get(ct);
  if (lists?.some((a) => !a.length || artistSim(a, t.artists) >= 0.8)) return true;
  // The lead artist appears in the entry, and once every artist word is removed from the entry's title,
  // what is left is (nearly) exactly this song's title. "Heroes" is not inside "Heroes and Villains".
  const lead = artistList(t.artists)[0];
  if (!lead || ct.length < 4) return false;
  const leadTokens = new Set(lead.split(' '));
  const ctTokens = ct.split(' ');
  return ex.blobs.some((b) => {
    if (!b.full.includes(` ${lead} `)) return false;
    const rest = b.titleTokens.filter((w) => !b.artistTokens.has(w) && !leadTokens.has(w));
    const restStr = rest.join(' ');
    return restStr === ct || (restStr.includes(ct) && ctTokens.length / rest.length >= 0.6);
  });
}

/** Stable identity for a track regardless of source. */
export function trackKey(t) {
  if (t.spotifyId) return `sp:${t.spotifyId}`;
  return `ta:${cleanTitle(t.title)}|${artistList(t.artists)[0] ?? ''}`;
}
