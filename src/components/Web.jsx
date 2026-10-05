// The recommendation web: your most-played songs around "You", what we would add linked to the songs it resembles.
// Hover any dot to hear a 30 second preview. Click one to pin it and open its card.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createWeb, legendFor } from './web.js';
import { Artwork, FeatureChips, Toggle } from './ui.jsx';
import { RowActions } from './Rows.jsx';
import TiltedCard from './reactbits/TiltedCard.jsx';
import GlideSelect from './reactbits/GlideSelect.jsx';
import { Button } from './ui.jsx';
import { useStore } from '../app/useStore.js';
import { actions, webData } from '../app/store.js';

const COLOR_OPTIONS = [{ value: 'mood', label: 'Colour by mood' }, { value: 'genre', label: 'Colour by genre' }];

function Sound({ status }) {
  if (status === 'loading') return <>Loading preview</>;
  if (status === 'playing') return <><span className="eq" aria-hidden="true"><i /><i /><i /></span>30 second preview playing</>;
  if (status === 'none') return <>No preview for this track</>;
  if (status === 'blocked') return <>Click once to unlock sound</>;
  if (status === 'error') return <>Preview could not be played</>;
  return null;
}

export default function WebView() {
  const s = useStore();
  const tab = s.tabs[s.activeTab];
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const webRef = useRef(null);
  const [colorBy, setColorBy] = useState('mood');
  const [tip, setTip] = useState(null); // { node, pos }
  const [selected, setSelected] = useState(null);

  const data = useMemo(() => webData(), [s.activeTab, tab.picks, tab.rest, s.history.size, s.similar]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const web = createWeb(canvasRef.current, {
      onHover: (node, pos) => {
        if (!node || node.type === 'you') { setTip(null); actions.hoverStop(); return; }
        setTip({ node, pos });
        actions.hoverPlay(node.track);
      },
      onSelect: (node) => {
        setSelected(node ? node.track : null);
        if (node && matchMedia('(hover: none)').matches) actions.togglePlay(node.track); // touch screens have no hover
      },
    });
    webRef.current = web;
    window.__moodwave = { ...(window.__moodwave ?? {}), web: () => web };
    return () => { actions.hoverStop(); web.destroy(); webRef.current = null; };
  }, []);

  useEffect(() => {
    const w = webRef.current;
    if (!w) return;
    w.setColorBy(colorBy);
    w.setData(data);
    setSelected(null);
    setTip(null);
  }, [data, colorBy]);

  const playingKey = s.playing?.status === 'playing' ? s.playing.track.key : null;
  useEffect(() => { webRef.current?.setPlaying(playingKey); }, [playingKey]);

  const legend = useMemo(() => legendFor(colorBy, [...data.seeds.map((x) => x.track), ...data.recs.map((r) => r.track)]), [colorBy, data]);

  const stageW = stageRef.current?.clientWidth ?? 700;
  const stageH = stageRef.current?.clientHeight ?? 500;
  const tipStyle = tip && {
    left: Math.min(stageW - 250, Math.max(8, tip.pos.x + tip.pos.r + 12)),
    top: Math.min(stageH - 150, Math.max(8, tip.pos.y - 30)),
  };
  const tipTrack = tip?.node.track;
  const tipStatus = tipTrack && s.playing?.track?.key === tipTrack.key ? s.playing.status : null;

  return (
    <div className="view">
      <div className="view-head">
        <p className="muted small web-lede">You in the middle, your most-played songs around you, and what we would add linked to the songs it resembles. <strong>Hover a dot to hear it.</strong></p>
        <div className="view-actions web-controls">
          <GlideSelect
            options={COLOR_OPTIONS} value={colorBy} onChange={setColorBy} showTags={false} ariaLabel="Colour nodes by" menuWidth={190}
            accentColor="var(--ink)" surfaceColor="var(--surface-2)" highlightColor="var(--hairline-strong)" textColor="var(--ink)" radius={9999}
          />
          <label className="control inline"><Toggle checked={s.settings.hoverAudio} label="Hover audio" onChange={(v) => actions.setSetting('hoverAudio', v)} /><span>Hover audio</span></label>
          <label className="control inline slim"><span className="muted small">Volume</span>
            <input className="slider" type="range" min="0" max="1" step="0.05" value={s.settings.volume} style={{ '--fill': `${s.settings.volume * 100}%`, width: 96 }}
              aria-label="Preview volume" onChange={(e) => actions.setSetting('volume', +e.target.value)} />
          </label>
          <Button variant="ghost" className="btn-sm" onClick={() => webRef.current?.resetView()}>Reset view</Button>
        </div>
      </div>

      <div className="web-stage" ref={stageRef}>
        <canvas ref={canvasRef} className="web-canvas" role="img" aria-label="Recommendation web. Songs you play are linked to recommended songs they resemble. The same recommendations are listed in the Playlist view." />
        {tip && (
          <div className="web-tip" style={tipStyle} role="status">
            <Artwork track={tipTrack} size={52} />
            <div><div className="t">{tipTrack.title}</div><div className="a">{tipTrack.artists.join(', ')}</div></div>
            <FeatureChips track={tipTrack} />
            <div className="snd">{!s.settings.hoverAudio ? 'Hover audio is off' : <Sound status={tipStatus} />}</div>
          </div>
        )}
        {s.playing?.status === 'blocked' && <div className="web-hint">Click once anywhere on the page to unlock hover audio.</div>}
      </div>

      <div className="legend">
        <span><i className="sw ring" />ring: from your history</span>
        <span><i className="sw dot" />dot: recommended</span>
        <span><i className="sw faint" />faint: runner-up</span>
        {legend.map((l) => <span key={l.label}><i className="sw" style={{ background: l.color }} />{l.label}</span>)}
      </div>

      {selected && (
        <div className="web-detail">
          {selected.art ? (
            <TiltedCard
              imageSrc={selected.art} altText="" containerHeight="132px" containerWidth="132px" imageHeight="132px" imageWidth="132px"
              scaleOnHover={1.06} rotateAmplitude={12} showMobileWarning={false} showTooltip={false}
            />
          ) : <Artwork track={selected} size={132} />}
          <div className="detail-body">
            <h3>{selected.title}</h3>
            <p className="muted">{selected.artists.join(', ')}</p>
            <FeatureChips track={selected} />
            <RowActions track={selected} playing={playingKey === selected.key} liked={s.likes.has(selected.key)} disliked={s.dislikes.has(selected.key)} />
          </div>
        </div>
      )}
    </div>
  );
}
