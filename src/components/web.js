// The recommendation web: an interactive force-directed graph on <canvas>.
//   centre  = "You"
//   inner   = your most-played tracks (seeds)
//   outer   = recommendations, each tied to the seeds it resembles most; runners-up are drawn faint.
// Nodes start where they sit on the valence x energy mood plane and are then pulled by similarity,
// so position means something even before the layout settles. No libraries, works offline.

import { familiesOf, moodOf, similarity } from '../core/engine.js';

const FAMILY_HUES = {
  pop: 330, rock: 8, 'hip-hop': 268, 'r&b': 292, electronic: 190, indie: 160, alternative: 100, metal: 0, punk: 24,
  indian: 36, latin: 48, 'k-pop': 315, 'j-pop': 340, folk: 80, country: 60, jazz: 215, classical: 235, reggae: 130,
  afrobeats: 20, blues: 250, oldies: 45,
};

export function moodColor(track, alpha = 1) {
  const { valence, energy } = track.features;
  const hue = 230 - valence * 190; // blue (low valence) -> orange (high)
  return `hsla(${hue.toFixed(0)}, ${(28 + energy * 38).toFixed(0)}%, ${(44 + energy * 12).toFixed(0)}%, ${alpha})`;
}

export function genreColor(track, alpha = 1) {
  const fam = familiesOf(track)[0];
  const hue = FAMILY_HUES[fam];
  return hue == null ? `hsla(0, 0%, 60%, ${alpha})` : `hsla(${hue}, 52%, 54%, ${alpha})`;
}

export function legendFor(colorBy, tracks) {
  if (colorBy === 'genre') {
    const seen = new Map();
    for (const t of tracks) { const f = familiesOf(t)[0]; if (f && !seen.has(f)) seen.set(f, genreColor(t)); }
    return [...seen].slice(0, 10).map(([label, color]) => ({ label, color }));
  }
  return [
    { label: 'Sad, dark', color: 'hsl(230,36%,50%)' }, { label: 'Calm', color: 'hsl(150,32%,46%)' },
    { label: 'Upbeat', color: 'hsl(60,52%,50%)' }, { label: 'Euphoric', color: 'hsl(40,62%,52%)' },
  ];
}

export function createWeb(canvas, { onSelect = () => {}, onHover = () => {} } = {}) {
  const ctx = canvas.getContext('2d');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 600;
  let H = 480;
  let nodes = [];
  let edges = [];
  let colorBy = 'mood';
  let alpha = 0;
  let raf = 0;
  let hover = null;
  let selected = null;
  let drag = null;
  let pan = null;
  const view = { x: 0, y: 0, k: 1 };

  const css = (name, fallback) => getComputedStyle(canvas).getPropertyValue(name).trim() || fallback;

  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    W = Math.max(280, r.width);
    H = Math.max(260, r.height);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  const toWorld = (px, py) => ({ x: (px - view.x) / view.k, y: (py - view.y) / view.k });
  const screenPos = (n) => ({ x: n.x * view.k + view.x, y: n.y * view.k + view.y, r: n.r * view.k });

  // The node whose preview is currently playing pulses so you can see what you are hearing.
  let playingKey = null;
  let pulseRaf = 0;
  const pulse = () => { draw(); pulseRaf = playingKey ? requestAnimationFrame(pulse) : 0; };

  function build({ seeds, recs, extras = [] }) {
    nodes = [{ id: 'you', type: 'you', r: 15, fixed: true, x: 0, y: 0, vx: 0, vy: 0, label: 'You' }];
    const byKey = new Map();
    const add = (item, type) => {
      const t = item.track;
      if (byKey.has(t.key)) return null;
      const f = t.features;
      const strength = type === 'seed' ? item.weight : item.score;
      const n = {
        id: t.key, type, track: t, item,
        r: type === 'seed' ? 5 + 7 * Math.sqrt(strength) : type === 'rec' ? 6 + 6 * strength : 4,
        gx: (f.valence - 0.5) * 520, gy: (0.5 - f.energy) * 400, // mood-plane "home"
        x: (f.valence - 0.5) * 420 + (Math.random() - 0.5) * 40,
        y: (0.5 - f.energy) * 320 + (Math.random() - 0.5) * 40,
        vx: 0, vy: 0, label: t.title,
      };
      byKey.set(t.key, n);
      nodes.push(n);
      return n;
    };
    const maxW = Math.max(1e-6, ...seeds.map((s) => s.weight));
    const seedNodes = seeds.map((s) => add({ ...s, weight: s.weight / maxW }, 'seed')).filter(Boolean);
    const recNodes = recs.map((r) => add(r, 'rec')).filter(Boolean);
    const extraNodes = extras.map((r) => add(r, 'extra')).filter(Boolean);

    edges = [];
    for (const s of seedNodes) edges.push({ a: nodes[0], b: s, strength: 0.25 + 0.5 * s.item.weight, kind: 'you' });
    for (const n of [...recNodes, ...extraNodes]) {
      const ranked = seedNodes.map((s) => ({ s, sim: similarity(n.track, s.track) })).sort((a, b) => b.sim - a.sim).slice(0, n.type === 'rec' ? 2 : 1);
      for (const { s, sim } of ranked) edges.push({ a: s, b: n, strength: sim, kind: 'seed' });
      if (!ranked.length) edges.push({ a: nodes[0], b: n, strength: 0.3, kind: 'you' });
    }
    // rec<->rec ties reveal clusters
    const lone = [...recNodes];
    for (let i = 0; i < lone.length; i++) {
      let links = 0;
      for (let j = i + 1; j < lone.length && links < 2; j++) {
        const sim = similarity(lone[i].track, lone[j].track);
        if (sim > 0.82) { edges.push({ a: lone[i], b: lone[j], strength: sim * 0.6, kind: 'rec' }); links++; }
      }
    }
    alpha = 1;
    view.x = W / 2; view.y = H / 2; view.k = 1;
    if (reduceMotion) { for (let i = 0; i < 300; i++) tick(); draw(); } else loop();
  }

  function tick() {
    const a = alpha;
    for (let i = 0; i < nodes.length; i++) {
      const p = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const q = nodes[j];
        let dx = p.x - q.x;
        let dy = p.y - q.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        if (d2 > 90000) continue;
        const d = Math.sqrt(d2);
        const f = (2400 / d2) * a;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        if (!p.fixed) { p.vx += fx; p.vy += fy; }
        if (!q.fixed) { q.vx -= fx; q.vy -= fy; }
        const minD = p.r + q.r + 4; // soft collision
        if (d < minD) {
          const push = ((minD - d) / d) * 0.5;
          if (!p.fixed) { p.vx += dx * push; p.vy += dy * push; }
          if (!q.fixed) { q.vx -= dx * push; q.vy -= dy * push; }
        }
      }
    }
    for (const e of edges) {
      const rest = 50 + (1 - e.strength) * 150;
      const dx = e.b.x - e.a.x;
      const dy = e.b.y - e.a.y;
      const d = Math.hypot(dx, dy) || 1;
      const f = (d - rest) * 0.02 * (0.4 + e.strength) * a;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      if (!e.a.fixed) { e.a.vx += fx; e.a.vy += fy; }
      if (!e.b.fixed) { e.b.vx -= fx; e.b.vy -= fy; }
    }
    for (const n of nodes) {
      if (n.fixed) continue;
      if (n.gx != null) { n.vx += (n.gx - n.x) * 0.006 * a; n.vy += (n.gy - n.y) * 0.006 * a; }
      n.vx -= n.x * 0.0015 * a;
      n.vy -= n.y * 0.0015 * a;
      n.vx *= 0.82;
      n.vy *= 0.82;
      n.x += n.vx;
      n.y += n.vy;
    }
    alpha *= 0.985;
  }

  function loop() {
    cancelAnimationFrame(raf);
    const step = () => {
      for (let i = 0; i < 2; i++) tick();
      draw();
      if (alpha > 0.015 || drag) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  const fill = (n, a = 1) => (n.type === 'you' ? css('--accent', '#e4775a') : colorBy === 'genre' ? genreColor(n.track, a) : moodColor(n.track, a));

  function neighbours(n) {
    const set = new Set([n]);
    for (const e of edges) { if (e.a === n) set.add(e.b); if (e.b === n) set.add(e.a); }
    return set;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.k, view.k);
    const focus = hover ?? selected;
    const near = focus ? neighbours(focus) : null;
    const ink = css('--ink', '#edede3');
    const line = css('--hairline-strong', 'rgba(128,128,128,.4)');

    for (const e of edges) {
      const lit = !near || (near.has(e.a) && near.has(e.b));
      ctx.globalAlpha = lit ? 0.15 + e.strength * 0.5 : 0.04;
      ctx.strokeStyle = line;
      ctx.lineWidth = 0.6 + e.strength * 2;
      ctx.beginPath();
      ctx.moveTo(e.a.x, e.a.y);
      ctx.lineTo(e.b.x, e.b.y);
      ctx.stroke();
    }
    for (const n of nodes) {
      const dim = near && !near.has(n);
      ctx.globalAlpha = dim ? 0.18 : n.type === 'extra' ? 0.55 : 1;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      if (n.type === 'seed') {
        ctx.fillStyle = css('--ground', '#0e1011');
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = fill(n);
        ctx.stroke();
      } else {
        ctx.fillStyle = fill(n);
        ctx.fill();
        if (n.type === 'rec') { ctx.lineWidth = 1.5; ctx.strokeStyle = css('--ground', '#0e1011'); ctx.stroke(); }
      }
      if (n === selected || n === hover) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = ink;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (n.id === playingKey) {
        const t = (performance.now() % 1100) / 1100; // expanding ripple, twice per ~second
        for (const phase of [0, 0.5]) {
          const p = (t + phase) % 1;
          ctx.globalAlpha = (1 - p) * 0.7;
          ctx.lineWidth = 2;
          ctx.strokeStyle = fill(n);
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r + 5 + p * 16, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
    ctx.globalAlpha = 1;
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const labelled = new Set([nodes[0], focus, ...(near ?? [])].filter(Boolean));
    for (const n of labelled) {
      const txt = n.type === 'you' ? 'You' : `${n.track.title} · ${n.track.artists?.[0] ?? ''}`;
      const clipped = txt.length > 34 ? `${txt.slice(0, 33)}…` : txt;
      const y = n.y - n.r - 7;
      ctx.lineWidth = 4;
      ctx.strokeStyle = css('--ground', '#0e1011');
      ctx.strokeText(clipped, n.x, y);
      ctx.fillStyle = ink;
      ctx.fillText(clipped, n.x, y);
    }
    ctx.restore();
  }

  function pick(px, py) {
    const { x, y } = toWorld(px, py);
    let best = null;
    let bd = Infinity;
    for (const n of nodes) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d <= n.r + 5 && d < bd) { bd = d; best = n; }
    }
    return best;
  }

  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  canvas.addEventListener('pointerdown', (e) => {
    const [px, py] = local(e);
    const n = pick(px, py);
    canvas.setPointerCapture(e.pointerId);
    if (n && n.type !== 'you') { drag = { n, moved: false }; n.fixed = true; alpha = Math.max(alpha, 0.3); loop(); }
    else pan = { px, py, vx: view.x, vy: view.y, moved: false, hit: n };
  });
  canvas.addEventListener('pointermove', (e) => {
    const [px, py] = local(e);
    if (drag) {
      const w = toWorld(px, py);
      drag.n.x = w.x; drag.n.y = w.y; drag.n.vx = drag.n.vy = 0; drag.moved = true;
      return;
    }
    if (pan) {
      if (Math.hypot(px - pan.px, py - pan.py) > 3) pan.moved = true;
      view.x = pan.vx + px - pan.px; view.y = pan.vy + py - pan.py;
      draw();
      return;
    }
    const n = pick(px, py);
    if (n !== hover) {
      hover = n;
      canvas.style.cursor = n ? 'pointer' : 'grab';
      onHover(n, n ? screenPos(n) : null);
      draw();
    }
  });
  const release = () => {
    if (drag) {
      const { n, moved } = drag;
      n.fixed = false;
      drag = null;
      if (!moved) { selected = n; onSelect(n); }
      draw();
    } else if (pan) {
      if (!pan.moved) { selected = pan.hit && pan.hit.type !== 'you' ? pan.hit : null; onSelect(selected); draw(); }
      pan = null;
    }
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => { if (hover) { hover = null; onHover(null, null); draw(); } });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [px, py] = local(e);
    const k = Math.min(3, Math.max(0.35, view.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    view.x = px - ((px - view.x) / view.k) * k;
    view.y = py - ((py - view.y) / view.k) * k;
    view.k = k;
    draw();
  }, { passive: false });

  return {
    setData(data) { selected = null; hover = null; build(data); },
    setColorBy(mode) { colorBy = mode; draw(); },
    select(key) { selected = nodes.find((n) => n.id === key) ?? null; draw(); },
    /** Pulse the node whose preview is playing (null to stop). */
    setPlaying(key) {
      playingKey = key;
      if (key && !pulseRaf && !reduceMotion) pulseRaf = requestAnimationFrame(pulse);
      else draw();
    },
    resetView() { view.x = W / 2; view.y = H / 2; view.k = 1; draw(); },
    /** Canvas-relative positions of every node (for tests and debugging). */
    nodePositions() { return nodes.map((n) => ({ id: n.id, type: n.type, title: n.label, ...screenPos(n) })); },
    redraw: draw,
    destroy() { cancelAnimationFrame(raf); ro.disconnect(); },
  };
}
