// Small shared building blocks. Every colour comes from the design tokens (tokens.css), never from a literal.

import { MusicNote01Icon } from '@hugeicons/core-free-icons';
import Icon from './Icon.jsx';
import WarmTooltip from './reactbits/WarmTooltip.jsx';
import SquishSwitch from './reactbits/SquishSwitch.jsx';
import { moodOf, familiesOf } from '../core/engine.js';
import { moodColor } from './web.js';

export function Button({ variant = 'secondary', icon, children, className = '', ...rest }) {
  return (
    <button type="button" className={`btn btn-${variant} ${className}`} {...rest}>
      {icon && <Icon icon={icon} size={16} />}
      {children}
    </button>
  );
}

/** Tooltip in the project's colours: ink surface, ground text, no blur. */
export function Tip({ content, side = 'top', children }) {
  return (
    <WarmTooltip content={content} side={side} surfaceColor="var(--ink)" inkColor="var(--ground)" popBlur={0} radius={8} size="sm">
      {children}
    </WarmTooltip>
  );
}

export function IconButton({ icon, label, on = false, tone, onClick, tip = true, ...rest }) {
  const btn = (
    <button
      type="button"
      className={`icon-btn${on ? ' is-on' : ''}${tone ? ` tone-${tone}` : ''}`}
      aria-label={label}
      aria-pressed={on || undefined}
      onClick={onClick}
      {...rest}
    >
      <Icon icon={icon} size={17} />
    </button>
  );
  return tip ? <Tip content={label}>{btn}</Tip> : btn;
}

export const Chip = ({ children, tone, title, className = '' }) => (
  <span className={`chip${tone ? ` chip-${tone}` : ''} ${className}`} title={title}>{children}</span>
);

export function Toggle({ checked, onChange, label }) {
  return (
    <SquishSwitch
      checked={checked}
      onChange={onChange}
      ariaLabel={label}
      width={46}
      height={26}
      trackColor="var(--hairline-strong)"
      trackOnColor="var(--cta-fill)"
      thumbColor="var(--ground)"
      thumbOnColor="var(--cta-ink)"
    />
  );
}

export function Slider({ id, label, value, min = 0, max = 1, step = 0.05, onChange, format = (v) => v, hint, disabled }) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className={`field${disabled ? ' is-disabled' : ''}`}>
      <div className="field-head">
        <label htmlFor={id}>{label}</label>
        <span className="num muted">{format(value)}</span>
      </div>
      <input
        id={id} className="slider" type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        style={{ '--fill': `${fill}%` }} onChange={(e) => onChange(+e.target.value)}
      />
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export const pct = (x) => `${Math.round(Math.max(0, Math.min(1, x)) * 100)}%`;

export function Artwork({ track, size = 48 }) {
  return track.art ? (
    <img className="art" src={track.art} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" />
  ) : (
    <span className="art art-blank" style={{ width: size, height: size }} aria-hidden="true">
      <Icon icon={MusicNote01Icon} size={Math.round(size * 0.42)} />
    </span>
  );
}

/** Thin match bar. Scales on the transform axis only. */
export function Meter({ score }) {
  return (
    <div className="match" role="img" aria-label={`${Math.round(score * 100)} percent match`}>
      <span className="meter"><span style={{ transform: `scaleX(${Math.max(0.02, Math.min(1, score))})` }} /></span>
      <span className="num pct">{Math.round(score * 100)}</span>
    </div>
  );
}

/** BPM, mood and genre for one track. "est." marks values measured from a 30s preview rather than looked up. */
export function FeatureChips({ track }) {
  const f = track.features;
  const mood = moodOf(f.valence, f.energy);
  const fam = familiesOf(track)[0] ?? track.genres?.[0];
  return (
    <div className="chips">
      <Chip className="num" title={`${Math.round(f.tempo)} beats per minute${track.estimated ? ', estimated from the preview' : ''}`}>{Math.round(f.tempo)} BPM</Chip>
      <Chip title={`positivity ${pct(f.valence)}, energy ${pct(f.energy)}`}>{mood.label}</Chip>
      {fam && <Chip>{fam}</Chip>}
      {track.estimated && <Chip tone="est" title={track.featureNote ?? 'Estimated from the 30 second preview'}>estimated</Chip>}
    </div>
  );
}

export { moodColor };
