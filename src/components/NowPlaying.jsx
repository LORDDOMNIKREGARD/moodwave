// Floating "now playing" dock for a preview you pinned with a click. Hover previews in the web never show it.
// Structure follows React Bits' Dock, but icons magnify with `scale` (transform) instead of width and height,
// because the design system only allows transform and opacity to animate.

import { useRef } from 'react';
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import { StopIcon, FavouriteIcon, ThumbsDownIcon, SpotifyIcon, YoutubeIcon } from '@hugeicons/core-free-icons';
import Icon from './Icon.jsx';
import { Artwork } from './ui.jsx';
import { useStore } from '../app/useStore.js';
import { actions } from '../app/store.js';
import { linkFor } from '../core/links.js';

const SPRING = { mass: 0.1, stiffness: 170, damping: 14 };

function DockItem({ mouseX, label, on, onClick, href, icon }) {
  const ref = useRef(null);
  const dist = useTransform(mouseX, (x) => {
    const r = ref.current?.getBoundingClientRect();
    return r ? x - (r.x + r.width / 2) : Infinity;
  });
  const scale = useSpring(useTransform(dist, [-96, 0, 96], [1, 1.45, 1]), SPRING);
  const Tag = href ? 'a' : 'button';
  return (
    <motion.div ref={ref} className="dock-item" style={{ scale, originY: 1 }}>
      <Tag
        className={`dock-btn${on ? ' is-on' : ''}`} aria-label={label} title={label} aria-pressed={!href && on ? true : undefined}
        {...(href ? { href, target: '_blank', rel: 'noopener noreferrer' } : { type: 'button', onClick })}
      >
        <Icon icon={icon} size={18} />
      </Tag>
    </motion.div>
  );
}

export default function NowPlaying() {
  const s = useStore();
  const p = s.playing;
  const show = !!p?.pinned && (p.status === 'playing' || p.status === 'loading');
  const mouseX = useMotionValue(Infinity);
  const track = p?.track;
  return (
    <div className="dock-wrap">
    <AnimatePresence>
      {show && (
        <motion.div
          className="dock" role="region" aria-label="Now playing"
          initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 28 }} transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        >
          <Artwork track={track} size={44} />
          <div className="dock-meta">
            <div className="t">{track.title}</div>
            <div className="a">
              {p.status === 'loading' ? 'Loading preview' : (<><span className="eq" aria-hidden="true"><i /><i /><i /></span>{track.artists.join(', ')}</>)}
            </div>
          </div>
          <div className="dock-items" onMouseMove={(e) => mouseX.set(e.clientX)} onMouseLeave={() => mouseX.set(Infinity)}>
            <DockItem mouseX={mouseX} label="Stop preview" icon={StopIcon} onClick={actions.stopPlayback} />
            <DockItem mouseX={mouseX} label="More like this" icon={FavouriteIcon} on={s.likes.has(track.key)} onClick={() => actions.like(track)} />
            <DockItem mouseX={mouseX} label="Fewer like this" icon={ThumbsDownIcon} on={s.dislikes.has(track.key)} onClick={() => actions.dislike(track)} />
            <DockItem mouseX={mouseX} label="Open in Spotify" icon={SpotifyIcon} href={linkFor.spotify(track)} />
            <DockItem mouseX={mouseX} label="Open in YouTube" icon={YoutubeIcon} href={linkFor.youtube(track)} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
    </div>
  );
}
