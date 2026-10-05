// Import and export dialogs.

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import Modal from './Modal.jsx';
import { Button, Artwork } from './ui.jsx';
import { useStore } from '../app/useStore.js';
import { actions, analyzePlaylist, api, ingest, spotify, store, toast, activePicks, defOf, S } from '../app/store.js';
import { download, copyText } from '../app/util.js';
import { parseAny, decodeBytes } from '../core/importers.js';
import { linkFor, isDirect, playlistToCsv, playlistToM3u, playlistToText, youtubeQueueUrl } from '../core/links.js';
import { bestMatch, cleanTitle, artistList } from '../core/match.js';
import { API_BASE } from '../core/apiBase.js';

// ---------------------------------------------------------------- shared pieces

function useProgress() {
  const [state, setState] = useState(null);
  const cancelled = useRef(false);
  return {
    state,
    start() { cancelled.current = false; setState({ p: 0, msg: 'Starting' }); },
    set(p, msg) { setState((s) => (s ? { p, msg: msg ?? s.msg } : s)); },
    stop() { setState(null); },
    cancel() { cancelled.current = true; setState((s) => s && { ...s, msg: 'Stopping' }); },
    isCancelled: () => cancelled.current,
  };
}

function Progress({ prog }) {
  if (!prog.state) return null;
  return (
    <div className="stack">
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(prog.state.p * 100)}>
        <span style={{ transform: `scaleX(${Math.max(0.02, Math.min(1, prog.state.p))})` }} />
      </div>
      <div className="line between">
        <p className="muted small" aria-live="polite">{prog.state.msg}</p>
        <Button variant="ghost" className="btn-sm" onClick={prog.cancel}>Stop</Button>
      </div>
    </div>
  );
}

const SOURCE_OF = { 'youtube-takeout': 'youtube', 'youtube-ids': 'youtube', 'spotify-history': 'spotify', 'spotify-playlists': 'spotify', table: 'apple', m3u: 'list', list: 'list', 'playlist-json': 'list' };

/** A link box, a file drop zone and a paste box. Calls onRead({ name, source, rows, note, kind }) when a playlist has been read. */
function SourceInput({ onRead }) {
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [allVideos, setAllVideos] = useState(false);
  const [over, setOver] = useState(false);
  const fileRef = useRef(null);

  async function readLink() {
    const link = url.trim();
    if (!link) return;
    setStatus('Reading the playlist');
    try {
      const res = await fetch(`${API_BASE}/api/playlist?url=${encodeURIComponent(link)}`);
      const j = await res.json().catch(() => null);
      if (!j) throw new Error('Reading links needs the Moodwave server, which this site does not have. You can still drop a file or paste a list.');
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      const note = [j.note, j.truncated ? 'Only the first 100 songs of a long playlist can be read from a link.' : ''].filter(Boolean).join(' ');
      setStatus('');
      onRead({ name: j.name, source: j.source, rows: j.tracks, note, kind: j.isMix ? 'mix' : 'link' });
    } catch (e) { setStatus(`Could not read it. ${e.message}`); }
  }

  async function readFiles(files) {
    setStatus('Reading files');
    try {
      const parsed = [];
      for (const f of files) parsed.push({ f, p: parseAny(f.name, decodeBytes(await f.arrayBuffer()), { all: allVideos }) });
      const rows = parsed.flatMap((x) => x.p.tracks);
      if (!rows.length) throw new Error('No songs found in that file.');
      setStatus('');
      onRead({
        name: files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') : `${files.length} files`,
        source: SOURCE_OF[parsed[0].p.kind] ?? 'list', rows, note: [...new Set(parsed.map((x) => x.p.label))].join(' and '), kind: 'file',
      });
    } catch (e) { setStatus(`Could not read it. ${e.message}`); }
  }

  function readPaste() {
    if (!text.trim()) return;
    try {
      const p = parseAny('pasted.txt', text.trim());
      setStatus('');
      onRead({ name: 'Pasted list', source: SOURCE_OF[p.kind] ?? 'list', rows: p.tracks, note: p.label, kind: 'paste' });
    } catch (e) { setStatus(`Could not read it. ${e.message}`); }
  }

  return (
    <div className="stack">
      <div className="line">
        <input
          className="input grow" type="text" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Playlist link"
          placeholder="YouTube Mix or playlist, Spotify or Apple Music link" onKeyDown={(e) => e.key === 'Enter' && readLink()}
        />
        <Button variant="primary" onClick={readLink}>Read link</Button>
      </div>
      <div
        className={`dropzone${over ? ' is-over' : ''}`} tabIndex={0} role="button" onClick={() => fileRef.current.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) readFiles([...e.dataTransfer.files]); }}
      >
        Drop files here or click to choose
        <span className="small muted">Spotify history, YouTube Takeout, Apple Music export, CSV or M3U</span>
      </div>
      <input ref={fileRef} type="file" multiple accept=".json,.csv,.txt,.m3u,.m3u8" hidden aria-label="Playlist or history file" onChange={(e) => e.target.files.length && readFiles([...e.target.files])} />
      <label className="check small"><input type="checkbox" checked={allVideos} onChange={(e) => setAllVideos(e.target.checked)} /> YouTube history: include every video, not only music</label>
      <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} aria-label="Pasted songs" placeholder={'Or paste songs, one per line:\nArtist - Title\nTitle by Artist'} />
      <div className="line"><Button onClick={readPaste}>Use pasted list</Button></div>
      {status && <p className="muted small" aria-live="polite">{status}</p>}
    </div>
  );
}

function ResultCard({ res, action, onGo }) {
  const sample = res.rows.filter((r) => r.title).slice(0, 5).map((r) => `${r.artists?.[0] ? `${r.artists[0]} - ` : ''}${r.title}`);
  return (
    <div className="result">
      <div>
        <strong>{res.name}</strong>
        <p className="muted small">{res.rows.length} songs{res.note ? `. ${res.note}` : ''}</p>
        {sample.length > 0 && <p className="muted small">{sample.join(', ')}{res.rows.length > sample.length ? ' and more' : ''}</p>}
      </div>
      <div className="line"><Button variant="primary" onClick={onGo}>{action}</Button></div>
    </div>
  );
}

function HowTo() {
  return (
    <div className="stack">
      <details className="how">
        <summary>How to get a playlist from each app</summary>
        <ul>
          <li><b>YouTube and YouTube Music.</b> Open the playlist or Mix, start a song, and copy the address bar link. A Mix link contains list=RD. Takeout files work too.</li>
          <li><b>Spotify.</b> Share, then Copy link to playlist. Or connect your account in the Spotify tab to see every playlist.</li>
          <li><b>Apple Music.</b> Share, then Copy Link. On a Mac or PC, File, Library, Export Playlist, then drop the .txt file here.</li>
        </ul>
      </details>
      <details className="how">
        <summary>What about my listening history?</summary>
        <ul>
          <li>Spotify: Account, Privacy, Download your data, Extended streaming history. Drop Streaming_History_Audio_*.json here.</li>
          <li>YouTube: takeout.google.com, YouTube and YouTube Music, history as JSON. Drop watch-history.json.</li>
          <li>Apple Music: privacy.apple.com, request a copy, Apple Media Services. Drop the Play Activity CSV.</li>
        </ul>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------- panes

function SimilarPane({ close }) {
  const [res, setRes] = useState(null);
  const [error, setError] = useState('');
  const prog = useProgress();
  async function go() {
    prog.start();
    setError('');
    try {
      const r = await analyzePlaylist({ name: res.name, source: res.source, rows: res.rows, note: res.note, onProgress: (p, m) => prog.set(p, m), shouldCancel: prog.isCancelled });
      close();
      toast(r.offline
        ? `Analysed “${res.name}”, but online recommendations were unavailable, so these come from the starter catalog.`
        : `Analysed ${r.matched} of ${r.total} songs in “${res.name}” and found ${r.found} new candidates. Songs already in it are left out.`, { kind: r.offline ? 'info' : 'good', ms: 8000 });
    } catch (e) { prog.stop(); setError(e.message); }
  }
  return (
    <div className="stack">
      <p>Share a YouTube Mix or any playlist. Moodwave learns its mood, tempo and genres, then suggests <b>new</b> songs in that style and never repeats what is already in it.</p>
      {!prog.state && <SourceInput onRead={(r) => { setRes(r); setError(''); }} />}
      {res && !prog.state && <ResultCard res={res} action="Find similar songs" onGo={go} />}
      {error && <p className="error" role="alert">{error}</p>}
      <Progress prog={prog} />
      <HowTo />
    </div>
  );
}

function TastePane({ close }) {
  const [res, setRes] = useState(null);
  const [error, setError] = useState('');
  const prog = useProgress();
  const isHistory = res?.kind === 'file' && /history|play activity|watch/i.test(res.note ?? '');
  async function go() {
    prog.start();
    setError('');
    try {
      const r = await ingest(res.rows, { source: res.source, liked: !isHistory, onProgress: (p, m) => prog.set(p, m), shouldCancel: prog.isCancelled });
      close();
      const bits = [`Added ${r.added} songs to your taste`];
      if (r.unmatched) bits.push(`${r.unmatched} could not be matched`);
      if (r.beyondCap) bits.push(`analysed the ${r.total - r.beyondCap} most played of ${r.total}`);
      toast(`${bits.join(', ')}.`, { kind: 'good', ms: 7000 });
    } catch (e) { prog.stop(); setError(e.message); }
  }
  return (
    <div className="stack">
      <p>Songs you add here shape “For you” and every mood tab. A playlist counts as songs you like. A history file counts by how often you played each song.</p>
      {!prog.state && <SourceInput onRead={(r) => { setRes(r); setError(''); }} />}
      {res && !prog.state && <ResultCard res={res} action={isHistory ? 'Add to my history' : 'Add to my taste'} onGo={go} />}
      {error && <p className="error" role="alert">{error}</p>}
      <Progress prog={prog} />
      <HowTo />
    </div>
  );
}

function PickPane({ close }) {
  const s = useStore();
  const [chosen, setChosen] = useState(() => new Map());
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return s.catalog.filter((t) => !needle || `${t.title} ${t.artists.join(' ')}`.toLowerCase().includes(needle)).slice(0, needle ? 80 : 60);
  }, [s.catalog, q]);
  const toggle = (t) => setChosen((m) => { const n = new Map(m); if (n.has(t.key)) n.delete(t.key); else n.set(t.key, t); return n; });
  async function add() {
    const rows = [...chosen.values()].map((t) => ({ title: t.title, artists: t.artists, spotifyId: t.spotifyId, plays: 3, liked: true }));
    await ingest(rows, { source: 'picks', liked: true });
    close();
    toast(`Added ${rows.length} songs. Your tabs are retuned.`, { kind: 'good' });
  }
  return (
    <div className="stack">
      <p>No export handy? Tap songs you like from the starter catalog. Each one has real audio data.</p>
      <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by title or artist" aria-label="Filter songs" />
      <div className="pick-grid">
        {list.map((t) => (
          <button key={t.key} type="button" className="pick" aria-pressed={chosen.has(t.key)} onClick={() => toggle(t)}>
            <Artwork track={t} size={40} />
            <span className="pick-text"><span className="pt">{t.title}</span><span className="pa">{t.artists[0]}</span></span>
          </button>
        ))}
      </div>
      <div className="line"><Button variant="primary" disabled={!chosen.size} onClick={add}>{chosen.size ? `Add ${chosen.size} song${chosen.size > 1 ? 's' : ''}` : 'Add songs'}</Button></div>
    </div>
  );
}

function SpotifyPane({ close, autoSync }) {
  const s = useStore();
  const connected = s.spotifyConnected;
  const prog = useProgress();
  const [clientId, setClientId] = useState(spotify.savedClientId());
  const [playlists, setPlaylists] = useState(null);
  const [error, setError] = useState('');
  const synced = useRef(false);

  async function sync() {
    prog.start();
    try {
      const { tracks } = await spotify.fetchTaste((m) => prog.set(0.05, m));
      const r = await ingest(tracks, { source: 'spotify', onProgress: (p, m) => prog.set(p, m) });
      close();
      toast(`Synced ${r.added} songs from Spotify: top tracks, top artists, recent plays and saved songs.`, { kind: 'good', ms: 7000 });
    } catch (e) { prog.stop(); toast(`Spotify sync failed: ${e.message}`, { kind: 'error', ms: 9000 }); }
  }

  async function usePlaylist(p, mode) {
    prog.start();
    prog.set(0.05, `Reading “${p.name}”`);
    try {
      const tracks = await spotify.playlistTracks(p.id);
      if (mode === 'similar') await analyzePlaylist({ name: p.name, source: 'spotify', rows: tracks, onProgress: (pr, m) => prog.set(pr, m), shouldCancel: prog.isCancelled });
      else await ingest(tracks, { source: 'spotify', liked: true, onProgress: (pr, m) => prog.set(pr, m), shouldCancel: prog.isCancelled });
      close();
      toast(mode === 'similar' ? `Found songs like “${p.name}”.` : `Added “${p.name}” to your taste.`, { kind: 'good' });
    } catch (e) { prog.stop(); toast(e.message, { kind: 'error', ms: 8000 }); }
  }

  useEffect(() => {
    if (!connected) return undefined;
    let alive = true;
    spotify.listPlaylists().then((p) => alive && setPlaylists(p)).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [connected]);
  useEffect(() => {
    if (connected && autoSync && !synced.current) { synced.current = true; sync(); }
  }, [connected, autoSync]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!connected) {
    return (
      <div className="stack">
        <p>Connect once to pull your top tracks, recent plays, saved songs and playlists, and to save playlists back to Spotify. Nothing leaves your browser except calls to Spotify.</p>
        <details className="how" open>
          <summary>One-time setup, about 2 minutes</summary>
          <ol>
            <li>Open developer.spotify.com/dashboard and create an app.</li>
            <li>Add this exact Redirect URI: <code>{spotify.redirectUri()}</code>{' '}
              <button type="button" className="text-btn" onClick={async () => toast((await copyText(spotify.redirectUri())) ? 'Copied.' : 'Copy failed.', { ms: 1500 })}>Copy</button>
            </li>
            <li>Tick Web API, save, and paste the Client ID below.</li>
            <li>Spotify now requires the app owner to have Premium, and limits a new app to 5 users.</li>
          </ol>
        </details>
        <div className="line">
          <input className="input grow" type="text" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Spotify Client ID" aria-label="Spotify Client ID" />
          <Button variant="primary" onClick={() => spotify.login(clientId.trim()).catch((e) => toast(e.message, { kind: 'error' }))}>Connect</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="stack">
      <div className="line between">
        <Button variant="primary" onClick={sync} disabled={!!prog.state}>Sync my listening</Button>
        <Button variant="ghost" onClick={() => { spotify.logout(); actions.spotifyChanged(); close(); toast('Disconnected from Spotify.'); }}>Disconnect</Button>
      </div>
      <Progress prog={prog} />
      <h3 className="subhead">Your playlists</h3>
      {error && <p className="error" role="alert">{error}</p>}
      {!playlists && !error && <p className="muted">Loading</p>}
      <div className="menu-list">
        {(playlists ?? []).map((p) => (
          <div className="menu-item" key={p.id}>
            <div><strong>{p.name}</strong><p className="muted small">{p.count ?? '?'} songs{p.owner ? `, ${p.owner}` : ''}</p></div>
            <div className="line">
              <Button className="btn-sm" onClick={() => usePlaylist(p, 'taste')}>Add to taste</Button>
              <Button className="btn-sm" onClick={() => usePlaylist(p, 'similar')}>Match</Button>
            </div>
          </div>
        ))}
        {playlists?.length === 0 && <p className="muted">No playlists found.</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- import dialog

const IMPORT_TABS = [['similar', 'Match a playlist'], ['taste', 'Add to my taste'], ['pick', 'Pick songs'], ['spotify', 'Spotify']];
const PANES = { similar: SimilarPane, taste: TastePane, pick: PickPane, spotify: SpotifyPane };

function ImportDialog({ initial, autoSync }) {
  const [tab, setTab] = useState(initial);
  const Pane = PANES[tab];
  return (
    <Modal title="Bring in your music" onClose={actions.closeDialog}>
      <div className="dtabs" role="tablist">
        {IMPORT_TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className="dtab" onClick={() => setTab(id)}>
            {tab === id && <motion.span layoutId="dtab-line" className="dtab-line" transition={{ type: 'spring', duration: 0.35, bounce: 0 }} />}
            {label}
          </button>
        ))}
      </div>
      <div className="modal-body"><Pane key={tab} close={actions.closeDialog} autoSync={autoSync} /></div>
    </Modal>
  );
}

// ---------------------------------------------------------------- export dialog

async function resolveYouTubeIds(tracks, key, onProgress) {
  const cache = store.get('ytids', {});
  const ids = [];
  for (const [i, t] of tracks.entries()) {
    onProgress(i / tracks.length, `Finding ${t.title} on YouTube`);
    if (t.ytId) { ids.push(t.ytId); continue; }
    const ck = `${cleanTitle(t.title)}|${artistList(t.artists)[0] ?? ''}`;
    if (!cache[ck]) {
      const q = encodeURIComponent(`${t.artists[0] ?? ''} ${t.title} official audio`);
      const res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=id&type=video&videoCategoryId=10&maxResults=1&q=${q}&key=${encodeURIComponent(key)}`);
      const j = await res.json();
      if (j.error) throw new Error(j.error.message);
      cache[ck] = j.items?.[0]?.id?.videoId ?? '';
    }
    if (cache[ck]) ids.push(cache[ck]);
  }
  store.set('ytids', cache);
  return ids;
}

async function toSpotifyIds(tracks, onProgress) {
  const ids = [];
  for (const [i, t] of tracks.entries()) {
    if (t.spotifyId) { ids.push(t.spotifyId); continue; }
    onProgress(i / tracks.length, `Finding ${t.title} on Spotify`);
    const hits = await spotify.searchTrack(t.title, t.artists[0]).catch(() => []);
    const best = bestMatch({ title: t.title, artists: t.artists }, hits.map((x) => ({ title: x.title, artists: x.artists, spotifyId: x.spotifyId })));
    if (best) ids.push(best.item.spotifyId);
  }
  return ids;
}

function ExportDialog() {
  const s = useStore();
  const tracks = activePicks();
  const label = defOf(s.activeTab).label;
  const name = `Moodwave ${label}`;
  const prog = useProgress();
  const [sub, setSub] = useState(null);
  const [keyDraft, setKeyDraft] = useState('');

  const linkList = (service, title) => setSub(
    <div className="stack">
      <h3 className="subhead">{title}</h3>
      <ol className="link-list small">
        {tracks.map((t) => (
          <li key={t.key}><a href={linkFor[service](t)} target="_blank" rel="noopener noreferrer">{t.artists[0]} - {t.title}</a>{!isDirect[service](t) && <span className="muted"> (search)</span>}</li>
        ))}
      </ol>
    </div>,
  );

  async function toSpotify() {
    if (!s.spotifyConnected) { actions.openDialog({ type: 'import', tab: 'spotify' }); return; }
    prog.start();
    try {
      const ids = await toSpotifyIds(tracks, (p, m) => prog.set(p, m));
      prog.set(0.95, 'Creating the playlist');
      const url = await spotify.createPlaylist({ name, description: `Made with Moodwave (${label}). Mood, genre and beat matched.`, spotifyIds: ids });
      prog.stop();
      setSub(<p>Created with {ids.length} of {tracks.length} songs. <a href={url} target="_blank" rel="noopener noreferrer">Open in Spotify</a></p>);
    } catch (e) { prog.stop(); setSub(<p className="error" role="alert">{e.message}</p>); }
  }

  async function toYouTube() {
    const key = S.settings.ytKey;
    if (!key) {
      setSub(
        <div className="stack">
          <p className="small">To open the whole playlist as one YouTube queue, Moodwave looks up each song’s video with a free YouTube Data API key (console.cloud.google.com, enable YouTube Data API v3, create an API key). It stays in this browser.</p>
          <div className="line">
            <input className="input grow" type="password" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} placeholder="YouTube Data API key" aria-label="YouTube Data API key" />
            <Button variant="primary" onClick={() => { actions.setSetting('ytKey', keyDraft.trim()); toYouTube(); }}>Save and continue</Button>
          </div>
          <p className="small muted">No key? <button type="button" className="text-btn" onClick={() => linkList('youtube', 'Search each song on YouTube')}>Use per-song links</button> instead.</p>
        </div>,
      );
      return;
    }
    prog.start();
    try {
      const ids = await resolveYouTubeIds(tracks, key, (p, m) => prog.set(p, m));
      prog.stop();
      if (!ids.length) throw new Error('No videos found.');
      setSub(<div className="stack"><p>Found {ids.length} of {tracks.length} songs. <a href={youtubeQueueUrl(ids)} target="_blank" rel="noopener noreferrer">Open the YouTube queue</a></p><p className="small muted">This opens an unsaved queue of up to 50 songs. Use Save inside YouTube to keep it.</p></div>);
    } catch (e) {
      prog.stop();
      setSub(<div className="stack"><p className="error" role="alert">{e.message}</p><div className="line"><Button className="btn-sm" onClick={() => { actions.setSetting('ytKey', ''); toYouTube(); }}>Change the API key</Button></div></div>);
    }
  }

  const item = (title, desc, ...actionsNodes) => (
    <div className="menu-item">
      <div><strong>{title}</strong><p className="muted small">{desc}</p></div>
      <div className="line">{actionsNodes}</div>
    </div>
  );

  return (
    <Modal title={`Export ${label}`} onClose={actions.closeDialog}>
      <div className="modal-body">
        <div className="menu-list">
          {item('Spotify', s.spotifyConnected ? 'Creates a private playlist in your account.' : 'Connect your account to create the playlist directly.',
            <Button key="s" variant="primary" onClick={toSpotify}>{s.spotifyConnected ? 'Create playlist' : 'Connect first'}</Button>)}
          {item('YouTube', 'Open every song as a YouTube queue, or search each one.',
            <Button key="q" onClick={toYouTube}>Open queue</Button>, <Button key="l" variant="ghost" onClick={() => linkList('youtube', 'Search each song on YouTube')}>Links</Button>)}
          {item('Apple Music', 'Apple only allows playlist creation with a paid developer token. Use the song links, or import the CSV with a transfer tool such as TuneMyMusic or Soundiiz.',
            <Button key="a" onClick={() => linkList('apple', 'Open each song in Apple Music')}>Song links</Button>)}
          {item('Files', 'Take it anywhere.',
            <Button key="c" onClick={() => download(`${name}.csv`, playlistToCsv(tracks), 'text/csv')}>CSV</Button>,
            <Button key="m" onClick={() => download(`${name}.m3u`, playlistToM3u(name, tracks), 'audio/x-mpegurl')}>M3U</Button>,
            <Button key="j" onClick={() => download(`${name}.json`, JSON.stringify({ name, tracks: tracks.map((t) => ({ title: t.title, artists: t.artists, spotifyId: t.spotifyId, features: t.features })) }, null, 2), 'application/json')}>JSON</Button>,
            <Button key="t" onClick={async () => toast((await copyText(playlistToText(tracks))) ? 'Copied the list.' : 'Copy failed.', { ms: 1800 })}>Copy text</Button>)}
        </div>
        <Progress prog={prog} />
        {sub}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- host

export default function Dialogs() {
  const s = useStore();
  if (!s.dialog) return null;
  if (s.dialog.type === 'export') return <ExportDialog />;
  const tab = s.dialog.tab && PANES[s.dialog.tab] ? s.dialog.tab : 'taste';
  return <ImportDialog key={`${tab}-${s.dialog.autoSync ? 1 : 0}`} initial={tab} autoSync={s.dialog.autoSync} />;
}
