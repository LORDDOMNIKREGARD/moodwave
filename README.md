# Moodwave

Playlists tuned by **mood, genre and beat**, built from your listening on Spotify, Apple Music or YouTube.

- **Mood tabs.** For you, Focus, Workout, Chill, Party, Heartbreak, Commute, Road trip, Late night, Wind down, Release and Custom. Each tab has its own playlist and its own calibration.
- **Calibrate.** Drag a target on the valence by energy mood map, set a BPM zone (half and double time count), weight mood, genre and beat separately, and choose how much of the playlist is new to you.
- **Import from any app.** Paste a link to a Spotify, Apple Music or YouTube playlist or a **YouTube Mix**, drop an export file (Spotify streaming history, YouTube Takeout, Apple Music play activity, Music.app playlists, CSV, M3U), or connect Spotify.
- **Playlist match.** Share a playlist or Mix and get new songs in its style. Nothing already in it is ever suggested back, even if it appears under a different ID on another service.
- **Recommendation web.** Your most-played songs around you, recommendations linked to the songs they resemble. **Hover a dot to hear a 30 second preview.**
- **Fresh drops.** A live feed of new releases from artists you listen to and your country chart, scored against the active mood tab and rechecked every 15 minutes while the page is open.
- **Export.** Create a Spotify playlist, open a YouTube queue, get Apple Music song links, or download CSV, M3U and JSON.

## Run it

You need Node 20 or newer.

```bash
npm install
npm run build
npm start          # node server.mjs, then open http://127.0.0.1:8787
```

On Windows, `start.bat` opens the browser and starts the server (run the build once first).

Use `127.0.0.1`, not `localhost`: Spotify only accepts a loopback IP as a redirect address.

To change the interface:

```bash
npm run dev      # Vite on :5173, proxying /api to the Node server (run `npm start` too)
npm test         # 53 unit tests for matching, the engine, importers, playlists, audio
```

## Deploy it

Most of the app runs in the browser. Two features need a small server, because browsers cannot read other sites' pages: **importing a playlist from a link** and **the country chart in Fresh drops**. Everything else (history files, pasted lists, Spotify, mood tabs, the web, hover audio, Fresh drops from your artists, export) works on any static host.

| Host | Link import and chart | Setup |
| --- | --- | --- |
| **Vercel** | Yes, `api/*.js` run as serverless functions | Import the repo. Framework Vite is detected, nothing to configure. |
| **Netlify** | Yes, `netlify/functions/*` | Import the repo. `netlify.toml` has the build settings. |
| **GitHub Pages** | No, there is no server | Settings, Pages, Source: GitHub Actions. `.github/workflows/pages.yml` builds and deploys on every push to `main`. |
| **Your own machine or VPS** | Yes | `npm run build && npm start` |

On a static host the app tells you that link import needs the server and points you to files and pasted lists instead. To use a backend deployed elsewhere, build with `VITE_API_BASE=https://your-backend.example`.

**Spotify on a deployed site.** Register your site's address as the redirect URI (for example `https://moodwave.vercel.app/`, with the trailing slash, or `https://you.github.io/moodwave/` on Pages). The Import dialog shows the exact value to copy.

## Where the data comes from

Spotify turned off its audio-features and recommendations endpoints for new apps in November 2024, and trimmed the rest of the API in February 2026. Moodwave therefore does not depend on them.

| Need | Source | Notes |
| --- | --- | --- |
| Tempo, energy, valence, danceability | [ReccoBeats](https://reccobeats.com) | Free, no key, addressable by Spotify ID or ISRC. Rate limited, so requests are paced. |
| Genre, artwork, 30 s previews, Apple Music links | iTunes Search API | Free, no key. |
| New releases | iTunes `lookup?sort=recent` and Apple's most-played feed | Filtered to your window (7 to 60 days). |
| Playlists from links | Public share pages, read by `server.mjs` | Best effort: they are web pages, not APIs. A Mix shows its first 25 songs. |
| Your taste | Export files, pasted links, or Spotify (PKCE, no secret) | Spotify needs a Client ID, see below. |

**Brand new songs.** ReccoBeats has no audio features for songs released in the last few weeks, so Fresh drops measures tempo and energy from the 30 second preview in your browser. Those values are labelled `estimated`. Mood (valence) for them leans on your history of the same artist or genre, so treat it as a hint.

**YouTube.** There is no watch-history API; use Google Takeout. A personal "My Mix" differs per account and is not readable from a link, so start a Mix from a song you like and share that.

**Apple Music.** Creating playlists needs a paid developer token, so Moodwave gives you song links and a CSV for a transfer tool instead.

### Connecting Spotify (optional, 2 minutes)

1. Open <https://developer.spotify.com/dashboard> and create an app.
2. Add the redirect URI `http://127.0.0.1:8787/`.
3. Paste the Client ID into Import, then Spotify.

Spotify currently requires the app owner to have Premium and limits a new app to 5 users.

## Design

The interface follows the **Taste Skill** design system: Geist and Geist Mono, an off-white or off-black ground, one terracotta accent, pill buttons and tabs, 16px cards, 8px inputs, no emoji, and motion limited to transform and opacity. Tokens live in `src/styles/tokens.css`.

Components adapted from **[React Bits](https://reactbits.dev)** (David Haz, MIT with Commons Clause, which permits use inside an application): Waves, SplitText, CountUp, SpotlightCard, Magnet, TiltedCard, Noise, PulseHeart, SquishSwitch, RubberSegment, GlideSelect, ScrubField, WarmTooltip, SwipeToast and StatusMark. They live in `src/components/reactbits/`. Changes: Waves lost its decorative cursor dot and pauses when hidden or when reduced motion is on; Noise renders one static frame; the now-playing dock uses the structure of React Bits' Dock but magnifies with `scale`, because the design system only allows transform and opacity to animate.

Icons are [Hugeicons](https://hugeicons.com) (free set), animation is [Motion](https://motion.dev) and [GSAP](https://gsap.com).

## Layout

```
server.mjs, server/        local server: static files, /api/playlist, /api/chart
api/                       the same two endpoints as Vercel functions
netlify/functions/         ... and as Netlify functions
src/core/                  engine, matching, importers, API clients, audio analysis (no UI)
src/app/store.js           state and actions
src/components/            React UI, web.js is the canvas graph
src/components/reactbits/  adapted React Bits components
public/data/catalog.json   192 well-known songs with real audio features (npm run build-catalog)
test/                      node:test suites
```

## How the recommendations work

1. **Profile.** Each history song is weighted by plays (log), skips, likes, rank and recency. The weighted mean of valence and energy is your mood centre, the quartiles of folded tempo are your BPM zone, and genre families are normalised across Spotify and iTunes vocabularies.
2. **Score.** Every candidate gets three fits: mood (Gaussian around the target in the valence by energy plane), beat (distance to the BPM zone with half and double time, plus danceability), genre (affinity, boost and mute). They are combined as a weighted geometric mean, so a miss on any axis you care about sinks the track.
3. **Select.** Maximal marginal relevance for variety, an artist cap, a soft quota for songs new to you, and a quality floor.
4. **Order.** Songs are arranged along an energy arc (steady, build, peak, wind down, waves) with smooth tempo and harmonic key transitions (Camelot wheel).

Thumbs up and down feed back into the profile.
