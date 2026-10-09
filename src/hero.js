// Landing hero: four seats playing a scripted game in miniature, with real card images from Scryfall.
// Pure DOM + CSS animation; loops forever, pauses when off-screen, and freezes under reduced motion.
import { fetchCards, cached } from './scryfall.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RING = { W: '#f3e9c8', U: '#4fc3ff', B: '#9b86c9', R: '#ff7a5a', G: '#7fd58a' };

// Four pods: commander, the first color of the ring, a mat, and a short script of plays.
const SEATS = [
  { name: 'Marcus', mat: 'izzet', ring: 'U', cmdr: "Yuriko, the Tiger's Shadow", plays: ['Island', 'Ninja of the Deep Hours', 'Island', 'Changeling Outcast', 'Counterspell', 'Fallen Shinobi'], spells: ['Counterspell', 'Ponder'] },
  { name: 'Priya', mat: 'golgari', ring: 'G', cmdr: "Atraxa, Praetors' Voice", plays: ['Forest', 'Arcane Signet', 'Swamp', 'Doubling Season', 'Cultivate', 'Forest'], spells: ['Cultivate', 'Swords to Plowshares'] },
  { name: 'Theo', mat: 'selesnya', ring: 'W', cmdr: 'Sythis, Harvest\'s Hand', plays: ['Plains', 'Utopia Sprawl', 'Forest', 'Enchantress\'s Presence', 'Wild Growth', 'Sigil of the Empty Throne'], spells: ['Swords to Plowshares'] },
  { name: 'Jade', mat: 'boros', ring: 'R', cmdr: 'Krenko, Mob Boss', plays: ['Mountain', 'Sol Ring', 'Goblin Chieftain', 'Mountain', 'Skirk Prospector', 'Goblin Warchief'], spells: ['Lightning Bolt'] },
];
const PHASES = ['Beginning', 'Main', 'Combat', 'Main 2', 'End'];

export function startHero(root) {
  if (!root) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const state = SEATS.map((s) => ({ ...s, life: 40, bf: [], hand: [] }));
  const all = [...new Set(state.flatMap((s) => [s.cmdr, ...s.plays, ...s.spells]))];

  root.innerHTML = `<div class="hs-grid">${[0, 1, 2].map((i) => seatHTML(i)).join('')}${seatHTML(3, true)}</div>
    <div class="hs-turn" id="hsTurn"></div><div class="hs-hand" id="hsHand"></div><div class="hs-end" id="hsEnd">End turn</div><svg class="hs-arc" id="hsArc"></svg>`;
  function seatHTML(i, me) {
    const s = state[i];
    return `<div class="hs-seat ${me ? 'me' : ''}" data-s="${i}" style="background-image:url(/mats/${s.mat}.jpg)"><div class="hs-plate"><span class="hs-av" style="--ring:${RING[s.ring]}"><span class="hs-life" data-life="${i}">40</span></span><span class="hs-name">${esc(s.name)}</span></div><div class="hs-bf" data-bf="${i}"></div></div>`;
  }
  const $ = (q) => root.querySelector(q);
  const seatEl = (i) => $(`.hs-seat[data-s="${i}"]`);
  const img = (name) => { const c = cached(name); return c && c.img ? c.img : ''; };
  const art = (name) => { const c = cached(name); return c && c.art ? c.art : ''; };
  const cardHTML = (name, cls = '') => { const src = img(name); return src ? `<div class="hs-card ${cls}"><img src="${esc(src)}" alt="" loading="lazy" decoding="async"></div>` : `<div class="hs-card ph ${cls}" data-n="${esc(name)}"></div>`; };

  // Avatars: commander art crops, exactly like a player without a photo at a real table.
  const paintAvatars = () => state.forEach((s, i) => { const a = art(s.cmdr); const av = seatEl(i).querySelector('.hs-av'); if (a) av.style.backgroundImage = `url(${a})`; });

  function placeCard(i, name, cls = '') {
    const s = state[i]; const bf = $(`[data-bf="${i}"]`);
    const el = document.createElement('div'); el.innerHTML = cardHTML(name, 'in ' + cls); const card = el.firstChild;
    const k = s.bf.length; const cols = i === 3 ? 11 : 6; const gap = i === 3 ? 8.6 : 16.5;
    card.style.left = `${(k % cols) * gap}%`; card.style.top = `${Math.floor(k / cols) * 55}%`;
    bf.appendChild(card); s.bf.push({ name, el: card }); return card;
  }
  function renderHand(i) {
    const h = $('#hsHand'); if (i !== 3) { h.innerHTML = ''; return; }
    const n = state[3].hand.length;
    h.innerHTML = state[3].hand.map((name, k) => { const t = n > 1 ? k / (n - 1) - 0.5 : 0; return cardHTML(name).replace('class="hs-card', `style="--r:${(t * 28).toFixed(1)}deg;--l:${(Math.abs(t) * 18).toFixed(1)}px" class="hs-card`); }).join('');
  }
  function setTurn(i, round, ph) {
    state.forEach((_, k) => seatEl(k).classList.toggle('on', k === i));
    $('#hsTurn').innerHTML = `<span>Round ${round}</span><b>${esc(state[i].name)}'s turn</b>${PHASES.map((p, k) => `<i class="${k === ph ? 'on' : ''}">${p}</i>`).join('')}`;
    $('#hsEnd').classList.toggle('on', i === 3);
  }
  function castFlash(name) {
    const src = img(name); if (!src || reduce) return;
    const d = document.createElement('div'); d.className = 'hs-cast'; d.style.left = '50%'; d.style.top = '52%'; d.innerHTML = `<img src="${esc(src)}" alt="">`; root.appendChild(d); setTimeout(() => d.remove(), 1200);
  }
  function arc(fromEl, toSeat) {
    const svg = $('#hsArc'); const R = root.getBoundingClientRect(); const a = fromEl.getBoundingClientRect(); const b = seatEl(toSeat).querySelector('.hs-av').getBoundingClientRect();
    const x1 = a.left + a.width / 2 - R.left, y1 = a.top + a.height / 2 - R.top, x2 = b.left + b.width / 2 - R.left, y2 = b.top + b.height / 2 - R.top;
    const mx = (x1 + x2) / 2, my = Math.min(y1, y2) - Math.abs(x2 - x1) * 0.25 - 20;
    svg.setAttribute('viewBox', `0 0 ${R.width} ${R.height}`);
    const d = `M${x1},${y1} Q${mx},${my} ${x2},${y2}`;
    svg.innerHTML = `<path class="glow" d="${d}"/><path d="${d}"/><path class="dash" d="${d}"/>`;
  }
  function hit(i, n) {
    const s = state[i]; s.life = Math.max(1, s.life - n);
    const el = $(`[data-life="${i}"]`); el.textContent = s.life; el.classList.add('tick'); setTimeout(() => el.classList.remove('tick'), 300);
    const seat = seatEl(i); seat.classList.remove('hurt'); void seat.offsetWidth; seat.classList.add('hurt');
  }
  function reset() {
    state.forEach((s, i) => { s.life = 40; s.bf = []; $(`[data-bf="${i}"]`).innerHTML = ''; $(`[data-life="${i}"]`).textContent = '40'; });
    state[3].hand = state[3].plays.slice(0, 5); renderHand(3); $('#hsArc').innerHTML = '';
  }

  let running = true, visible = true;
  if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.1 }).observe(root);
  const wait = async (ms) => { if (reduce) return; await sleep(ms); while (!visible || document.hidden) await sleep(400); };

  async function turn(i, round) {
    const s = state[i]; const step = s.plays[(round - 1) * 2 % s.plays.length] ? (round - 1) * 2 : 0;
    setTurn(i, round, 0); await wait(700);
    // draw (visible only for the bottom seat)
    if (i === 3) { let k = 5; while (s.hand.length < 6) s.hand.push(s.plays[(step + k++) % s.plays.length]); renderHand(3); $('#hsHand').lastElementChild?.classList.add('enter'); }
    setTurn(i, round, 1); await wait(600);
    // land
    const land = s.plays[step % s.plays.length];
    if (i === 3) { const k = s.hand.indexOf(land); if (k >= 0) { $('#hsHand').children[k]?.classList.add('leave'); await wait(350); s.hand.splice(k, 1); } }
    placeCard(i, land); if (i === 3) renderHand(3); await wait(900);
    // commander on round 1, otherwise the next play
    const spell = round === 1 ? s.cmdr : s.plays[(step + 1) % s.plays.length];
    if (i === 3 && round > 1) { const k = s.hand.indexOf(spell); if (k >= 0) { $('#hsHand').children[k]?.classList.add('leave'); await wait(350); s.hand.splice(k, 1); renderHand(3); } }
    castFlash(spell); await wait(700); placeCard(i, spell, round === 1 ? 'cmdr' : ''); await wait(900);
    // combat from round 2: the commander swings at the healthiest opponent
    if (round >= 2 && s.bf.length) {
      setTurn(i, round, 2);
      const atk = s.bf.find((c) => c.name === s.cmdr) || s.bf[s.bf.length - 1];
      const target = state.map((t, k) => ({ k, life: t.life })).filter((t) => t.k !== i).sort((a, b) => b.life - a.life)[0].k;
      atk.el.classList.add('attack', 'tapped'); arc(atk.el, target); await wait(900);
      hit(target, 3 + round); await wait(900);
      $('#hsArc').innerHTML = ''; atk.el.classList.remove('attack');
    }
    // occasional instant from someone else in response
    if (round >= 2 && Math.random() < 0.5) { const o = state[(i + 1) % 4]; castFlash(o.spells[0]); await wait(1100); }
    setTurn(i, round, 4); await wait(500);
    if (i === 3) { const b = $('#hsEnd'); b.classList.add('press'); await wait(180); b.classList.remove('press'); }
    s.bf.forEach((c) => c.el.classList.remove('tapped'));
  }

  (async () => {
    try { await fetchCards(all); } catch { /* placeholders stay */ }
    paintAvatars(); reset();
    if (reduce) { // one still frame of a mid-game board
      state.forEach((s, i) => { s.plays.slice(0, 3).forEach((n) => placeCard(i, n)); placeCard(i, s.cmdr); }); setTurn(3, 3, 1); state[1].life = 31; $('[data-life="1"]').textContent = '31'; return;
    }
    while (running) {
      for (let round = 1; round <= 4 && running; round++) for (let i = 0; i < 4 && running; i++) await turn(i, round);
      await wait(1500); reset();
    }
  })();
  return () => { running = false; };
}
