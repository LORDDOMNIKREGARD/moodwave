// Track rows for the playlist and the fresh-drops feed, plus the per-row actions.

import { memo, useState } from 'react';
import { motion } from 'motion/react';
import { PlayIcon, StopIcon, ThumbsDownIcon, SpotifyIcon, AppleMusicIcon, YoutubeIcon } from '@hugeicons/core-free-icons';
import Icon from './Icon.jsx';
import PulseHeart from './reactbits/PulseHeart.jsx';
import { Artwork, FeatureChips, Meter, IconButton, Tip, pct } from './ui.jsx';
import { actions } from '../app/store.js';
import { linkFor, isDirect } from '../core/links.js';

const SERVICES = [
  ['spotify', 'Spotify', SpotifyIcon],
  ['apple', 'Apple Music', AppleMusicIcon],
  ['youtube', 'YouTube', YoutubeIcon],
];

export function ServiceLinks({ track }) {
  return (
    <span className="svcs">
      {SERVICES.map(([id, name, icon]) => {
        const direct = isDirect[id](track);
        const label = `${direct ? 'Open in' : 'Search in'} ${name}`;
        return (
          <Tip key={id} content={label}>
            <a className={`svc${direct ? ' is-direct' : ''}`} href={linkFor[id](track)} target="_blank" rel="noopener noreferrer" aria-label={label}>
              <Icon icon={icon} size={15} />
            </a>
          </Tip>
        );
      })}
    </span>
  );
}

export function RowActions({ track, playing, liked, disliked }) {
  return (
    <div className="actions">
      <IconButton icon={playing ? StopIcon : PlayIcon} label={playing ? 'Stop preview' : 'Play 30 second preview'} on={playing} onClick={() => actions.togglePlay(track)} />
      <span className="heart-wrap">
        <PulseHeart
          liked={liked} showCount={false} size={22} corner={40} label={`Like ${track.title}`} onChange={() => actions.like(track)}
          likedColor="var(--accent)" idleColor="var(--muted)" pillColor="transparent" textColor="var(--ink)"
        />
      </span>
      <IconButton icon={ThumbsDownIcon} label="Fewer songs like this" on={disliked} tone="bad" onClick={() => actions.dislike(track)} />
      <ServiceLinks track={track} />
    </div>
  );
}

/** One playlist row. Memoised: the list re-renders on every slider tick, rows should not. */
export const TrackRow = memo(function TrackRow({ pick, index, playing, liked, disliked, hover, onHover }) {
  const { track } = pick;
  const [open, setOpen] = useState(false);
  return (
    <motion.li
      layout="position" className={`row${playing ? ' is-playing' : ''}`} data-key={track.key}
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1], delay: Math.min(index, 12) * 0.018 }}
      onPointerEnter={() => onHover(track.key)}
    >
      {hover && <motion.span layoutId="row-hover" className="row-hover" transition={{ type: 'spring', duration: 0.35, bounce: 0 }} />}
      <span className="num idx">{index + 1}</span>
      <Artwork track={track} />
      <div className="meta">
        <div className="title"><span className="title-text">{track.title}</span>{!pick.known && <span className="badge">New to you</span>}</div>
        <div className="artist">{track.artists.join(', ')}</div>
      </div>
      <FeatureChips track={track} />
      <Meter score={pick.score} />
      <RowActions track={track} playing={playing} liked={liked} disliked={disliked} />
      <button type="button" className="why-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>Why this</button>
      {open && (
        <ul className="why">
          {pick.why.map((w) => <li key={w}>{w}</li>)}
          <li className="fits">
            {['mood', 'beat', 'genre'].map((k) => <span key={k}>{k} <b className="num">{pct(pick.fits[k])}</b></span>)}
          </li>
        </ul>
      )}
    </motion.li>
  );
});

const relativeDay = (iso) => {
  const d = Math.floor((Date.now() - Date.parse(iso)) / 864e5);
  if (!Number.isFinite(d)) return '';
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 14) return `${d} days ago`;
  return `${Math.round(d / 7)} weeks ago`;
};

export const FreshRow = memo(function FreshRow({ item, index, playing, liked, disliked, hover, onHover }) {
  const { track } = item;
  return (
    <motion.li
      layout="position" className={`row row-fresh${playing ? ' is-playing' : ''}`} data-key={track.key}
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1], delay: Math.min(index, 12) * 0.018 }}
      onPointerEnter={() => onHover(track.key)}
    >
      {hover && <motion.span layoutId="row-hover" className="row-hover" transition={{ type: 'spring', duration: 0.35, bounce: 0 }} />}
      <Artwork track={track} />
      <div className="meta">
        <div className="title"><span className="title-text">{track.title}</span>{item.isNew && <span className="badge is-solid">New</span>}</div>
        <div className="artist">
          {track.artists.join(', ')} <span aria-hidden="true">/</span> <time dateTime={track.releaseDate}>{relativeDay(track.releaseDate)}</time>
          {track.followedArtist && <span className="via"> You listen to {track.followedArtist}</span>}
        </div>
      </div>
      {track.features ? <FeatureChips track={track} /> : <div className="chips"><span className="chip chip-est">Analysing</span></div>}
      {track.features ? <Meter score={item.score ?? 0} /> : <div className="match" />}
      <RowActions track={track} playing={playing} liked={liked} disliked={disliked} />
    </motion.li>
  );
});
