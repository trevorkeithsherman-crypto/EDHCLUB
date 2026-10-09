import { fetchCards, cached, CARD_BACK } from './scryfall.js';
import { DB, buildSample } from './decks.js';
import { FX, SFX, Ambient, setFxState } from './fx.js';
import { net, rememberRoom, recallRoom } from './net.js';
import { makeBot } from './bots.js';
import { online, currentUser, recordGame, setRoomStatus, localName, listDecks, getDeck, saveDeck, deleteDeck, lastDeckId, setLastDeckId } from './supa.js';

/* ---------- Mode from the URL ---------- */
const Q = new URLSearchParams(location.search);
const MODE = Q.get('room') ? 'room' : Q.get('mode') === 'bots' ? 'bots' : 'hotseat';
const ROOM = { code: (Q.get('room') || '').toUpperCase(), host: Q.get('host') === '1', name: Q.get('name') || localName() || 'Planeswalker', seats: clampInt(Q.get('seats'), 2, 4, 4), bots: clampInt(Q.get('bots'), 0, 3, MODE === 'bots' ? 3 : 0), club: Q.get('club') || null };
function clampInt(v, a, b, d) { const n = parseInt(v, 10); return isNaN(n) ? d : Math.max(a, Math.min(b, n)); }
const BOT_NAMES = ['Goblin Bot', 'Sphinx Bot', 'Lich Bot', 'Druid Bot'];
let bot = null;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const KEY = 'edhclub-table-v2';
const PHASES = ['Beginning', 'Main 1', 'Combat', 'Main 2', 'End'];
const SEAT_NAMES = ['Ash', 'Mira', 'Dax', 'Juno'];
const MANA = { W: 'var(--mW)', U: 'var(--mU)', B: 'var(--mB)', R: 'var(--mR)', G: 'var(--mG)', C: 'var(--mC)' };
const HEX = {};
const ZLABEL = { library: 'Library', hand: 'Hand', battlefield: 'Battlefield', graveyard: 'Graveyard', exile: 'Exile', command: 'Command zone', stack: 'Stack' };
const RATIO = 1.397;
const MATS = {
  ember: { name: 'Emberforge', blurb: 'Volcanic stone, rising sparks' },
  tide: { name: 'Tidehollow', blurb: 'Deep water, drifting bubbles' },
  grave: { name: 'Gravewood', blurb: 'Rolling mist, will-o-wisps' },
  sun: { name: 'Sunspire', blurb: 'Warm marble, falling light' },
  wild: { name: 'Wildheart', blurb: 'Forest canopy, fireflies' },
};
const MAT_BY_COLOR = { W: 'sun', U: 'tide', B: 'grave', R: 'ember', G: 'wild' };
const CUSTOM_KEY = 'edhclub-custom-mats';
let customMats = {};
try { customMats = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}'); } catch { customMats = {}; }
function saveCustomMats() { try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(customMats)); return true; } catch { return false; } }
/** Shrink an uploaded image to playmat size and return a JPEG data URL. */
function readMatFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file); const im = new Image();
    im.onload = () => {
      const scale = Math.min(1, 1600 / im.width, 1000 / im.height);
      const cv = document.createElement('canvas'); cv.width = Math.round(im.width * scale); cv.height = Math.round(im.height * scale);
      cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url); resolve(cv.toDataURL('image/jpeg', 0.84));
    };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not an image')); };
    im.src = url;
  });
}

/* ---------- State ---------- */
let S = null;
let modalClose = null, drag = null, lpTimer = 0, ignoreClick = 0, saveT = 0, lastClick = null;
let zoomT = 0, zoomId = null, zoomPending = null;
const mouse = { x: 0, y: 0 };
let backOk = true; // falls back to the EDH Club back if Scryfall's card back can't load
const defaultMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full'; } catch { return 'full'; } };
const emptyZones = () => ({ library: [], hand: [], battlefield: [], graveyard: [], exile: [], command: [] });
function freshState() {
  const n = MODE === 'hotseat' ? 4 : ROOM.seats;
  return {
    v: 2, seats: n,
    players: [0, 1, 2, 3].map((i) => ({ name: SEAT_NAMES[i], life: 40, poison: 0, cmdDmg: {}, out: i >= n, outAt: 0, mulls: 0, deckText: buildSample(i), mat: 'auto', zones: emptyZones(), bot: MODE !== 'hotseat' && i >= n - ROOM.bots && i < n, empty: MODE === 'room' && i < n - ROOM.bots })),
    cards: {}, stack: [], turn: { active: 0, phase: 1, number: 1 }, view: 0, motion: defaultMotion(), sound: false, nextId: 1,
    log: [], attacks: [], outOrder: [], stats: { casts: {}, big: null }, over: false, sel: null, fx: true,
  };
}
const motionMul = () => ({ full: 1, reduced: 0.5, off: 0 }[S.motion] ?? 1);
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const P = (i) => S.players[i];
function log(text) { S.log.unshift({ t: Date.now(), text }); if (S.log.length > 150) S.log.length = 150; }
function toast(text, ms = 2800) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = text; $('#toasts').appendChild(t); setTimeout(() => t.remove(), ms); return t; }
function queueSave() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* ignore */ } }, 250); }

/* ---------- Card data ---------- */
function lookup(name) {
  const k = name.toLowerCase();
  const sf = cached(name);
  if (sf) return { ...sf, known: true };
  const d = DB[k] || DB[k.split(' // ')[0]];
  if (d) return { ...d, known: true };
  return { name, cost: '', type: 'Card', pt: '', colors: '', known: false };
}
function applyEntry(c, e) {
  Object.assign(c, { name: e.name, cost: e.cost, type: e.type || c.type, pt: e.pt, colors: e.colors, img: e.img, big: e.big, backImg: e.backImg, backBig: e.backBig, artist: e.artist });
}
function hydrate() {
  let n = 0;
  for (const c of Object.values(S.cards)) {
    if (c.img || (c.token && !c.copyOf)) continue;
    const e = cached(c.copyOf || c.name);
    if (e) { applyEntry(c, e); if (c.token) c.type = /Token/.test(e.type) ? e.type : 'Token ' + e.type; n++; }
  }
  return n;
}
async function ensureArt(names, { quiet = false } = {}) {
  const need = [...new Set(names)].filter((n) => !cached(n));
  if (!need.length) { if (hydrate()) render(); return; }
  const t = quiet ? null : toast(`Loading card art for ${need.length} card${need.length > 1 ? 's' : ''}…`, 60000);
  try {
    const { missing } = await fetchCards(need);
    t && t.remove();
    hydrate(); render();
    if (missing.length) toast(`Scryfall couldn't find ${missing.length} card${missing.length > 1 ? 's' : ''}: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '…' : ''}. Those show by name.`, 6000);
  } catch {
    t && t.remove();
    if (!quiet) toast("Couldn't reach Scryfall. Cards show by name until it's back.", 5000);
  }
}
const allNames = () => [...new Set(Object.values(S.cards).filter((c) => !c.token).map((c) => c.name))];

/* ---------- Deck parsing ---------- */
function parseDeck(text, cmdOverride) {
  let section = 'deck'; let cmd = []; const main = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const l = raw.trim(); if (!l || l.startsWith('//') || l.startsWith('#')) continue;
    const head = l.replace(/:$/, '').replace(/\s*\(\d+\)$/, '').toLowerCase();
    if (/^(commanders?|deck|main ?deck|mainboard|sideboard|maybeboard|considering|companion|tokens?)$/.test(head)) {
      section = head.startsWith('commander') ? 'cmd' : /^(side|maybe|consid|token|companion)/.test(head) ? 'skip' : 'deck'; continue;
    }
    const m = l.match(/^(\d+)\s*x?\s+(.+)$/i); let n = 1, name = l; if (m) { n = +m[1]; name = m[2]; }
    const isC = /\*cmdr\*|\[[^\]]*commander[^\]]*\]|\^commander/i.test(name);
    name = name.replace(/\s*\*[A-Za-z]+\*\s*/g, ' ').replace(/\s*\[[^\]]*\]\s*/g, ' ').replace(/\s*\^[^^]*\^\s*/g, ' ').replace(/\s+\([A-Za-z0-9]{2,6}\)(\s+[\w★-]+)?\s*$/, '').replace(/\s+/g, ' ').trim();
    if (!name || section === 'skip') continue;
    if (section === 'cmd' || isC) cmd.push(name); else main.push({ n, name });
  }
  if (cmdOverride && cmdOverride.trim()) {
    const nm = cmdOverride.trim(); const hit = main.find((e) => e.name.toLowerCase() === nm.toLowerCase()); if (hit) hit.n--; cmd = [hit ? hit.name : nm];
  }
  if (!cmd.length && main.length) {
    const leg = main.find((e) => /Legendary/.test(lookup(e.name).type) && /(Creature|can be your commander)/.test(lookup(e.name).type));
    if (leg) { cmd.push(leg.name); leg.n--; }
  }
  const list = main.filter((e) => e.n > 0);
  const count = list.reduce((a, e) => a + e.n, 0);
  return { cmd, main: list, count };
}
function makeCard(def, owner) {
  const id = `c${net.active ? net.seat : 'l'}_${S.nextId++}`;
  const c = { id, name: def.name, cost: def.cost || '', type: def.type || 'Card', pt: def.pt || '', colors: def.colors || '', img: def.img || '', big: def.big || '', backImg: def.backImg || '', backBig: def.backBig || '', artist: def.artist || '', owner, controller: owner, zone: 'library', tapped: false, faceDown: false, flipped: false, p1: 0, ctr: 0, token: false, x: 0, y: 0, isCmdr: false, casts: 0 };
  S.cards[id] = c; return c;
}
function shuffleArr(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function purgeOwner(i) {
  Object.values(S.cards).forEach((c) => { if (c.owner === i) delete S.cards[c.id]; });
  S.players.forEach((p) => Object.keys(p.zones).forEach((z) => { p.zones[z] = p.zones[z].filter((id) => S.cards[id]); }));
  S.stack = S.stack.filter((id) => S.cards[id]);
  S.attacks = S.attacks.filter((a) => S.cards[a.id]);
}
function loadDeck(i, text, cmdName) {
  const p = P(i); const d = parseDeck(text, cmdName);
  purgeOwner(i);
  Object.assign(p, { deckText: text, life: 40, poison: 0, cmdDmg: {}, out: false, outAt: 0, mulls: 0, zones: emptyZones() });
  d.cmd.forEach((n) => { const c = makeCard(lookup(n), i); c.isCmdr = true; c.zone = 'command'; p.zones.command.push(c.id); });
  d.main.forEach((e) => { const def = lookup(e.name); for (let k = 0; k < e.n; k++) { const c = makeCard(def, i); p.zones.library.push(c.id); } });
  shuffleArr(p.zones.library);
  const hand = p.zones.library.splice(0, 7); hand.forEach((id) => { S.cards[id].zone = 'hand'; }); p.zones.hand = hand;
  return d;
}
function newGame(keep) {
  const old = S; S = freshState();
  if (keep && old) { S.players.forEach((p, i) => { p.name = old.players[i].name; p.deckText = old.players[i].deckText; }); S.motion = old.motion; S.sound = old.sound; S.view = old.view; }
  setFxState(S);
  S.players.forEach((p, i) => { if (p.bot) p.name = BOT_NAMES[i]; if (i < S.seats && net.isMine(i)) loadDeck(i, p.deckText); });
  if (MODE !== 'hotseat') { const me = net.active && net.seat != null ? net.seat : 0; P(me).name = ROOM.name; P(me).empty = false; }
  log('New game. Everyone shuffled and drew 7.');
}

/* ---------- Card helpers ---------- */
function frame(c) {
  const t = c.type || '';
  if (/Land/.test(t)) {
    const tints = [['Plains', 'W'], ['Island', 'U'], ['Swamp', 'B'], ['Mountain', 'R'], ['Forest', 'G']].filter(([w]) => t.includes(w)).map((x) => x[1]);
    const a = tints[0] || 'C', b = tints[1] || a; return { cls: 'f-land', style: `--b1:${MANA[a]};--b2:${MANA[b]}` };
  }
  const cs = (c.colors || '').split('').filter((k) => MANA[k]);
  if (!cs.length) return { cls: /Artifact/.test(t) ? 'f-art' : 'f-none', style: '' };
  if (cs.length === 1) return { cls: 'f-mono', style: `--b1:${MANA[cs[0]]};--b2:${MANA[cs[0]]}` };
  return { cls: 'f-multi', style: `--b1:${MANA[cs[0]]};--b2:${MANA[cs[1]]}` };
}
const firstColor = (c) => ((c.colors || 'C')[0] || 'C');
const colorHex = (c) => HEX[firstColor(c)] || HEX.C;
const colorsHex = (c) => { const cs = (c.colors || '').split('').filter((k) => HEX[k]); return (cs.length ? cs : ['C']).map((k) => HEX[k]); };
function manaClass(v) {
  const k = v.toLowerCase().replace('/', '');
  if (/^(w|u|b|r|g|c|s|x|y|z|\d+|wu|wb|ub|ur|br|bg|rg|rw|gw|gu|2w|2u|2b|2r|2g|wp|up|bp|rp|gp)$/.test(k)) return 'ms-' + k;
  return null;
}
function pips(cost) {
  if (!cost) return '';
  return (cost.match(/\{[^}]+\}/g) || []).map((t) => { const v = t.slice(1, -1); const m = manaClass(v); return m ? `<i class="ms ${m} ms-cost"></i>` : `<span class="pip">${esc(v)}</span>`; }).join('');
}
function identityPips(i) {
  const cs = [...new Set(commandersOf(i).flatMap((c) => (c.colors || '').split('')))].filter((k) => 'WUBRG'.includes(k));
  const order = 'WUBRG';
  cs.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (!cs.length) return '<span class="pips"><i class="ms ms-c ms-cost"></i></span>';
  return `<span class="pips">${cs.map((k) => `<i class="ms ms-${k.toLowerCase()} ms-cost"></i>`).join('')}</span>`;
}
function ptOf(c) {
  if (!c.pt) return null;
  const m = c.pt.match(/^(\d+|\*)\/(\d+|\*)$/); if (!m || !c.p1) return c.pt;
  const a = m[1] === '*' ? '*' : (+m[1] + c.p1), b = m[2] === '*' ? '*' : (+m[2] + c.p1); return a + '/' + b;
}
function powerOf(c) { const s = ptOf(c); const n = parseInt(s || '0', 10); return isNaN(n) ? 0 : n; }
const isPerm = (c) => !/(Instant|Sorcery)/.test(c.type);
const isCreature = (c) => /Creature/.test(c.type);
const faceSrc = (c, big) => (c.flipped && c.backImg ? (big ? c.backBig : c.backImg) : (big ? c.big : c.img));
function cardHTML(c, o = {}) {
  const hidden = (c.faceDown && !o.reveal) || o.back;
  const f = frame(c);
  const cls = ['card', f.cls, c.tapped && !o.flat ? 'tapped' : '', c.token ? 'token' : '', c.isCmdr ? 'cmdr' : '', S.sel === c.id && !o.noid ? 'sel' : '', o.cls || ''].join(' ');
  const st = (o.style || '') + ';' + f.style;
  const idA = o.noid ? '' : `data-id="${c.id}"`;
  if (hidden) return `<div class="${cls} facedown" ${idA} style="${st}"><div class="ci back ${backOk ? 'pic' : ''}"><span>EC</span>${backOk ? `<img src="${CARD_BACK}" alt="" draggable="false" decoding="async">` : ''}</div></div>`;
  const sg = c.p1 > 0 ? '+' : '';
  const over = `${c.p1 ? `<div class="bp">${sg}${c.p1}/${sg}${c.p1}</div>` : ''}${c.ctr ? `<div class="bc">${c.ctr}</div>` : ''}${c.token ? '<div class="tk">Token</div>' : ''}`;
  const src = faceSrc(c, o.big);
  if (src) {
    const mod = c.p1 && c.pt ? ptOf(c) : null;
    return `<div class="${cls}" ${idA} style="${st}" title="${esc(c.name)}"><div class="ci pic"><img src="${esc(src)}" alt="${esc(c.name)}" draggable="false" decoding="async">${mod ? `<div class="ptm">${esc(mod)}</div>` : ''}${over}</div></div>`;
  }
  const pt = ptOf(c);
  return `<div class="${cls}" ${idA} style="${st}" title="${esc(c.name)}"><div class="ci frame"><div class="band"><span class="cc">${pips(c.cost)}</span></div><div class="cn">${esc(c.name)}</div><div class="art"></div><div class="ct">${esc(c.type)}</div>${pt ? `<div class="cp">${esc(pt)}</div>` : ''}${over}</div></div>`;
}
const cardEl = (id) => $(`#table .card[data-id="${id}"]`);
const lifeEl = (i) => $(`[data-life="${i}"]`);
const seatEl = (i) => $(`.seat[data-seat="${i}"]`);
function visRect(el) { if (!el) return null; const r = el.getBoundingClientRect(); return (r.width > 2 && r.height > 2) ? r : null; }
const pileKey = (c) => (c.zone === 'stack' ? 'stack' : `p${c.controller}-${c.zone}`);
const pileRect = (k) => visRect($(`[data-pile="${k}"]`));
function parseZone(s) { if (s === 'stack') return [-1, 'stack']; const m = s.match(/^p(\d)-(\w+)$/); return m ? [+m[1], m[2]] : [-1, null]; }
const commandersOf = (i) => Object.values(S.cards).filter((c) => c.isCmdr && c.owner === i);
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* ---------- Flight animation ---------- */
function makeGhost(c, size, back) {
  const t = document.createElement('div');
  t.innerHTML = cardHTML(c, { noid: true, back, flat: true, style: `--cw:${size}px` });
  const g = t.firstElementChild; g.classList.add('flyer'); $('#layer').appendChild(g); return g;
}
function fly(c, from, to, o = {}) {
  return new Promise((res) => {
    const m = motionMul(); if (!m || !from || !to) { res(); return; }
    const cardish = (r) => r.height > r.width * 1.15;
    const size = cardish(to) ? to.width : cardish(from) ? from.width : 64;
    const w = size, h = size * RATIO;
    const g = makeGhost(c, size, o.back);
    const x0 = from.left + from.width / 2 - w / 2, y0 = from.top + from.height / 2 - h / 2, x1 = to.left + to.width / 2 - w / 2, y1 = to.top + to.height / 2 - h / 2;
    const s0 = cardish(from) ? clamp(from.width / w, 0.3, 2.2) : 0.45, s1 = cardish(to) ? 1 : 0.45;
    const dist = Math.hypot(x1 - x0, y1 - y0);
    let kf;
    if (m >= 1) {
      const lift = Math.min(150, dist * 0.32), mx = (x0 + x1) / 2, my = Math.min(y0, y1) - lift;
      kf = [
        { transform: `translate(${x0}px,${y0}px) scale(${s0}) rotate(0deg)`, filter: 'none' },
        { transform: `translate(${mx}px,${my}px) scale(${Math.max(s0, s1) * 1.14}) rotate(${o.spin ?? -5}deg)`, filter: o.glow ? `drop-shadow(0 0 18px ${o.glow})` : 'drop-shadow(0 16px 18px rgba(0,0,0,.5))', offset: 0.5 },
        { transform: `translate(${x1}px,${y1}px) scale(${s1}) rotate(0deg)`, filter: 'none' },
      ];
    } else {
      kf = [{ transform: `translate(${x0}px,${y0}px) scale(${s0})`, opacity: 0.4 }, { transform: `translate(${x1}px,${y1}px) scale(${s1})`, opacity: 1 }];
    }
    const dur = (o.dur || Math.min(640, 360 + dist * 0.35)) * (m >= 1 ? 1 : 0.5);
    const an = g.animate(kf, { duration: dur, easing: 'cubic-bezier(.45,.05,.25,1)', fill: 'forwards' });
    const done = () => { g.remove(); res(); }; an.onfinish = done; an.oncancel = done;
  });
}
async function arrive(c, from, kind) {
  const el = cardEl(c.id);
  const to = visRect(el) || pileRect(pileKey(c));
  const back = (c.zone === 'hand' && c.controller !== S.view) || c.zone === 'library' || c.faceDown;
  if (kind === 'commander') { FX.beam(from, colorHex(c)); SFX.play('fanfare'); }
  else if (kind === 'cast') SFX.play('chime', firstColor(c));
  else if (kind !== 'none') SFX.play('whoosh');
  if (kind === 'none' || !motionMul() || !from || !to) { if (kind === 'land') SFX.play('thud'); return; }
  if (el) el.style.visibility = 'hidden';
  await fly(c, from, to, { back, glow: (kind === 'cast' || kind === 'commander') ? colorHex(c) : null });
  const el2 = cardEl(c.id); if (el2) el2.style.visibility = '';
  if (c.zone === 'battlefield' && (kind === 'land' || kind === 'commander')) { FX.slam(el2); FX.dust(visRect(el2)); SFX.play('thud'); }
  else if (c.zone === 'stack') FX.slam(el2, 1.1);
}

/* ---------- Moving cards ---------- */
function detach(c) {
  if (c.zone === 'stack') { S.stack = S.stack.filter((x) => x !== c.id); return; }
  const z = P(c.controller).zones[c.zone]; const k = z.indexOf(c.id); if (k >= 0) z.splice(k, 1);
}
function moveCard(id, pi, zone, o = {}) {
  const c = S.cards[id]; if (!c) return;
  const from = o.fromRect || visRect(cardEl(id)) || pileRect(pileKey(c));
  const fromZone = c.zone;
  detach(c);
  if (c.token && zone !== 'battlefield' && zone !== 'stack') { delete S.cards[id]; S.attacks = S.attacks.filter((a) => a.id !== id); render(); FX.puff(from, colorHex(c)); SFX.play('pop'); return; }
  if (fromZone === 'battlefield' && zone !== 'battlefield') { c.tapped = false; c.p1 = 0; c.ctr = 0; c.faceDown = false; c.flipped = false; S.attacks = S.attacks.filter((a) => a.id !== id); }
  if (fromZone === 'command' && c.isCmdr && (zone === 'stack' || zone === 'battlefield')) c.casts = (c.casts || 0) + 1;
  c.controller = (zone === 'battlefield' || zone === 'stack' || zone === 'hand') ? pi : c.owner;
  c.zone = zone;
  if (zone === 'stack') S.stack.push(id);
  else { const list = P(c.controller).zones[zone]; if (zone === 'library') { o.bottom ? list.push(id) : list.unshift(id); } else list.push(id); }
  render();
  if (zone === 'battlefield') { if (o.x == null) autoPlace(c); else { c.x = o.x; c.y = o.y; } render(); }
  arrive(c, from, o.anim || 'fly');
}
function bfMetrics(pi) {
  const el = $(`[data-zone="p${pi}-battlefield"]`);
  const W = el ? el.clientWidth : 600, H = el ? el.clientHeight : 300;
  const cw = el ? parseFloat(getComputedStyle(el).getPropertyValue('--cw')) || 60 : 60;
  return { fw: (cw + 6) / W, fh: (cw * RATIO) / H };
}
function autoPlace(c) {
  const { fw, fh } = bfMetrics(c.controller);
  const land = /Land/.test(c.type);
  const baseY = land ? clamp(1 - fh - 0.03, 0, 1) : 0.04;
  const others = P(c.controller).zones.battlefield.filter((id) => id !== c.id).map((id) => S.cards[id]).filter((o) => Math.abs(o.y - baseY) < fh * 0.5);
  const maxX = Math.max(0, 1 - fw);
  for (let x = 0.012; x <= maxX + 0.0001; x += fw) { if (!others.some((o) => Math.abs(o.x - x) < fw * 0.92)) { c.x = x; c.y = baseY; return; } }
  const n = others.length; c.x = clamp(((n * fw * 0.33) % maxX) || 0, 0, maxX); c.y = clamp(baseY + (land ? -0.1 : 0.12), 0, Math.max(0, 1 - fh));
}
const ZVERB = { hand: 'returned {c} to hand', graveyard: 'put {c} in the graveyard', exile: 'exiled {c}', library: 'put {c} on top of the library', command: 'returned {c} to the command zone', battlefield: 'put {c} onto the battlefield' };
function moveLog(c, zone, o = {}) { const who = P(S.view).name; let v = ZVERB[zone] || 'moved {c}'; if (zone === 'library' && o.bottom) v = 'put {c} on the bottom of the library'; log(`${who} ${v.replace('{c}', c.faceDown ? 'a card' : c.name)}`); }
function castToStack(id, fromRect) {
  const c = S.cards[id]; if (!c) return;
  const fromCmd = c.zone === 'command'; const who = P(c.controller).name;
  if (/Land/.test(c.type) && !fromCmd) { log(`${who} played ${c.name}`); moveCard(id, c.controller, 'battlefield', { anim: 'land', fromRect }); return; }
  S.stats.casts[c.controller] = (S.stats.casts[c.controller] || 0) + 1;
  if (fromCmd) log(`${who} cast ${c.name} from the command zone (tax ${2 * (c.casts || 0)})`); else log(`${who} cast ${c.name}`);
  if (isPerm(c)) { moveCard(id, c.controller, 'battlefield', { anim: fromCmd ? 'commander' : 'cast', fromRect }); return; }
  // Instants and sorceries: announce, flash the card at the table, then it goes to the graveyard.
  const from = fromRect || visRect(cardEl(id)); const dest = c.isCmdr ? 'command' : 'graveyard';
  S.lastSpell = { id, t: Date.now() };
  spellFlash(c, from);
  moveCard(id, c.owner, dest, { anim: 'none', fromRect: from });
}
function spellFlash(c, from) {
  if (!motionMul() || !from) { SFX.play('chime', firstColor(c)); return; }
  SFX.play('chime', firstColor(c));
  const size = Math.min(220, innerWidth * 0.16); const g = makeGhost(c, size); g.classList.add('spell');
  const x0 = from.left + from.width / 2 - size / 2, y0 = from.top + from.height / 2 - size * RATIO / 2;
  const x1 = innerWidth / 2 - size / 2, y1 = innerHeight * 0.42 - size * RATIO / 2;
  const col = colorHex(c);
  g.animate([
    { transform: `translate(${x0}px,${y0}px) scale(.4)`, opacity: 0 },
    { transform: `translate(${x1}px,${y1}px) scale(1)`, opacity: 1, filter: `drop-shadow(0 0 24px ${col})`, offset: 0.25 },
    { transform: `translate(${x1}px,${y1}px) scale(1.02)`, opacity: 1, filter: `drop-shadow(0 0 30px ${col})`, offset: 0.7 },
    { transform: `translate(${x1}px,${y1 - 40}px) scale(.9)`, opacity: 0, filter: `drop-shadow(0 0 0 ${col})` },
  ], { duration: 1500 * (motionMul() >= 1 ? 1 : 0.5), easing: 'ease-in-out', fill: 'forwards' }).onfinish = () => g.remove();
  FX.burst({ left: innerWidth / 2 - 40, top: innerHeight * 0.42 - 40, width: 80, height: 80 }, [col, css('--gold'), css('--parch')]);
}
function resolveTop() {
  const id = S.stack[S.stack.length - 1]; if (!id) return; const c = S.cards[id];
  if (isPerm(c)) moveCard(id, c.controller, 'battlefield', { anim: 'land' });
  else moveCard(id, c.owner, c.isCmdr ? 'command' : 'graveyard', { anim: 'fly' });
}
function draw(pi, n) {
  const p = P(pi); let k = 0;
  const step = () => {
    if (k >= n) return;
    const id = p.zones.library[0];
    if (!id) { toast(`${p.name}'s library is empty`); return; }
    moveCard(id, pi, 'hand', { anim: 'fly' }); k++;
    if (k < n) setTimeout(step, motionMul() ? 110 : 0);
  };
  step();
  log(`${p.name} drew ${n === 1 ? 'a card' : n + ' cards'}`);
}
function shuffleLib(pi, quiet) { shuffleArr(P(pi).zones.library); SFX.play('shuffle'); FX.shake($(`[data-pile="p${pi}-library"]`)); if (!quiet) { log(`${P(pi).name} shuffled their library`); toast('Library shuffled'); } render(); }
function mulligan(pi) {
  const p = P(pi); p.zones.hand.forEach((id) => { S.cards[id].zone = 'library'; p.zones.library.push(id); }); p.zones.hand = [];
  shuffleArr(p.zones.library); p.mulls++; render(); SFX.play('shuffle');
  setTimeout(() => draw(pi, 7), motionMul() ? 200 : 0);
  toast(p.mulls === 1 ? 'Free mulligan. You draw 7.' : `Mulligan ${p.mulls}: put ${p.mulls - 1} card${p.mulls > 2 ? 's' : ''} on the bottom.`);
  log(`${p.name} took mulligan ${p.mulls}`);
}
function toggleTap(c) { c.tapped = !c.tapped; const el = cardEl(c.id); if (el) el.classList.toggle('tapped', c.tapped); SFX.play('tick'); queueSave(); requestAnimationFrame(drawArrows); }
function counter(c, key, d) { c[key] = key === 'ctr' ? Math.max(0, (c[key] || 0) + d) : (c[key] || 0) + d; render(); FX.bounce(cardEl(c.id)?.querySelector(key === 'ctr' ? '.bc' : '.bp')); SFX.play('tick'); }
function createTokens(pi, def, count) {
  const p = P(pi); let k = 0;
  const step = () => {
    const c = makeCard(def, pi); c.token = true; c.copyOf = def.copyOf || null; c.zone = 'battlefield'; p.zones.battlefield.push(c.id);
    render(); autoPlace(c); render();
    const el = cardEl(c.id); FX.pop(el); FX.puff(visRect(el), colorHex(c)); SFX.play('pop');
    if (++k < count) setTimeout(step, motionMul() ? 110 : 0);
  };
  step(); log(`${p.name} created ${count} ${def.name} token${count > 1 ? 's' : ''}`);
}
function attack(c, t) {
  const ex = S.attacks.find((a) => a.id === c.id); if (ex) { ex.target = t; ex.t = Date.now(); } else S.attacks.push({ id: c.id, target: t, t: Date.now() });
  if (S.turn.phase !== 2) S.turn.phase = 2; c.tapped = true; render();
  FX.lunge(cardEl(c.id), visRect(lifeEl(t))); SFX.play('charge'); log(`${c.name} attacks ${P(t).name}`);
}
function combatDamage(c, t) {
  const n = powerOf(c); if (n <= 0) { toast(`${c.name} has no power to deal damage`); return; }
  S.attacks = S.attacks.filter((a) => a.id !== c.id);
  if (!net.isMine(t)) { render(); request(t, 'combat', c.id); return; }
  REQ.combat(t, c.id);
}
function changeLife(i, d, o = {}) {
  const p = P(i); if (!d) return; p.life += d;
  const amt = Math.abs(d);
  if (!o.manual && amt > (S.stats.big?.amt || 0)) S.stats.big = { amt, text: o.src ? `${o.src.name} hit ${p.name} for ${amt}` : `${p.name} ${d < 0 ? 'lost' : 'gained'} ${amt} life at once` };
  render();
  FX.floatNum(lifeEl(i), d);
  if (d < 0) { FX.shake(seatEl(i)); SFX.play('hit'); } else SFX.play('heal');
  checkOut(i);
}
function checkOut(i) {
  const p = P(i); if (p.out) return;
  const cmd = Math.max(0, ...Object.values(p.cmdDmg));
  let why = null;
  if (p.life <= 0) why = 'life reached 0'; else if (p.poison >= 10) why = '10 poison counters'; else if (cmd >= 21) why = '21 commander damage';
  if (why) eliminate(i, why);
}
function eliminate(i, why) {
  const p = P(i); p.out = true; p.outAt = Date.now();
  S.outOrder.push({ i, why, round: S.turn.number });
  S.attacks = S.attacks.filter((a) => a.target !== i);
  log(`${p.name} is out: ${why}`); SFX.play('gong'); render(); FX.shake(seatEl(i), true);
  const alive = S.players.map((_, k) => k).filter((k) => k < (S.seats || 4) && !P(k).out);
  if (alive.length === 1) setTimeout(() => win(alive[0]), motionMul() ? 1100 : 0);
  else if (S.turn.active === i) passTurn();
}
function win(i, fromRemote) {
  if (S.over && !fromRemote) return;
  S.over = true;
  if (net.active && net.isHost && !fromRemote) { setRoomStatus(ROOM.code, 'finished'); recordGame({ code: ROOM.code, clubId: ROOM.club, winnerName: P(i).name, players: S.players.slice(0, S.seats).map((p, k) => ({ name: p.name, commander: commandersOf(k).map((c) => c.name).join(' + '), bot: !!p.bot })), rounds: S.turn.number }); } const cols = []; commandersOf(i).forEach((c) => colorsHex(c).forEach((h) => cols.push(h))); cols.push(css('--candle'), css('--parch'));
  FX.confetti(cols); SFX.play('victory'); log(`${P(i).name} wins the game`); render();
  const total = Object.values(S.stats.casts).reduce((a, b) => a + b, 0);
  const ccasts = S.players.map((p, k) => `${esc(p.name)} ${commandersOf(k).reduce((a, c) => a + (c.casts || 0), 0)}`).join(' · ');
  const cm = commandersOf(i)[0];
  openModal(`<div class="recap"><div class="eyebrow">Game over · Round ${S.turn.number}</div><h2>${esc(P(i).name)} wins</h2><p>with ${esc(commandersOf(i).map((c) => c.name).join(' + ') || 'their deck')}</p>
  ${cm && cm.img ? `<div class="closer" style="margin:6px 0 12px"><img src="${esc(cm.big || cm.img)}" alt="${esc(cm.name)}" style="width:min(220px,60%)"></div>` : ''}
  <dl class="stats"><div><dt>Biggest swing</dt><dd>${esc(S.stats.big?.text || 'No big hits this game')}</dd></div><div><dt>Spells cast</dt><dd>${total}</dd></div><div><dt>Commander casts</dt><dd>${ccasts}</dd></div></dl>
  <div class="eyebrow">Knocked out</div><ol class="outs">${S.outOrder.map((o) => `<li><b>${esc(P(o.i).name)}</b>, ${esc(o.why)}, round ${o.round}</li>`).join('')}</ol>
  <div class="row"><button type="button" class="btn ghost" data-act="close">Look at the board</button><button type="button" class="btn" data-act="again">Play again</button></div></div>`);
}
function passTurn() {
  S.attacks = [];
  let n = S.turn.active;
  const ns = S.seats || 4;
  for (let k = 1; k <= ns; k++) { const c = (S.turn.active + k) % ns; if (!P(c).out && !P(c).empty) { n = c; break; } }
  if (n <= S.turn.active) S.turn.number++;
  S.turn.active = n; S.turn.phase = 0;
  const p = P(n); const tapped = p.zones.battlefield.filter((id) => S.cards[id].tapped);
  tapped.forEach((id) => { S.cards[id].tapped = false; cardEl(id)?.classList.remove('tapped'); });
  if (tapped.length) SFX.play('tick');
  log(`${p.name}'s turn`);
  banner(`${p.name}'s turn`, `Round ${S.turn.number}`, n);
  setTimeout(() => { S.turn.phase = 1; render(); draw(n, 1); }, tapped.length && motionMul() ? 300 : 0);
}
function nextPhase() { if (S.turn.phase >= PHASES.length - 1) { passTurn(); return; } if (S.turn.phase === 2) S.attacks = []; S.turn.phase++; render(); }
function wipe(kind) { if (net.active) net.send('all', { fn: 'wipe', kind }); wipeLocal(kind); }
function wipeLocal(kind) {
  const victims = [];
  S.players.forEach((p, k) => net.isMine(k) && p.zones.battlefield.forEach((id) => { const c = S.cards[id]; if (kind === 'creatures' ? isCreature(c) : !/Land/.test(c.type)) victims.push(c); }));
  if (!victims.length) { if (!net.active) toast('Nothing on the battlefield to destroy'); return; }
  SFX.play('shatter');
  victims.forEach((c) => { const el = cardEl(c.id); const r = visRect(el); if (r && motionMul()) { FX.shatter(r, colorsHex(c)); el.style.transition = 'opacity .14s'; el.style.opacity = '0'; } });
  setTimeout(() => {
    victims.forEach((c) => { if (S.cards[c.id]) moveCard(c.id, c.owner, c.isCmdr ? 'command' : 'graveyard', { anim: 'none' }); });
    log(`Board wipe: ${victims.length} permanent${victims.length > 1 ? 's' : ''} destroyed${victims.some((c) => c.isCmdr) ? ' (commanders went to the command zone)' : ''}`); render();
  }, motionMul() ? 280 : 0);
}

/* ---------- Room sync ---------- */
const CARD_FIELDS = ['id', 'name', 'cost', 'type', 'pt', 'colors', 'owner', 'controller', 'zone', 'tapped', 'faceDown', 'flipped', 'p1', 'ctr', 'token', 'copyOf', 'x', 'y', 'isCmdr', 'casts'];
function seatSnap(i) {
  const p = P(i);
  const cards = Object.values(S.cards).filter((c) => c.owner === i).map((c) => { const o = {}; CARD_FIELDS.forEach((k) => { if (c[k] !== undefined) o[k] = c[k]; }); return o; });
  return { seat: i, player: { name: p.name, life: p.life, poison: p.poison, cmdDmg: p.cmdDmg, out: p.out, outAt: p.outAt, mulls: p.mulls, mat: p.mat, bot: p.bot, empty: false }, zones: p.zones, cards };
}
function sharedSnap() { return { turn: S.turn, stack: S.stack, attacks: S.attacks, over: S.over, outOrder: S.outOrder, stats: S.stats, log: S.log.slice(0, 40) }; }
function applySeat(snap) {
  const i = snap.seat; if (net.isMine(i)) return;
  const p = P(i); Object.assign(p, snap.player); p.zones = snap.zones;
  Object.values(S.cards).forEach((c) => { if (c.owner === i) delete S.cards[c.id]; });
  snap.cards.forEach((c) => { S.cards[c.id] = { img: '', big: '', backImg: '', backBig: '', artist: '', ...c }; });
  hydrate();
  if (!drag) render();
  ensureArt(snap.cards.filter((c) => !c.token).map((c) => c.name), { quiet: true });
}
function applyShared(sn) {
  S.turn = sn.turn; S.stack = sn.stack; S.attacks = sn.attacks; S.outOrder = sn.outOrder; S.stats = sn.stats;
  const was = S.over; S.over = sn.over;
  if (sn.log && sn.log[0] && (!S.log[0] || S.log[0].t < sn.log[0].t)) S.log = sn.log;
  if (!drag) render();
  if (S.over && !was) { const alive = S.players.map((_, k) => k).filter((k) => k < S.seats && !P(k).out); if (alive.length === 1) win(alive[0], true); }
}
function request(to, fn, ...args) {
  if (net.isMine(to)) { REQ[fn](to, ...args); return; }
  net.send('req', { to, fn, args });
}
const REQ = {
  changeLife: (to, d, src) => changeLife(to, d, { src: src ? S.cards[src] : null }),
  poison: (to, d) => { const p = P(to); p.poison = Math.max(0, p.poison + d); render(); if (d > 0) { SFX.play('hit'); FX.shake(seatEl(to)); } checkOut(to); },
  cmdDmg: (to, cardId, d) => { const p = P(to); const cur = p.cmdDmg[cardId] || 0; const nv = Math.max(0, cur + d); if (nv !== cur) { p.cmdDmg[cardId] = nv; changeLife(to, -(nv - cur), { src: S.cards[cardId] }); } },
  combat: (to, cardId) => { const c = S.cards[cardId]; if (!c) return; const n = powerOf(c); if (n <= 0) return; const p = P(to); if (c.isCmdr) p.cmdDmg[c.id] = (p.cmdDmg[c.id] || 0) + n; log(`${c.name} dealt ${n} damage to ${p.name}`); changeLife(to, -n, { src: c }); },
};
const ALL = {
  wipe: (kind) => wipeLocal(kind),
  newGame: () => { newGame(true); render(); },
  attackEnd: (cardId) => { S.attacks = S.attacks.filter((a) => a.id !== cardId); },
};
function maybeBot() {
  if (!bot || S.over) return;
  const i = S.turn.active; const p = P(i);
  if (!p.bot || !net.isMine(i) || bot.busy || p.out) return;
  if (!bot.scheduled) { bot.scheduled = true; setTimeout(() => { bot.scheduled = false; if (P(S.turn.active).bot && !S.over) bot.takeTurn(S.turn.active); }, 600); }
}

/* ---------- Rendering ---------- */
function matOf(i) {
  const p = P(i);
  if (p.mat === 'custom' && customMats[i]) return 'custom';
  if (p.mat && p.mat !== 'auto' && MATS[p.mat]) return p.mat;
  const c = commandersOf(i)[0]; const col = c ? (c.colors || '')[0] : '';
  return MAT_BY_COLOR[col] || ['wild', 'tide', 'grave', 'sun'][i % 4];
}
const others = () => [1, 2, 3].map((k) => (S.view + k) % 4).filter((k) => k < (S.seats || 4));
function seatHTML(i, full) {
  const p = P(i); const active = S.turn.active === i;
  const cmdNames = commandersOf(i).map((c) => c.name).join(' + ');
  const maxCmd = Math.max(0, ...Object.values(p.cmdDmg));
  const warn = maxCmd >= 15 || p.poison >= 7;
  const bf = p.zones.battlefield.map((id) => { const c = S.cards[id]; return cardHTML(c, { style: `left:${(c.x * 100).toFixed(2)}%;top:${(c.y * 100).toFixed(2)}%` }); }).join('');
  const mp = (z, label, n) => `<button type="button" class="mp" data-act="pile" data-zone="p${i}-${z}" data-pile="p${i}-${z}">${label} <b>${n}</b></button>`;
  const head = `<div class="seat-h">
    <button type="button" class="pname" data-act="seatmenu" data-p="${i}"><span>${esc(p.name)}</span>${identityPips(i)}</button>
    ${p.out ? '<span class="outtag">Out</span>' : ''}${p.bot ? '<span class="chip" title="Practice bot">Bot</span>' : ''}${p.empty ? '<span class="chip">Waiting for a player…</span>' : ''}
    <span class="cmdn">${esc(cmdNames)}</span>
    <div class="life" data-life="${i}"><button type="button" data-act="life" data-p="${i}" data-d="-1" aria-label="${esc(p.name)} loses 1 life" title="Shift-click for 5">−</button><span class="lv">${p.life}</span><button type="button" data-act="life" data-p="${i}" data-d="1" aria-label="${esc(p.name)} gains 1 life" title="Shift-click for 5">+</button></div>
    <button type="button" class="chip ${warn ? 'warn' : ''}" data-act="dmg" data-p="${i}">Cmdr ${maxCmd} · Poison ${p.poison}</button>
    ${full ? '' : `<div class="minipiles">${mp('hand', 'Hand', p.zones.hand.length)}${mp('library', 'Library', p.zones.library.length)}${mp('graveyard', 'Graveyard', p.zones.graveyard.length)}${mp('exile', 'Exile', p.zones.exile.length)}${mp('command', 'Command', p.zones.command.length)}</div>`}
  </div>`;
  const crack = p.out ? `<svg class="crack ${Date.now() - p.outAt < 1200 ? 'fresh' : ''}" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M52 0 L47 22 L58 35 L44 55 L55 72 L49 100"/><path d="M47 22 L30 30 L18 26"/><path d="M58 35 L76 40 L90 33"/><path d="M44 55 L26 62 L12 74"/><path d="M55 72 L72 80 L86 92"/></svg>` : '';
  const empty = p.zones.battlefield.length ? '' : `<div class="bf-empty">${full ? 'Drag cards here to play them. Lands sit along the bottom.' : 'No permanents yet'}</div>`;
  let dock = '';
  if (full) {
    const slot = (z, label) => {
      const list = p.zones[z]; let inner;
      if (z === 'library') inner = list.length ? `<div class="card"><div class="ci back stackback ${backOk ? 'pic' : ''}"><span>EC</span>${backOk ? `<img src="${CARD_BACK}" alt="" draggable="false">` : ''}</div></div>` : '<span class="empty">Empty</span>';
      else inner = list.length ? cardHTML(S.cards[list[list.length - 1]]) : `<span class="empty">${z === 'command' ? 'None' : 'Empty'}</span>`;
      const tax = z === 'command' ? commandersOf(i).filter((c) => c.zone === 'command').map((c) => `<span class="tax">Tax +${2 * (c.casts || 0)}</span>`).join('') : '';
      return `<div class="pile" data-zone="p${i}-${z}" data-pile="p${i}-${z}"><button type="button" class="pl" data-act="pile" data-zone="p${i}-${z}">${label} <b>${list.length}</b></button><div class="slot" data-act="pileclick" data-zone="p${i}-${z}" title="${z === 'library' ? 'Click to draw. Right-click for more.' : ''}">${inner}</div>${tax}</div>`;
    };
    const hand = p.zones.hand.map((id) => cardHTML(S.cards[id])).join('') || '<span class="hand-empty">Your hand is empty</span>';
    dock = `<div class="dock"><div class="piles">${slot('command', 'Command')}${slot('library', 'Library')}${slot('graveyard', 'Graveyard')}${slot('exile', 'Exile')}</div>
      <div class="handwrap"><div class="handbar"><span>Hand · ${p.zones.hand.length}</span><span class="sp"></span><button type="button" class="btn ghost sm" data-act="draw" data-p="${i}">Draw</button><button type="button" class="btn ghost sm" data-act="mull" data-p="${i}">Mulligan</button></div>
      <div class="hand" data-zone="p${i}-hand" data-pile="p${i}-hand">${hand}</div></div></div>`;
  }
  const mat = matOf(i); const matStyle = mat === 'custom' ? ` style="background-image:var(--grain),url(${customMats[i]})"` : '';
  const labels = full ? '<span class="zl top">Battlefield</span><span class="zl bot">Lands</span>' : '';
  return `<div class="seat ${active ? 'active' : ''} ${p.out ? 'out' : ''}" data-seat="${i}" data-mat="${mat}"${matStyle}>${head}<div class="bf" data-zone="p${i}-battlefield">${labels}${empty}${bf}</div>${dock}${crack}</div>`;
}
function renderTurn() { $('#turn').innerHTML = ''; }
function renderMid() {
  const p = P(S.turn.active); const mine = net.isMine(S.turn.active);
  const last = S.log[0] ? S.log[0].text : 'Game log';
  $('#mid').innerHTML = `<div class="turnbar ${mine ? 'mine' : ''}">
    <div class="tb-who"><span class="tn">Round ${S.turn.number}</span><span class="who">${identityPips(S.turn.active)}${esc(p.name)}'s turn</span></div>
    <div class="phases" role="group" aria-label="Phase">${PHASES.map((ph, k) => `<button type="button" class="ph ${k === S.turn.phase ? 'on' : ''}" data-act="phase" data-k="${k}">${ph}</button>`).join('')}</div>
    <div class="tb-act"><button type="button" class="btn sm" data-act="next">Next phase</button><button type="button" class="btn ghost sm" data-act="pass">Pass turn</button></div>
    <div class="midtools"><button type="button" class="btn ghost sm" data-act="token">Token</button><button type="button" class="btn ghost sm" data-act="wipe">Board wipe</button><button type="button" class="btn ghost sm" data-act="d20">Roll d20</button><button type="button" class="ticker" data-act="log" title="Open the game log">${esc(last)}</button></div>
  </div>`;
}
function syncTools() {
  $('#viewSel').closest('label').hidden = MODE !== 'hotseat';
  $('#viewSel').innerHTML = S.players.map((p, i) => `<option value="${i}" ${i === S.view ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  $('#motionSel').value = S.motion;
  const sb = $('#soundBtn'); sb.textContent = S.sound ? 'Sound on' : 'Sound off'; sb.setAttribute('aria-pressed', String(S.sound));
  const fb = $('#fxBtn'); fb.textContent = S.fx ? 'Effects on' : 'Effects off'; fb.setAttribute('aria-pressed', String(S.fx));
}
function render() {
  renderTurn();
  $('#opps').innerHTML = others().map((i) => seatHTML(i, false)).join('');
  $('#me').innerHTML = seatHTML(S.view, true);
  renderMid(); syncTools(); fanHand();
  $('#opps').style.gridTemplateColumns = `repeat(${Math.max(1, (S.seats || 4) - 1)}, minmax(0, 1fr))`;
  sizeBattlefields(); Ambient.sync();
  net.queueSync(seatSnap, sharedSnap);
  if (net.active && net.ready) rememberRoom(ROOM.code, { seat: net.seat, clientId: undefined, ...recallRoom(ROOM.code), mine: net.ownedSeats().map(seatSnap), shared: sharedSnap(), deck: { id: P(net.seat).deckId, name: P(net.seat).deckName } });
  maybeBot();
  if (zoomId && !S.cards[zoomId]) hideZoom();
  requestAnimationFrame(drawArrows); queueSave();
}
// Lay the hand out as a fan: overlapping, rotated around a pivot below the cards.
function fanHand() {
  const hand = $('.me .hand'); if (!hand) return;
  const cards = $$('.card', hand); const n = cards.length; if (!n) return;
  const cw = cards[0].offsetWidth || 100;
  const avail = Math.max(cw, hand.clientWidth - 24);
  const step = n > 1 ? Math.min(cw * 0.72, (avail - cw) / (n - 1)) : 0;
  const spread = Math.min(26, 3.2 * (n - 1));
  hand.style.setProperty('--fan-h', `${cw * RATIO + 24 + spread * 1.2}px`);
  const x0 = Math.max(12, (hand.clientWidth - ((n - 1) * step + cw)) / 2);
  cards.forEach((el, i) => {
    const t = n > 1 ? i / (n - 1) - 0.5 : 0;
    const rot = t * spread; const lift = Math.abs(t) * Math.abs(t) * spread * 1.6;
    el.style.left = `${x0 + i * step}px`; el.style.setProperty('--rot', `${rot.toFixed(2)}deg`); el.style.setProperty('--lift', `${lift.toFixed(1)}px`); el.style.zIndex = i + 1;
  });
}
// Size battlefield cards so two rows (spells on top, lands below) always fit the mat.
function sizeBattlefields() {
  $$('.bf').forEach((el) => {
    const h = el.clientHeight; if (!h) return;
    const max = el.closest('.opps') ? Math.round(Math.min(80, Math.max(40, innerWidth * 0.048, innerHeight * 0.075))) : Math.round(Math.min(130, Math.max(56, Math.min(innerWidth * 0.075, innerHeight * 0.13))));
    el.style.setProperty('--cw', Math.max(30, Math.min(max, Math.floor((h * 0.45) / RATIO))) + 'px');
  });
}
function drawArrows() {
  const svg = $('#arrows'); const W = innerWidth, H = innerHeight; svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  let out = '<defs><marker id="ah" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path class="ahp" d="M0,0 L10,5 L0,10 z"/></marker></defs>';
  S.attacks.forEach((a) => {
    const r1 = visRect(cardEl(a.id)), r2 = visRect(lifeEl(a.target)); if (!r1 || !r2) return;
    const x1 = r1.left + r1.width / 2, y1 = r1.top + r1.height / 2, x2 = r2.left + r2.width / 2, y2 = r2.top + r2.height + 4;
    const mx = (x1 + x2) / 2 + (y2 - y1) * 0.12, my = (y1 + y2) / 2 - Math.abs(x2 - x1) * 0.12 - 30;
    const fresh = Date.now() - a.t < 700 && motionMul();
    out += `<path class="arw ${fresh ? 'fresh' : ''}" d="M${x1},${y1} Q${mx},${my} ${x2},${y2}" marker-end="url(#ah)"/>`;
  });
  svg.innerHTML = out;
}

function banner(text, sub, pi) {
  if (!motionMul()) return;
  $$('.banner').forEach((b) => b.remove());
  const b = document.createElement('div'); b.className = 'banner';
  const c = commandersOf(pi)[0]; b.style.setProperty('--bc', c ? colorHex(c) : css('--candle'));
  b.innerHTML = `<span>${esc(text)}<small>${esc(sub)}</small></span>`;
  $('#layer').appendChild(b); setTimeout(() => b.remove(), 1700);
}

/* ---------- Zoom ---------- */
const canSee = (c) => c && !(c.zone === 'hand' && c.controller !== S.view) && c.zone !== 'library' && !(c.faceDown && c.controller !== S.view);
function showZoom(id) {
  const c = S.cards[id]; if (!canSee(c)) { hideZoom(); return; }
  const z = $('#zoom'); const w = innerWidth < 760 ? 220 : 300;
  const src = faceSrc(c, true);
  const meta = `<b>${esc(c.flipped && c.backImg ? c.name.split(' // ')[1] || c.name : c.name)}</b><br><span>${esc(P(c.owner).name)} · ${ZLABEL[c.zone]}${c.isCmdr ? ` · Tax +${2 * (c.casts || 0)}` : ''}${c.tapped ? ' · Tapped' : ''}${c.artist ? ` · Illus. ${esc(c.artist)}` : ''}</span>`;
  z.innerHTML = (src ? `<img src="${esc(src)}" alt="${esc(c.name)}">` : cardHTML(c, { noid: true, flat: true, reveal: true, cls: 'big', style: `--cw:${w}px` })) + `<div class="zmeta">${meta}</div>`;
  z.hidden = false; zoomId = id; placeZoom();
}
function placeZoom() {
  const z = $('#zoom'); if (z.hidden) return;
  const w = z.offsetWidth, h = z.offsetHeight;
  let x = mouse.x + 28; if (x + w > innerWidth - 8) x = mouse.x - 28 - w;
  const y = clamp(mouse.y - h / 2, 8, Math.max(8, innerHeight - h - 8));
  z.style.left = Math.max(8, x) + 'px'; z.style.top = y + 'px';
}
function hideZoom() { clearTimeout(zoomT); zoomId = null; zoomPending = null; const z = $('#zoom'); z.hidden = true; z.innerHTML = ''; }
function closerModal(c) {
  const src = faceSrc(c, true);
  openModal(`<div class="closer">${src ? `<img src="${esc(src)}" alt="${esc(c.name)}">` : cardHTML(c, { noid: true, flat: true, reveal: true, cls: 'big', style: '--cw:300px' })}</div>${c.artist ? `<p style="text-align:center;margin-top:10px">Illustrated by ${esc(c.artist)}</p>` : ''}<div class="row" style="justify-content:center"><button type="button" class="btn" data-act="close">Close</button></div>`, { cls: 'narrow' });
}

/* ---------- Menus ---------- */
function openMenu(items, x, y, title) {
  hideZoom();
  const m = $('#menu');
  m.innerHTML = (title ? `<div class="mh">${esc(title)}</div>` : '') + items.map((it, k) => (it.sep ? '<hr>' : `<button type="button" class="mi ${it.hot ? 'hot' : ''}" data-mi="${k}">${esc(it.label)}</button>`)).join('');
  m.hidden = false; m.style.left = '0px'; m.style.top = '0px';
  const r = m.getBoundingClientRect();
  m.style.left = clamp(x, 8, innerWidth - r.width - 8) + 'px'; m.style.top = clamp(y, 8, innerHeight - r.height - 8) + 'px';
  m.onclick = (e) => { const b = e.target.closest('[data-mi]'); if (!b) return; closeMenu(); items[+b.dataset.mi].fn(); };
  m.querySelector('.mi')?.focus({ preventScroll: true });
}
function closeMenu() { const m = $('#menu'); if (!m.hidden) { m.hidden = true; m.innerHTML = ''; } }
function cardMenu(c, x, y) {
  const items = []; const add = (label, fn, o = {}) => items.push({ label, fn, ...o }); const sep = () => items.push({ sep: true });
  const mv = (z, o = {}) => () => { moveLog(c, z, o); moveCard(c.id, c.owner, z, o); };
  if (!net.isMine(c.controller)) {
    if (canSee(c)) add('Look closer', () => closerModal(c));
    openMenu(items.length ? items : [{ label: 'Not your card', fn: () => {} }], x, y, `${P(c.controller).name}'s card`); return;
  }
  if (canSee(c)) { add('Look closer', () => closerModal(c)); sep(); }
  if (c.zone === 'battlefield') {
    add(c.tapped ? 'Untap' : 'Tap', () => toggleTap(c));
    if (c.backImg) add(c.flipped ? 'Transform to front' : 'Transform', () => { c.flipped = !c.flipped; render(); FX.slam(cardEl(c.id), 1.08); SFX.play('whoosh'); });
    if (isCreature(c)) {
      const at = S.attacks.find((a) => a.id === c.id);
      if (at) add(`Deal ${powerOf(c)} combat damage to ${P(at.target).name}`, () => combatDamage(c, at.target), { hot: true });
      S.players.forEach((p, k) => { if (k !== c.controller && !p.out) add(`Attack ${p.name}`, () => attack(c, k)); });
    }
    sep();
    add('+1/+1 counter', () => counter(c, 'p1', 1)); add('−1/−1 counter', () => counter(c, 'p1', -1));
    add('Add a counter', () => counter(c, 'ctr', 1)); if (c.ctr) add('Remove a counter', () => counter(c, 'ctr', -1));
    add(c.faceDown ? 'Turn face up' : 'Turn face down', () => { c.faceDown = !c.faceDown; render(); });
    add('Copy as token', () => createTokens(c.controller, { name: c.name, cost: '', type: /Token/.test(c.type) ? c.type : 'Token ' + c.type, pt: c.pt, colors: c.colors, img: c.img, big: c.big, backImg: c.backImg, backBig: c.backBig, artist: c.artist, copyOf: c.name }, 1));
    sep();
    add('Return to hand', mv('hand')); add('Put in graveyard', mv('graveyard')); add('Exile', mv('exile'));
    add('Put on top of library', mv('library')); add('Put on bottom of library', mv('library', { bottom: true }));
    if (c.isCmdr) add('Return to command zone', mv('command'));
  } else if (c.zone === 'hand') {
    add(/Land/.test(c.type) ? 'Play land' : 'Cast', () => castToStack(c.id), { hot: true });
    add('Put onto battlefield', () => { moveLog(c, 'battlefield'); moveCard(c.id, c.controller, 'battlefield', { anim: 'land' }); });
    add('Reveal to the table', () => { toast(`${P(c.controller).name} reveals ${c.name}`); log(`${P(c.controller).name} revealed ${c.name}`); });
    sep(); add('Discard', mv('graveyard')); add('Exile', mv('exile'));
    add('Put on top of library', mv('library')); add('Put on bottom of library', mv('library', { bottom: true }));
  } else if (c.zone === 'stack') {
    if (S.stack[S.stack.length - 1] === c.id) add('Resolve', resolveTop, { hot: true });
    add('Counter it', () => { log(`${c.name} was countered`); moveCard(c.id, c.owner, c.isCmdr ? 'command' : 'graveyard'); });
    add('Return to hand', mv('hand'));
  } else if (c.zone === 'command') {
    add(`Cast ${c.name} (tax +${2 * (c.casts || 0)})`, () => castToStack(c.id), { hot: true });
    add('Put onto battlefield', () => { moveLog(c, 'battlefield'); moveCard(c.id, c.owner, 'battlefield', { anim: 'commander' }); });
  } else {
    add('Return to hand', mv('hand')); add('Put onto battlefield', () => { moveLog(c, 'battlefield'); moveCard(c.id, c.owner, 'battlefield', { anim: 'land' }); });
    if (c.zone !== 'exile') add('Exile', mv('exile')); if (c.zone !== 'graveyard') add('Put in graveyard', mv('graveyard'));
    add('Put on top of library', mv('library'));
    if (c.isCmdr) add('Return to command zone', mv('command'));
    add(`View ${ZLABEL[c.zone].toLowerCase()}`, () => openZone(c.owner, c.zone));
  }
  openMenu(items, x, y, c.faceDown && c.controller !== S.view ? 'Face-down card' : c.name);
}
function libraryMenu(pi, x, y) {
  const p = P(pi);
  openMenu([
    { label: 'Draw a card', fn: () => draw(pi, 1), hot: true }, { label: 'Draw 7', fn: () => draw(pi, 7) }, { sep: true },
    { label: 'Shuffle', fn: () => shuffleLib(pi) },
    { label: 'Mill 1', fn: () => { const id = p.zones.library[0]; if (id) { log(`${p.name} milled ${S.cards[id].name}`); moveCard(id, pi, 'graveyard'); } } },
    { label: 'Look at the top 3', fn: () => openZone(pi, 'library', { top: 3 }) },
    { label: 'Search library', fn: () => openZone(pi, 'library', { search: true }) },
    { label: 'Reveal the top card', fn: () => { const id = p.zones.library[0]; if (id) { toast(`Top of ${p.name}'s library: ${S.cards[id].name}`); log(`${p.name} revealed ${S.cards[id].name} from the top of their library`); } } },
  ], x, y, `${p.name}'s library`);
}
function commandMenu(pi, x, y) {
  const cs = commandersOf(pi).filter((c) => c.zone === 'command');
  if (!cs.length) { toast(`${P(pi).name}'s commander is not in the command zone`); return; }
  const items = []; cs.forEach((c) => { items.push({ label: `Cast ${c.name} (tax +${2 * (c.casts || 0)})`, fn: () => castToStack(c.id), hot: true }); items.push({ label: `Put ${c.name} onto battlefield`, fn: () => moveCard(c.id, pi, 'battlefield', { anim: 'commander' }) }); });
  openMenu(items, x, y, 'Command zone');
}
function seatMenu(pi, x, y) {
  const p = P(pi);
  if (!net.isMine(pi)) { openMenu([{ label: `${p.name}'s seat`, fn: () => {} }], x, y, p.name); return; }
  openMenu([
    ...(MODE === 'hotseat' && pi !== S.view ? [{ label: `Play as ${p.name}`, fn: () => { S.view = pi; S.sel = null; render(); }, hot: true }] : []),
    { label: 'Choose playmat', fn: () => matModal(pi) },
    { label: 'Rename', fn: () => renameModal(pi) },
    { label: 'Import a deck for this seat', fn: () => importModal(pi) },
    { label: 'Reset life to 40', fn: () => { p.life = 40; render(); } },
    { label: p.out ? 'Rejoin the game' : 'Concede', fn: () => { if (p.out) { p.out = false; S.outOrder = S.outOrder.filter((o) => o.i !== pi); log(`${p.name} rejoined`); render(); } else eliminate(pi, 'conceded'); } },
  ], x, y, p.name);
}
function pileClick(zs, anchor) {
  const [pi, z] = parseZone(zs); if (pi < 0) return; const r = anchor.getBoundingClientRect();
  if (!net.isMine(pi)) { if (z === 'graveyard' || z === 'exile') openZone(pi, z); else toast(`That's ${P(pi).name}'s ${ZLABEL[z].toLowerCase()}.`); return; }
  if (z === 'library') draw(pi, 1);
  else if (z === 'graveyard' || z === 'exile') openZone(pi, z);
  else if (z === 'command') commandMenu(pi, r.left, r.bottom + 4);
  else if (z === 'hand' && pi !== S.view) toast(`${P(pi).name}'s hand is hidden. Use "Playing as" to take that seat.`);
}

/* ---------- Modals ---------- */
function openModal(html, o = {}) {
  closeMenu(); hideZoom(); const m = $('#modal');
  m.innerHTML = `<div class="scrim" data-close="1"></div><div class="mpanel ${o.cls || ''}" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false; modalClose = o.onClose || null;
  m.onclick = (e) => { if (e.target.dataset.close || e.target.closest('[data-act="close"]')) closeModal(); };
  (m.querySelector('[data-autofocus]') || m.querySelector('input,textarea,.btn:not(.ghost),button'))?.focus({ preventScroll: true });
}
function closeModal() { const m = $('#modal'); if (m.hidden) return; m.hidden = true; m.innerHTML = ''; const cb = modalClose; modalClose = null; cb && cb(); }
function confirmModal(text, ok, fn) {
  openModal(`<h2>${esc(ok)}?</h2><p>${esc(text)}</p><div class="row"><button type="button" class="btn ghost" data-act="close">Cancel</button><button type="button" class="btn" id="okBtn">${esc(ok)}</button></div>`, { cls: 'narrow' });
  $('#okBtn').onclick = () => { closeModal(); fn(); };
}
function matModal(pi) {
  const p = P(pi); const cur = p.mat || 'auto';
  const opt = (k, name, blurb, extra = '') => `<button type="button" class="matopt ${k} ${cur === k ? 'on' : ''}" data-mat-pick="${k}" ${extra}><span>${name}<small>${blurb}</small></span></button>`;
  const seatStyle = (k) => { const el = document.createElement('div'); el.className = 'seat'; el.dataset.mat = k; document.body.appendChild(el); const bg = getComputedStyle(el).backgroundImage; el.remove(); return `style="background:${bg.replace(/"/g, '&quot;')}"`; };
  const now = matOf(pi); const nowName = now === 'custom' ? 'your upload' : MATS[now].name;
  const custom = customMats[pi] ? opt('custom', 'Your mat', 'Uploaded image', `style="background-image:url(${customMats[pi]})"`) : '';
  openModal(`<h2>${esc(p.name)}'s playmat</h2><p>Each mat is its own corner of the multiverse, with its own weather. Auto matches the commander's colors. Upload your own art to play on it; wide images (about 3:2) fit best.</p>
  <div class="matgrid">${opt('auto', 'Auto', `Now: ${nowName}`)}${Object.entries(MATS).map(([k, m]) => opt(k, m.name, m.blurb, seatStyle(k))).join('')}${custom}</div>
  <input type="file" id="matFile" accept="image/*" hidden>
  <div class="row" style="justify-content:space-between"><span><button type="button" class="btn ghost" id="matUpload">${customMats[pi] ? 'Replace your mat' : 'Upload your own'}</button> ${customMats[pi] ? '<button type="button" class="btn ghost" id="matRemove">Remove</button>' : ''}</span><button type="button" class="btn" data-act="close">Done</button></div>`);
  $('#modal .mpanel').addEventListener('click', (e) => { const b = e.target.closest('[data-mat-pick]'); if (!b) return; p.mat = b.dataset.matPick; render(); matModal(pi); });
  $('#matUpload').onclick = () => $('#matFile').click();
  $('#matFile').onchange = async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try {
      customMats[pi] = await readMatFile(f);
      if (!saveCustomMats()) toast("Your browser's storage is full, so this mat lasts until you reload.", 5000);
      p.mat = 'custom'; render(); matModal(pi); toast('Playmat updated');
    } catch { toast("That file isn't an image this browser can read."); }
  };
  const rm = $('#matRemove'); if (rm) rm.onclick = () => { delete customMats[pi]; saveCustomMats(); if (p.mat === 'custom') p.mat = 'auto'; render(); matModal(pi); };
}
function renameModal(pi) {
  openModal(`<h2>Rename seat</h2><label for="rnIn">Player name<input id="rnIn" maxlength="24" value="${esc(P(pi).name)}"></label><div class="row"><button type="button" class="btn ghost" data-act="close">Cancel</button><button type="button" class="btn" id="rnGo">Save</button></div>`, { cls: 'narrow' });
  const go = () => { const v = $('#rnIn').value.trim(); if (v) P(pi).name = v; closeModal(); render(); };
  $('#rnGo').onclick = go; $('#rnIn').onkeydown = (e) => { if (e.key === 'Enter') go(); };
}
async function deckLibraryHTML() {
  if (!online) return '';
  const user = await currentUser(); if (!user) return '<div class="summary">Sign in on the <a href="/">lobby</a> to keep decks on your account.</div>';
  const decks = await listDecks(); const last = lastDeckId();
  return `<div class="decklib"><div class="eyebrow">Your decks</div>${decks.length ? `<ul class="list">${decks.map((d) => `<li><span><b>${esc(d.name)}</b> <small>· ${esc(d.commander || '')}${d.card_count ? ` · ${d.card_count} cards` : ''}${d.id === last ? ' · last used' : ''}</small></span><span class="row"><button type="button" class="btn sm" data-deck-load="${d.id}">Load</button><button type="button" class="btn ghost sm" data-deck-del="${d.id}">Delete</button></span></li>`).join('')}</ul>` : '<p class="muted">No saved decks yet. Paste a list below and save it.</p>'}</div>`;
}
async function importModal(pi) {
  const lib = await deckLibraryHTML();
  openModal(`<h2>Decks</h2>${lib}<p>Paste a text export from Moxfield, Archidekt or any deck site, one card per line like "1 Sol Ring". Put the commander under a "Commander" heading, or type it below. Seating a deck resets that seat's board and life.</p>
  <div class="grid2"><label for="impSeat" ${MODE === 'hotseat' ? '' : 'hidden'}>Seat<select id="impSeat">${S.players.filter((p, i) => i < S.seats && net.isMine(i)).map((p) => { const i = S.players.indexOf(p); return `<option value="${i}" ${i === pi ? 'selected' : ''}>${esc(p.name)}</option>`; }).join('')}</select></label>
  <label for="impName">Player name<input id="impName" maxlength="24" value="${esc(P(pi).name)}"></label></div>
  <label for="impCmd">Commander (optional)<input id="impCmd" placeholder="Taken from the list if left blank"></label>
  <label for="impList">Decklist<textarea id="impList" rows="9" spellcheck="false" data-autofocus></textarea></label>
  <div class="summary" id="impSum"></div>
  <div class="grid2"><label for="impDeckName">Deck name (to save)<input id="impDeckName" maxlength="40" placeholder="Krenko goblins"></label></div>
  <div class="row"><button type="button" class="btn ghost" data-act="close">Cancel</button>${online ? '<button type="button" class="btn ghost" id="impSave">Save to my decks</button>' : ''}<button type="button" class="btn" id="impGo">Shuffle up and seat</button></div>`);
  const ta = $('#impList'); ta.value = P(pi).deckText || '';
  let editingId = P(pi).deckId || '';
  $('#impDeckName').value = P(pi).deckName || '';
  $$('[data-deck-load]').forEach((b) => { b.onclick = async () => { const d = await getDeck(b.dataset.deckLoad); if (!d) return; ta.value = d.list; $('#impDeckName').value = d.name; editingId = d.id; $('#impCmd').value = ''; sum(); toast(`Loaded ${d.name}`); }; });
  $$('[data-deck-del]').forEach((b) => { b.onclick = async () => { await deleteDeck(b.dataset.deckDel); toast('Deck deleted'); importModal(pi); }; });
  const saveBtn = $('#impSave'); if (saveBtn) saveBtn.onclick = async () => {
    const d = parseDeck(ta.value, $('#impCmd').value); const nm = $('#impDeckName').value.trim() || d.cmd[0] || 'Untitled deck';
    if (!d.count && !d.cmd.length) { toast('Paste a decklist first'); return; }
    try {
      const cols = [...new Set(d.cmd.flatMap((n) => (lookup(n).colors || '').split('')))].join('');
      const list = `Commander\n${d.cmd.map((n) => '1 ' + n).join('\n')}\n\nDeck\n${d.main.map((e) => e.n + ' ' + e.name).join('\n')}`;
      const row = await saveDeck({ id: editingId || undefined, name: nm, commander: d.cmd.join(' + '), colors: cols, cardCount: d.count + d.cmd.length, list, mat: P(pi).mat });
      editingId = row.id; setLastDeckId(row.id); P(pi).deckId = row.id; P(pi).deckName = nm; toast(`Saved ${nm}`); importModal(pi);
    } catch (e) { toast('Could not save: ' + e.message, 5000); }
  };
  const sum = () => {
    const d = parseDeck(ta.value, $('#impCmd').value);
    if (!d.cmd.length && !d.count) { $('#impSum').innerHTML = 'Paste a list to see what will load.'; return; }
    const size = d.count + d.cmd.length;
    if (!d.cmd.length) {
      const names = [...new Set(d.main.map((e) => e.name))].sort((a, b) => a.localeCompare(b));
      $('#impSum').innerHTML = `<span class="bad">No commander is marked in this list.</span> Pick one: <select id="impCmdPick" style="width:auto;display:inline-block;margin-left:6px"><option value="">Choose a card…</option>${names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select><br>${d.count} cards in the list.`;
      $('#impCmdPick').onchange = (e) => { $('#impCmd').value = e.target.value; sum(); };
      return;
    }
    $('#impSum').innerHTML = `Commander: <b>${esc(d.cmd.join(' + '))}</b> · ${d.count} cards in the library${size !== 100 ? ` <span class="bad">· Commander decks run 100 cards; this list has ${size}.</span>` : ''}`;
  };
  ta.oninput = sum; $('#impCmd').oninput = sum;
  $('#impSeat').onchange = (e) => { const k = +e.target.value; $('#impName').value = P(k).name; ta.value = P(k).deckText || ''; sum(); };
  sum();
  $('#impGo').onclick = () => {
    const k = +$('#impSeat').value; const nm = $('#impName').value.trim(); if (nm) P(k).name = nm;
    const d = parseDeck(ta.value, $('#impCmd').value); if (!d.count && !d.cmd.length) { toast('The decklist is empty'); return; }
    if (!d.cmd.length) { toast('Pick a commander first'); $('#impCmdPick')?.focus(); return; }
    const text = `Commander\n${d.cmd.map((n) => '1 ' + n).join('\n')}\n\nDeck\n${d.main.map((e) => e.n + ' ' + e.name).join('\n')}`;
    loadDeck(k, text, null); P(k).deckId = editingId || ''; P(k).deckName = $('#impDeckName').value.trim(); if (editingId) setLastDeckId(editingId); closeModal(); SFX.play('shuffle'); log(`${P(k).name} sat down with ${d.cmd.join(' + ')}`); toast(`${P(k).name} shuffled up and drew 7`); render();
    ensureArt([...d.cmd, ...d.main.map((e) => e.name)]);
  };
}
function openZone(pi, z, o = {}) {
  const p = P(pi); let ids; let title;
  if (z === 'library') { ids = o.top ? p.zones.library.slice(0, o.top) : p.zones.library.slice().sort((a, b) => S.cards[a].name.localeCompare(S.cards[b].name)); title = o.top ? `Top ${o.top} of ${p.name}'s library` : `Search ${p.name}'s library`; }
  else { ids = p.zones[z].slice().reverse(); title = `${p.name}'s ${ZLABEL[z].toLowerCase()}`; }
  const acts = { hand: 'Hand', battlefield: 'Battlefield', graveyard: 'Graveyard', exile: 'Exile', top: 'Top', bottom: 'Bottom' };
  const allowed = Object.keys(acts).filter((a) => !(a === z) && !(z === 'library' && a === 'top' && !o.top));
  const items = ids.map((id) => { const c = S.cards[id]; return `<div class="zitem">${cardHTML(c, { noid: true, flat: true, reveal: true }).replace('class="card', `data-mcid="${id}" class="card`)}<div class="zacts">${allowed.map((a) => `<button type="button" class="mini" data-za="${a}" data-cid="${id}">${acts[a]}</button>`).join('')}</div></div>`; }).join('');
  const note = z === 'library' && !o.top ? '<p>The library shuffles when you close this.</p>' : '';
  openModal(`<h2>${esc(title)}</h2>${note}${ids.length ? `<div class="zgrid">${items}</div>` : '<p>Nothing here yet.</p>'}<div class="row"><button type="button" class="btn" data-act="close">Done</button></div>`, { onClose: z === 'library' && !o.top ? () => shuffleLib(pi, true) : null });
  $('#modal .mpanel').addEventListener('click', (e) => {
    const b = e.target.closest('[data-za]'); if (!b) return; const c = S.cards[b.dataset.cid]; if (!c) return;
    const from = visRect($(`[data-mcid="${c.id}"]`)); const a = b.dataset.za;
    if (a === 'top' || a === 'bottom') { moveLog(c, 'library', { bottom: a === 'bottom' }); moveCard(c.id, c.owner, 'library', { bottom: a === 'bottom', fromRect: from }); }
    else if (a === 'battlefield') { moveLog(c, 'battlefield'); moveCard(c.id, c.owner, 'battlefield', { fromRect: from, anim: 'land' }); }
    else { moveLog(c, a); moveCard(c.id, c.owner, a, { fromRect: from }); }
    const keep = modalClose; modalClose = null;
    if (z === 'library' && o.top) { const rest = Math.max(0, (o.top || 0) - 1); if (a === 'top') openZone(pi, z, o); else if (rest) openZone(pi, z, { top: rest }); else closeModal(); }
    else openZone(pi, z, o);
    if (keep && !modalClose) modalClose = keep;
  });
}
function dmgModal(pi) {
  const p = P(pi);
  const rows = [`<div class="dmgrow"><span>Poison counters</span><div class="ctl"><button type="button" class="mini" data-dm="poison" data-d="-1">−</button><span class="v">${p.poison}</span><button type="button" class="mini" data-dm="poison" data-d="1">+</button></div></div>`];
  S.players.forEach((o, k) => { if (k === pi) return; commandersOf(k).forEach((c) => { rows.push(`<div class="dmgrow"><span>From ${esc(c.name)} <small style="color:var(--muted)">(${esc(o.name)})</small></span><div class="ctl"><button type="button" class="mini" data-dm="${c.id}" data-d="-1">−</button><span class="v">${p.cmdDmg[c.id] || 0}</span><button type="button" class="mini" data-dm="${c.id}" data-d="1">+</button></div></div>`); }); });
  openModal(`<h2>Damage taken by ${esc(p.name)}</h2><p>Commander damage also lowers life. 21 from one commander or 10 poison knocks a player out.</p><div class="dmgrows">${rows.join('')}</div><div class="row"><button type="button" class="btn" data-act="close">Done</button></div>`, { cls: 'narrow' });
  $('#modal .mpanel').addEventListener('click', (e) => {
    const b = e.target.closest('[data-dm]'); if (!b) return; const d = +b.dataset.d; const k = b.dataset.dm;
    if (k === 'poison') request(pi, 'poison', d); else request(pi, 'cmdDmg', k, d);
    if (!$('#modal').hidden && !S.over) dmgModal(pi);
  });
}
function tokenModal() {
  const opts = ['C', 'W', 'U', 'B', 'R', 'G'].map((k) => `<option value="${k}">${{ C: 'Colorless', W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' }[k]}</option>`).join('');
  openModal(`<h2>Create tokens</h2><div class="grid2"><label for="tkName">Name<input id="tkName" value="Goblin"></label><label for="tkPT">Power/toughness<input id="tkPT" value="1/1"></label>
  <label for="tkCol">Color<select id="tkCol">${opts}</select></label><label for="tkN">How many<input id="tkN" type="number" min="1" max="40" value="1"></label>
  <label for="tkFor">For<select id="tkFor">${S.players.map((p, i) => `<option value="${i}" ${i === S.view ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label></div>
  <div class="row"><button type="button" class="btn ghost" data-act="close">Cancel</button><button type="button" class="btn" id="tkGo">Create</button></div>`, { cls: 'narrow' });
  $('#tkCol').value = 'R';
  $('#tkGo').onclick = () => {
    const name = $('#tkName').value.trim() || 'Token', pt = $('#tkPT').value.trim(), col = $('#tkCol').value, n = clamp(parseInt($('#tkN').value, 10) || 1, 1, 40), pi = +$('#tkFor').value;
    closeModal(); createTokens(pi, { name, cost: '', type: pt ? 'Token Creature' : 'Token', pt, colors: col === 'C' ? '' : col }, n);
  };
}
function logModal() {
  const fmt = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  openModal(`<h2>Game log</h2><ul class="loglist">${S.log.map((l) => `<li><time>${fmt(l.t)}</time><span>${esc(l.text)}</span></li>`).join('') || '<li>Nothing has happened yet.</li>'}</ul><div class="row"><button type="button" class="btn" data-act="close">Close</button></div>`, { cls: 'narrow' });
}

/* ---------- Input ---------- */
function onCardClick(c) {
  const now = performance.now();
  if (lastClick && lastClick.id === c.id && now - lastClick.t < 330) { lastClick = null; quick(c); return; }
  lastClick = { id: c.id, t: now }; S.sel = c.id;
  $$('#table .card.sel').forEach((x) => x.classList.remove('sel')); cardEl(c.id)?.classList.add('sel');
}
function quick(c) {
  if (c.zone === 'battlefield') toggleTap(c);
  else if (c.zone === 'hand' || c.zone === 'command') castToStack(c.id);
  else if (c.zone === 'stack' && S.stack[S.stack.length - 1] === c.id) resolveTop();
}
function clearHot() { $$('.hot').forEach((x) => x.classList.remove('hot')); }
function onDown(e) {
  hideZoom(); untilt();
  if (e.button > 0) return;
  if (!e.target.closest('#menu')) closeMenu();
  const el = e.target.closest('#table .card[data-id]'); if (!el) return;
  const c = S.cards[el.dataset.id]; if (!c) return;
  if (!net.isMine(c.controller)) return;
  drag = { c, el, sx: e.clientX, sy: e.clientY, moved: false, ghost: null, lp: false, off: { x: 0, y: 0 } };
  if (e.pointerType !== 'mouse') { clearTimeout(lpTimer); lpTimer = setTimeout(() => { if (drag && !drag.moved) { drag.lp = true; cardMenu(c, drag.sx, drag.sy); } }, 480); }
}
let tiltEl = null;
function tilt(e, el) {
  if (tiltEl && tiltEl !== el) untilt();
  if (!el || !motionMul() || el.classList.contains('facedown')) { if (tiltEl) untilt(); return; }
  const r = el.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
  const tapped = el.classList.contains('tapped'); const lift = el.closest('.hand') ? 'translateY(-34px) ' : '';
  el.style.transform = `${lift}perspective(700px) rotateX(${((0.5 - py) * 18).toFixed(1)}deg) rotateY(${((px - 0.5) * (tapped ? -18 : 18)).toFixed(1)}deg) scale(1.05)`;
  el.style.setProperty('--gx', (px * 100).toFixed(0) + '%'); el.style.setProperty('--gy', (py * 100).toFixed(0) + '%');
  if (!el.querySelector('.glare')) { const g = document.createElement('div'); g.className = 'glare'; el.appendChild(g); }
  el.classList.add('tilt'); tiltEl = el;
}
function untilt() { if (!tiltEl) return; tiltEl.style.transform = ''; tiltEl.classList.remove('tilt'); tiltEl = null; }
function hoverZoom(e) {
  if (e.pointerType !== 'mouse') return;
  mouse.x = e.clientX; mouse.y = e.clientY;
  const el = e.target.closest && e.target.closest('#table .card[data-id], .stackcards .card[data-id]');
  tilt(e, el && el.closest('.me, .lane') ? el : null);
  if (!el) { if (zoomId || zoomPending) hideZoom(); return; }
  const id = el.dataset.id;
  if (zoomId === id) { placeZoom(); return; }
  if (zoomPending === id) return;
  zoomPending = id; clearTimeout(zoomT);
  zoomT = setTimeout(() => { if (zoomPending === id) showZoom(id); }, zoomId ? 0 : 280);
}
function onMove(e) {
  if (!drag) { hoverZoom(e); return; }
  if (!drag.moved) {
    if (drag.lp || Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 7) return;
    drag.moved = true; clearTimeout(lpTimer); hideZoom(); untilt();
    const r = drag.el.getBoundingClientRect(); const tapped = drag.el.classList.contains('tapped');
    const w = tapped ? r.height : r.width;
    drag.off = { x: w / 2, y: w * 0.7 };
    drag.ghost = makeGhost(drag.c, w, drag.c.faceDown && drag.c.controller !== S.view); drag.ghost.classList.add('dragging');
    drag.el.style.visibility = 'hidden'; document.body.classList.add('is-drag');
  }
  e.preventDefault();
  drag.ghost.style.transform = `translate(${e.clientX - drag.off.x}px,${e.clientY - drag.off.y}px) rotate(2.5deg) scale(1.06)`;
  const hit = document.elementFromPoint(e.clientX, e.clientY); const z = hit && hit.closest('[data-zone]');
  if (!z || !z.classList.contains('hot')) { clearHot(); if (z) z.classList.add('hot'); }
}
function onUp(e) {
  clearTimeout(lpTimer); if (!drag) return; const d = drag; drag = null;
  document.body.classList.remove('is-drag'); clearHot();
  ignoreClick = performance.now() + 350;
  if (d.lp) return;
  if (!d.moved) {
    const slot = d.el.closest('.slot'); const z = slot && slot.dataset.zone;
    if (z && /-(graveyard|exile)$/.test(z)) { const [pi, zone] = parseZone(z); openZone(pi, zone); return; }
    onCardClick(d.c); return;
  }
  drop(d, e.clientX, e.clientY, e.type === 'pointercancel');
}
function drop(d, x, y, cancel) {
  const r1 = d.ghost.getBoundingClientRect(); d.ghost.remove();
  const c = d.c;
  const hit = cancel ? null : document.elementFromPoint(x, y); const zEl = hit && hit.closest('[data-zone]');
  const back = () => { const to = visRect(d.el); fly(c, r1, to, { dur: 260 }).then(() => { d.el.style.visibility = ''; }); if (!to || !motionMul()) d.el.style.visibility = ''; };
  if (!zEl) { back(); return; }
  const [pi, z] = parseZone(zEl.dataset.zone);
  if (z === 'battlefield') {
    const bf = zEl.getBoundingClientRect(); const cw = parseFloat(getComputedStyle(zEl).getPropertyValue('--cw')) || 60;
    const fw = cw / bf.width, fh = (cw * RATIO) / bf.height;
    const nx = clamp((r1.left + r1.width / 2 - bf.left) / bf.width - fw / 2, 0, Math.max(0, 1 - fw)), ny = clamp((r1.top + r1.height / 2 - bf.top) / bf.height - fh / 2, 0, Math.max(0, 1 - fh));
    if (c.zone === 'battlefield' && c.controller === pi) { c.x = nx; c.y = ny; render(); return; }
    const fromCmd = c.zone === 'command';
    if (c.zone === 'hand' && /Land/.test(c.type)) log(`${P(c.controller).name} played ${c.name}`); else moveLog(c, 'battlefield');
    moveCard(c.id, pi, 'battlefield', { x: nx, y: ny, fromRect: r1, anim: fromCmd ? 'commander' : 'land' });
  } else {
    const dest = z === 'hand' ? pi : c.owner;
    if (c.zone === z && c.controller === dest) { d.el.style.visibility = ''; render(); return; }
    moveLog(c, z); moveCard(c.id, dest, z, { fromRect: r1 });
  }
}
function onClick(e) {
  const a = e.target.closest('[data-act]'); if (!a || (a.closest('#modal') && a.dataset.act === 'close')) return;
  if (performance.now() < ignoreClick && e.target.closest('.card[data-id]')) return;
  if (a.dataset.act === 'pileclick' && e.target.closest('.card[data-id]') && !/-(graveyard|exile)$/.test(a.dataset.zone || '')) return;
  const act = a.dataset.act, p = +a.dataset.p; const r = a.getBoundingClientRect();
  switch (act) {
    case 'life': { const d = (+a.dataset.d) * (e.shiftKey ? 5 : 1); if (net.isMine(p)) changeLife(p, d, { manual: true }); else request(p, 'changeLife', d); break; }
    case 'pile': case 'pileclick': pileClick(a.dataset.zone, a); break;
    case 'seatmenu': seatMenu(p, r.left, r.bottom + 4); break;
    case 'dmg': dmgModal(p); break;
    case 'draw': if (net.isMine(p)) draw(p, 1); break;
    case 'mull': if (net.isMine(p)) mulligan(p); break;
    case 'phase': { const k = +a.dataset.k; if (S.turn.phase === 2 && k !== 2) S.attacks = []; S.turn.phase = k; render(); break; }
    case 'next': nextPhase(); break;
    case 'pass': passTurn(); break;
    case 'resolve': resolveTop(); break;
    case 'token': tokenModal(); break;
    case 'wipe': openMenu([{ label: 'Destroy all creatures', fn: () => wipe('creatures'), hot: true }, { label: 'Destroy all nonland permanents', fn: () => wipe('nonland') }], r.left, r.bottom + 4, 'Board wipe'); break;
    case 'd20': { const n = 1 + Math.floor(Math.random() * 20); const who = P(S.view).name; toast(`${who} rolled ${n} on a d20`); log(`${who} rolled ${n} on a d20`); SFX.play('tick'); renderMid(); break; }
    case 'log': logModal(); break;
    case 'again': closeModal(); if (net.active && !net.isHost) { toast('Only the host can start a new game'); break; } if (net.active) net.send('all', { fn: 'newGame' }); newGame(true); render(); SFX.play('shuffle'); ensureArt(allNames(), { quiet: true }); break;
    default: break;
  }
}
function onContext(e) {
  if (e.target.closest('#modal')) return;
  const cardElm = e.target.closest('#table .card[data-id]');
  if (cardElm) { e.preventDefault(); const c = S.cards[cardElm.dataset.id]; if (c) cardMenu(c, e.clientX, e.clientY); return; }
  const pile = e.target.closest('[data-pile]');
  if (pile) {
    const [pi, z] = parseZone(pile.dataset.pile); if (pi < 0) return; e.preventDefault();
    if (!net.isMine(pi)) { if (z === 'graveyard' || z === 'exile') openZone(pi, z); return; }
    if (z === 'library') libraryMenu(pi, e.clientX, e.clientY);
    else if (z === 'command') commandMenu(pi, e.clientX, e.clientY);
    else if (z === 'graveyard' || z === 'exile') openZone(pi, z);
  }
}
function onKey(e) {
  if (e.key === 'Escape') { closeMenu(); closeModal(); hideZoom(); untilt(); return; }
  if (e.target.closest('input,textarea,select') || !$('#modal').hidden) return;
  if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); nextPhase(); }
  else if (e.key === 'd' || e.key === 'D') draw(S.view, 1);
}
function bindUI() {
  FX.init();
  ['W', 'U', 'B', 'R', 'G', 'C'].forEach((k) => { HEX[k] = css('--m' + k) || '#aaa'; });
  $('#viewSel').onchange = (e) => { S.view = +e.target.value; S.sel = null; render(); };
  $('#motionSel').onchange = (e) => { S.motion = e.target.value; render(); };
  $('#fxBtn').onclick = () => { S.fx = !S.fx; render(); toast(S.fx ? 'Playmat effects on' : 'Playmat effects off'); };
  $('#settingsBtn').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    openMenu([
      { label: `Playmat effects: ${S.fx ? 'on' : 'off'}`, fn: () => $('#fxBtn').click() },
      { label: `Sound: ${S.sound ? 'on' : 'off'}`, fn: () => $('#soundBtn').click() },
      { label: `Card motion: ${{ full: 'full', reduced: 'reduced', off: 'off' }[S.motion]}`, fn: () => { S.motion = { full: 'reduced', reduced: 'off', off: 'full' }[S.motion]; render(); toast(`Card motion ${S.motion}`); } },
      { sep: true },
      { label: 'Game log', fn: logModal },
    ], r.left, r.bottom + 4, 'Settings');
  };
  $('#soundBtn').onclick = () => { S.sound = !S.sound; if (S.sound) { SFX.init(); SFX.play('chime', 'U'); } render(); };
  $('#importBtn').onclick = () => importModal(S.view);
  $('#newBtn').onclick = () => { if (net.active && !net.isHost) { toast('Only the host can start a new game'); return; } confirmModal('Life totals and the board reset. Everyone keeps their deck and draws a fresh 7.', 'New game', () => { if (net.active) net.send('all', { fn: 'newGame' }); newGame(true); render(); SFX.play('shuffle'); ensureArt(allNames(), { quiet: true }); }); };
  document.addEventListener('pointerdown', (e) => { if (S.sound) SFX.init(); onDown(e); });
  document.addEventListener('pointermove', onMove, { passive: false });
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
  document.addEventListener('click', onClick);
  document.addEventListener('contextmenu', onContext);
  document.addEventListener('keydown', onKey);
  document.addEventListener('error', (e) => {
    const t = e.target; if (!t || t.tagName !== 'IMG') return;
    if (t.src === CARD_BACK) { if (backOk) { backOk = false; render(); } return; }
    if (t.closest('.ci.pic')) t.closest('.ci').classList.add('loading');
  }, true);
  const probe = new Image(); probe.onerror = () => { backOk = false; render(); }; probe.src = CARD_BACK;
  addEventListener('resize', () => requestAnimationFrame(() => { sizeBattlefields(); fanHand(); drawArrows(); }));
  $('#table').addEventListener('scroll', () => requestAnimationFrame(drawArrows), true);
  addEventListener('scroll', () => requestAnimationFrame(drawArrows));
}

/* ---------- Boot ---------- */
function botApi() { return { S, P, moveCard, castToStack, resolveTop, attack, combatDamage, nextPhase, passTurn, isCreature, powerOf, log }; }
function roomBar() {
  if (MODE !== 'room') return;
  const t = $('#roomBar'); if (!t) return;
  const humans = new Set(Object.values(net.peers).filter((p) => p.seat != null).map((p) => p.seat)).size;
  t.innerHTML = `<span class="tn">Table</span><span class="code">${esc(ROOM.code)}</span><button type="button" class="btn ghost sm" id="copyInvite">Copy invite link</button><span class="tn">${humans} of ${S.seats - ROOM.bots} seated</span>`;
  $('#copyInvite').onclick = async () => { const link = `${location.origin}/?join=${ROOM.code}`; try { await navigator.clipboard.writeText(link); toast('Invite link copied'); } catch { toast(link, 8000); } };
}
let seatRestored = false;
async function boot() {
  let restored = null;
  if (MODE === 'hotseat') { try { const raw = localStorage.getItem(KEY); if (raw) restored = JSON.parse(raw); } catch { /* ignore */ } }
  if (restored && restored.v === 2 && restored.players && restored.cards) { S = restored; if (S.fx == null) S.fx = true; if (!S.seats) S.seats = 4; S.players.forEach((p) => { if (!p.mat) p.mat = 'auto'; }); setFxState(S); }
  if (MODE === 'room') {
    try {
      if (online) { const u = await currentUser(); if (!u) { const { signInGuest } = await import('./supa.js'); await signInGuest(ROOM.name); } }
      if (!ROOM.host && online) { try { const { getRoom } = await import('./supa.js'); const row = await getRoom(ROOM.code); if (row) { ROOM.seats = row.seats; ROOM.bots = row.bots || 0; } } catch { /* fall back to presence */ } }
      const seat = await net.join({ code: ROOM.code, name: ROOM.name, isHost: ROOM.host, seats: ROOM.seats, bots: ROOM.bots });
      ROOM.seats = net.seats; ROOM.bots = net.bots;
      S = null; newGame(false); S.view = seat;
      const prior = recallRoom(ROOM.code);
      if (prior && prior.mine && prior.mine.some((m) => m.seat === seat)) {
        seatRestored = true;
        prior.mine.forEach((snap) => { if (!net.isMine(snap.seat)) return; const p = P(snap.seat); Object.assign(p, snap.player); p.zones = snap.zones; Object.values(S.cards).forEach((c) => { if (c.owner === snap.seat) delete S.cards[c.id]; }); snap.cards.forEach((c) => { S.cards[c.id] = { img: '', big: '', backImg: '', backBig: '', artist: '', ...c }; }); });
        if (prior.shared) { S.turn = prior.shared.turn; S.stack = prior.shared.stack; S.attacks = prior.shared.attacks; S.outOrder = prior.shared.outOrder; S.stats = prior.shared.stats; S.over = prior.shared.over; S.log = prior.shared.log || S.log; }
        if (prior.deck) { P(seat).deckId = prior.deck.id; P(seat).deckName = prior.deck.name; }
        S.nextId = Math.max(S.nextId, ...Object.keys(S.cards).map((id) => parseInt(id.split('_')[1], 10) + 1).filter((n) => !isNaN(n)));
        toast('Welcome back. Your seat was kept.');
      }
      net.on('seat', applySeat); net.on('shared', applyShared);
      net.on('req', ({ fn, to, args }) => { if (REQ[fn]) REQ[fn](to, ...args); });
      net.on('all', ({ fn, kind, cardId }) => { if (fn === 'wipe') ALL.wipe(kind); else if (fn === 'newGame') ALL.newGame(); else if (fn === 'attackEnd') ALL.attackEnd(cardId); });
      net.on('peers', (peers) => { Object.values(peers).forEach((pr) => { if (pr.seat != null && pr.seat < S.seats && !net.isMine(pr.seat)) { const p = P(pr.seat); p.empty = false; if (p.name === SEAT_NAMES[pr.seat]) p.name = pr.name; } }); roomBar(); render(); });
      net.on('resend', () => { net.queueSync(seatSnap, sharedSnap); });
      if (!ROOM.host) { ROOM.seats = S.seats; }
      toast(ROOM.host ? `Table ${ROOM.code} is open. Share the code.` : `You're seated at ${ROOM.code}`, 4000);
    } catch (e) {
      net.leave(); net.seat = null; net.ready = false;
      document.body.insertAdjacentHTML('afterbegin', `<div class="toast" style="position:fixed;left:50%;top:40%;transform:translateX(-50%);z-index:99;pointer-events:auto;max-width:460px">${esc(e.message)}<br><a href="/">Back to the lobby</a></div>`);
      S = null; newGame(false);
    }
  } else if (MODE === 'bots') { S = null; newGame(false); S.view = 0; }
  else if (!S) { S = null; newGame(false); }
  if (MODE !== 'hotseat') bot = makeBot(botApi());
  bindUI(); hydrate(); render(); roomBar();
  ensureArt(allNames());
  if (MODE !== 'hotseat' && online && lastDeckId() && !seatRestored) {
    try {
      const d = await getDeck(lastDeckId());
      if (d) { const me = net.active ? net.seat : 0; loadDeck(me, d.list, null); P(me).deckId = d.id; P(me).deckName = d.name; if (d.mat && d.mat !== 'auto') P(me).mat = d.mat; render(); toast(`Seated with ${d.name}`); ensureArt(allNames(), { quiet: true }); }
    } catch { /* deck library unavailable */ }
  }
  if (net.active) net.resendAll();
}
boot();
// Read-only hook for the test suite.
window.__edhState = () => S;
