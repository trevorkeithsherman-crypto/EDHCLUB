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
