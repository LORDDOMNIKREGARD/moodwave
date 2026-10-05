// Left column: what we learned about you (or about a shared playlist) and the controls that tune the result.

import { useMemo, useRef } from 'react';
import { Button, Slider, Toggle, pct, moodColor } from './ui.jsx';
import SpotlightCard from './reactbits/SpotlightCard.jsx';
import CountUp from './reactbits/CountUp.jsx';
import GlideSelect from './reactbits/GlideSelect.jsx';
import ScrubField from './reactbits/ScrubField.jsx';
import { useStore } from '../app/useStore.js';
import { actions, pool, profileFor, topSeeds } from '../app/store.js';
import { MOODS, ARC_LABELS, ALL_FAMILIES, familiesOf, moodOf } from '../core/engine.js';

// ---------------------------------------------------------------- profile

function Bar({ label, share, lead }) {
  return (
    <div className="bar">
      <span className="bar-label">{label}</span>
      <span className="bar-track"><span className={lead ? 'is-lead' : ''} style={{ transform: `scaleX(${Math.max(0.03, share)})` }} /></span>
      <span className="num bar-pct">{Math.round(share * 100)}</span>
    </div>
  );
}

export function ProfileCard() {
  const s = useStore();
  const sim = s.activeTab === 'similar' ? s.similar : null;
  const profile = profileFor(s.activeTab);
  const total = sim ? sim.count : s.history.size;
  const analysed = sim ? sim.profile.analysed : s.profile.analysed;
  const unmatched = sim ? sim.count - sim.matched : s.unmatched;
  const moods = [...profile.moods].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const genres = [...profile.genres].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return (
    <SpotlightCard className="card" spotlightColor="rgba(128, 118, 108, 0.14)">
      <h2 className="card-title">{sim ? 'This playlist’s sound' : 'Your sound'}</h2>
      {!total ? (
        <p className="muted small">Nothing yet. Import a playlist, or tap Import and pick a few songs. Until then the mood tabs run on a starter catalog.</p>
      ) : (
        <>
          <dl className="stats">
            <div><dt className="muted small">Songs</dt><dd className="num stat"><CountUp to={total} duration={0.8} /></dd></div>
            <div><dt className="muted small">With audio data</dt><dd className="num stat"><CountUp to={analysed} duration={0.8} /></dd></div>
            <div><dt className="muted small">Usual BPM</dt><dd className="num stat">{Math.round(profile.tempoRange[0])}-{Math.round(profile.tempoRange[1])}</dd></div>
          </dl>
          {unmatched > 0 && <p className="muted small note">{unmatched} songs could not be matched to audio data. They still count for genre when known.</p>}
          {moods.length > 0 && <h3 className="subhead">Moods</h3>}
          {moods.map(([id, share], i) => <Bar key={id} label={MOODS.find((m) => m.id === id)?.label ?? id} share={share} lead={i === 0} />)}
          {genres.length > 0 && <h3 className="subhead">Genres</h3>}
          {genres.map(([g, share], i) => <Bar key={g} label={g} share={share} lead={i === 0} />)}
        </>
      )}
    </SpotlightCard>
  );
}

// ---------------------------------------------------------------- mood plane

const SIZE = 260;
const PAD = 14;
const px = (v) => PAD + v * (SIZE - 2 * PAD);
const py = (e) => PAD + (1 - e) * (SIZE - 2 * PAD);

function MoodPlane({ target, center, dots, onChange }) {
  const ref = useRef(null);
  const dragging = useRef(false);
  const fromEvent = (e) => {
    const r = ref.current.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * SIZE;
    const sy = ((e.clientY - r.top) / r.height) * SIZE;
    return {
      valence: Math.min(1, Math.max(0, (sx - PAD) / (SIZE - 2 * PAD))),
      energy: Math.min(1, Math.max(0, 1 - (sy - PAD) / (SIZE - 2 * PAD))),
    };
  };
  const onKey = (e) => {
    const step = e.shiftKey ? 0.1 : 0.03;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (!d) return;
    e.preventDefault();
    const base = target ?? { valence: 0.5, energy: 0.5 };
    onChange({ valence: Math.min(1, Math.max(0, base.valence + d[0])), energy: Math.min(1, Math.max(0, base.energy + d[1])) });
  };
  const max = Math.max(1e-6, ...dots.map((d) => d.weight));
  return (
    <svg
      ref={ref} viewBox={`0 0 ${SIZE} ${SIZE}`} className="moodplane" role="slider" tabIndex={0}
      aria-label="Target mood. Horizontal is sad to happy, vertical is calm to intense. Use the arrow keys."
      aria-valuetext={target ? `positivity ${pct(target.valence)}, energy ${pct(target.energy)}` : 'following your taste'}
      onPointerDown={(e) => { dragging.current = true; ref.current.setPointerCapture(e.pointerId); onChange(fromEvent(e)); }}
      onPointerMove={(e) => { if (dragging.current) onChange(fromEvent(e)); }}
      onPointerUp={() => { dragging.current = false; }}
      onPointerCancel={() => { dragging.current = false; }}
      onKeyDown={onKey}
    >
      <rect className="plane-bg" x={PAD} y={PAD} width={SIZE - 2 * PAD} height={SIZE - 2 * PAD} rx="12" />
      <line className="plane-axis" x1={px(0.5)} y1={PAD} x2={px(0.5)} y2={SIZE - PAD} />
      <line className="plane-axis" x1={PAD} y1={py(0.5)} x2={SIZE - PAD} y2={py(0.5)} />
      {MOODS.map((m) => <text key={m.id} className="plane-mood" x={px(m.valence)} y={py(m.energy)} textAnchor="middle">{m.label}</text>)}
      <text className="plane-corner" x={px(0.04)} y={PAD + 12}>Intense, dark</text>
      <text className="plane-corner" x={px(0.96)} y={PAD + 12} textAnchor="end">Euphoric</text>
      <text className="plane-corner" x={px(0.04)} y={SIZE - PAD - 6}>Calm, dark</text>
      <text className="plane-corner" x={px(0.96)} y={SIZE - PAD - 6} textAnchor="end">Calm, bright</text>
      {dots.map(({ track, weight }, i) => (
        <circle
          key={track.key + i} className="plane-dot" cx={px(track.features.valence) + Math.sin(track.features.tempo) * 2}
          cy={py(track.features.energy) + Math.cos(track.features.tempo) * 2} r={2 + 4 * Math.sqrt(weight / max)} fill={moodColor(track, 0.6)}
        />
      ))}
      {center && <circle className="plane-center" cx={px(center.valence)} cy={py(center.energy)} r="5" />}
      {target && (
        <g className="plane-target">
          <line x1={PAD} x2={SIZE - PAD} y1={py(target.energy)} y2={py(target.energy)} />
          <line y1={PAD} y2={SIZE - PAD} x1={px(target.valence)} x2={px(target.valence)} />
          <circle cx={px(target.valence)} cy={py(target.energy)} r="14" />
        </g>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------- calibrate

const ARC_OPTIONS = Object.entries(ARC_LABELS).map(([value, label]) => ({ value, label }));

export function Calibrate() {
  const s = useStore();
  const tab = s.tabs[s.activeTab];
  const t = tab.target;
  const e = tab.effective;
  const prof = profileFor(s.activeTab);
  const hasVibe = !!t.vibe;
  const zone = t.tempo ?? e?.tempo ?? [100, 130];
  const mood = e ? moodOf(e.valence, e.energy) : null;
  const patch = actions.patchTarget;

  const dots = useMemo(() => topSeeds(60), [s.history.size, s.similar, s.activeTab, prof]); // eslint-disable-line react-hooks/exhaustive-deps
  const families = useMemo(() => {
    const counts = new Map();
    for (const tr of pool()) for (const f of familiesOf(tr)) counts.set(f, (counts.get(f) ?? 0) + 1);
    return ALL_FAMILIES.filter((f) => counts.has(f) || t.genrePrefs[f])
      .sort((a, b) => (prof.genres.get(b) ?? 0) - (prof.genres.get(a) ?? 0) || (counts.get(b) ?? 0) - (counts.get(a) ?? 0)).slice(0, 16);
  }, [s.history.size, s.discovered.size, prof, t.genrePrefs]);

  const setZone = (i, v) => {
    const cur = [...zone].map(Math.round);
    cur[i] = v;
    if (cur[0] > cur[1]) cur[i === 0 ? 1 : 0] = v;
    patch({ tempo: cur });
  };
  const cycleGenre = (f) => {
    const next = { ...t.genrePrefs };
    if (!t.genrePrefs[f]) next[f] = 'boost';
    else if (t.genrePrefs[f] === 'boost') next[f] = 'mute';
    else delete next[f];
    patch({ genrePrefs: next });
  };

  return (
    <SpotlightCard className="card" spotlightColor="rgba(128, 118, 108, 0.14)">
      <div className="card-head">
        <h2 className="card-title">Calibrate</h2>
        <Button variant="ghost" className="btn-sm" onClick={actions.resetTab}>Reset</Button>
      </div>

      <div className="field">
        <div className="field-head">
          <span className="field-label">Mood</span>
          <button type="button" className="text-btn" disabled={!hasVibe} onClick={() => patch({ vibe: null })}>Follow my taste</button>
        </div>
        <MoodPlane
          target={t.vibe} center={prof.empty ? null : prof.mean} dots={dots}
          onChange={(v) => patch({ vibe: { ...(t.vibe ?? {}), valence: v.valence, energy: v.energy } })}
        />
        <p className="hint center">
          {mood ? (hasVibe ? `Target: ${mood.label}, ${pct(e.valence)} positive, ${pct(e.energy)} energy.` : `Following your taste: ${mood.label}. Drag on the map to set a mood.`) : ''}
        </p>
      </div>

      <Slider id="c-blend" label="Taste or vibe" value={t.blend} onChange={(v) => patch({ blend: v })} format={pct} disabled={!hasVibe} hint="Left follows your history, right follows the mood you set." />

      <div className="field">
        <div className="field-head">
          <span className="field-label">Beat</span>
          <label className="inline-toggle"><span className="muted small">My usual zone</span><Toggle checked={!t.tempo} label="Use my usual BPM zone" onChange={(on) => patch({ tempo: on ? null : zone.map(Math.round) })} /></label>
        </div>
        <div className="pair">
          <ScrubField label="Min" suffix="BPM" min={50} max={200} step={1} value={Math.round(zone[0])} disabled={!t.tempo} onChange={(v) => setZone(0, v)} accent="var(--ink)" chipColor="var(--surface-2)" />
          <ScrubField label="Max" suffix="BPM" min={50} max={200} step={1} value={Math.round(zone[1])} disabled={!t.tempo} onChange={(v) => setZone(1, v)} accent="var(--ink)" chipColor="var(--surface-2)" />
        </div>
        <p className="hint">Half and double time count, so a 70 BPM groove can fill a 140 zone.</p>
      </div>

      <div className="field">
        <span className="field-label">What matters most</span>
        <Slider id="c-pm" label="Mood" value={t.priorities.mood} min={0} max={2} step={0.1} onChange={(v) => patch({ priorities: { ...t.priorities, mood: v } })} format={(v) => v.toFixed(1)} />
        <Slider id="c-pg" label="Genre" value={t.priorities.genre} min={0} max={2} step={0.1} onChange={(v) => patch({ priorities: { ...t.priorities, genre: v } })} format={(v) => v.toFixed(1)} />
        <Slider id="c-pb" label="Beat" value={t.priorities.beat} min={0} max={2} step={0.1} onChange={(v) => patch({ priorities: { ...t.priorities, beat: v } })} format={(v) => v.toFixed(1)} />
      </div>

      <Slider id="c-disc" label="New to me" value={t.discovery} onChange={(v) => patch({ discovery: v })} format={pct} hint="Share of songs from outside your history." />
      <Slider id="c-len" label="Length" value={t.length} min={10} max={50} step={5} onChange={(v) => patch({ length: v })} format={(v) => `${v} songs`} />
      <Slider id="c-var" label="Variety" value={t.variety} min={0} max={0.6} step={0.05} onChange={(v) => patch({ variety: v })} format={(v) => pct(v / 0.6)} hint="Higher spreads picks further apart." />

      <div className="field">
        <span className="field-label">Flow</span>
        <GlideSelect
          options={ARC_OPTIONS} value={t.arc} onChange={(v) => patch({ arc: v })} showTags={false} ariaLabel="Playlist flow" menuWidth={260}
          accentColor="var(--ink)" surfaceColor="var(--surface-2)" highlightColor="var(--hairline-strong)" textColor="var(--ink)" radius={8}
        />
      </div>

      <div className="field">
        <div className="field-head"><span className="field-label">Genres</span><span className="muted small">tap to boost, again to mute</span></div>
        <div className="genre-chips">
          {families.map((f) => (
            <button key={f} type="button" className="gchip" data-pref={t.genrePrefs[f] ?? ''} aria-pressed={!!t.genrePrefs[f]} onClick={() => cycleGenre(f)}>
              {t.genrePrefs[f] === 'boost' ? `+ ${f}` : t.genrePrefs[f] === 'mute' ? `- ${f}` : f}
            </button>
          ))}
        </div>
      </div>
    </SpotlightCard>
  );
}
