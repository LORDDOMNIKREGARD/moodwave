// Builds public/data/catalog.json: a starter pool of well-known tracks with REAL audio features
// (ReccoBeats) and genre / artwork / preview / Apple Music link (iTunes). Run: node scripts/build-catalog.mjs
// The app ships this file so it works instantly (and offline) before any account is connected.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi, memoryCache } from '../src/core/api.js';
import { bestMatch } from '../src/core/match.js';

const SEEDS = {
  Pop: [
    'The Weeknd | Blinding Lights', 'Dua Lipa | Levitating', 'Dua Lipa | Don\'t Start Now', 'Ed Sheeran | Shape of You',
    'Ed Sheeran | Photograph', 'Ed Sheeran | Thinking Out Loud', 'Harry Styles | As It Was', 'Harry Styles | Watermelon Sugar',
    'Taylor Swift | Shake It Off', 'Taylor Swift | cardigan', 'Billie Eilish | bad guy', 'Billie Eilish | when the party\'s over',
    'Billie Eilish | Ocean Eyes', 'Olivia Rodrigo | drivers license', 'Adele | Someone Like You', 'Adele | Rolling in the Deep',
    'Bruno Mars | Uptown Funk', 'Bruno Mars | Locked out of Heaven', 'Justin Bieber | Peaches', 'Ariana Grande | 7 rings',
    'Lizzo | About Damn Time', 'Katy Perry | Firework', 'Lady Gaga | Shallow', 'Lady Gaga | Bad Romance', 'Sia | Chandelier',
    'Charlie Puth | Attention', 'Shawn Mendes | Stitches', 'Sam Smith | Stay With Me', 'Lewis Capaldi | Someone You Loved',
    'Post Malone | Circles', 'Doja Cat | Say So', 'Rihanna | Umbrella', 'Miley Cyrus | Flowers', 'Sabrina Carpenter | Espresso',
    'Tate McRae | greedy', 'Pharrell Williams | Happy', 'Lorde | Royals', 'Lorde | Ribs', 'Gotye | Somebody That I Used to Know',
    'Vance Joy | Riptide', 'Jason Mraz | I\'m Yours', 'Glass Animals | Heat Waves',
  ],
  Rock: [
    'Coldplay | Yellow', 'Coldplay | Viva La Vida', 'Coldplay | Fix You', 'Imagine Dragons | Believer', 'Imagine Dragons | Radioactive',
    'Linkin Park | In the End', 'Linkin Park | Numb', 'Nirvana | Smells Like Teen Spirit', 'Queen | Bohemian Rhapsody',
    'Queen | Don\'t Stop Me Now', 'Arctic Monkeys | Do I Wanna Know?', 'Arctic Monkeys | R U Mine?', 'The Killers | Mr. Brightside',
    'Green Day | Boulevard of Broken Dreams', 'Foo Fighters | Everlong', 'Red Hot Chili Peppers | Under the Bridge',
    'Radiohead | Creep', 'Radiohead | Karma Police', 'Oasis | Wonderwall', 'AC/DC | Back In Black', 'Metallica | Enter Sandman',
    'Led Zeppelin | Stairway to Heaven', 'Fleetwood Mac | Dreams', 'Pink Floyd | Comfortably Numb', 'Paramore | Misery Business',
    'My Chemical Romance | Welcome to the Black Parade', 'Twenty One Pilots | Stressed Out', 'Eagles | Hotel California',
    'Journey | Don\'t Stop Believin\'', 'Guns N\' Roses | Sweet Child O\' Mine', 'Bon Jovi | Livin\' on a Prayer',
    'Rage Against the Machine | Killing in the Name', 'System of a Down | Chop Suey!', 'Black Sabbath | Paranoid',
    'Iron Maiden | The Trooper', 'Bring Me The Horizon | Can You Feel My Heart', 'Måneskin | Beggin\'', 'Foster the People | Pumped Up Kicks',
    'Cage the Elephant | Cigarette Daydreams', 'U2 | With or Without You', 'The Cure | Just Like Heaven', 'Joy Division | Love Will Tear Us Apart',
    'Depeche Mode | Enjoy the Silence', 'The Smiths | There Is a Light That Never Goes Out', 'David Bowie | Heroes',
  ],
  Indie: [
    'Tame Impala | The Less I Know the Better', 'Tame Impala | Let It Happen', 'Mac DeMarco | Chamber of Reflection',
    'Cigarettes After Sex | Apocalypse', 'Beach House | Space Song', 'The 1975 | Chocolate', 'Bon Iver | Skinny Love',
    'Hozier | Take Me to Church', 'Passenger | Let Her Go', 'Mumford & Sons | Little Lion Man', 'The Lumineers | Ho Hey',
    'Phoebe Bridgers | Motion Sickness', 'Mitski | Nobody', 'Sufjan Stevens | Mystery of Love', 'Rex Orange County | Loving Is Easy',
    'Clairo | Sofia', 'Boy Pablo | Everytime', 'Wallows | Are You Bored Yet?', 'Khruangbin | Maria También', 'Men I Trust | Show Me How',
    'MGMT | Electric Feel', 'Passion Pit | Sleepyhead', 'Gorillaz | Feel Good Inc.', 'Gorillaz | Clint Eastwood', 'Lana Del Rey | Summertime Sadness',
    'Lana Del Rey | Video Games', 'Joji | Slow Dancing in the Dark', 'Kate Bush | Running Up That Hill',
  ],
  'Hip-Hop': [
    'Kendrick Lamar | HUMBLE.', 'Kendrick Lamar | Money Trees', 'Drake | One Dance', 'Drake | God\'s Plan', 'Travis Scott | SICKO MODE',
    'Eminem | Lose Yourself', 'Eminem | Without Me', 'Kanye West | Stronger', 'Kanye West | Gold Digger', 'JAY-Z | Empire State of Mind',
    'J. Cole | No Role Modelz', 'Tyler, The Creator | EARFQUAKE', 'Childish Gambino | Redbone', 'Lil Nas X | Industry Baby',
    'Cardi B | Bodak Yellow', '50 Cent | In Da Club', 'OutKast | Hey Ya!', 'Post Malone | rockstar', 'Juice WRLD | Lucid Dreams',
    'XXXTENTACION | SAD!', 'Migos | Bad and Boujee', 'Nujabes | Feather',
  ],
  'R&B / Soul': [
    'Frank Ocean | Thinkin Bout You', 'Frank Ocean | Pink + White', 'SZA | Kill Bill', 'SZA | Snooze', 'Daniel Caesar | Best Part',
    'H.E.R. | Focus', 'Bryson Tiller | Don\'t', 'Beyoncé | Crazy in Love', 'Usher | Yeah!', 'Stevie Wonder | Superstition',
    'Marvin Gaye | Let\'s Get It On', 'Amy Winehouse | Back to Black', 'Alicia Keys | Fallin\'', 'Norah Jones | Don\'t Know Why',
    'Earth, Wind & Fire | September', 'Michael Jackson | Billie Jean', 'Michael Jackson | Thriller', 'Whitney Houston | I Wanna Dance with Somebody',
    'Prince | Purple Rain', 'Ben E. King | Stand By Me',
  ],
  Electronic: [
    'Daft Punk | Get Lucky', 'Daft Punk | One More Time', 'Daft Punk | Instant Crush', 'Avicii | Wake Me Up', 'Avicii | Levels',
    'Calvin Harris | Summer', 'Calvin Harris | This Is What You Came For', 'Swedish House Mafia | Don\'t You Worry Child',
    'Martin Garrix | Animals', 'Marshmello | Alone', 'Kygo | Firestone', 'Zedd | Clarity', 'The Chainsmokers | Closer',
    'Disclosure | Latch', 'Flume | Never Be Like You', 'ODESZA | A Moment Apart', 'Porter Robinson | Language', 'deadmau5 | Strobe',
    'Skrillex | Scary Monsters and Nice Sprites', 'Fred again.. | Delilah (pull me out of this)', 'Kavinsky | Nightcall',
    'Justice | D.A.N.C.E.', 'Bonobo | Kerala', 'Four Tet | Baby', 'Tycho | A Walk', 'Jon Hopkins | Open Eye Signal',
    'Madonna | Like a Prayer', 'Britney Spears | Toxic', 'ABBA | Dancing Queen', 'Bee Gees | Stayin\' Alive',
  ],
  'Classical / Ambient': [
    'Ludovico Einaudi | Nuvole Bianche', 'Ludovico Einaudi | Experience', 'Max Richter | On the Nature of Daylight', 'Hans Zimmer | Time',
    'Yiruma | River Flows in You', 'Claude Debussy | Clair de Lune', 'Erik Satie | Gymnopédie No. 1', 'Brian Eno | An Ending (Ascent)',
  ],
  'Jazz / Folk / Country': [
    'Louis Armstrong | What a Wonderful World', 'Miles Davis | So What', 'John Coltrane | My Favorite Things', 'Dave Brubeck | Take Five',
    'Ella Fitzgerald | Summertime', 'Frank Sinatra | Fly Me to the Moon', 'Johnny Cash | Hurt', 'Dolly Parton | Jolene',
    'Luke Combs | Beautiful Crazy', 'Morgan Wallen | Last Night', 'Zach Bryan | Something in the Orange', 'Chris Stapleton | Tennessee Whiskey',
    'Jack Johnson | Better Together', 'Billy Joel | Piano Man', 'Elton John | Rocket Man', 'Bruce Springsteen | Born to Run',
    'The Beatles | Here Comes The Sun', 'The Beatles | Let It Be', 'Elvis Presley | Can\'t Help Falling in Love', 'Bob Marley & The Wailers | Three Little Birds',
    'Bob Marley & The Wailers | Is This Love', 'Sublime | What I Got',
  ],
  'Latin / K-Pop / Afro': [
    'Bad Bunny | Tití Me Preguntó', 'Bad Bunny | Me Porto Bonito', 'Luis Fonsi | Despacito', 'Shakira | Hips Don\'t Lie', 'J Balvin | Mi Gente',
    'ROSALÍA | MALAMENTE', 'BTS | Dynamite', 'BTS | Butter', 'BLACKPINK | How You Like That', 'NewJeans | Hype Boy', 'PSY | Gangnam Style',
    'Burna Boy | Last Last', 'Wizkid | Essence', 'Rema | Calm Down', 'Tems | Free Mind', 'Backstreet Boys | I Want It That Way', '*NSYNC | Bye Bye Bye',
  ],
  'Bollywood / Punjabi / Indian indie': [
    'Arijit Singh | Tum Hi Ho', 'Arijit Singh | Channa Mereya', 'Arijit Singh | Kesariya', 'A.R. Rahman | Jai Ho', 'A.R. Rahman | Kun Faya Kun',
    'Pritam | Tum Se Hi', 'Badshah | DJ Waale Babu', 'Diljit Dosanjh | Lover', 'Diljit Dosanjh | Born to Shine', 'AP Dhillon | Brown Munde',
    'Sidhu Moose Wala | The Last Ride', 'Sidhu Moose Wala | So High', 'Yo Yo Honey Singh | Blue Eyes', 'Prateek Kuhad | cold/mess',
    'Anuv Jain | Husn', 'Atif Aslam | Tera Hone Laga Hoon', 'Shreya Ghoshal | Sun Raha Hai Na Tu', 'Jasleen Royal | Ranjha',
    'Sunidhi Chauhan | Dhoom Machale', 'Lata Mangeshkar | Lag Ja Gale', 'Pritam | Kabira', 'Jubin Nautiyal | Raataan Lambiyan',
    'Armaan Malik | Bol Do Na Zara', 'Darshan Raval | Chogada', 'King | Maan Meri Jaan', 'Ritviz | Liggi',
  ],
};

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'public', 'data', 'catalog.json');
const api = createApi({ cache: memoryCache() });

const seeds = Object.entries(SEEDS).flatMap(([category, list]) =>
  list.map((line) => {
    const [artist, ...rest] = line.split(' | ');
    return { artist, title: rest.join(' | '), category };
  }));

console.log(`Resolving ${seeds.length} seed tracks...`);
const pool = (fn, items, n) => {
  let i = 0;
  return Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  }));
};

const resolved = [];
const missed = [];
await pool(async (s) => {
  try {
    const r = await api.searchTitle(s.title);
    const hit = bestMatch({ title: s.title, artists: [s.artist] }, r);
    if (hit) resolved.push({ ...s, ...hit.item }); else missed.push(`${s.artist} - ${s.title}`);
  } catch (e) { missed.push(`${s.artist} - ${s.title} (${e.message})`); }
}, seeds, 4);
console.log(`  resolved ${resolved.length}, missed ${missed.length}`);

// de-dupe on spotify id
const byId = new Map(resolved.map((r) => [r.spotifyId, r]));
const feats = await api.featuresBySpotifyIds([...byId.keys()]);
console.log(`  features for ${feats.size}/${byId.size}`);

const tracks = [];
let done = 0;
await pool(async (r) => {
  const f = feats.get(r.spotifyId);
  if (!f) return;
  const meta = await api.enrich({ title: r.title, artists: r.artists });
  const genres = [meta?.genre, r.category].filter(Boolean);
  const round = (v, d) => (v == null ? null : +v.toFixed(d));
  tracks.push({
    id: r.spotifyId,
    title: r.title,
    artists: r.artists,
    isrc: r.isrc,
    genres: [...new Set(genres)],
    year: meta?.year ?? null,
    art: meta?.art ?? null,
    preview: meta?.preview ?? null,
    appleUrl: meta?.appleUrl ?? null,
    appleId: meta?.appleId ?? null,
    popularity: r.popularity,
    features: {
      tempo: round(f.tempo, 1), energy: round(f.energy, 3), valence: round(f.valence, 3),
      danceability: round(f.danceability, 3), acousticness: round(f.acousticness, 3),
      instrumentalness: round(f.instrumentalness, 3), speechiness: round(f.speechiness, 3),
      liveness: round(f.liveness, 3), loudness: round(f.loudness, 1), key: f.key, mode: f.mode,
    },
  });
  if (++done % 25 === 0) console.log(`  enriched ${done}/${byId.size}`);
}, [...byId.values()], 3);

tracks.sort((a, b) => b.popularity - a.popularity);
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ built: new Date().toISOString(), tracks }));
const noGenre = tracks.filter((t) => t.genres.length < 2).length;
console.log(`Wrote ${tracks.length} tracks -> ${OUT} (${noGenre} without iTunes metadata)`);
if (missed.length) console.log('Unresolved seeds:\n  ' + missed.join('\n  '));
