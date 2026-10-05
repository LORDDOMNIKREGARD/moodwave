// Apple's public "most played" chart feed per country. Every item carries its releaseDate, so the
// client can keep only the songs that dropped recently (the "Fresh drops" feed).
// Proxied here because that host does not advertise CORS for browsers.

const cache = new Map();

export async function appleChart(country) {
  const cc = String(country).toLowerCase();
  if (!/^[a-z]{2}$/.test(cc)) throw new Error('bad country code');
  const hit = cache.get(cc);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value;

  const res = await fetch(`https://rss.applemarketingtools.com/api/v2/${cc}/music/most-played/100/songs.json`, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const feed = JSON.parse(await res.text()).feed;
  const value = {
    country: cc,
    updated: feed.updated ?? null,
    songs: (feed.results ?? []).map((r) => ({
      appleId: r.id,
      title: r.name,
      artists: [r.artistName],
      appleArtistId: r.artistId ?? null,
      releaseDate: r.releaseDate,
      genres: (r.genres ?? []).map((g) => g.name).filter((g) => g !== 'Music'),
      art: r.artworkUrl100?.replace('100x100bb', '300x300bb') ?? null,
      appleUrl: r.url,
    })),
  };
  cache.set(cc, { at: Date.now(), value });
  return value;
}
