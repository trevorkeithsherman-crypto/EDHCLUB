// Particles, motion helpers and synthesized sound. Everything here is original:
// no Wizards video, music or effects (Fan Content Policy rule 4).

let S = { motion: 'full', sound: false };
export function setFxState(state) { S = state; }

const $ = (s) => document.querySelector(s);
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const mul = () => ({ full: 1, reduced: 0.5, off: 0 }[S.motion] ?? 1);
function visRect(el) { if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 ? r : null; }

export const FX = {
  cv: null, cx: null, parts: [], raf: 0,
  init() { this.cv = $('#fx'); this.cx = this.cv.getContext('2d'); this.size(); addEventListener('resize', () => this.size()); },
  size() { const d = devicePixelRatio || 1; this.cv.width = innerWidth * d; this.cv.height = innerHeight * d; this.cx.setTransform(d, 0, 0, d, 0, 0); },
  full() { return S.motion === 'full'; },
  push(p) { p.life = 0; this.parts.push(p); if (!this.raf) this.raf = requestAnimationFrame(() => this.tick()); },
  tick() {
    const cx = this.cx, Ps = this.parts; cx.clearRect(0, 0, innerWidth, innerHeight);
    for (let k = Ps.length - 1; k >= 0; k--) {
      const p = Ps[k]; p.life++; if (p.life > p.max) { Ps.splice(k, 1); continue; }
      const a = 1 - p.life / p.max; p.vy += p.g || 0; if (p.drag) { p.vx *= p.drag; p.vy *= p.drag; } p.x += p.vx; p.y += p.vy; p.rot = (p.rot || 0) + (p.vr || 0);
      cx.save(); cx.globalAlpha = Math.max(0, a * (p.alpha || 1)); cx.translate(p.x, p.y); cx.rotate(p.rot);
      if (p.k === 'ring') { const rr = p.r + (1 - a) * p.grow; cx.strokeStyle = p.c; cx.lineWidth = 2.5 * a + 0.5; cx.beginPath(); cx.ellipse(0, 0, rr, rr * 0.32, 0, 0, Math.PI * 2); cx.stroke(); }
      else if (p.k === 'shard') { cx.fillStyle = p.c; cx.beginPath(); cx.moveTo(-p.s, -p.s * 0.6); cx.lineTo(p.s, -p.s * 0.15); cx.lineTo(-p.s * 0.15, p.s); cx.closePath(); cx.fill(); }
      else if (p.k === 'conf') { p.vx += Math.sin((p.life + p.ph) / 9) * 0.07; cx.fillStyle = p.c; cx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); }
      else { cx.fillStyle = p.c; cx.beginPath(); cx.arc(0, 0, p.s * (0.5 + 0.5 * a), 0, Math.PI * 2); cx.fill(); }
      cx.restore();
    }
    this.raf = Ps.length ? requestAnimationFrame(() => this.tick()) : 0;
    if (!Ps.length) cx.clearRect(0, 0, innerWidth, innerHeight);
  },
  dust(r) {
    if (!this.full() || !r) return; const x = r.left + r.width / 2, y = r.top + r.height - 2, c = css('--parch-2');
    this.push({ k: 'ring', x, y, vx: 0, vy: 0, r: r.width * 0.3, grow: r.width * 0.75, c, max: 26 });
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; this.push({ k: 'dot', x: x + Math.cos(a) * r.width * 0.3, y: y - 3, vx: Math.cos(a) * (1.2 + Math.random() * 1.8), vy: -Math.random() * 1.4, g: 0.05, drag: 0.95, s: 1.6 + Math.random() * 2.4, c, alpha: 0.6, max: 30 + Math.random() * 16 }); }
  },
  puff(r, col) {
    if (!this.full() || !r) return; const x = r.left + r.width / 2, y = r.top + r.height / 2;
    for (let k = 0; k < 20; k++) { const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 3; this.push({ k: 'dot', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, drag: 0.92, s: 2 + Math.random() * 4, c: k % 3 ? col : css('--parch'), alpha: 0.8, max: 28 + Math.random() * 14 }); }
  },
  burst(r, cols) {
    if (!this.full() || !r) return; const x = r.left + r.width / 2, y = r.top + r.height / 2;
    for (let k = 0; k < 40; k++) { const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 5; this.push({ k: 'dot', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1.5, g: 0.04, drag: 0.95, s: 1.5 + Math.random() * 3, c: cols[k % cols.length], max: 40 + Math.random() * 25 }); }
  },
  shatter(r, cols) {
    if (!this.full() || !r) return; const cxm = r.left + r.width / 2; const pal = cols.concat([css('--parch'), '#15110d']);
    for (let k = 0; k < 24; k++) { const x = r.left + Math.random() * r.width, y = r.top + Math.random() * r.height; this.push({ k: 'shard', x, y, vx: ((x - cxm) / r.width) * 7 + (Math.random() - 0.5) * 2, vy: -2 - Math.random() * 3.5, g: 0.28, s: 3 + Math.random() * 6, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: pal[k % pal.length], max: 55 + Math.random() * 20 }); }
  },
  confetti(cols) {
    if (!mul()) return; const n = this.full() ? 200 : 60;
    for (let k = 0; k < n; k++) this.push({ k: 'conf', x: Math.random() * innerWidth, y: -20 - Math.random() * innerHeight * 0.5, vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 3, g: 0.025, drag: 0.995, s: 6 + Math.random() * 7, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.25, c: cols[k % cols.length], ph: Math.random() * 60, max: 230 + Math.random() * 90 });
  },
  beam(r, col) {
    if (!mul() || !r) return; const b = document.createElement('div'); b.className = 'beam';
    b.style.left = r.left + r.width / 2 - 45 + 'px'; b.style.top = '0px'; b.style.height = Math.max(80, r.top + r.height / 2) + 'px'; b.style.setProperty('--bc', col);
    $('#layer').appendChild(b); setTimeout(() => b.remove(), 1050); this.burst(r, [col, css('--candle'), css('--parch')]);
  },
  floatNum(el, d) {
    const r = visRect(el); if (!r || !mul()) return; const s = document.createElement('div'); s.className = 'fnum ' + (d < 0 ? 'neg' : 'pos'); s.textContent = (d > 0 ? '+' : '') + d;
    s.style.left = r.left + r.width / 2 + 'px'; s.style.top = r.top - 6 + 'px'; $('#layer').appendChild(s);
    s.animate([{ transform: 'translate(-50%,0) scale(.7)', opacity: 0 }, { transform: 'translate(-50%,-14px) scale(1.2)', opacity: 1, offset: 0.18 }, { transform: 'translate(-50%,-50px) scale(1)', opacity: 0 }], { duration: 1050, easing: 'ease-out' }).onfinish = () => s.remove();
  },
  shake(el, big) { if (!el || !this.full()) return; const m = big ? 9 : 5; el.animate([{ transform: 'translateX(0)' }, { transform: `translateX(-${m}px)` }, { transform: `translateX(${m}px)` }, { transform: `translateX(-${m * 0.6}px)` }, { transform: `translateX(${m * 0.4}px)` }, { transform: 'translateX(0)' }], { duration: big ? 520 : 360, easing: 'ease-out' }); },
  slam(el, s = 1.18) { if (!el || !mul()) return; el.animate([{ transform: `scale(${s})` }, { transform: 'scale(.95)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: 300, easing: 'ease-out' }); },
  pop(el) { if (!el || !mul()) return; el.animate([{ transform: 'scale(.2)', opacity: 0 }, { transform: 'scale(1.14)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' }); },
  lunge(el, tr) {
    const r = visRect(el); if (!r || !tr || !mul()) return;
    const dx = tr.left + tr.width / 2 - (r.left + r.width / 2), dy = tr.top + tr.height / 2 - (r.top + r.height / 2), L = Math.hypot(dx, dy) || 1, k = 24 / L;
    el.animate([{ transform: 'translate(0,0)' }, { transform: `translate(${dx * k}px,${dy * k}px) scale(1.1)`, offset: 0.35 }, { transform: 'translate(0,0)' }], { duration: 440, easing: 'cubic-bezier(.3,.7,.3,1)' });
  },
  bounce(el) { if (!el || !mul()) return; el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.5)', offset: 0.4 }, { transform: 'scale(1)' }], { duration: 320, easing: 'ease-out' }); },
};

export const SFX = {
  ctx: null, master: null,
  init() { try { if (!this.ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.gain.value = 0.55; this.master.connect(this.ctx.destination); } if (this.ctx.state === 'suspended') this.ctx.resume(); } catch { /* no audio */ } },
  tone(f, dur, type, vol, at, to) { const c = this.ctx, t = c.currentTime + (at || 0); const o = c.createOscillator(), g = c.createGain(); o.type = type || 'sine'; o.frequency.setValueAtTime(f, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.15, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05); },
  noise(dur, vol, freq, ft, to, at) { const c = this.ctx, t = c.currentTime + (at || 0); const len = Math.max(1, Math.floor(c.sampleRate * dur)); const buf = c.createBuffer(1, len, c.sampleRate); const d = buf.getChannelData(0); for (let k = 0; k < len; k++) d[k] = Math.random() * 2 - 1; const s = c.createBufferSource(); s.buffer = buf; const f = c.createBiquadFilter(); f.type = ft || 'bandpass'; f.frequency.setValueAtTime(freq, t); if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur); f.Q.value = 1.1; const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + dur + 0.05); },
  play(n, arg) {
    if (!S || !S.sound || !this.ctx) return;
    try {
      switch (n) {
        case 'whoosh': this.noise(0.3, 0.16, 500, 'bandpass', 2600); break;
        case 'thud': this.tone(120, 0.3, 'sine', 0.45, 0, 42); this.noise(0.14, 0.2, 380, 'lowpass'); break;
        case 'chime': { const f = { W: 988, U: 784, B: 523, R: 880, G: 659, C: 698 }[arg] || 784; this.noise(0.26, 0.08, 900, 'bandpass', 3200); this.tone(f, 0.7, 'triangle', 0.13, 0.05); this.tone(f * 1.5, 0.6, 'sine', 0.05, 0.09); break; }
        case 'fanfare': [523, 659, 784, 1047].forEach((f, k) => this.tone(f, 0.45, 'sawtooth', 0.05, k * 0.08)); this.tone(1047, 1.3, 'triangle', 0.11, 0.32); this.noise(0.6, 0.1, 400, 'bandpass', 4000); break;
        case 'charge': this.noise(0.42, 0.2, 300, 'bandpass', 1700); this.tone(196, 0.3, 'square', 0.04, 0, 392); break;
        case 'hit': this.tone(160, 0.18, 'square', 0.1, 0, 60); this.noise(0.12, 0.22, 1800, 'highpass'); break;
        case 'heal': this.tone(660, 0.35, 'sine', 0.12, 0, 990); break;
        case 'shatter': this.noise(0.6, 0.32, 2500, 'highpass'); for (let k = 0; k < 6; k++) this.tone(1800 + Math.random() * 2400, 0.25, 'triangle', 0.035, k * 0.04); break;
        case 'pop': this.tone(420, 0.12, 'sine', 0.16, 0, 900); break;
        case 'tick': this.tone(1400, 0.05, 'square', 0.035); break;
        case 'gong': this.tone(98, 2.2, 'sine', 0.35); this.tone(147.5, 1.8, 'sine', 0.12); this.tone(231, 1.4, 'sine', 0.06); break;
        case 'victory': [523, 659, 784, 659, 784, 1047].forEach((f, k) => this.tone(f, 0.4, 'triangle', 0.11, k * 0.14)); this.tone(1047, 1.6, 'sine', 0.11, 0.84); break;
        case 'shuffle': for (let k = 0; k < 8; k++) this.noise(0.06, 0.12, 2000, 'bandpass', null, k * 0.05); break;
        default: break;
      }
    } catch { /* ignore */ }
  },
};

/* ---------- Ambient worlds: one small canvas per playmat ---------- */
const R = (a, b) => a + Math.random() * (b - a);
// Building blocks: each world is a particle recipe plus a slow "glow" pass painted under the particles.
// Everything is deliberately quiet; the painting is the star and the weather should only be noticed on a second look.
const motes = (o) => ({
  density: o.density,
  spawn: (w, h) => ({ x: R(o.x ? o.x[0] * w : 0, o.x ? o.x[1] * w : w), y: o.up ? h + 6 : (o.band ? R(o.band[0] * h, o.band[1] * h) : -6), vx: R(o.vx[0], o.vx[1]), vy: R(o.vy[0], o.vy[1]), s: R(o.s[0], o.s[1]), life: 0, max: R(o.max[0], o.max[1]), c: Array.isArray(o.c) ? o.c[Math.floor(Math.random() * o.c.length)] : o.c, wob: R(0, 6.3) }),
  step: (p, t) => { p.x += p.vx + Math.sin(t / (o.sway || 30) + p.wob) * (o.swayAmt || 0.2); p.y += p.vy; },
  draw: (cx, p, a) => { const tw = o.twinkle ? 0.45 + 0.55 * Math.abs(Math.sin(p.life / 11 + p.wob)) : 1; cx.globalAlpha = a * (o.alpha || 0.8) * tw; cx.fillStyle = p.c; if (o.blur) { cx.shadowColor = p.c; cx.shadowBlur = o.blur; } cx.beginPath(); cx.arc(p.x, p.y, p.s, 0, 6.3); cx.fill(); },
});
const mist = (o) => ({
  density: o.density || 0.00006,
  spawn: (w, h) => ({ x: R(-80, w), y: R((o.band ? o.band[0] : 0.45) * h, (o.band ? o.band[1] : 1.05) * h), vx: R(o.vx ? o.vx[0] : 0.12, o.vx ? o.vx[1] : 0.35), vy: R(-0.04, 0.02), s: R(60, 150), life: 0, max: R(500, 900), c: o.c, wob: R(0, 6.3) }),
  step: (p, t) => { p.x += p.vx; p.y += p.vy + Math.sin(t / 90 + p.wob) * 0.05; },
  draw: (cx, p, a) => { const g = cx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.s); g.addColorStop(0, `rgba(${o.c},${(o.alpha || 0.12) * a})`); g.addColorStop(1, `rgba(${o.c},0)`); cx.globalAlpha = 1; cx.fillStyle = g; cx.fillRect(p.x - p.s, p.y - p.s, p.s * 2, p.s * 2); },
});
// Mix two recipes: the second gets a share of the spawns.
const mix = (A, B, shareB = 0.4) => ({
  density: A.density + B.density,
  spawn: (w, h) => { const b = Math.random() < shareB; const p = (b ? B : A).spawn(w, h); p._r = b ? B : A; return p; },
  step: (p, t) => p._r.step(p, t),
  draw: (cx, p, a) => p._r.draw(cx, p, a),
});
const pulse = (cx, x, y, r, rgb, k) => { const g = cx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(${rgb},${k})`); g.addColorStop(1, `rgba(${rgb},0)`); cx.fillStyle = g; cx.fillRect(x - r, y - r, r * 2, r * 2); };
const shafts = (cx, w, h, t, rgb, ox = 0.7, rot = 0.5, n = 4, base = 0.06) => { cx.save(); cx.globalAlpha = base + Math.sin(t / 140) * 0.02; cx.translate(w * ox, -h * 0.4); cx.rotate(rot); const g = cx.createLinearGradient(0, 0, 0, h * 2); g.addColorStop(0, `rgba(${rgb},1)`); g.addColorStop(1, `rgba(${rgb},0)`); cx.fillStyle = g; for (let i = 0; i < n; i++) cx.fillRect(i * 80 + Math.sin(t / 220 + i) * 12, 0, 16 + i * 7, h * 2.2); cx.restore(); };
const W_ = {};
W_.azorius = { ...motes({ density: 0.00004, c: '#eef4ff', vx: [-0.5, -0.25], vy: [-0.05, 0.05], s: [0.8, 1.4], max: [400, 700], band: [0.05, 0.4], alpha: 0.5 }), glow: (cx, w, h, t) => { shafts(cx, w, h, t, '220,235,255', 0.25, -0.35, 3, 0.05); pulse(cx, w * 0.5, h * 0.1, h * 0.8, '190,215,255', 0.05 + Math.sin(t / 160) * 0.015); } };
W_.orzhov = { ...motes({ density: 0.00009, c: ['#ffe2a0', '#fff1c8'], up: true, vx: [-0.1, 0.1], vy: [-0.25, -0.08], s: [0.7, 1.6], max: [300, 600], alpha: 0.6, twinkle: true, blur: 6 }), glow: (cx, w, h, t) => { const k = 0.07 + Math.sin(t / 50) * 0.012 + Math.sin(t / 17) * 0.006; pulse(cx, w * 0.68, h * 0.55, h * 0.55, '255,190,90', k); pulse(cx, w * 0.5, h * 0.45, h * 0.3, '255,200,110', k * 0.6); } };
W_.dimir = { ...mix(mist({ density: 0.00005, c: '120,110,170', alpha: 0.1, band: [0.55, 1.05], vx: [0.05, 0.15] }), motes({ density: 0.00003, c: '#b9a8ff', vx: [-0.05, 0.05], vy: [-0.08, -0.02], s: [0.7, 1.3], max: [200, 400], band: [0.6, 1], up: false, alpha: 0.7, twinkle: true, blur: 8 }), 0.4), glow: (cx, w, h, t) => { shafts(cx, w, h, t, '255,236,190', 0.3, 0.45, 4, 0.05); if (Math.random() < 0.003) { cx.globalAlpha = 0.35; cx.fillStyle = '#d6c9ff'; cx.shadowColor = '#d6c9ff'; cx.shadowBlur = 14; cx.beginPath(); cx.arc(R(w * 0.5, w), R(h * 0.55, h), 1.3, 0, 6.3); cx.fill(); } } };
W_.izzet = { ...mix(mist({ density: 0.00006, c: '170,200,255', alpha: 0.09, band: [0.6, 1.05], vx: [-0.2, 0.2] }), motes({ density: 0.00007, c: ['#7fd4ff', '#ff8a6a', '#fff'], up: true, vx: [-0.3, 0.3], vy: [-0.9, -0.3], s: [0.6, 1.4], max: [60, 140], x: [0.3, 0.75], alpha: 0.9, blur: 8, sway: 8, swayAmt: 0.8 }), 0.5), glow: (cx, w, h, t) => { const k = 0.07 + Math.abs(Math.sin(t / 23)) * 0.05; pulse(cx, w * 0.58, h * 0.6, h * 0.45, '255,80,50', k); pulse(cx, w * 0.5, h * 0.35, h * 0.3, '70,140,255', 0.06 + Math.abs(Math.sin(t / 37 + 1)) * 0.05); if (Math.random() < 0.012) { cx.globalAlpha = 0.5; cx.strokeStyle = '#bfe8ff'; cx.lineWidth = 1; cx.shadowColor = '#7fd4ff'; cx.shadowBlur = 10; cx.beginPath(); let x = R(w * 0.4, w * 0.65), y = R(h * 0.25, h * 0.55); cx.moveTo(x, y); for (let i = 0; i < 5; i++) { x += R(-18, 18); y += R(-14, 14); cx.lineTo(x, y); } cx.stroke(); } } };
W_.rakdos = { ...motes({ density: 0.0003, c: ['#ff8a3a', '#ffc27a', '#ff5a2a'], up: true, vx: [-0.15, 0.15], vy: [-0.8, -0.3], s: [0.8, 2.4], max: [120, 260], alpha: 0.85, blur: 8, sway: 25, swayAmt: 0.25 }), glow: (cx, w, h, t) => { const k = 0.1 + Math.sin(t / 19) * 0.02 + Math.sin(t / 7) * 0.012; pulse(cx, w * 0.55, h * 0.95, h * 0.8, '255,110,40', k); } };
W_.golgari = { ...mix(mist({ density: 0.00006, c: '150,200,180', alpha: 0.11, band: [0.5, 1.05] }), motes({ density: 0.00008, c: ['#b6ffc0', '#d8ffb0'], vx: [-0.15, 0.15], vy: [-0.12, 0.08], s: [0.8, 1.6], max: [200, 420], band: [0.3, 1], up: false, alpha: 0.7, twinkle: true, blur: 10 }), 0.55), glow: (cx, w, h, t) => { const k = 0.07 + Math.sin(t / 29) * 0.015; pulse(cx, w * 0.6, h * 0.62, h * 0.4, '255,170,60', k); pulse(cx, w * 0.33, h * 0.75, h * 0.25, '255,170,60', k * 0.6); } };
W_.gruul = { ...motes({ density: 0.00009, c: ['#e8f0a0', '#cfe67a', '#fff6c0'], vx: [-0.2, 0.2], vy: [-0.08, 0.12], s: [0.8, 1.8], max: [260, 520], band: [0.1, 1], up: false, alpha: 0.6, twinkle: true, blur: 5, sway: 35, swayAmt: 0.35 }), glow: (cx, w, h, t) => { shafts(cx, w, h, t, '240,255,200', 0.55, 0.3, 5, 0.06); } };
W_.boros = { ...mix(motes({ density: 0.00018, c: ['#ffb060', '#ffd89a', '#ff7a3a'], up: true, vx: [-0.1, 0.1], vy: [-0.7, -0.25], s: [0.7, 2], max: [120, 280], alpha: 0.8, blur: 7, sway: 20, swayAmt: 0.3 }), motes({ density: 0.00002, c: '#3a2a20', vx: [-0.6, -0.2], vy: [-0.1, 0.1], s: [1, 1.6], max: [300, 500], band: [0.02, 0.3], alpha: 0.6 }), 0.1), glow: (cx, w, h, t) => { const k = 0.09 + Math.sin(t / 23) * 0.02 + Math.sin(t / 9) * 0.01; pulse(cx, w * 0.5, h * 0.3, h * 0.6, '255,170,60', k); } };
W_.selesnya = { ...motes({ density: 0.00012, c: ['#ffffff', '#e9ffb3', '#fff4d0'], vx: [-0.35, -0.1], vy: [0.08, 0.25], s: [0.8, 2], max: [300, 560], x: [0.2, 1.2], alpha: 0.65, twinkle: true, blur: 4, sway: 40, swayAmt: 0.4 }), glow: (cx, w, h, t) => { shafts(cx, w, h, t, '255,250,220', 0.7, 0.45, 5, 0.06); } };
W_.simic = { ...mix(mist({ density: 0.00008, c: '235,240,250', alpha: 0.13, band: [0.45, 1.05], vx: [0.15, 0.4] }), motes({ density: 0.00005, c: ['#7fe6ff', '#a8f3ff'], vx: [0, 0], vy: [0, 0], s: [0.9, 1.8], max: [140, 260], band: [0.25, 0.85], up: false, alpha: 0.9, twinkle: true, blur: 12, x: [0.4, 0.9] }), 0.4), glow: (cx, w, h, t) => { pulse(cx, w * 0.6, h * 0.5, h * 0.5, '120,220,255', 0.05 + Math.sin(t / 60) * 0.02); } };
const WORLDS = W_;

export const Ambient = {
  seats: new Map(), raf: 0, t: 0,
  sync() {
    document.querySelectorAll('.seat[data-mat]').forEach((seat) => {
      const key = seat.dataset.seat, world = seat.dataset.mat;
      let cv = seat.querySelector('canvas.amb');
      if (!cv) { cv = document.createElement('canvas'); cv.className = 'amb'; seat.prepend(cv); }
      let st = this.seats.get(key);
      if (!st || st.world !== world) { st = { world, parts: [] }; this.seats.set(key, st); }
      st.cv = cv;
    });
    if (!this.raf) this.raf = requestAnimationFrame(() => this.tick());
  },
  tick() {
    this.raf = 0; this.t++;
    const m = mul();
    if (m === 0 || S.fx === false || document.hidden) { this.seats.forEach((st) => { if (st.cv) { const cx = st.cv.getContext('2d'); cx.clearRect(0, 0, st.cv.width, st.cv.height); } }); this.raf = requestAnimationFrame(() => this.tick()); return; }
    if (m < 1 && this.t % 2) { this.raf = requestAnimationFrame(() => this.tick()); return; }
    this.seats.forEach((st) => {
      const cv = st.cv; if (!cv || !cv.isConnected) return;
      const W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return;
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      const world = WORLDS[st.world]; if (!world) return;
      const cx = cv.getContext('2d'); cx.clearRect(0, 0, W, H);
      cx.save(); world.glow(cx, W, H, this.t); cx.restore();
      const want = Math.round(W * H * world.density * (m < 1 ? 0.5 : 1));
      while (st.parts.length < want && Math.random() < 0.3) st.parts.push(world.spawn(W, H));
      for (let i = st.parts.length - 1; i >= 0; i--) {
        const p = st.parts[i]; p.life++;
        if (p.life > p.max || p.y < -40 || p.y > H + 60 || p.x < -150 || p.x > W + 150) { st.parts.splice(i, 1); continue; }
        world.step(p, this.t);
        const a = Math.min(1, p.life / 40, (p.max - p.life) / 60);
        cx.save(); world.draw(cx, p, a); cx.restore();
      }
    });
    this.raf = requestAnimationFrame(() => this.tick());
  },
};
