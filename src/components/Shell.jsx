// Page shell: nav, masthead and the mood tab strip.

import { useMemo } from 'react';
import { motion } from 'motion/react';
import {
  Link01Icon, SpotifyIcon, Add01Icon, SparklesIcon, Target01Icon, Dumbbell01Icon, ArmchairIcon, PartyIcon, HeartRemoveIcon,
  Train01Icon, Car01Icon, Moon02Icon, BedIcon, FireIcon, SlidersHorizontalIcon,
} from '@hugeicons/core-free-icons';
import Icon from './Icon.jsx';
import { Button, pct } from './ui.jsx';
import Waves from './reactbits/Waves.jsx';
import SplitText from './reactbits/SplitText.jsx';
import Magnet from './reactbits/Magnet.jsx';
import { useStore, usePrefersDark, useReducedMotionPref } from '../app/useStore.js';
import { actions, defOf, visibleTabs } from '../app/store.js';

const TAB_ICONS = {
  foryou: SparklesIcon, similar: Link01Icon, focus: Target01Icon, workout: Dumbbell01Icon, chill: ArmchairIcon, party: PartyIcon,
  heartbreak: HeartRemoveIcon, commute: Train01Icon, roadtrip: Car01Icon, latenight: Moon02Icon, sleep: BedIcon, rage: FireIcon, custom: SlidersHorizontalIcon,
};

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--cta-fill)" />
      <path d="M5 17c2.5-8 4.5-8 7 0s4.5 8 7 0 3-4 8-4" stroke="var(--cta-ink)" strokeWidth="2.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function Nav() {
  const s = useStore();
  return (
    <header className="nav">
      <div className="nav-inner">
        <a className="wordmark" href="/" aria-label="Moodwave"><Logo /><span>Moodwave</span></a>
        <div className="nav-actions">
          <button type="button" className="nav-link" onClick={() => actions.openDialog({ type: 'import', tab: 'spotify' })}>
            <Icon icon={SpotifyIcon} size={16} />
            <span>{s.spotifyConnected ? 'Connected' : 'Connect'}</span>
          </button>
          <Button variant="ghost" icon={Link01Icon} onClick={() => actions.openDialog({ type: 'import', tab: 'similar' })}>Match playlist</Button>
          <Magnet padding={70} magnetStrength={5}>
            <Button variant="primary" icon={Add01Icon} onClick={() => actions.openDialog({ type: 'import', tab: 'taste' })}>Import</Button>
          </Magnet>
        </div>
      </div>
    </header>
  );
}

/** Line colour for the Waves canvas: the ink token at low alpha, re-read when the colour scheme changes. */
function useInkRgba(alpha) {
  const dark = usePrefersDark();
  return useMemo(() => {
    const hex = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim().replace('#', '');
    const n = parseInt(hex.length === 3 ? hex.replace(/./g, '$&$&') : hex, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }, [dark, alpha]);
}

export function Masthead() {
  const s = useStore();
  const reduce = useReducedMotionPref();
  const line = useInkRgba(0.16);
  const tab = s.tabs[s.activeTab];
  const empty = s.history.size === 0 && s.activeTab === 'foryou';
  const title = empty ? 'Music that fits the moment' : defOf(s.activeTab).label;
  const st = tab.stats;
  const sub = empty
    ? 'Import a playlist or pick a few songs. Moodwave tunes mood, genre and beat to you.'
    : st
      ? `${tab.picks.length} songs at ${Math.round(st.bpm)} BPM on average. ${st.fresh} are new to you, ${pct(st.match)} match.`
      : 'Nothing fits these settings yet. Widen the BPM zone or import more music.';
  return (
    <section className="masthead" aria-label="Current mood">
      <div className="masthead-bg" aria-hidden="true">
        <Waves lineColor={line} waveSpeedX={0.012} waveSpeedY={0.005} waveAmpX={34} waveAmpY={18} xGap={12} yGap={36} />
      </div>
      <div className="masthead-inner">
        {reduce ? (
          <h1 className="display">{title}</h1>
        ) : (
          <SplitText
            key={title} tag="h1" text={title} className="display" splitType="chars" delay={24} duration={0.9} ease="expo.out"
            from={{ opacity: 0, y: 28 }} to={{ opacity: 1, y: 0 }} threshold={0} rootMargin="0px" textAlign="left"
          />
        )}
        <p className="masthead-sub">{sub}</p>
      </div>
    </section>
  );
}

export function MoodTabs() {
  const s = useStore();
  const tabs = visibleTabs();
  const onKey = (e, i) => {
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next == null) return;
    e.preventDefault();
    const target = tabs[(next + tabs.length) % tabs.length];
    actions.selectTab(target.id);
    requestAnimationFrame(() => document.getElementById(`tab-${target.id}`)?.focus());
  };
  return (
    <nav className="tabs-wrap" aria-label="Moods">
      <div className="tabs" role="tablist" aria-label="Mood playlists">
        {tabs.map((t, i) => {
          const active = t.id === s.activeTab;
          const score = s.tabs[t.id].score;
          return (
            <button
              key={t.id} id={`tab-${t.id}`} type="button" role="tab" aria-selected={active} tabIndex={active ? 0 : -1} title={t.hint}
              className={`tab${active ? ' is-active' : ''}`} onClick={() => actions.selectTab(t.id)} onKeyDown={(e) => onKey(e, i)}
            >
              {active && <motion.span layoutId="tab-pill" className="tab-pill" transition={{ type: 'spring', duration: 0.45, bounce: 0.12 }} />}
              <span className="tab-content">
                <Icon icon={TAB_ICONS[t.id]} size={16} />
                <span>{t.label}</span>
                {score != null && <span className="num tab-score">{Math.round(score * 100)}%</span>}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
