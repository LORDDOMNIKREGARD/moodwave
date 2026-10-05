// The right-hand stage: view switch, playlist, and the live fresh-drops feed. The web lives in Web.jsx.

import { useState } from 'react';
import { Refresh01Icon, Globe02Icon, Download01Icon } from '@hugeicons/core-free-icons';
import { Button, Toggle, moodColor } from './ui.jsx';
import { TrackRow, FreshRow } from './Rows.jsx';
import RubberSegment from './reactbits/RubberSegment.jsx';
import GlideSelect from './reactbits/GlideSelect.jsx';
import StatusMark from './reactbits/StatusMark.jsx';
import WebView from './Web.jsx';
import { useStore } from '../app/useStore.js';
import { actions, freshRows, freshBadgeCount, defOf, REGION_NAMES } from '../app/store.js';
import { moodOf, ARC_LABELS, foldTempo } from '../core/engine.js';

const selectColors = { accentColor: 'var(--ink)', surfaceColor: 'var(--surface-2)', highlightColor: 'var(--hairline-strong)', textColor: 'var(--ink)', radius: 9999 };

export function ViewSwitch() {
  const s = useStore();
  const n = freshBadgeCount();
  const items = [
    { value: 'playlist', label: 'Playlist' },
    { value: 'web', label: 'Recommendation web' },
    { value: 'fresh', label: <span className="seg-label">Fresh drops{n > 0 && s.view !== 'fresh' && <span className="num count">{n}</span>}</span> },
  ];
  return (
    <div className="view-switch">
      <RubberSegment
        items={items} value={s.view} onChange={actions.selectView} size="lg" radius={9999} aria-label="View"
        trackColor="var(--surface-2)" thumbColor="var(--cta-fill)" textColor="var(--ink)" activeTextColor="var(--cta-ink)"
      />
    </div>
  );
}

// ---------------------------------------------------------------- playlist

/** Tempo (line) and energy (dashed) across the playlist, so the arc is visible at a glance. */
function ArcChart({ picks }) {
  if (picks.length < 2) return null;
  const W = 640;
  const H = 76;
  const bpms = picks.map((p) => foldTempo(p.track.features.tempo));
  const lo = Math.min(...bpms) - 5;
  const hi = Math.max(...bpms) + 5;
  const x = (i) => 8 + (i / (picks.length - 1)) * (W - 16);
  const yb = (v) => H - 8 - ((v - lo) / (hi - lo)) * (H - 16);
  const ye = (v) => H - 8 - v * (H - 16);
  const pts = (fn, vals) => vals.map((v, i) => `${x(i)},${fn(v)}`).join(' ');
  return (
    <figure className="arc">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Playlist arc. Tempo runs from ${Math.round(Math.min(...bpms))} to ${Math.round(Math.max(...bpms))} BPM.`}>
        <polyline className="arc-energy" points={pts(ye, picks.map((p) => p.track.features.energy))} fill="none" />
        <polyline className="arc-bpm" points={pts(yb, bpms)} fill="none" />
        {picks.map((p, i) => <circle key={p.track.key} className="arc-dot" cx={x(i)} cy={yb(bpms[i])} r="3" fill={moodColor(p.track)} />)}
      </svg>
      <figcaption><span className="key-bpm">Tempo</span><span className="key-energy">Energy</span></figcaption>
    </figure>
  );
}

function Callout() {
  const s = useStore();
  const sim = s.activeTab === 'similar' ? s.similar : null;
  if (!sim) return null;
  const p = sim.profile;
  const mood = moodOf(p.mean.valence, p.mean.energy);
  const genres = [...p.genres].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => g);
  const src = { youtube: 'YouTube', spotify: 'Spotify', apple: 'Apple Music' }[sim.source] ?? 'Your list';
  return (
    <aside className="callout">
      <div>
        <h3>Based on “{sim.name}”</h3>
        <p className="muted small">
          {src}. {sim.matched} of {sim.count} songs analysed. It sounds {mood.label.toLowerCase()}, around {Math.round(p.mean.tempo)} BPM{genres.length ? `, mostly ${genres.join(', ')}` : ''}.
        </p>
        <p className="muted small">Songs already in that playlist are left out{sim.skipped ? ` (${sim.skipped} filtered)` : ''}. Everything below is new relative to it.</p>
        {sim.note && <p className="muted small">{sim.note}</p>}
      </div>
      <div className="line">
        <Button className="btn-sm" onClick={() => actions.openDialog({ type: 'import', tab: 'similar' })}>Try another</Button>
        <Button variant="ghost" className="btn-sm" onClick={actions.clearSimilar}>Remove</Button>
      </div>
    </aside>
  );
}

export function PlaylistView() {
  const s = useStore();
  const tab = s.tabs[s.activeTab];
  const [hover, setHover] = useState(null);
  const playingKey = s.playing?.status === 'playing' ? s.playing.track.key : null;
  return (
    <div className="view">
      <div className="view-head">
        <p className="muted small">{ARC_LABELS[tab.target.arc]}</p>
        <div className="view-actions">
          <Button icon={Refresh01Icon} onClick={actions.regenerate}>Regenerate</Button>
          <Button icon={Globe02Icon} onClick={actions.discoverOnline} disabled={s.busy.more}>{s.busy.more ? 'Searching' : 'Search online'}</Button>
          <Button icon={Download01Icon} onClick={() => actions.openDialog({ type: 'export' })}>Export</Button>
        </div>
      </div>
      <Callout />
      <ArcChart picks={tab.picks} />
      {tab.picks.length === 0 ? (
        <div className="empty"><h3>No songs match</h3><p className="muted">Widen the BPM zone, clear a genre filter, or import more music.</p></div>
      ) : (
        <ol className="list" onPointerLeave={() => setHover(null)}>
          {tab.picks.map((pick, i) => (
            <TrackRow
              key={pick.track.key} pick={pick} index={i} playing={playingKey === pick.track.key} liked={s.likes.has(pick.track.key)}
              disliked={s.dislikes.has(pick.track.key)} hover={hover === pick.track.key} onHover={setHover}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- fresh drops

const timeAgo = (ts) => {
  if (!ts) return 'never';
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 45) return 'just now';
  if (secs < 3600) return `${Math.round(secs / 60)} min ago`;
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const REGION_OPTIONS = Object.entries(REGION_NAMES).map(([value, label]) => ({ value, label }));
const DAY_OPTIONS = [7, 14, 30, 60].map((d) => ({ value: String(d), label: `${d} days` }));

export function FreshView() {
  const s = useStore();
  const F = s.fresh;
  const [hover, setHover] = useState(null);
  const rows = freshRows();
  const playingKey = s.playing?.status === 'playing' ? s.playing.track.key : null;
  const set = actions.setSetting;
  return (
    <div className="view">
      <div className="view-head">
        <p className="muted small fresh-sub">
          {F.lastChecked
            ? `Checked ${timeAgo(F.lastChecked)}. ${F.items.length} releases in the last ${s.settings.days} days, scored for ${defOf(s.activeTab).label}. ${s.settings.auto ? 'Rechecks every 15 minutes while this page is open.' : 'Auto-check is off.'}`
            : 'Checking your artists and the chart for new releases.'}
        </p>
        <div className="view-actions"><Button icon={Refresh01Icon} onClick={() => actions.refreshFresh({ manual: true })} disabled={F.loading}>Check now</Button></div>
      </div>

      <div className="controls">
        <label className="control"><span className="muted small">Region</span>
          <GlideSelect options={REGION_OPTIONS} value={s.settings.country} onChange={(v) => set('country', v)} showTags={false} ariaLabel="Region" menuWidth={200} {...selectColors} />
        </label>
        <label className="control"><span className="muted small">Released in the last</span>
          <GlideSelect options={DAY_OPTIONS} value={String(s.settings.days)} onChange={(v) => set('days', +v)} showTags={false} ariaLabel="Release window" menuWidth={160} {...selectColors} />
        </label>
        <label className="control inline"><Toggle checked={s.settings.auto} label="Auto-check every 15 minutes" onChange={(v) => set('auto', v)} /><span>Auto-check</span></label>
        <label className="control inline"><Toggle checked={s.settings.chart} label="Include the chart" onChange={(v) => set('chart', v)} /><span>Chart</span></label>
        <label className="control inline"><Toggle checked={s.settings.strong} label="Only strong matches" onChange={(v) => set('strong', v)} /><span>Strong matches</span></label>
        <label className="control inline"><Toggle checked={s.settings.notify} label="Notify me" onChange={(v) => actions.setNotify(v)} /><span>Notify</span></label>
      </div>

      <p className="fresh-status muted small" aria-live="polite">
        <StatusMark status={F.loading ? 'running' : 'done'} size={16} color="var(--muted)" doneColor="var(--good)" label="" />
        <span>{F.loading ? F.progress || 'Looking' : F.progress || 'Up to date'}</span>
      </p>

      {rows.length === 0 ? (
        <div className="empty">
          <h3>{F.loading ? 'Looking' : 'No new releases fit'}</h3>
          <p className="muted">{F.loading ? 'Reading the chart and your artists’ latest songs.' : s.settings.strong ? 'Nothing above 60% right now. Turn off Strong matches to see everything.' : 'Try a longer window or another region.'}</p>
        </div>
      ) : (
        <ol className="list" onPointerLeave={() => setHover(null)}>
          {rows.map((item, i) => (
            <FreshRow
              key={item.track.key} item={item} index={i} playing={playingKey === item.track.key} liked={s.likes.has(item.track.key)}
              disliked={s.dislikes.has(item.track.key)} hover={hover === item.track.key} onHover={setHover}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

export function Stage() {
  const s = useStore();
  return (
    <section className="stage" aria-label="Results">
      <ViewSwitch />
      {s.view === 'playlist' && <PlaylistView />}
      {s.view === 'web' && <WebView />}
      {s.view === 'fresh' && <FreshView />}
    </section>
  );
}

