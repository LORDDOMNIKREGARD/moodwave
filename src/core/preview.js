// One shared 30-second preview player for the whole app (playlist rows, fresh drops, the web).
// Only one clip ever plays at a time. Hovering plays with a short fade; leaving fades out unless the
// clip was pinned by a click. Browsers refuse sound until the page has had a user gesture, so a
// blocked play() is reported as status 'blocked' and the UI asks for one click instead of failing silently.

export function createPreviewPlayer({ resolveUrl, onState = () => {} }) {
  const audio = new Audio();
  audio.preload = 'auto';
  let token = 0; // bumps on every request so stale async work can tell it was superseded
  let current = null;
  let pinned = false;
  let fade = null;
  let volume = 0.7;

  const fadeTo = (target, ms, done) => {
    clearInterval(fade);
    const from = audio.volume;
    const steps = Math.max(1, Math.round(ms / 30));
    let i = 0;
    fade = setInterval(() => {
      i++;
      audio.volume = Math.min(1, Math.max(0, from + ((target - from) * i) / steps));
      if (i >= steps) { clearInterval(fade); done?.(); }
    }, 30);
  };

  audio.addEventListener('ended', () => { current = null; pinned = false; onState({ status: 'stopped' }); });

  async function play(track, { pin = false } = {}) {
    const mine = ++token;
    if (current?.key === track.key && !audio.paused) {
      if (pin && !pinned) { pinned = true; onState({ status: 'playing', track, pinned }); }
      return;
    }
    onState({ status: 'loading', track, pinned: pin });
    let url = track.preview;
    if (!url) {
      try { url = await resolveUrl(track); } catch { url = null; }
    }
    if (mine !== token) return; // user moved on while we were looking it up
    if (!url) { current = null; onState({ status: 'none', track }); return; }
    clearInterval(fade);
    audio.pause();
    audio.src = url;
    audio.volume = 0;
    try {
      await audio.play();
    } catch (e) {
      if (mine === token) onState({ status: e?.name === 'NotAllowedError' ? 'blocked' : 'error', track });
      return;
    }
    if (mine !== token) { audio.pause(); return; }
    current = track;
    pinned = pin;
    fadeTo(volume, 260);
    onState({ status: 'playing', track, pinned });
  }

  /** Stop. A hover-out (`force` false) leaves a click-pinned clip playing. */
  function stop({ force = false } = {}) {
    token++;
    if (pinned && !force) return;
    pinned = false;
    current = null;
    fadeTo(0, 200, () => audio.pause());
    onState({ status: 'stopped' });
  }

  return {
    play,
    stop,
    toggle(track) { return current?.key === track.key && !audio.paused ? stop({ force: true }) : play(track, { pin: true }); },
    setVolume(v) { volume = v; if (!audio.paused) audio.volume = v; },
    get playingKey() { return !audio.paused ? current?.key ?? null : null; },
    get audio() { return audio; },
  };
}
