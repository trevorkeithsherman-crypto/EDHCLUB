import { fetchCards, fetchToken, fetchPrintings, cached, CARD_BACK } from './scryfall.js';
import { DB, buildSample } from './decks.js';
import { FX, SFX, Ambient, setFxState } from './fx.js';
import { net, rememberRoom, recallRoom } from './net.js';
import { makeBot } from './bots.js';
import * as Rules from './combat.js';
import { parseList, deckStats, deckText } from './decklist.js';
import { parseAbilities, parseEffects, staticGrant, boardRules, castTax, castBlock, spellKind, manaValue } from './effects.js';
import { deckLink, fetchLinkedDeck } from './deckimport.js';
import { registerSW, canInstall, install, onInstallable, isIOS, toggleFullscreen, fullscreenOn, fullscreenSupported } from './pwa.js';
import { online, currentUser, recordGame, setRoomStatus, localName, localAvatar, defaultDeckId, bumpDeckPlays, listDecks, getDeck, saveDeck, deleteDeck, lastDeckId, setLastDeckId } from './supa.js';

/* ---------- Mode from the URL ---------- */
const Q = new URLSearchParams(location.search);
const MODE = Q.get('room') ? 'room' : Q.get('mode') === 'bots' ? 'bots' : 'hotseat';
const SPECTATE = MODE === 'room' && Q.get('spectate') === '1';
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
  azorius: { name: 'Azorius Senate', blurb: 'Blue domes, drifting haze and gulls', credit: 'Richard Wright' },
  orzhov: { name: 'Orzhov Basilica', blurb: 'Gilded spires, candlelit windows', credit: 'Richard Wright' },
  dimir: { name: 'Dimir Waterways', blurb: 'Sunlit stone over dark water', credit: 'Richard Wright' },
  izzet: { name: 'Izzet Boilerworks', blurb: 'Steam, sparks and arcing current', credit: 'Richard Wright' },
  rakdos: { name: 'Rakdos Rix Maadi', blurb: 'Firelit halls, rising embers', credit: 'Richard Wright' },
  golgari: { name: 'Golgari Undercity', blurb: 'Rot-light, mist and spores', credit: 'Richard Wright' },
  gruul: { name: 'Gruul Rubblebelt', blurb: 'Overgrown ruins, sun dapple', credit: 'Richard Wright' },
  boros: { name: 'Boros Sunhome', blurb: 'War forges, heat and cinders', credit: 'Richard Wright' },
  selesnya: { name: 'Selesnya Vitu-Ghazi', blurb: 'Great tree, pollen on the wind', credit: 'Richard Wright' },
  simic: { name: 'Simic Zonot', blurb: 'Cloud sea, bio-lights pulsing', credit: 'Richard Wright' },
};
const MAT_BY_COLOR = { W: 'orzhov', U: 'azorius', B: 'golgari', R: 'rakdos', G: 'selesnya' };
const MAT_BY_PAIR = { WU: 'azorius', UB: 'dimir', BR: 'rakdos', RG: 'gruul', GW: 'selesnya', WB: 'orzhov', UR: 'izzet', BG: 'golgari', RW: 'boros', GU: 'simic' };
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
    players: [0, 1, 2, 3].map((i) => ({ name: SEAT_NAMES[i], life: 40, poison: 0, cmdDmg: {}, out: i >= n, outAt: 0, mulls: 0, deckText: buildSample(i), mat: 'auto', zones: emptyZones(), bot: MODE !== 'hotseat' && i < n && net.botSeats().includes(i), empty: MODE === 'room' && i < n && !net.botSeats().includes(i) })),
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
function lookup(name, set, num) {
  const k = name.toLowerCase();
  const sf = cached(name, set, num);
  if (sf) return { ...sf, known: true };
  const d = DB[k] || DB[k.split(' // ')[0]];
  if (d) return { ...d, known: true };
  return { name, cost: '', type: 'Card', pt: '', colors: '', known: false };
}
function applyEntry(c, e) {
  Object.assign(c, { name: e.name, cost: e.cost, type: e.type || c.type, pt: e.pt, colors: e.colors, img: e.img, big: e.big, backImg: e.backImg, backBig: e.backBig, artist: e.artist, art: e.art || '', kw: e.kw || c.kw || '', oracle: e.oracle || c.oracle || '' });
}
function hydrate() {
  let n = 0;
  for (const c of Object.values(S.cards)) {
    if (c.token && !c.copyOf && !c.img && !c._tokenTried) { c._tokenTried = true; fetchToken(c.name, c.pt, c.colors).then((t) => { if (t && S.cards[c.id] && !c.img) { Object.assign(c, { img: t.img, big: t.big, art: t.art, artist: t.artist }); render(); } }); continue; }
    if (c.token && !c.copyOf) continue;
    if (c.img && !(c.set && c.num && !c._printed)) continue;
    const e = cached(c.copyOf || c.name, c.set, c.num); if (c.set && c.num && e && e.set === c.set && String(e.num) === String(c.num)) c._printed = true; else if (c.img && !e) continue;
    if (e) { applyEntry(c, e); if (c.token) c.type = /Token/.test(e.type) ? e.type : 'Token ' + e.type; n++; }
  }
  return n;
}
async function ensureArt(names, { quiet = false } = {}) {
  const need = names.filter((n) => (typeof n === 'string' ? !cached(n) : !cached(n.name, n.set, n.num) || cached(n.name, n.set, n.num).set !== n.set));
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
const allNames = () => { const seen = new Set(); return Object.values(S.cards).filter((c) => !c.token).map((c) => (c.set && c.num ? { name: c.name, set: c.set, num: c.num } : c.name)).filter((x) => { const k = typeof x === 'string' ? x : `${x.set}|${x.num}`; if (seen.has(k)) return false; seen.add(k); return true; }); };

/* ---------- Deck parsing ---------- */
function parseDeck(text, cmdOverride) { return parseList(text, cmdOverride, (n) => lookup(n).type); }
function makeCard(def, owner) {
  const id = `c${net.active ? net.seat : 'l'}_${S.nextId++}`;
  const c = { id, name: def.name, cost: def.cost || '', type: def.type || 'Card', pt: def.pt || '', colors: def.colors || '', kw: def.kw || '', oracle: def.oracle || '', set: def.set || '', num: def.num || '', foil: !!def.foil, img: def.img || '', big: def.big || '', art: def.art || '', backImg: def.backImg || '', backBig: def.backBig || '', artist: def.artist || '', owner, controller: owner, zone: 'library', tapped: false, faceDown: false, flipped: false, p1: 0, ctr: 0, token: false, x: 0, y: 0, isCmdr: false, casts: 0 };
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
  d.cmd.forEach((n) => { const pr = d.cmdPrints?.[n] || {}; const c = makeCard({ ...lookup(n, pr.set, pr.num), name: n, set: pr.set || '', num: pr.num || '', foil: !!pr.foil }, i); c.isCmdr = true; c.zone = 'command'; p.zones.command.push(c.id); });
  d.main.forEach((e) => { const def = { ...lookup(e.name, e.set, e.num), name: e.name, set: e.set || '', num: e.num || '', foil: !!e.foil }; for (let k = 0; k < e.n; k++) { const c = makeCard(def, i); p.zones.library.push(c.id); } });
  shuffleArr(p.zones.library);
  const hand = p.zones.library.splice(0, 7); hand.forEach((id) => { S.cards[id].zone = 'hand'; }); p.zones.hand = hand;
  return d;
}
function newGame(keep) {
  const old = S; S = freshState();
  if (keep && old) { S.players.forEach((p, i) => { p.name = old.players[i].name; p.deckText = old.players[i].deckText; p.deckSrc = old.players[i].deckSrc; p.deckName = old.players[i].deckName; }); S.motion = old.motion; S.sound = old.sound; S.view = old.view; }
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
const ptModified = (c) => !!(c.p1 || c.tp || c.tt || (c.zone === 'battlefield' && Rules.ptOf(c).join('/') !== String(c.pt)));
function ptOf(c) {
  if (!c.pt) return null;
  const m = c.pt.match(/^(\d+|\*)\/(\d+|\*)$/); if (!m || !ptModified(c)) return c.pt;
  const [p, t] = Rules.ptOf(c); const a = m[1] === '*' ? '*' : p, b = m[2] === '*' ? '*' : t; return a + '/' + b;
}
function powerOf(c) { const s = ptOf(c); const n = parseInt(s || '0', 10); return isNaN(n) ? 0 : n; }
function toughnessOf(c) { const s = ptOf(c) || ''; const m = s.split('/')[1]; const n = parseInt(m || '0', 10); return isNaN(n) ? 0 : n; }
const isPerm = (c) => !/(Instant|Sorcery)/.test(c.type);
const isCreature = (c) => Rules.isCreature(c);
const faceSrc = (c, big) => (c.flipped && c.backImg ? (big ? c.backBig : c.backImg) : (big ? c.big : c.img));
function cardHTML(c, o = {}) {
  const hidden = (c.faceDown && !o.reveal) || o.back;
  const f = frame(c);
  const cls = ['card', f.cls, c.tapped && !o.flat ? 'tapped' : '', c.token ? 'token' : '', c.isCmdr ? 'cmdr' : '', c.foil && S.foilFx !== false ? 'foil' : '', S.sel === c.id && !o.noid ? 'sel' : '', o.cls || ''].join(' ');
  const st = (o.style || '') + ';' + f.style;
  const idA = o.noid ? '' : `data-id="${c.id}"`;
  if (hidden) return `<div class="${cls} facedown" ${idA} style="${st}"><div class="ci back ${backOk ? 'pic' : ''}"><span>EC</span>${backOk ? `<img src="${CARD_BACK}" alt="" draggable="false" decoding="async">` : ''}</div></div>`;
  const sg = c.p1 > 0 ? '+' : '';
  const over = `${c.p1 ? `<div class="bp">${sg}${c.p1}/${sg}${c.p1}</div>` : ''}${c.ctr ? `<div class="bc">${c.ctr}</div>` : ''}${c.dmg ? `<div class="dmg" title="Damage marked this turn">${c.dmg}</div>` : ''}${c.sick && c.zone === 'battlefield' && isCreature(c) && !Rules.has(c, 'haste') ? '<div class="zz" title="Summoning sick: can\'t attack until your next turn">zz</div>' : ''}${c.token ? '<div class="tk">Token</div>' : ''}`;
  const src = faceSrc(c, o.big);
  if (src) {
    const mod = c.pt && ptModified(c) ? ptOf(c) : null;
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
  if (fromZone === 'battlefield' && zone !== 'battlefield') { c.tapped = false; c.p1 = 0; c.ctr = 0; c.dmg = 0; c.sick = false; c.faceDown = false; c.flipped = false; S.attacks = S.attacks.filter((a) => a.id !== id); S.attacks.forEach((a) => { if (a.blockers && a.blockers.includes(id)) { a.blockers = a.blockers.filter((b) => b !== id); } }); }
  if (fromZone === 'command' && c.isCmdr && o.cast) c.casts = (c.casts || 0) + 1;
  c.controller = (zone === 'battlefield' || zone === 'stack' || zone === 'hand') ? pi : c.owner;
  c.zone = zone;
  // Commander rule: when it would hit a graveyard, exile, hand or library, its owner may send it to the command zone instead.
  if (c.isCmdr && !o.forced && ['graveyard', 'exile', 'library', 'hand'].includes(zone) && (fromZone === 'battlefield' || fromZone === 'stack') && net.isMine(c.owner)) {
    if (P(c.owner).bot) { setTimeout(() => commanderTo(c, 'command', zone), 0); }
    else setTimeout(() => commanderChoice(c, zone), 0);
  }
  if (zone === 'stack') S.stack.push(id);
  else { const list = P(c.controller).zones[zone]; if (zone === 'library') { o.bottom ? list.push(id) : list.unshift(id); } else list.push(id); }
  render();
  if (zone === 'battlefield') { if (fromZone !== 'battlefield') c.sick = true; if (o.x == null) autoPlace(c); else { c.x = o.x; c.y = o.y; } render();
    if (fromZone !== 'battlefield' && MODE !== 'hotseat' && !o.forced) { const r = rulesFor(c.controller); const kinds = [...r.entersTapped]; const hit = kinds.find((k) => spellKind(c, k === 'nonbasic' ? 'nonbasic' : k) || (k === 'creature' && isCreature(c))); if (hit && !c.tapped) { const src = r.sources.find((x) => x.rule === 'entersTapped'); if (P(c.controller).bot) { c.tapped = true; log(`${c.name} enters tapped (${src ? src.name : 'board rule'})`); } else if (net.isMine(c.controller) && S.reminders !== false) toast(`${src ? src.name : 'Board rule'}: ${c.name} enters tapped`, 5000); } }
    if (fromZone !== 'battlefield' && MODE !== 'hotseat') setTimeout(() => { if (S.cards[id] && c.zone === 'battlefield') { fireEvent('etb', { card: c }); if (/Land/.test(c.type)) fireEvent('landfall', { card: c }); if (isCreature(c)) fireEvent('creatureEnters', { card: c }); if (c.token) fireEvent('tokenEnters', { card: c }); } }, 60); }
  if (fromZone === 'battlefield' && zone === 'graveyard' && MODE !== 'hotseat' && isCreature(c)) setTimeout(() => { fireEvent('dies', { card: c }); fireEvent('anyDies', { card: c }); }, 60);
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
function commanderTo(c, dest, from) {
  if (!S.cards[c.id] || c.zone !== from) return;
  if (dest === 'command') { moveCard(c.id, c.owner, 'command', { forced: true, anim: 'fly' }); log(`${c.name} returned to the command zone`); }
  else log(`${P(c.owner).name} left ${c.name} in the ${ZLABEL[from].toLowerCase()}`);
}
function commanderChoice(c, from) {
  if (!S.cards[c.id] || c.zone !== from) return;
  const where = ZLABEL[from].toLowerCase();
  openModal(`<h2>${esc(c.name)} ${from === 'graveyard' ? 'died' : from === 'exile' ? 'was exiled' : 'left the battlefield'}</h2><p>It’s your commander. Send it back to the command zone, or leave it in the ${esc(where)}${from === 'graveyard' ? ' (for reanimation, say)' : ''}? The next cast from the command zone costs ${2 * ((c.casts || 0) + 0)} more.</p>
  <div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" id="cmdStay">Leave it in the ${esc(where)}</button><button type="button" class="btn" id="cmdHome" data-autofocus>Command zone</button></div>`, { cls: 'narrow' });
  $('#cmdHome').onclick = () => { closeModal(); commanderTo(c, 'command', from); };
  $('#cmdStay').onclick = () => { closeModal(); commanderTo(c, from, from); };
}
function castToStack(id, fromRect) {
  const c = S.cards[id]; if (!c) return;
  const fromCmd = c.zone === 'command'; const who = P(c.controller).name;
  if (/Land/.test(c.type) && !fromCmd) { log(`${who} played ${c.name}`); moveCard(id, c.controller, 'battlefield', { anim: 'land', fromRect }); return; }
  S.stats.casts[c.controller] = (S.stats.casts[c.controller] || 0) + 1;
  if (fromCmd) log(`${who} cast ${c.name} from the command zone (tax ${2 * (c.casts || 0)})`); else log(`${who} cast ${c.name}`);
  if (MODE !== 'hotseat') { const nth = noteCast(c.controller); if (net.active && !net.isHost) net.send('all', { fn: 'cast', seat: c.controller, cardId: c.id, nth, type: c.type }); else { fireEvent('opponentCasts', { caster: c.controller, card: c, nth }); fireEvent('youCast', { caster: c.controller, card: c, nth }); } }
  if (isPerm(c)) { moveCard(id, c.controller, 'battlefield', { anim: fromCmd ? 'commander' : 'cast', fromRect, cast: fromCmd }); return; }
  // Instants and sorceries: announce, flash the card at the table, then it goes to the graveyard.
  const from = fromRect || visRect(cardEl(id)); const dest = c.isCmdr ? 'command' : 'graveyard';
  S.lastSpell = { id, t: Date.now() };
  spellFlash(c, from);
  if (fromCmd) c.casts = (c.casts || 0) + 1;
  moveCard(id, c.owner, dest, { anim: 'none', fromRect: from, forced: true });
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
  else moveCard(id, c.owner, c.isCmdr ? 'command' : 'graveyard', { anim: 'fly', forced: true });
}
function draw(pi, n) {
  const p = P(pi); let k = 0;
  const step = () => {
    if (k >= n) return;
    const id = p.zones.library[0];
    if (!id) { toast(`${p.name}'s library is empty`); return; }
    moveCard(id, pi, 'hand', { anim: 'fly' }); k++;
    if (MODE !== 'hotseat' && S.turn.number >= 1) { const q = P(pi); if (!q.drawsTurn || q.drawsTurn.turn !== S.turn.number) q.drawsTurn = { turn: S.turn.number, n: 0 }; q.drawsTurn.n++; if (net.active && !net.isHost) net.send('all', { fn: 'drew', seat: pi, n: 1 }); else fireEvent('opponentDraws', { drawer: pi, n: 1 }); }
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
    if (def._art) Object.assign(c, def._art);
    render(); autoPlace(c); render(); if (MODE !== 'hotseat') setTimeout(() => { if (S.cards[c.id]) { fireEvent('creatureEnters', { card: c }); fireEvent('tokenEnters', { card: c }); } }, 60);
    const el = cardEl(c.id); FX.pop(el); FX.puff(visRect(el), colorHex(c)); SFX.play('pop');
    if (++k < count) setTimeout(step, motionMul() ? 110 : 0);
  };
  step(); log(`${p.name} created ${count} ${def.name} token${count > 1 ? 's' : ''}`);
  if (!def.copyOf && !def.img) fetchToken(def.name, def.pt, def.colors).then((t) => { if (!t) return; def._art = { img: t.img, big: t.big, art: t.art, artist: t.artist }; Object.values(S.cards).forEach((c) => { if (c.token && c.owner === pi && c.name === def.name && c.pt === (def.pt || '') && !c.img) Object.assign(c, { img: t.img, big: t.big, art: t.art, artist: t.artist, kw: c.kw || t.kw, oracle: c.oracle || t.oracle }); }); render(); });
}
function attack(c, t) {
  const ex = S.attacks.find((a) => a.id === c.id);
  if (ex) { ex.target = t; ex.t = Date.now(); ex.ok = false; ex.blockers = []; } else S.attacks.push({ id: c.id, target: t, t: Date.now(), ok: false, blockers: [] });
  if (S.turn.phase !== 2) S.turn.phase = 2; if (!Rules.has(c, 'vigilance')) c.tapped = true; render();
  FX.lunge(cardEl(c.id), visRect(lifeEl(t))); SFX.play('charge'); log(`${c.name} attacks ${P(t).name}`);
  fireEvent('attacks', { card: c, target: t }); fireEvent('anyAttacks', { card: c, target: t });
  botDefend();
}
// The defender gets a say before damage happens: block with a creature, or let it through.
const attackOf = (c) => S.attacks.find((a) => a.id === c.id);
const needsAnswer = (a) => !a.ok && !(a.blockers && a.blockers.length);
const isBlocked = (a) => !!(a.blockers && a.blockers.length);
function allowAttack(a) { a.ok = true; a.blockers = []; log(`${P(a.target).name} takes the hit from ${S.cards[a.id]?.name || 'an attacker'}`); render(); }
function allowAll(t) { S.attacks.filter((a) => a.target === t && needsAnswer(a)).forEach((a) => { a.ok = true; a.blockers = []; }); log(`${P(t).name} lets the attack through`); render(); }
let blocking = null;
function startBlocking(a) { blocking = { attackId: a.id, seat: a.target }; render(); }
function stopBlocking() { blocking = null; render(); }
// Tap a legal blocker to add it; tap again to remove. Menace needs two; flying needs flying or reach.
function setBlock(a, blockerId) {
  const b = S.cards[blockerId]; const atk = S.cards[a.id]; if (!b || !atk) return;
  if (!Rules.canBlock(b, atk)) { toast(Rules.blockLegal(atk, [b]).why || `${b.name} can't block that`); return; }
  a.blockers = a.blockers || [];
  if (a.blockers.includes(blockerId)) a.blockers = a.blockers.filter((x) => x !== blockerId);
  else { a.blockers = [...a.blockers, blockerId]; FX.slam(cardEl(blockerId), 1.1); SFX.play('whoosh'); }
  a.ok = false; render();
}
function finishBlock(a) {
  const atk = S.cards[a.id]; const bl = (a.blockers || []).map((id) => S.cards[id]).filter(Boolean);
  const legal = Rules.blockLegal(atk, bl); if (!legal.ok) { toast(legal.why); return; }
  blocking = null;
  if (bl.length) { const r = Rules.simulate(atk, bl); log(`${P(a.target).name} blocks ${atk.name} with ${bl.map((b) => b.name).join(' and ')} (${Rules.describe(atk, bl, r)})`); } else { allowAttack(a); return; }
  render();
}
function unblock(a) { a.blockers = []; a.ok = false; render(); }
function dmgTo(card, n, src, lethal = false) {
  if (!card || n <= 0) return;
  if (net.isMine(card.controller)) REQ.cardDmg(card.controller, card.id, n, src ? src.id : null, lethal); else request(card.controller, 'cardDmg', card.id, n, src ? src.id : null, lethal);
}
function combatDamage(c, t) {
  const a = attackOf(c);
  if (a && isBlocked(a)) { resolveBlock(a); return; }
  if (a && !a.ok && !P(t).bot) { toast(`Waiting for ${P(t).name} to block or take it`); return; }
  const n = powerOf(c); if (n <= 0) { toast(`${c.name} has no power to deal damage`); return; }
  S.attacks = S.attacks.filter((x) => x.id !== c.id);
  if (Rules.has(c, 'lifelink')) { log(`${P(c.controller).name} gains ${n} (lifelink)`); changeLifeAny(c.controller, n); }
  setTimeout(() => fireEvent('combatDamage', { card: c, target: t }), 200);
  if (!net.isMine(t)) { render(); request(t, 'combat', c.id); return; }
  REQ.combat(t, c.id);
}
function changeLifeAny(i, d) { if (net.isMine(i)) changeLife(i, d); else request(i, 'changeLife', d); }
function resolveBlock(a) {
  const c = S.cards[a.id]; if (!c) return;
  const blockers = (a.blockers || []).map((id) => S.cards[id]).filter(Boolean);
  S.attacks = S.attacks.filter((x) => x.id !== a.id); render();
  if (!blockers.length) return;
  const r = Rules.simulate(c, blockers);
  const byId = Object.fromEntries([c, ...blockers].map((x) => [x.id, x]));
  const dealt = {}; r.events.forEach((e) => { const k = `${e.from}>${e.to}`; dealt[k] = (dealt[k] || 0) + e.n; });
  Object.entries(dealt).forEach(([k, n]) => { const [from, to] = k.split('>'); const src = byId[from]; if (to === 'player') { log(`${src.name} tramples over for ${n} to ${P(a.target).name}`); if (src.isCmdr && net.isMine(a.target)) P(a.target).cmdDmg[src.id] = (P(a.target).cmdDmg[src.id] || 0) + n; changeLifeAny(a.target, -n); } else { log(`${src.name} deals ${n} to ${byId[to].name}`); dmgTo(byId[to], n, src, r.blockersDie.includes(to) || (to === c.id && r.attackerDies)); } });
  Object.entries(r.lifelink).forEach(([pi, n]) => { log(`${P(+pi).name} gains ${n} (lifelink)`); changeLifeAny(+pi, n); });
  log(Rules.describe(c, blockers, r));
  SFX.play('hit');
}
// Resolve every attack of mine the defenders have answered.
function resolveCombat(seat) {
  const ready = S.attacks.filter((a) => { const c = S.cards[a.id]; return c && c.controller === seat && (a.ok || isBlocked(a) || P(a.target).bot); });
  if (!ready.length) { toast('Nothing to resolve yet'); return; }
  ready.forEach((a, k) => setTimeout(() => { const c = S.cards[a.id]; if (c) combatDamage(c, a.target); }, k * 350));
}
// Bots answer attacks against them: block when a creature would survive, otherwise take it.
function botDefend() {
  const pending = S.attacks.filter((a) => needsAnswer(a) && P(a.target).bot && net.isMine(a.target) && !a._botTimer);
  pending.forEach((a) => {
    a._botTimer = true;
    setTimeout(() => {
      delete a._botTimer; if (!S.attacks.includes(a) || !needsAnswer(a)) return;
      const atk = S.cards[a.id]; if (!atk) return;
      const used = new Set(S.attacks.flatMap((x) => x.blockers || []));
      const choice = bot ? bot.chooseBlock(a, used) : [];
      if (choice.length) { a.blockers = choice; a.ok = false; const bl = choice.map((id) => S.cards[id]); log(`${P(a.target).name} blocks ${atk.name} with ${bl.map((b) => b.name).join(' and ')} (${Rules.describe(atk, bl, Rules.simulate(atk, bl))})`); choice.forEach((id) => FX.slam(cardEl(id), 1.1)); SFX.play('whoosh'); render(); }
      else allowAttack(a);
    }, 600 + Math.random() * 700);
  });
}
function clearPumps() { Object.values(S.cards).forEach((c) => { if ((c.tp || c.tt || c.tkw) && net.isMine(c.controller)) { c.tp = 0; c.tt = 0; c.tkw = ''; } }); }
function clearSick(active) { Object.values(S.cards).forEach((c) => { if (c.sick && c.controller === active && net.isMine(c.controller)) c.sick = false; }); }
function clearDamage() { Object.values(S.cards).forEach((c) => { if (c.dmg && net.isMine(c.controller)) c.dmg = 0; }); }
function changeLife(i, d, o = {}) {
  const p = P(i); if (!d) return; p.life += d;
  const amt = Math.abs(d);
  if (!o.manual && amt > (S.stats.big?.amt || 0)) S.stats.big = { amt, text: o.src ? `${o.src.name} hit ${p.name} for ${amt}` : `${p.name} ${d < 0 ? 'lost' : 'gained'} ${amt} life at once` };
  render();
  FX.floatNum(lifeEl(i), d);
  if (d < 0) { FX.shake(seatEl(i)); SFX.play('hit'); if (i === S.view) hurtFlash(); } else SFX.play('heal');
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
  S.attacks = []; clearDamage(); clearPumps();
  let n = S.turn.active;
  const ns = S.seats || 4;
  for (let k = 1; k <= ns; k++) { const c = (S.turn.active + k) % ns; if (!P(c).out && !P(c).empty) { n = c; break; } }
  if (n <= S.turn.active) S.turn.number++;
  S.turn.active = n; S.turn.phase = 0;
  const p = P(n); const tapped = p.zones.battlefield.filter((id) => S.cards[id].tapped);
  clearSick(n);
  tapped.forEach((id) => { S.cards[id].tapped = false; cardEl(id)?.classList.remove('tapped'); });
  if (MODE !== 'hotseat' && tapped.length) { // Winter Orb, Static Orb, Stasis, Hokori: only some of it untaps
    const r = rulesFor(n);
    if (r.untap) {
      const cards = tapped.map((id) => S.cards[id]); const isL = (c) => /Land/.test(c.type);
      const keyOf = (c) => (isL(c) ? 10 + (String(c.oracle || '').match(/\{[wubrg]\}/g) || []).length : /Artifact/.test(c.type) && /add \{/i.test(c.oracle || '') ? 8 : isCreature(c) ? powerOf(c) : 1);
      let allow = cards.slice().sort((a, b) => keyOf(b) - keyOf(a));
      if (r.untap.permanents !== Infinity) allow = allow.slice(0, r.untap.permanents);
      if (r.untap.lands !== Infinity) { const lands = allow.filter(isL).slice(0, r.untap.lands + (r.untap.plusUpkeep || 0)); allow = [...allow.filter((c) => !isL(c)), ...lands]; }
      const stay = cards.filter((c) => !allow.includes(c));
      if (stay.length) { if (p.bot) { stay.forEach((c) => { c.tapped = true; }); log(`${p.name} untaps only ${allow.length} permanent${allow.length === 1 ? '' : 's'} (${r.untap.src})`); } else if (net.isMine(n) && S.reminders !== false) toast(`${r.untap.src}: you may untap only ${r.untap.lands !== Infinity ? `${r.untap.lands + (r.untap.plusUpkeep || 0)} land${r.untap.lands === 1 ? '' : 's'}` : `${r.untap.permanents} permanents`} this turn`, 7000); }
    }
  }
  if (tapped.length) SFX.play('tick');
  log(`${p.name}'s turn`);
  banner(`${p.name}'s turn`, `Round ${S.turn.number}`, n);
  if (MODE !== 'hotseat') setTimeout(() => fireEvent('upkeep', { seat: n }), 400);
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
    victims.forEach((c) => { if (S.cards[c.id]) moveCard(c.id, c.owner, c.isCmdr ? 'command' : 'graveyard', { anim: 'none', forced: true }); });
    log(`Board wipe: ${victims.length} permanent${victims.length > 1 ? 's' : ''} destroyed${victims.some((c) => c.isCmdr) ? ' (commanders went to the command zone)' : ''}`); render();
  }, motionMul() ? 280 : 0);
}

/* ---------- Room sync ---------- */
const CARD_FIELDS = ['id', 'name', 'cost', 'type', 'pt', 'colors', 'owner', 'controller', 'zone', 'tapped', 'faceDown', 'flipped', 'p1', 'ctr', 'dmg', 'kw', 'sick', 'anim', 'set', 'num', 'foil', 'tp', 'tt', 'tkw', 'token', 'copyOf', 'x', 'y', 'isCmdr', 'casts'];
function seatSnap(i) {
  const p = P(i);
  const cards = Object.values(S.cards).filter((c) => c.owner === i).map((c) => { const o = {}; CARD_FIELDS.forEach((k) => { if (c[k] !== undefined) o[k] = c[k]; }); return o; });
  return { seat: i, player: { name: p.name, life: p.life, poison: p.poison, cmdDmg: p.cmdDmg, out: p.out, outAt: p.outAt, mulls: p.mulls, mat: p.mat, bot: p.bot, avatar: p.avatar || '', empty: !!p.empty }, zones: p.zones, cards };
}
function sharedSnap() { return { turn: S.turn, stack: S.stack, attacks: S.attacks, pending: S.pending || null, over: S.over, outOrder: S.outOrder, stats: S.stats, log: S.log.slice(0, 40) }; }
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
  const turnChanged = S.turn.active !== sn.turn.active || S.turn.number !== sn.turn.number;
  S.turn = sn.turn; S.stack = sn.stack; S.attacks = sn.attacks; S.outOrder = sn.outOrder; S.stats = sn.stats; if (!net.isHost) S.pending = sn.pending || null;
  if (turnChanged) { clearDamage(); clearPumps(); clearSick(S.turn.active); }
  botDefend();
  const was = S.over; S.over = sn.over;
  if (sn.log && sn.log[0] && (!S.log[0] || S.log[0].t < sn.log[0].t)) S.log = sn.log;
  const nowIn = S.attacks.filter((a) => S.cards[a.id] && net.isMine(a.target) && !P(a.target).bot && needsAnswer(a) && S.cards[a.id].controller !== a.target).length;
  if (nowIn > (applyShared.lastIn || 0)) { SFX.play('charge'); if (!sideVisible()) toast('You are being attacked'); }
  applyShared.lastIn = nowIn;
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
  draw: (to, n) => draw(to, n),
  token: (to, def, n) => createTokens(to, def, n),
  mill: (to, n) => { const p = P(to); const ids = p.zones.library.splice(0, n); ids.forEach((id) => { S.cards[id].zone = 'graveyard'; p.zones.graveyard.push(id); }); log(`${p.name} milled ${ids.length}`); render(); },
  discard: (to, n, srcName) => { const p = P(to); if (p.bot) { const hand = p.zones.hand.map((id) => S.cards[id]).sort((a, b) => valueOf(a) - valueOf(b)); hand.slice(0, n).forEach((c) => moveCard(c.id, to, 'graveyard', { anim: 'fly' })); log(`${p.name} discarded ${hand.slice(0, n).map((c) => c.name).join(', ')}`); } else pickModal(to, 'hand', n, `Discard ${n} card${n > 1 ? 's' : ''} (${srcName})`, (ids) => ids.forEach((id) => { moveLog(S.cards[id], 'graveyard'); moveCard(id, to, 'graveyard', { anim: 'fly' }); })); },
  edict: (to, n, what, srcName) => { const p = P(to); const pool = seatCards(to, (c) => matchesWhat(c, what)); if (!pool.length) { log(`${p.name} has no ${what} to sacrifice`); return; } if (p.bot) { pool.sort((a, b) => valueOf(a) - valueOf(b)).slice(0, n).forEach((c) => { log(`${p.name} sacrificed ${c.name}`); moveCard(c.id, to, 'graveyard', { anim: 'fly' }); }); } else pickModal(to, 'battlefield', n, `Sacrifice ${n} ${what}${n > 1 ? 's' : ''} (${srcName})`, (ids) => ids.forEach((id) => { log(`${p.name} sacrificed ${S.cards[id].name}`); moveCard(id, to, 'graveyard', { anim: 'fly' }); }), (c) => matchesWhat(c, what)); },
  ask: (to, key, srcId, n, srcName) => { const src = S.cards[srcId] || { name: srcName, oracle: '', controller: to }; payModal(to, src, n, (paid) => net.send('all', { fn: 'answer', key, paid })); },
  cardTo: (to, cardId, zone) => { const c = S.cards[cardId]; if (c && c.controller === to) moveCard(cardId, c.owner, zone); },
  cardDmg: (to, cardId, n, srcId, lethal) => {
    const c = S.cards[cardId]; if (!c || c.zone !== 'battlefield') return;
    c.dmg = (c.dmg || 0) + n; const tough = toughnessOf(c); const src = srcId ? S.cards[srcId] : null;
    FX.shake(cardEl(cardId)); SFX.play('hit');
    const dies = !Rules.has(c, 'indestructible') && (lethal || (tough > 0 && c.dmg >= tough) || (src && Rules.has(src, 'deathtouch')));
    if (dies) { log(`${c.name} was destroyed`); setTimeout(() => { if (S.cards[cardId] && S.cards[cardId].zone === 'battlefield') { moveCard(cardId, c.owner, 'graveyard'); FX.puff(cardEl(cardId) || seatEl(to), colorHex(c)); } }, 450); }
    render();
  },
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
// Auto playmats: each seat gets the guild that fits its commander, but no two seats share a mat when the
// game starts. Players can still pick the same one by hand. Resolved in seat order so every client agrees.
const MAT_PREFS = { W: ['orzhov', 'azorius', 'boros', 'selesnya'], U: ['azorius', 'izzet', 'dimir', 'simic'], B: ['golgari', 'dimir', 'rakdos', 'orzhov'], R: ['rakdos', 'boros', 'izzet', 'gruul'], G: ['selesnya', 'gruul', 'simic', 'golgari'] };
const MAT_FALLBACK = ['azorius', 'rakdos', 'selesnya', 'dimir', 'izzet', 'golgari', 'boros', 'orzhov', 'gruul', 'simic'];
function matPrefs(i) {
  const c = commandersOf(i)[0]; const cols = c ? (c.colors || '').replace(/[^WUBRG]/g, '') : '';
  const out = [];
  if (cols.length === 2) { const pr = MAT_BY_PAIR[cols] || MAT_BY_PAIR[cols[1] + cols[0]]; if (pr) out.push(pr); }
  for (const k of cols) (MAT_PREFS[k] || []).forEach((m) => out.push(m));
  out.push(MAT_FALLBACK[i % MAT_FALLBACK.length], ...MAT_FALLBACK);
  return [...new Set(out)];
}
function autoMats() {
  const n = S.seats || 4; const taken = new Set(); const out = {};
  for (let i = 0; i < n; i++) { const p = P(i); if (p.mat && p.mat !== 'auto' && (MATS[p.mat] || (p.mat === 'custom' && customMats[i]))) taken.add(p.mat); }
  for (let i = 0; i < n; i++) {
    const p = P(i); if (p.mat && p.mat !== 'auto' && (MATS[p.mat] || (p.mat === 'custom' && customMats[i]))) continue;
    const pick = matPrefs(i).find((m) => !taken.has(m)) || matPrefs(i)[0];
    taken.add(pick); out[i] = pick;
  }
  return out;
}
function matOf(i) {
  const p = P(i);
  if (p.mat === 'custom' && customMats[i]) return 'custom';
  if (p.mat && p.mat !== 'auto' && MATS[p.mat]) return p.mat;
  return autoMats()[i] || MAT_FALLBACK[i % MAT_FALLBACK.length];
}
const others = () => [1, 2, 3].map((k) => (S.view + k) % 4).filter((k) => k < (S.seats || 4));
function avatarHTML(i, big) {
  const p = P(i); const c = commandersOf(i)[0];
  const ring = c ? colorHex(c) : css('--gold');
  const pic = !p.bot && p.avatar ? p.avatar : (c && c.art ? c.art : '');
  const art = pic ? ` style="background-image:url(${esc(pic)});--ring:${ring}"` : ` style="--ring:${ring}"`;
  return `<div class="avatar ${p.bot ? 'bot' : ''} ${!p.bot && p.avatar ? 'photo' : ''}"${art}>${pic ? '' : `<span class="init">${esc((p.name || '?')[0].toUpperCase())}</span>`}<button type="button" class="lifebadge" data-life="${i}" data-act="dmg" data-p="${i}" title="Damage, poison and commander damage">${p.life}</button></div>`;
}
function seatHTML(i, full) {
  const p = P(i); const active = S.turn.active === i;
  const cmdNames = commandersOf(i).map((c) => c.name).join(' + ');
  const maxCmd = Math.max(0, ...Object.values(p.cmdDmg));
  const warn = maxCmd >= 15 || p.poison >= 7;
  const usedB = new Set(S.attacks.flatMap((a) => a.blockers || []));
  const bf = p.zones.battlefield.map((id) => { const c = S.cards[id]; const atk = S.attacks.some((a) => a.id === id); const blk = usedB.has(id); const atkCard = blocking ? S.cards[blocking.attackId] : null; const chosen = blocking && S.attacks.find((x) => x.id === blocking.attackId)?.blockers?.includes(id); const can = blocking && blocking.seat === i && atkCard && Rules.canBlock(c, atkCard) && (!blk || chosen); return cardHTML(c, { cls: `${atk ? 'attacking' : ''} ${blk ? 'blocking' : ''} ${can ? 'canblock' : ''}`, style: `left:${(c.x * 100).toFixed(2)}%;top:${(c.y * 100).toFixed(2)}%` }); }).join('');
  const mp = (z, label, n) => `<button type="button" class="mp" data-act="pile" data-zone="p${i}-${z}" data-pile="p${i}-${z}" title="${label}">${label} <b>${n}</b></button>`;
  const plate = `<div class="plate">${avatarHTML(i, full)}<div class="pinfo">
    <button type="button" class="pname" data-act="seatmenu" data-p="${i}"><span>${esc(p.name)}</span>${identityPips(i)}${p.out ? '<span class="outtag">Out</span>' : ''}${p.empty ? '<span class="chip">Waiting…</span>' : ''}</button>
    <span class="cmdn">${esc(cmdNames)}</span>
    <div class="pstat">${(maxCmd || p.poison || warn) ? `<button type="button" class="chip ${warn ? 'warn' : ''}" data-act="dmg" data-p="${i}">Cmdr ${maxCmd} · Poison ${p.poison}</button>` : ''}<span class="lifectl"><button type="button" data-act="life" data-p="${i}" data-d="-1" title="−1 (shift: −5)">−</button><button type="button" data-act="life" data-p="${i}" data-d="1" title="+1 (shift: +5)">+</button></span></div>
  </div></div>`;
  const crack = p.out ? `<svg class="crack ${Date.now() - p.outAt < 1200 ? 'fresh' : ''}" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M52 0 L47 22 L58 35 L44 55 L55 72 L49 100"/><path d="M47 22 L30 30 L18 26"/><path d="M58 35 L76 40 L90 33"/><path d="M44 55 L26 62 L12 74"/><path d="M55 72 L72 80 L86 92"/></svg>` : '';
  const empty = p.zones.battlefield.length ? '' : `<div class="bf-empty">${full ? 'Drag cards here. Click to tap, right-click for more.' : ''}</div>`;
  let dock = '';
  if (full) {
    const slot = (z, label) => {
      const list = p.zones[z]; let inner;
      if (z === 'library') inner = list.length ? `<div class="card"><div class="ci back stackback ${backOk ? 'pic' : ''}"><span>EC</span>${backOk ? `<img src="${CARD_BACK}" alt="" draggable="false">` : ''}</div></div>` : '<span class="empty">Empty</span>';
      else inner = list.length ? cardHTML(S.cards[list[list.length - 1]]) : `<span class="empty">${z === 'command' ? 'None' : 'Empty'}</span>`;
      const tax = z === 'command' ? commandersOf(i).filter((c) => c.zone === 'command').map((c) => `<span class="tax" title="${esc(c.name)}: commander tax">${net.isMine(i) ? `<button type="button" class="taxbtn" data-act="tax" data-id="${c.id}" data-d="-1" title="Lower tax" ${c.casts ? '' : 'disabled'}>−</button>` : ''}Tax +${2 * (c.casts || 0)}${net.isMine(i) ? `<button type="button" class="taxbtn" data-act="tax" data-id="${c.id}" data-d="1" title="Raise tax">+</button>` : ''}</span>`).join('') : '';
      const cnt = (z !== 'command' && list.length) ? `<span class="cnt">${list.length}</span>` : '';
      return `<div class="pile" data-zone="p${i}-${z}" data-pile="p${i}-${z}"><div class="slot" data-act="pileclick" data-zone="p${i}-${z}" title="${z === 'library' ? 'Click to draw. Right-click for more.' : label}">${inner}${cnt}</div><button type="button" class="pl" data-act="pile" data-zone="p${i}-${z}">${label}</button>${tax}</div>`;
    };
    const hand = p.zones.hand.map((id) => cardHTML(S.cards[id], SPECTATE ? { back: true } : {})).join('') || `<span class="hand-empty">${SPECTATE ? 'Empty hand' : 'Your hand is empty'}</span>`;
    const mine = net.isMine(S.turn.active) && S.turn.active === i;
    dock = `<div class="dock"><div class="piles">${slot('command', 'Command')}${slot('library', 'Library')}${slot('graveyard', 'Graveyard')}${slot('exile', 'Exile')}</div>
      <div class="handwrap"><div class="handbar"><span>Hand · ${p.zones.hand.length}</span><span class="sp"></span><button type="button" class="btn ghost sm" data-act="draw" data-p="${i}">Draw</button><button type="button" class="btn ghost sm" data-act="mull" data-p="${i}">Mulligan</button></div>
      <div class="hand" data-zone="p${i}-hand" data-pile="p${i}-hand">${hand}</div></div>
      <div class="actions"><button type="button" class="endturn ${mine ? 'mine' : ''}" data-act="pass">${mine ? 'End turn' : 'Pass turn'}</button><button type="button" class="btn sm" data-act="next">Next phase</button></div></div>`;
  }
  const mat = matOf(i); const matStyle = mat === 'custom' ? ` style="background-image:url(${customMats[i]})"` : '';
  const labels = full ? '<span class="zl top">Battlefield</span><span class="zl bot">Lands</span>' : '';
  const minis = full ? '' : `<button type="button" class="xp" data-act="expand" data-p="${i}" title="Expand"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg></button><div class="minipiles">${mp('hand', 'Hand', p.zones.hand.length)}${mp('library', 'Lib', p.zones.library.length)}${mp('graveyard', 'GY', p.zones.graveyard.length)}${mp('exile', 'Ex', p.zones.exile.length)}${mp('command', 'Cmd', p.zones.command.length)}</div>`;
  return `<div class="seat ${active ? 'active' : ''} ${p.out ? 'out' : ''} ${expandedSeats.has(i) ? 'expanded' : ''} ${targeting && i !== targeting.from && !p.out && i < S.seats ? 'targetable' : ''}" data-seat="${i}" data-mat="${mat}"${matStyle}>${plate}<div class="bf" data-zone="p${i}-battlefield">${labels}${empty}${bf}</div>${minis}${dock}${crack}</div>`;
}
function renderTurn() { $('#turn').innerHTML = ''; }
function renderMid() {
  const p = P(S.turn.active); const mine = net.isMine(S.turn.active);
  const last = S.log[0] ? S.log[0].text : 'Game log';
  $('#mid').innerHTML = `<div class="turnbar ${mine ? 'mine' : ''}">
    <div class="tb-who"><span class="tn">Round ${S.turn.number}</span><span class="who">${identityPips(S.turn.active)}${mine ? 'Your turn' : esc(p.name) + "'s turn"}</span></div>
    <div class="phases" role="group" aria-label="Phase">${PHASES.map((ph, k) => `<button type="button" class="ph ${k === S.turn.phase ? 'on' : ''}" data-act="phase" data-k="${k}">${ph}</button>`).join('')}</div>
    <div class="midtools"><button type="button" class="btn ghost sm" data-act="token">Token</button><button type="button" class="btn ghost sm" data-act="wipe">Board wipe</button><button type="button" class="btn ghost sm" data-act="d20">Roll d20</button><button type="button" class="ticker" data-act="log" title="Open the game log">${esc(last)}</button></div>
  </div>`;
  renderSide();
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
  if (net.active && net.ready && net.seat != null) rememberRoom(ROOM.code, { seat: net.seat, clientId: undefined, ...recallRoom(ROOM.code), mine: net.ownedSeats().map(seatSnap), shared: sharedSnap(), deck: { id: P(net.seat).deckId, name: P(net.seat).deckName } });
  maybeBot();
  if (zoomId && !S.cards[zoomId]) hideZoom();
  renderPrompt();
  const tb = $('#tapbar'); if (tb && !tb.hidden) { const tc = S.cards[tb.dataset.id]; if (tc && cardEl(tc.id)) requestAnimationFrame(() => showTapbar(tc)); else hideTapbar(); }
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
    const blk = isBlocked(a) ? cardEl(a.blockers[0]) : null;
    const r1 = visRect(cardEl(a.id)), r2 = visRect(blk || $(`.seat[data-seat="${a.target}"] .avatar`)); if (!r1 || !r2) return;
    const state = blk ? 'blocked' : a.ok ? 'ok' : '';
    const x1 = r1.left + r1.width / 2, y1 = r1.top + r1.height / 2, x2 = r2.left + r2.width / 2, y2 = r2.top + r2.height / 2;
    const mx = (x1 + x2) / 2 + (y2 - y1) * 0.15, my = (y1 + y2) / 2 - Math.abs(x2 - x1) * 0.18 - 40;
    const fresh = Date.now() - a.t < 700 && motionMul();
    const d = `M${x1},${y1} Q${mx},${my} ${x2},${y2}`;
    out += `<g class="${state}"><path class="arw glow" d="${d}"/><path class="arw ${fresh ? 'fresh' : ''}" d="${d}" marker-end="url(#ah)"/><path class="arw dash" d="${d}"/></g>`;
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

/* ---------- Side panel ---------- */
let sideTab = 'log';
function renderSide() {
  const el = $('#sideLog'); if (!el) return;
  const fmt = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const rows = S.log.slice(0, 60).map((l) => {
    const who = S.players.find((p) => l.text.startsWith(p.name)); const k = who ? S.players.indexOf(who) : -1;
    const c = k >= 0 ? commandersOf(k)[0] : null; const dot = c ? `<span class="ldot" style="border-color:${colorHex(c)}"><i class="ms ms-${firstColor(c).toLowerCase()}"></i></span>` : '<span class="ldot">·</span>';
    const text = who ? `<b>${esc(who.name)}</b>${esc(l.text.slice(who.name.length))}` : esc(l.text);
    return `<div class="logrow">${dot}<div>${text}<time>${fmt(l.t)}</time></div></div>`;
  }).join('');
  el.innerHTML = rows || '<p class="side-empty">Nothing has happened yet.</p>';
}
function sideCardHTML(c) {
  const src = faceSrc(c, true); const hidden = c.faceDown && c.controller !== S.view;
  const meta = `<b>${esc(c.flipped && c.backImg ? c.name.split(' // ')[1] || c.name : c.name)}</b>${esc(c.type)}<br><span>${esc(P(c.owner).name)} · ${ZLABEL[c.zone]}${c.isCmdr ? ` · Tax +${2 * (c.casts || 0)}` : ''}${c.tapped ? ' · Tapped' : ''}${c.artist ? ` · Illus. ${esc(c.artist)}` : ''}</span>`;
  return (src && !hidden ? `<img src="${esc(src)}" alt="${esc(c.name)}">` : cardHTML(c, { noid: true, flat: true, reveal: !hidden, back: hidden, cls: 'big', style: '--cw:100%' })) + `<div class="zmeta">${meta}</div>`;
}
const sideVisible = () => { const sd = $('#side'); return sd && getComputedStyle(sd).display !== 'none'; };

/* ---------- Attack targeting ---------- */
let targeting = null;
const expandedSeats = new Set();
const isCompact = () => matchMedia('(max-width: 760px), (max-height: 520px)').matches;
function startTargeting(c) { targeting = { id: c.id, from: c.controller }; render(); }
function stopTargeting() { targeting = null; render(); }
const ptTag = (c) => (ptOf(c) ? ` <small>${esc(ptOf(c))}</small>` : '');
function renderPrompt() {
  const pr = $('#prompt'); if (!pr) return;
  let html = '', cls = 'prompt';
  const mineHuman = (k) => net.isMine(k) && !P(k).bot && !P(k).out;
  if (targeting) {
    const c = S.cards[targeting.id];
    html = `<span>Choose a player for <b>${esc(c ? c.name : 'this creature')}</b> to attack</span><button type="button" class="btn sm" data-act="cancelTarget">Cancel</button>`;
  } else if (blocking) {
    const c = S.cards[blocking.attackId]; const a = S.attacks.find((x) => x.id === blocking.attackId);
    const bl = (a?.blockers || []).map((id) => S.cards[id]).filter(Boolean);
    const kw = c ? Rules.shownKeywords(c) : [];
    const preview = c && bl.length ? Rules.describe(c, bl, Rules.simulate(c, bl)) : (Rules.has(c, 'menace') ? 'Menace: pick two blockers' : (Rules.has(c, 'flying') ? 'Flying: only flying or reach creatures can block' : 'Tap a highlighted creature'));
    cls = 'prompt multi';
    html = `<div class="phead">Block <b>${esc(c ? c.name : 'the attacker')}</b>${c ? ptTag(c) : ''} ${kw.map((k) => `<em class="kwb">${esc(k)}</em>`).join('')}</div><div class="prow"><span class="pcard">${bl.length ? `With: <b>${esc(bl.map((b) => b.name).join(', '))}</b>` : ''}<small>${esc(preview)}</small></span><button type="button" class="btn ghost sm" data-act="cancelBlock">Cancel</button><button type="button" class="btn sm hot" data-act="doneBlock" ${bl.length ? '' : 'disabled'}>Done</button></div>`;
  } else {
    if (S.pending && S.pending.state === 'open' && S.cards[S.pending.id]) { cls = 'prompt multi pending'; html = pendingPromptHTML(); }
    const fromOther = (a) => S.cards[a.id].controller !== a.target;
    const incoming = S.attacks.filter((a) => S.cards[a.id] && mineHuman(a.target) && needsAnswer(a) && fromOther(a));
    const outgoing = S.attacks.filter((a) => S.cards[a.id] && net.isMine(S.cards[a.id].controller) && !P(S.cards[a.id].controller).bot);
    const held = S.attacks.filter((a) => S.cards[a.id] && mineHuman(a.target) && isBlocked(a) && fromOther(a) && !net.isMine(S.cards[a.id].controller));
    const blockRow = (a) => { const c = S.cards[a.id]; const bl = a.blockers.map((id) => S.cards[id]).filter(Boolean); return `<div class="prow"><span class="pcard">${esc(c.name)}${ptTag(c)}<small>${esc(Rules.describe(c, bl, Rules.simulate(c, bl)))}</small></span><span class="pstate">blocked by <b>${esc(bl.map((b) => b.name).join(', ') || '?')}</b></span><button type="button" class="btn ghost sm" data-act="unblock" data-id="${a.id}">Change</button></div>`; };
    if (html) { /* pending spell shown */ }
    else if (incoming.length) {
      cls = 'prompt multi incoming';
      const seat = incoming[0].target; const atkName = P(S.cards[incoming[0].id].controller).name;
      const rows = incoming.map((a) => { const c = S.cards[a.id];
        const kw = Rules.shownKeywords(c).map((k) => `<em class="kwb">${esc(k)}</em>`).join(''); const legal = P(a.target).zones.battlefield.map((id) => S.cards[id]).filter((b) => Rules.canBlock(b, c)).length;
        return `<div class="prow"><span class="pcard">${esc(c.name)}${ptTag(c)} ${kw}</span>${legal ? `<button type="button" class="btn ghost sm" data-act="block" data-id="${a.id}">Block</button>` : '<small class="pstate">no legal blockers</small>'}<button type="button" class="btn sm" data-act="allow" data-id="${a.id}">Take it</button></div>`; }).join('');
      html = `<div class="phead"><b>${esc(atkName)}</b> attacks ${MODE === 'hotseat' ? esc(P(seat).name) : 'you'}<button type="button" class="btn ghost sm" data-act="allowAll" data-p="${seat}">Take all</button></div>${rows}`;
    } else if (outgoing.length) {
      cls = 'prompt multi outgoing';
      const waiting = outgoing.filter((a) => needsAnswer(a) && !P(a.target).bot);
      const ready = outgoing.length - waiting.length;
      const names = [...new Set(waiting.map((a) => P(a.target).name))];
      const blocked = outgoing.filter(isBlocked);
      const changeable = blocked.filter((a) => mineHuman(a.target) && fromOther(a));
      html = `<div class="prow"><span class="pcard">${waiting.length ? `Waiting for <b>${esc(names.join(', '))}</b> to block or take it (${waiting.length})` : `${blocked.length ? `${blocked.length} blocked · ` : ''}Defenders have answered`}</span>${ready ? `<button type="button" class="btn sm hot" data-act="resolveCombat" data-p="${S.cards[outgoing[0].id].controller}">Resolve combat</button>` : ''}</div>${changeable.map(blockRow).join('')}`;
    } else if (held.length) {
      cls = 'prompt multi incoming held';
      html = `<div class="phead">Waiting for <b>${esc(P(S.cards[held[0].id].controller).name)}</b> to resolve combat</div>${held.map(blockRow).join('')}`;
    }
  }
  pr.className = cls; pr.innerHTML = html; pr.hidden = !html;
}
function hurtFlash() { if (!motionMul()) return; const h = document.createElement('div'); h.className = 'hurt'; $('#layer').appendChild(h); setTimeout(() => h.remove(), 800); }

/* ---------- Zoom ---------- */
const viewer = () => (SPECTATE ? -1 : S.view);
const canSee = (c) => c && !(c.zone === 'hand' && c.controller !== viewer()) && c.zone !== 'library' && !(c.faceDown && c.controller !== viewer());
function showZoom(id) {
  const c = S.cards[id]; if (!canSee(c)) { hideZoom(); return; }
  if (sideVisible()) { $('#sideCard').innerHTML = sideCardHTML(c); zoomId = id; return; }
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
/* Artwork picker: every printing of the card from Scryfall; applies to this card and every copy in the deck. */
async function artworkModal(c) {
  openModal(`<h2>Artwork for ${esc(c.name)}</h2><p>Loading printings from Scryfall…</p>`, { cls: 'wide' });
  const prints = await fetchPrintings(c.name);
  if (!prints.length) { openModal(`<h2>Artwork for ${esc(c.name)}</h2><p>Couldn’t load printings right now.</p><div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-act="close">Close</button></div>`, { cls: 'narrow' }); return; }
  const cur = `${c.set}|${c.num}`;
  openModal(`<h2>Artwork for ${esc(c.name)}</h2><p>${prints.length} printing${prints.length > 1 ? 's' : ''}. Pick one; every copy in this deck changes with it, and it’s remembered if you save the deck.</p>
  <div class="artgrid">${prints.map((e, k) => `<button type="button" class="artopt ${`${e.set}|${e.num}` === cur ? 'on' : ''} ${/foil/.test(e.finishes || '') ? 'has-foil' : ''}" data-pr="${k}" title="${esc(e.setName)} ${esc(e.year)}"><img src="${esc(e.img)}" alt="" loading="lazy"><span><b>${esc(e.setName)}</b><small>${esc(e.set.toUpperCase())} #${esc(e.num)} · ${esc(e.year)}${e.fullArt ? ' · full art' : ''}${e.frame && /showcase|extendedart|etched/.test(e.frame) ? ' · ' + esc(e.frame.replace(/,/g, ', ')) : ''}${e.finishes && !/nonfoil/.test(e.finishes) ? ' · foil only' : ''}</small><em>${esc(e.artist)}</em></span></button>`).join('')}</div>
  <div class="row" style="justify-content:space-between"><label class="chk"><input type="checkbox" id="artFoil" ${c.foil ? 'checked' : ''}> Foil</label><button type="button" class="btn" data-act="close">Done</button></div>`, { cls: 'wide' });
  $('#artFoil').onchange = (e) => { Object.values(S.cards).forEach((x) => { if (x.owner === c.owner && x.name === c.name && !x.token) x.foil = e.target.checked; }); render(); };
  $$('[data-pr]').forEach((b) => { b.onclick = () => {
    const e = prints[+b.dataset.pr]; const foil = $('#artFoil').checked || (e.finishes && !/nonfoil/.test(e.finishes));
    Object.values(S.cards).forEach((x) => { if (x.owner === c.owner && x.name === c.name && !x.token) { Object.assign(x, { set: e.set, num: e.num, img: e.img, big: e.big, art: e.art, artist: e.artist, foil, _printed: true }); } });
    $$('[data-pr]').forEach((o) => o.classList.toggle('on', o === b)); $('#artFoil').checked = foil; render(); SFX.play('chime', firstColor(c));
    P(c.owner).deckText = rewriteDeckText(P(c.owner).deckText, c.name, e.set, e.num, foil);
  }; });
}
// Keep the seat's decklist text in step with artwork choices so "Save to my decks" remembers them.
function rewriteDeckText(text, name, set, num, foil) {
  if (!text) return text;
  return text.split(/\r?\n/).map((line) => { const m = line.match(/^(\d+x?\s+)?(.+?)(\s+\([A-Za-z0-9]{2,6}\)\s+[\w★-]+)?(\s+\*[A-Za-z]\*)?\s*$/); if (!m) return line; const base = m[2].replace(/\s*\*[A-Za-z]+\*\s*/g, '').trim(); if (base.toLowerCase() !== name.toLowerCase()) return line; return `${m[1] || ''}${base} (${set}) ${num}${foil ? ' *F*' : ''}`; }).join('\n');
}
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
  if (canSee(c)) { add('Look closer', () => closerModal(c)); if (!c.token && net.isMine(c.controller)) { add('Choose artwork…', () => artworkModal(c)); add(c.foil ? 'Make it non-foil' : 'Make it foil', () => { c.foil = !c.foil; render(); SFX.play('chime', firstColor(c)); }); } sep(); }
  if (c.isCmdr && !c.token) { add(`Commander tax: {${2 * (c.casts || 0)}} — raise`, () => adjustTax(c, 1)); if (c.casts) add('Commander tax — lower', () => adjustTax(c, -1)); sep(); }
  if (c.zone === 'command') commandersOf(c.owner).filter((x) => x.zone === 'command' && x.id !== c.id).forEach((x) => { add(`Cast ${x.name} (tax +${2 * (x.casts || 0)})`, () => castToStack(x.id)); add(`Put ${x.name} onto battlefield (no tax)`, () => moveCard(x.id, x.owner, 'battlefield', { anim: 'commander' })); sep(); });
  if (c.zone === 'battlefield') {
    add(c.tapped ? 'Untap' : 'Tap', () => toggleTap(c));
    if (c.backImg) add(c.flipped ? 'Transform to front' : 'Transform', () => { c.flipped = !c.flipped; render(); FX.slam(cardEl(c.id), 1.08); SFX.play('whoosh'); });
    if (!/Creature/.test(c.type) && isPerm(c)) {
      const auto = Rules.stationThreshold(c) > 0 && (c.ctr || 0) >= Rules.stationThreshold(c);
      if (c.anim) add('It\'s not a creature anymore', () => { c.anim = false; render(); log(`${c.name} stops being a creature`); });
      else if (!auto) add(/Vehicle/.test(c.type) ? 'Crew it (becomes a creature)' : /Spacecraft/.test(c.type) ? 'It\'s stationed (becomes a creature)' : 'Treat as a creature (animate)', () => { c.anim = true; if (c.sick == null) c.sick = false; render(); log(`${c.name} becomes a creature`); });
    }
    if (isCreature(c)) {
      const at = S.attacks.find((a) => a.id === c.id);
      if (at && isBlocked(at)) add(`Resolve block: trade blows with ${S.cards[at.blockers[0]]?.name || 'the blocker'}`, () => resolveBlock(at), { hot: true });
      else if (at && (at.ok || P(at.target).bot)) add(`Deal ${powerOf(c)} combat damage to ${P(at.target).name}`, () => combatDamage(c, at.target), { hot: true });
      else if (at) add(`Waiting for ${P(at.target).name} to block or take it`, () => toast(`${P(at.target).name} hasn't answered yet`));
      else { const ca = Rules.canAttack(c); if (ca.ok) add('Attack…', () => startTargeting(c), { hot: true }); else if (ca.why !== 'Tapped') add(`Attack anyway (${ca.why.toLowerCase()})`, () => startTargeting(c)); }
      if (at) add('Call off the attack', () => { S.attacks = S.attacks.filter((a) => a.id !== c.id); c.tapped = false; render(); log(`${c.name} stops attacking`); });
      if (Rules.canAttack(c).ok) S.players.forEach((p, k) => { if (k !== c.controller && !p.out && k < S.seats) add(`Attack ${p.name}`, () => attack(c, k)); });
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
    { label: 'Scry…', fn: () => peekModal(pi, 'scry') }, { label: 'Surveil…', fn: () => peekModal(pi, 'surveil') },
    { label: 'Look at the top 3', fn: () => openZone(pi, 'library', { top: 3 }) },
    { label: 'Search library', fn: () => openZone(pi, 'library', { search: true }) },
    { label: 'Reveal the top card', fn: () => { const id = p.zones.library[0]; if (id) { toast(`Top of ${p.name}'s library: ${S.cards[id].name}`); log(`${p.name} revealed ${S.cards[id].name} from the top of their library`); } } },
  ], x, y, `${p.name}'s library`);
}
// Commander tax is counted automatically on each cast from the command zone; these nudge it for the odd case
// (a partner moved aside by hand, a Command Beacon, a take-back).
function adjustTax(c, d) {
  if (!c || !c.isCmdr) return; const next = Math.max(0, (c.casts || 0) + d); if (next === (c.casts || 0)) return;
  c.casts = next; log(`${P(c.owner).name} set ${c.name}'s commander tax to {${2 * next}}`); render();
}
/* ---------- Scry and surveil ----------
   Scry N (CR 701.22): look at the top N, put any number on the bottom in any order and the rest back on top in any
   order. Surveil N (CR 701.49): the same, but the ones you don't keep go to the graveyard instead of the bottom. */
function peekModal(pi, mode, n = null) {
  const p = P(pi); const lib = p.zones.library; if (!lib.length) { toast('The library is empty'); return; }
  if (n == null) {
    const verb = mode === 'surveil' ? 'Surveil' : 'Scry';
    openModal(`<h2>${verb}</h2><p>${mode === 'surveil' ? 'Look at the top cards; keep each on top or put it in the graveyard.' : 'Look at the top cards; keep each on top or send it to the bottom.'}</p><div class="row" id="peekN">${[1, 2, 3, 4, 5].map((k) => `<button type="button" class="btn ${k === 1 ? '' : 'ghost'}" data-n="${k}" ${k > lib.length ? 'disabled' : ''}>${verb} ${k}</button>`).join('')}</div>`, { cls: 'narrow' });
    $$('#peekN [data-n]').forEach((b) => { b.onclick = () => peekModal(pi, mode, +b.dataset.n); }); return;
  }
  n = Math.min(n, lib.length); const ids = lib.slice(0, n); const away = new Set(); const order = ids.slice();
  const awayWord = mode === 'surveil' ? 'Graveyard' : 'Bottom';
  const draw = () => {
    const kept = order.filter((id) => !away.has(id)); const gone = order.filter((id) => away.has(id));
    $('#peekBody').innerHTML = `<div class="peekrow">${order.map((id) => { const c = S.cards[id]; const isAway = away.has(id); const ki = kept.indexOf(id); return `<div class="peek ${isAway ? 'away' : ''}" data-pid="${id}">${cardHTML(c, { noid: true, flat: true, reveal: true })}<div class="peekacts"><span class="peekpos">${isAway ? awayWord.toLowerCase() : ki === 0 ? 'top' : `top ${ki + 1}`}</span><button type="button" class="btn ghost sm" data-pk="toggle" data-id="${id}">${isAway ? 'Keep on top' : awayWord}</button>${!isAway && kept.length > 1 ? `<span class="row tight"><button type="button" class="btn ghost sm" data-pk="left" data-id="${id}" ${ki === 0 ? 'disabled' : ''} title="Closer to the top">◀</button><button type="button" class="btn ghost sm" data-pk="right" data-id="${id}" ${ki === kept.length - 1 ? 'disabled' : ''} title="Further down">▶</button></span>` : ''}</div></div>`; }).join('')}</div>
    <p class="muted small">${kept.length} stay${kept.length === 1 ? 's' : ''} on top${kept.length > 1 ? ' (left is the very top)' : ''}; ${gone.length} to the ${awayWord.toLowerCase()}.</p>`;
    $$('#peekBody [data-pk]').forEach((b) => { b.onclick = () => { const id = b.dataset.id; const a = b.dataset.pk; if (a === 'toggle') { away.has(id) ? away.delete(id) : away.add(id); } else { const k = order.indexOf(id); const dir = a === 'left' ? -1 : 1; let j = k + dir; while (j >= 0 && j < order.length && away.has(order[j])) j += dir; if (j >= 0 && j < order.length) { [order[k], order[j]] = [order[j], order[k]]; } } draw(); }; });
  };
  openModal(`<h2>${mode === 'surveil' ? 'Surveil' : 'Scry'} ${n}</h2><div id="peekBody"></div><div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-act="close">Cancel</button><button type="button" class="btn" id="peekGo" data-autofocus>Done</button></div>`, { cls: 'wide' });
  draw();
  $('#peekGo').onclick = () => {
    const kept = order.filter((id) => !away.has(id)); const gone = order.filter((id) => away.has(id));
    const rest = lib.slice(n);
    if (mode === 'surveil') { p.zones.library = [...kept, ...rest]; gone.forEach((id) => { const c = S.cards[id]; c.zone = 'graveyard'; p.zones.graveyard.push(id); }); }
    else p.zones.library = [...kept, ...rest, ...gone];
    log(`${p.name} ${mode === 'surveil' ? 'surveiled' : 'scried'} ${n}${gone.length ? ` (${gone.length} to the ${awayWord.toLowerCase()})` : ' (kept all on top)'}`);
    closeModal(); render(); if (gone.length) SFX.play('whoosh');
  };
}
function commandMenu(pi, x, y) {
  const cs = commandersOf(pi).filter((c) => c.zone === 'command');
  if (!cs.length) { toast(`${P(pi).name}'s commander is not in the command zone`); return; }
  const items = []; cs.forEach((c, k) => { if (k) items.push({ sep: true }); items.push({ label: `Cast ${c.name} (tax +${2 * (c.casts || 0)})`, fn: () => castToStack(c.id), hot: true }); items.push({ label: `Put ${c.name} onto battlefield (no tax)`, fn: () => moveCard(c.id, pi, 'battlefield', { anim: 'commander' }) }); items.push({ label: `${c.name}: tax +{2}`, fn: () => adjustTax(c, 1) }); if (c.casts) items.push({ label: `${c.name}: tax −{2}`, fn: () => adjustTax(c, -1) }); });
  openMenu(items, x, y, 'Command zone');
}
/* ---------- Card text runtime: bots act on what their cards say ----------
   Triggers and activated abilities resolve for bot-controlled permanents (on the host). Humans' own cards only get
   reminder toasts; static anthems apply to everyone. Everything is logged. */
const botOwned = (c) => c && c.zone === 'battlefield' && P(c.controller).bot && net.isMine(c.controller);
const valueOf = (c) => (isCreature(c) ? powerOf(c) + toughnessOf(c) + Rules.shownKeywords(c).length + (c.isCmdr ? 4 : 0) : 2 + (String(c.cost || '').match(/\{/g) || []).length);
const oppsOf = (i) => S.players.map((q, k) => k).filter((k) => k !== i && k < S.seats && !P(k).out && !P(k).empty);
const seatCards = (k, pred) => P(k).zones.battlefield.map((id) => S.cards[id]).filter((c) => c && (!pred || pred(c)));
const matchesWhat = (c, what) => what === 'permanent' ? true : what === 'nonland permanent' ? !/Land/.test(c.type) : what === 'creature' ? isCreature(c) : what.split('|').some((w) => new RegExp(w, 'i').test(c.type));
function pickTarget(i, what, theirs = true) {
  const pool = (theirs ? oppsOf(i) : [i]).flatMap((k) => seatCards(k, (c) => matchesWhat(c, what)));
  return pool.sort((a, b) => valueOf(b) - valueOf(a))[0] || null;
}
function sendTo(c, zone) { if (!c) return; if (net.isMine(c.controller)) moveCard(c.id, c.owner, zone, { anim: 'fly' }); else request(c.controller, 'cardTo', c.id, zone); }
function tapAll(i, what) { seatCards(i, (c) => matchesWhat(c, what) && c.tapped).forEach((c) => { c.tapped = false; }); render(); }
const xValue = (src, eff) => { const o = lc(src.oracle); const m = o.match(/where x is the number of ([a-z]+?)s? you control/); if (m) return seatCards(src.controller, (c) => new RegExp(m[1], 'i').test(c.type) || (m[1] === 'creature' && isCreature(c))).length; if (/x is the number of creatures/.test(o)) return seatCards(src.controller, isCreature).length; return 1; };
const lc = (s) => String(s || '').toLowerCase();
// Run a list of parsed effects for a source card. Returns a short description for the log.
async function runEffects(src, effects, ctx = {}) {
  const i = src.controller; const done = []; const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const rules = rulesFor(i); const theOpp = () => (ctx.actor != null && ctx.actor !== i ? ctx.actor : oppsOf(i).sort((a, b) => P(a).life - P(b).life)[0]);
  for (const e of effects) {
    const n = e.n === 'x' ? xValue(src, e) : (e.n ?? 1);
    switch (e.k) {
      case 'draw': { const who = e.who === 'you' ? [i] : e.who === 'opponents' ? oppsOf(i) : e.who === 'all' ? [i, ...oppsOf(i)] : [theOpp()].filter((k) => k != null); who.forEach((k) => { const rk = rulesFor(k); if (rk.drawLimit != null && P(k).bot && drawsThisTurn(k) >= rk.drawLimit) { done.push(`${P(k).name} can't draw more this turn`); return; } if (net.isMine(k)) draw(k, n); else request(k, 'draw', n); }); done.push(`draw ${n}`); break; }
      case 'life': { if (e.who === 'you') { if (n > 0 && rules.noLifeGain) { done.push('no life gain allowed'); break; } changeLifeAny(i, n); done.push(`gain ${n}`); } else { const who = e.who === 'opponents' ? oppsOf(i) : e.who === 'all' ? [i, ...oppsOf(i)] : [theOpp()].filter((k) => k != null); who.forEach((k) => changeLifeAny(k, n)); done.push(`${Math.abs(n)} life from ${who.map((k) => P(k).name).join(', ')}`); } break; }
      case 'damage': {
        if (e.to === 'opponents' || e.to === 'all') { const who = e.to === 'all' ? [i, ...oppsOf(i)] : oppsOf(i); who.forEach((k) => changeLifeAny(k, -n)); done.push(`${n} damage to ${who.map((k) => P(k).name).join(', ')}`); break; }
        if (e.to === 'creatures' || e.to === 'everything') { S.players.forEach((q, k) => { if (k < S.seats) seatCards(k, isCreature).forEach((c) => dmgTo(c, n, src)); if (e.to === 'everything' && k < S.seats && !q.out) changeLifeAny(k, -n); }); done.push(`${n} damage to each creature`); break; }
        const threat = pickTarget(i, 'creature'); const victim = oppsOf(i).sort((a, b) => P(a).life - P(b).life)[0];
        if ((e.to === 'creature' || e.to === 'any') && threat && (e.to === 'creature' || (toughnessOf(threat) - (threat.dmg || 0) <= n && valueOf(threat) >= 5))) { dmgTo(threat, n, src); done.push(`${n} damage to ${threat.name}`); }
        else if (victim != null && e.to !== 'creature') { changeLifeAny(victim, -n); if (src.isCmdr && isCreature(src) && false) {} done.push(`${n} damage to ${P(victim).name}`); }
        break;
      }
      case 'token': { const def = { name: e.name, cost: '', type: e.type || (e.pt ? 'Token Creature — ' + e.name : 'Token'), pt: e.pt || '', colors: e.colors || '', kw: e.kw || '', oracle: e.oracle || '' }; const cnt = Math.max(1, Math.min(20, n)); if (net.isMine(i)) createTokens(i, def, cnt); else request(i, 'token', def, cnt); done.push(`${n} ${e.name} token${n > 1 ? 's' : ''}`); break; }
      case 'destroy': case 'exile': {
        const zone = e.k === 'exile' ? 'exile' : 'graveyard';
        if (e.all) { const victims = S.players.flatMap((q, k) => (k < S.seats ? seatCards(k, (c) => matchesWhat(c, e.what) && !(e.theirs && k === i)) : [])); victims.forEach((c) => sendTo(c, zone)); done.push(`${e.k} all ${e.what}s (${victims.length})`); }
        else { const t = pickTarget(i, e.what, true); if (t) { sendTo(t, zone); done.push(`${e.k} ${t.name}`); } }
        break;
      }
      case 'bounce': { const t = pickTarget(i, e.what, true); if (t) { sendTo(t, 'hand'); done.push(`bounce ${t.name}`); } break; }
      case 'reanimate': { if (rules.noReanimate) { done.push('graveyard is locked'); break; } const g = P(i).zones.graveyard.map((id) => S.cards[id]).filter(isCreature).sort((a, b) => valueOf(b) - valueOf(a))[0]; if (g) { moveCard(g.id, i, 'battlefield', { anim: 'land' }); done.push(`return ${g.name} to the battlefield`); } break; }
      case 'regrow': { const g = P(i).zones.graveyard.map((id) => S.cards[id]).filter((c) => matchesWhat(c, e.what === 'instant or sorcery' ? 'Instant|Sorcery' : e.what)).sort((a, b) => valueOf(b) - valueOf(a))[0]; if (g) { moveCard(g.id, i, 'hand', { anim: 'fly' }); done.push(`return ${g.name} to hand`); } break; }
      case 'tutor': {
        if (rules.noSearch) { done.push(`can't search (${(rules.sources.find((x) => x.rule === 'noSearch') || {}).name || 'board'})`); break; }
        if (rules.searchTax) { if (!P(i).bot || !botPays(i, rules.searchTax, src)) { done.push(`can't search without paying {${rules.searchTax}}`); break; } bot.payMana(i, rules.searchTax); }
        const lib = P(i).zones.library.map((id) => S.cards[id]).slice(0, rules.searchTop || undefined); let picks = [];
        if (/basic land|land|plains|island|swamp|mountain|forest/.test(e.what)) { const need = new Set(P(i).zones.hand.concat(P(i).zones.command).map((id) => S.cards[id]).flatMap((c) => (c.colors || '').split(''))); const basics = lib.filter((c) => /Basic/.test(c.type) && (e.what === 'land' || e.what === 'basic land' || new RegExp(e.what, 'i').test(c.type))).sort((a, b) => (need.has((b.colors || '')[0] || ({ Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' })[b.name]) ? 1 : 0) - (need.has(({ Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' })[a.name]) ? 1 : 0)); picks = basics.slice(0, e.n + (e.extra ? 1 : 0)); }
        else picks = lib.filter((c) => matchesWhat(c, e.what)).sort((a, b) => valueOf(b) - valueOf(a)).slice(0, e.n);
        picks.forEach((c, k) => { const toBf = e.to === 'battlefield' && (!e.extra || k === 0); moveCard(c.id, i, toBf ? 'battlefield' : 'hand', { anim: toBf ? 'land' : 'fly' }); if (toBf && e.tapped) c.tapped = true; });
        if (picks.length) { shuffleArr(P(i).zones.library); done.push(`search for ${picks.map((c) => c.name).join(', ')}`); }
        break;
      }
      case 'counter': { const targets = e.on === 'self' ? [src] : e.on === 'mine' ? seatCards(i, isCreature) : [seatCards(i, isCreature).sort((a, b) => valueOf(b) - valueOf(a))[0]].filter(Boolean); targets.forEach((c) => { c.p1 = (c.p1 || 0) + n; }); if (targets.length) done.push(`${n} +1/+1 counter${n > 1 ? 's' : ''} on ${targets.length === 1 ? targets[0].name : targets.length + ' creatures'}`); break; }
      case 'pump': { const targets = e.on === 'self' ? [src] : e.on === 'mine' ? seatCards(i, isCreature) : [seatCards(i, isCreature).sort((a, b) => valueOf(b) - valueOf(a))[0]].filter(Boolean); targets.forEach((c) => { c.tp = (c.tp || 0) + e.p; c.tt = (c.tt || 0) + e.t; if (e.kw) c.tkw = `${c.tkw || ''},${e.kw}`; }); if (targets.length) done.push(`+${e.p}/+${e.t} until end of turn`); break; }
      case 'discard': { const who = e.who === 'opponents' ? oppsOf(i) : [ctx.actor != null && ctx.actor !== i ? ctx.actor : oppsOf(i).sort((a, b) => P(b).zones.hand.length - P(a).zones.hand.length)[0]].filter((k) => k != null); who.forEach((k) => { if (net.isMine(k)) REQ.discard(k, n, src.name); else request(k, 'discard', n, src.name); }); done.push(`${who.map((k) => P(k).name).join(', ')} discard ${n}`); break; }
      case 'edict': { const who = e.who === 'opponents' ? oppsOf(i) : e.who === 'all' ? [i, ...oppsOf(i)] : [ctx.actor != null && ctx.actor !== i ? ctx.actor : oppsOf(i).sort((a, b) => seatCards(b, isCreature).length - seatCards(a, isCreature).length)[0]].filter((k) => k != null); who.forEach((k) => { if (net.isMine(k)) REQ.edict(k, n, e.what, src.name); else request(k, 'edict', n, e.what, src.name); }); done.push(`${who.map((k) => P(k).name).join(', ')} sacrifice ${n} ${e.what}`); break; }
      case 'untap': { tapAll(i, e.what); done.push(`untap ${e.what}s`); break; }
      case 'mill': { const who = e.who === 'you' ? [i] : e.who === 'all' ? [i, ...oppsOf(i)] : [oppsOf(i)[0]].filter((k) => k != null); who.forEach((k) => { if (net.isMine(k)) REQ.mill(k, n); else request(k, 'mill', n); }); done.push(`mill ${n}`); break; }
      case 'mana': { P(i).floating = (P(i).floating || 0) + (e.n === 'x' ? 1 : e.n); break; }
      case 'scry': { // bots scry like a sensible player: bottom extra lands when flooded, bottom spells when short on lands
        const lib = P(i).zones.library; const top = lib.slice(0, n); const landsOut = seatCards(i, (c) => /Land/.test(c.type)).length; const inHand = P(i).zones.hand.map((id) => S.cards[id]).filter((c) => /Land/.test(c.type)).length;
        const wantLand = landsOut + inHand < 5; const gone = top.filter((id) => { const l = /Land/.test(S.cards[id].type); return wantLand ? !l && landsOut < 3 : l && landsOut + inHand >= 6; });
        if (gone.length) { P(i).zones.library = [...top.filter((id) => !gone.includes(id)), ...lib.slice(n), ...gone]; }
        done.push(`scry ${n}${gone.length ? ` (${gone.length} to the bottom)` : ''}`); break; }
      case 'tax': break; // handled by the trigger that owns it
    }
    await wait(120);
  }
  return done.join(', ');
}
// Which trigger events a card has, with conditions evaluated against the event context.
function triggersFor(c, event, ctx) {
  return parseAbilities(c).filter((a) => a.kind === 'trigger' && a.event === event).filter((a) => {
    if (event === 'anyDies') return a.scope === 'any' || ctx.card.controller === c.controller;
    if (event === 'opponentCasts') { if (!(a.scope === 'any' || ctx.caster !== c.controller)) return false; if (a.spell && a.spell !== 'all' && ctx.card && !spellKind(ctx.card, a.spell === 'instant or sorcery' ? 'instant|sorcery' : a.spell)) return false; if (a.nth) { const kindCount = a.spell && a.spell !== 'all' ? (ctx.kindNth || ctx.nth || 1) : (ctx.nth || 1); if (kindCount !== a.nth) return false; } return true; }
    if (event === 'opponentDraws') return a.scope === 'any' || ctx.drawer !== c.controller;
    if (event === 'creatureEnters') return ctx.card.controller === c.controller && ctx.card.id !== c.id;
    if (event === 'landfall') return ctx.card.controller === c.controller;
    if (event === 'anyAttacks') return ctx.card.controller === c.controller;
    if (event === 'tokenEnters') return ctx.card.controller === c.controller && ctx.card.token;
    if (event === 'upkeep' || event === 'endStep') return ctx.seat === c.controller;
    return true;
  });
}
const firing = new Set();
// Fire an event across the table: bot-owned permanents resolve, humans get a reminder for their own.
async function fireEvent(event, ctx = {}) {
  if (MODE === 'hotseat') return;
  const seatsToCheck = S.players.map((p, k) => k).filter((k) => k < S.seats && !P(k).out && !P(k).empty);
  const selfOnly = ['etb', 'dies', 'attacks', 'combatDamage'].includes(event);
  const sources = selfOnly ? [ctx.card].filter(Boolean) : seatsToCheck.flatMap((k) => seatCards(k));
  // Torpor Orb / Hushbringer: creatures entering (or dying) don't trigger anything
  if (ctx.card && isCreature(ctx.card) && ['etb', 'creatureEnters', 'tokenEnters', 'dies', 'anyDies'].includes(event)) { const r = rulesFor(ctx.card.controller); if ((r.noETB && ['etb', 'creatureEnters', 'tokenEnters'].includes(event)) || (r.noDies && ['dies', 'anyDies'].includes(event))) { const src = r.sources.find((x) => x.rule === 'noETB'); if (event === 'etb' && triggersFor(ctx.card, event, ctx).length) log(`${ctx.card.name}'s trigger doesn't happen (${src ? src.name : 'ETB hate'})`); return; } }
  const actor = ctx.caster ?? ctx.drawer ?? null;
  for (const c of sources) {
    if (!c || (selfOnly ? false : c.zone !== 'battlefield')) continue;
    const trig = triggersFor(c, event, ctx); if (!trig.length) continue;
    const taxed = trig.filter((a) => a.effects.some((x) => x.k === 'tax'));
    // "Pay {n} or else" cards: the actor decides, whoever owns the card. Bots decide here; humans get a prompt from a bot's card.
    let handled = 0;
    if (taxed.length && actor != null && actor !== c.controller) {
      for (const a of taxed) {
        const tax = a.effects.find((x) => x.k === 'tax'); const n = tax.n === 'x' ? powerOf(c) : tax.n; const benefit = a.effects.filter((x) => x.k !== 'tax');
        if (P(actor).bot && net.isMine(actor)) {
          handled++;
          if (botPays(actor, n, c)) { bot.payMana(actor, n); log(`${P(actor).name} pays {${n}} for ${P(c.controller).name}'s ${c.name}`); render(); continue; }
          const what = await runEffects(c, benefit, { ...ctx, actor });
          log(`${P(actor).name} doesn't pay for ${c.name}: ${what || a.text.slice(0, 80)}`);
          if (!P(c.controller).bot && net.isMine(c.controller)) toast(`${c.name}: ${P(actor).name} didn't pay — ${what}`, 5000);
        } else if (!P(actor).bot && P(c.controller).bot && net.isMine(c.controller)) { handled++; askPay(actor, c, n, { ...a, effects: benefit }); }
      }
      if (handled && trig.length === taxed.length) continue;
    }
    if (P(c.controller).bot && net.isMine(c.controller)) {
      for (const a of trig.filter((x) => !taxed.includes(x))) {
        if (!a.effects.length) { log(`${c.name} triggers (${a.text.slice(0, 80)}) — resolve by hand`); continue; }
        const what = await runEffects(c, a.effects, { ...ctx, actor });
        if (what) log(`${P(c.controller).name}'s ${c.name} triggers: ${what}`);
      }
    } else if (net.isMine(c.controller) && !P(c.controller).bot && S.reminders !== false && ['etb', 'dies', 'upkeep', 'attacks', 'combatDamage', 'opponentCasts', 'endStep', 'landfall', 'creatureEnters', 'anyDies'].includes(event)) {
      const k = `${c.id}|${event}|${ctx.card ? ctx.card.id : ''}|${S.turn.number}`; if (firing.has(k)) continue; firing.add(k); setTimeout(() => firing.delete(k), 1500);
      toast(`Reminder — ${c.name}: ${trig[0].text.slice(0, 110)}`, 6000);
    }
  }
}
// "Pay {1}?" for Rhystic Study and friends: the human decides; declining lets the bot's effect happen.
function askPay(seat, src, n, ability) {
  const run = async (paid) => { if (paid) log(`${P(seat).name} paid {${n}} for ${src.name}`); else { const what = await runEffects(src, ability.effects.filter((x) => x.k !== 'tax')); log(`${P(seat).name} didn't pay for ${src.name}: ${what}`); } };
  if (net.isMine(seat)) payModal(seat, src, n, run);
  else { const key = 'ask' + Math.random().toString(36).slice(2, 8); asks[key] = run; request(seat, 'ask', key, src.id, n, src.name); }
}
const asks = {};
function pickModal(seat, zone, n, title, cb, pred = null) {
  const ids = P(seat).zones[zone].filter((id) => !pred || pred(S.cards[id])); const chosen = new Set();
  openModal(`<h2>${esc(title)}</h2><p>Pick ${n}.</p><div class="zgrid">${ids.map((id) => `<div class="zitem"><button type="button" class="pickcard" data-pick="${id}">${cardHTML(S.cards[id], { noid: true, flat: true, reveal: true })}</button></div>`).join('')}</div><div class="row" style="justify-content:flex-end"><button type="button" class="btn" id="pickGo" disabled>Confirm</button></div>`);
  $$('[data-pick]').forEach((b) => { b.onclick = () => { const id = b.dataset.pick; if (chosen.has(id)) chosen.delete(id); else if (chosen.size < n) chosen.add(id); b.classList.toggle('on', chosen.has(id)); $('#pickGo').disabled = chosen.size < Math.min(n, ids.length); }; });
  $('#pickGo').onclick = () => { closeModal(); cb([...chosen]); };
}
function payModal(seat, src, n, cb) {
  openModal(`<h2>${esc(src.name)}</h2><p>${esc(P(src.controller).name)}'s ${esc(src.name)} triggers on your spell: <i>${esc(src.oracle || '')}</i></p><p><b>Pay {${n}}?</b> (Tap mana for it yourself; the table doesn't track your mana.)</p><div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" id="payNo">Don't pay</button><button type="button" class="btn" id="payYes" data-autofocus>Pay {${n}}</button></div>`, { cls: 'narrow' });
  $('#payYes').onclick = () => { closeModal(); cb(true); }; $('#payNo').onclick = () => { closeModal(); cb(false); };
}
// Bots use their activated abilities at the end of their turn: mana sinks, token makers, card draw, pumps before combat.
async function botActivate(i, phase) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const c of seatCards(i)) {
    for (const a of parseAbilities(c).filter((x) => x.kind === 'activated')) {
      if (!a.effects.length || a.effects.every((e) => e.k === 'mana' || e.k === 'scry')) continue;
      if (a.sacOther) continue;
      { const r = rulesFor(i); if ((r.noAbilities.has('creature') && isCreature(c)) || (r.noAbilities.has('artifact') && /Artifact/.test(c.type)) || r.noAbilities.has('permanent')) continue; }
      if (a.sacSelf && !a.effects.some((e) => e.k === 'tutor' || e.k === 'draw')) continue;
      if (a.tap && (c.tapped || (isCreature(c) && c.sick && !Rules.has(c, 'haste')))) continue;
      const early = a.effects.some((e) => e.k === 'pump' || e.k === 'token' || e.k === 'counter' || e.k === 'untap');
      if (early !== (phase === 'precombat')) continue; // board-builders before combat, card draw and sinks after
      if (a.tap && phase === 'precombat' && isCreature(c) && powerOf(c) >= 3 && !a.effects.some((e) => e.k === 'token')) continue; // keep real attackers for combat
      if (a.sorcery && phase === 'combat') continue;
      const mana = bot ? bot.manaAvailable(i) : 0; if (a.mana > mana) continue;
      if (a.life && P(i).life - a.life < 10) continue;
      if (a.mana) bot.payMana(i, a.mana);
      if (a.tap) c.tapped = true;
      if (a.sacSelf) sendTo(c, 'graveyard');
      const what = await runEffects(c, a.effects);
      log(`${P(i).name} activates ${c.name}${what ? `: ${what}` : ''}`); render(); await wait(500);
      if (a.sacSelf) break;
    }
  }
}
function reminderSettingLabel() { return `Trigger reminders: ${S.reminders === false ? 'off' : 'on'}`; }

/* ---------- Priority: every non-land spell a bot casts waits for the humans at the table ----------
   They can let it resolve (OK), hold priority while they cast an instant (Respond), or counter it outright. */
const humanSeats = () => S.players.map((p, k) => k).filter((k) => k < S.seats && !P(k).bot && !P(k).empty && !P(k).out);
const mySeats = () => humanSeats().filter((k) => net.isMine(k));
function respond(fn, id, seat, on) {
  const p = S.pending; if (!p || p.id !== id || p.state !== 'open') return;
  if (fn === 'ack') { if (!p.acks.includes(seat)) p.acks.push(seat); p.holds = p.holds.filter((h) => h !== seat); }
  else if (fn === 'hold') { if (on) { if (!p.holds.includes(seat)) p.holds.push(seat); p.acks = p.acks.filter((a) => a !== seat); } else p.holds = p.holds.filter((h) => h !== seat); }
  else if (fn === 'counter') { p.state = 'countered'; p.by2 = seat; }
  render();
}
function respondLocal(fn, on) {
  const p = S.pending; if (!p) return;
  for (const k of mySeats()) { if (net.active && !net.isHost) net.send('all', { fn, id: p.id, seat: k, on }); else respond(fn, p.id, k, on); }
  if (fn === 'counter') { const c = S.cards[p.id]; log(`${P(mySeats()[0]).name} counters ${c ? c.name : 'the spell'}`); SFX.play('shatter'); }
  if (net.active && !net.isHost) { const q = S.pending; if (q) { if (fn === 'ack') mySeats().forEach((k) => { if (!q.acks.includes(k)) q.acks.push(k); }); if (fn === 'hold') mySeats().forEach((k) => { on ? q.holds.push(k) : (q.holds = q.holds.filter((h) => h !== k)); }); render(); } }
}
async function botCast(c) {
  const who = P(c.controller).name; const fromCmd = c.zone === 'command';
  S.stats.casts[c.controller] = (S.stats.casts[c.controller] || 0) + 1;
  log(fromCmd ? `${who} casts ${c.name} from the command zone` : `${who} casts ${c.name}`);
  moveCard(c.id, c.controller, 'stack', { anim: 'cast' });
  S.pending = { id: c.id, by: c.controller, t: Date.now(), acks: [], holds: [], state: 'open' }; render(); SFX.play('chime', firstColor(c));
  const nth = noteCast(c.controller);
  fireEvent('opponentCasts', { caster: c.controller, card: c, nth }); fireEvent('youCast', { caster: c.controller, card: c, nth });
  const t0 = Date.now(); const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (;;) {
    await wait(200); const p = S.pending; if (!p || p.id !== c.id) return false;
    if (p.state === 'countered') break;
    const humans = humanSeats(); if (!humans.length || humans.every((h) => p.acks.includes(h))) break;
    if (!p.holds.length && Date.now() - t0 > 45000) { log(`No response to ${c.name}; it resolves`); break; }
  }
  const countered = S.pending && S.pending.state === 'countered'; S.pending = null;
  if (countered) { log(`${c.name} was countered`); const top = S.stack.indexOf(c.id); if (top >= 0) S.stack.splice(top, 1); moveCard(c.id, c.owner, 'graveyard', { anim: 'fly' }); render(); return false; }
  if (S.stack[S.stack.length - 1] === c.id) resolveTop(); else if (S.cards[c.id] && c.zone === 'stack') { const k = S.stack.indexOf(c.id); if (k >= 0) S.stack.splice(k, 1); moveCard(c.id, c.controller, isPerm(c) ? 'battlefield' : 'graveyard', { anim: 'land' }); }
  render();
  if (!isPerm(c)) { const what = await runEffects(c, parseEffects(c.oracle || '')); if (what) log(`${c.name}: ${what}`); render(); }
  return true;
}
function pendingPromptHTML() {
  const p = S.pending; const c = S.cards[p.id]; if (!c) return '';
  const mine = mySeats(); const waiting = humanSeats().filter((h) => !p.acks.includes(h));
  const iAcked = mine.length && mine.every((k) => p.acks.includes(k)); const iHold = mine.some((k) => p.holds.includes(k));
  const card = cardHTML(c, { noid: true, flat: true, reveal: true, cls: 'pend' });
  const body = !mine.length ? `<span class="pstate">Waiting for ${esc(waiting.map((h) => P(h).name).join(', ') || 'players')}</span>`
    : iHold ? `<span class="pstate">You have priority. Cast your instant, then…</span><button type="button" class="btn ghost sm" data-act="pcounter">Counter it</button><button type="button" class="btn sm hot" data-act="pok">Let it resolve</button>`
    : iAcked ? `<span class="pstate">Waiting for ${esc(waiting.map((h) => P(h).name).join(', '))}…</span>`
    : `<button type="button" class="btn ghost sm" data-act="pcounter" title="Counter the spell: it goes to the graveyard">Counter it</button><button type="button" class="btn ghost sm" data-act="phold" title="Hold priority while you respond">Respond…</button><button type="button" class="btn sm hot" data-act="pok">OK</button>`;
  return `<div class="phead"><b>${esc(P(p.by).name)}</b> casts <b>${esc(c.name)}</b>${c.isCmdr ? ' <em class="kwb">commander</em>' : ''}${c.type ? `<small> · ${esc(c.type)}</small>` : ''}</div><div class="prow pend-row">${card}<span class="pcard"><small>${esc((c.oracle || '').slice(0, 220))}</small></span></div><div class="prow" style="justify-content:flex-end">${body}</div>`;
}
/* ---------- Bot decks: random picks from the Top 100 (samples when offline) ---------- */
let topCache = null;
async function topList() {
  if (topCache) return topCache;
  try { const r = await fetch('/api/top-decks'); const j = await r.json(); if (r.ok && Array.isArray(j.decks) && j.decks.length) topCache = j.decks; } catch { /* offline */ }
  return topCache || [];
}
async function topDeckText(id) { const r = await fetch(`/api/deck/${id}`); const d = await r.json(); if (!r.ok || d.error || !d.text) throw new Error(d.error || 'bad deck'); return d; }
const inUse = () => new Set(S.players.slice(0, S.seats).map((p) => p.deckSrc).filter(Boolean));
// Give one bot seat a random Top 100 deck nobody else at the table is using. Falls back to a sample deck.
async function dealBotDeck(k, { quiet } = {}) {
  const p = P(k); if (!p.bot) return false;
  const list = (await topList()).filter((d) => !inUse().has('top:' + d.id));
  for (let tries = 0; tries < 4 && list.length; tries++) {
    const pick = list.splice(Math.floor(Math.random() * list.length), 1)[0];
    try {
      const d = await topDeckText(pick.id);
      if (!p.bot) return false;
      loadDeck(k, d.text, null); p.deckSrc = 'top:' + pick.id; p.deckName = d.name; render();
      if (!quiet) log(`${p.name} shuffled up ${d.name}${d.owner ? ` (by ${d.owner})` : ''}`);
      ensureArt(allNames(), { quiet: true }); return true;
    } catch { /* try another */ }
  }
  const used = inUse(); let n = k % 4; for (let t = 0; t < 4 && used.has('sample:' + n); t++) n = (n + 1) % 4;
  loadDeck(k, buildSample(n), null); p.deckSrc = 'sample:' + n; render(); ensureArt(allNames(), { quiet: true }); return false;
}
async function dealBotDecks() {
  const seats = S.players.map((p, k) => k).filter((k) => k < S.seats && P(k).bot && net.isMine(k));
  if (!seats.length) return;
  for (const k of seats) await dealBotDeck(k, { quiet: true });
  const names = seats.map((k) => `${P(k).name}: ${P(k).deckName || commandersOf(k).map((c) => c.name).join(' + ')}`);
  log(`Bots shuffled up — ${names.join(' · ')}`); toast(`Bots are playing ${seats.map((k) => P(k).deckName || commandersOf(k)[0]?.name || 'a deck').join(', ')}`, 6000);
  if (net.active) net.resendAll();
}

/* ---------- Table manager: add or kick bots, open seats for people, swap bot decks ---------- */
function applyLayout(seats, botList) {
  const before = JSON.stringify([net.seats, net.botSeats()]);
  net.seats = seats; net.botList = botList.slice();
  if (JSON.stringify([net.seats, net.botSeats()]) === before && S.seats === seats) return;
  S.seats = seats;
  S.players.forEach((p, k) => {
    if (k >= seats) { p.out = true; return; }
    const isBot = net.botSeats().includes(k);
    if (isBot && !p.bot) { p.bot = true; p.empty = false; p.out = false; p.name = BOT_NAMES[k]; }
    if (!isBot && p.bot) { p.bot = false; p.empty = k !== net.seat; p.out = false; purgeOwner(k); p.zones = emptyZones(); }
  });
  render();
}
const canManage = () => MODE === 'bots' || (MODE === 'room' && net.isHost);
async function addBot(k) {
  const p = P(k); if (p.bot) return;
  if (MODE === 'room' && net.takenSeats().has(k)) { toast(`${p.name} is sitting there`); return; }
  p.bot = true; p.empty = false; p.out = false; p.name = BOT_NAMES[k]; p.avatar = ''; p.mat = 'auto';
  net.botList = [...new Set([...net.botList, k])].sort();
  loadDeck(k, buildSample(k)); p.deckSrc = ''; if (S.outOrder) S.outOrder = S.outOrder.filter((o) => o.i !== k);
  log(`${p.name} joined the table`); render(); ensureArt(allNames(), { quiet: true });
  dealBotDeck(k);
  if (net.active) { await net.setLayout({ botList: net.botList }); net.resendAll(); }
}
async function kickBot(k) {
  const p = P(k); if (!p.bot) return;
  const name = p.name; purgeOwner(k); p.zones = emptyZones();
  p.bot = false; p.empty = MODE === 'room'; p.out = MODE !== 'room'; p.name = SEAT_NAMES[k]; p.life = 40; p.poison = 0; p.cmdDmg = {};
  S.attacks = S.attacks.filter((a) => a.target !== k && S.cards[a.id]);
  if (S.turn.active === k) passTurn();
  if (net.active) net.send('seat', seatSnap(k));
  net.botList = net.botList.filter((x) => x !== k);
  log(`${name} left the table${MODE === 'room' ? '; the seat is open' : ''}`); render();
  if (net.active) await net.setLayout({ botList: net.botList });
}
function kickHuman(k) { if (!net.active || !net.isHost) return; const p = P(k); net.send('all', { fn: 'kick', seat: k }); log(`${p.name} was removed by the host`); toast(`${p.name} removed`); }
async function setSeatCount(n) {
  n = clamp(n, 2, 4); if (n === S.seats) return;
  if (n < S.seats) { for (let k = n; k < S.seats; k++) { if (P(k).bot) { P(k).bot = false; net.botList = net.botList.filter((x) => x !== k); purgeOwner(k); P(k).zones = emptyZones(); } if (MODE === 'room' && net.takenSeats().has(k)) { toast('Someone is sitting in that seat'); return; } P(k).out = true; P(k).empty = false; } }
  else { for (let k = S.seats; k < n; k++) { const p = P(k); p.out = MODE !== 'room'; p.empty = MODE === 'room'; p.bot = false; p.life = 40; p.name = SEAT_NAMES[k]; } }
  S.seats = n; render();
  if (net.active) await net.setLayout({ seats: n, botList: net.botList });
}
function tableModal() {
  if (!canManage()) { toast('Only the host can change the table'); return; }
  const rows = S.players.slice(0, S.seats).map((p, k) => {
    const me = MODE === 'room' ? k === net.seat : k === S.view;
    const human = MODE === 'room' && !p.bot && !p.empty && !me;
    const kind = me ? 'You' : p.bot ? 'Bot' : human ? 'Player' : MODE === 'room' ? 'Open seat' : 'Empty seat';
    const deck = commandersOf(k).map((c) => c.name).join(' + ') || (p.deckName || '');
    const acts = p.bot ? `<button type="button" class="btn ghost sm" data-tm="deck" data-k="${k}">Change deck</button><button type="button" class="btn ghost sm" data-tm="random" data-k="${k}">Random deck</button><button type="button" class="btn ghost sm" data-tm="kick" data-k="${k}">${MODE === 'room' ? 'Kick bot, open seat' : 'Remove bot'}</button>`
      : human ? `<button type="button" class="btn ghost sm" data-tm="kickh" data-k="${k}">Remove player</button>`
      : me ? `<button type="button" class="btn ghost sm" data-tm="deck" data-k="${k}">Change deck</button>`
      : `<button type="button" class="btn sm" data-tm="add" data-k="${k}">Add a bot</button>`;
    return `<li class="tm-row ${p.bot ? 'is-bot' : ''} ${(!p.bot && p.empty) ? 'is-open' : ''}"><span class="tm-seat">${k + 1}</span><span class="tm-who"><b>${esc(p.bot || (!p.empty && (!p.out || me || human)) ? p.name : MODE === 'room' ? 'Waiting for a player' : 'Nobody')}</b><small>${kind}${deck ? ' · ' + esc(deck) : ''}${p.out && !p.empty && (p.bot || me || human) ? ' · out' : ''}</small></span><span class="row">${acts}</span></li>`;
  }).join('');
  openModal(`<h2>Table</h2><p>${MODE === 'room' ? 'Open seats can be taken by anyone with the invite code. Kick a bot to make room for a friend, or add one when a seat stays empty. Bots keep the same turn order as the seat they sit in.' : 'Add or remove practice bots and pick what they play. A removed seat sits out until you fill it again.'}</p>
  <div class="tm-head"><span>Seats</span><span class="seg">${[2, 3, 4].map((n) => `<button type="button" class="${S.seats === n ? 'on' : ''}" data-tm="seats" data-k="${n}">${n}</button>`).join('')}</span></div>
  <ul class="tm-list">${rows}</ul>
  <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-act="close">Done</button></div>`);
  $('#modal .mpanel').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-tm]'); if (!b) return; const k = +b.dataset.k; const act = b.dataset.tm;
    if (act === 'add') { await addBot(k); tableModal(); }
    else if (act === 'kick') { await kickBot(k); tableModal(); }
    else if (act === 'kickh') { confirmModal(`Remove ${P(k).name} from the table? They can rejoin with the code.`, 'Remove player', () => { kickHuman(k); setTimeout(tableModal, 300); }); }
    else if (act === 'deck') { importModal(k); }
    else if (act === 'random') { b.disabled = true; b.textContent = 'Shuffling…'; P(k).deckSrc = ''; await dealBotDeck(k); tableModal(); toast(`${P(k).name} shuffled up ${P(k).deckName || 'a new deck'}`); }
    else if (act === 'seats') { await setSeatCount(k); tableModal(); }
  });
}
function seatMenu(pi, x, y) {
  const p = P(pi);
  if (!net.isMine(pi)) { openMenu([{ label: `${p.name}'s seat`, fn: () => {} }, ...(canManage() ? [{ sep: true }, { label: p.empty ? 'Add a bot here' : 'Manage table…', fn: () => (p.empty ? addBot(pi).then(() => render()) : tableModal()) }] : [])], x, y, p.name); return; }
  openMenu([
    ...(MODE === 'hotseat' && pi !== S.view ? [{ label: `Play as ${p.name}`, fn: () => { S.view = pi; S.sel = null; render(); }, hot: true }] : []),
    { label: 'Choose playmat', fn: () => matModal(pi) },
    { label: 'Rename', fn: () => renameModal(pi) },
    { label: p.bot ? 'Change this bot\'s deck' : 'Import a deck for this seat', fn: () => importModal(pi) },
    ...(canManage() ? [{ label: p.bot ? (MODE === 'room' ? 'Kick bot, open the seat' : 'Remove this bot') : 'Manage table…', fn: () => (p.bot ? kickBot(pi) : tableModal()) }] : []),
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
  openModal(`<h2>${esc(p.name)}'s playmat</h2><p>Ten guild halls of Ravnica, each with its own weather. Auto picks the guild that matches your commander's colors and makes sure nobody at the table starts on the same mat; pick one by hand if you want to match. Upload your own art to play on it; wide images (about 2:1) fit best.</p>
  <div class="matgrid">${opt('auto', 'Auto', `Now: ${nowName}`)}${Object.entries(MATS).map(([k, m]) => opt(k, m.name, m.blurb)).join('')}${custom}</div>
  <p class="muted small">Guild art by Richard Wright, © Wizards of the Coast, used under the Fan Content Policy.</p>
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
  return `<div class="decklib"><div class="eyebrow">Your decks <a class="link" href="/decks.html" style="margin-left:8px;font-size:12px;letter-spacing:0;text-transform:none">Manage decks</a></div>${decks.length ? `<ul class="list">${decks.map((d) => `<li><span><b>${esc(d.name)}</b> <small>· ${esc(d.commander || '')}${d.card_count ? ` · ${d.card_count} cards` : ''}${d.id === last ? ' · last used' : ''}</small></span><span class="row"><button type="button" class="btn sm" data-deck-load="${d.id}">Load</button><button type="button" class="btn ghost sm" data-deck-del="${d.id}">Delete</button></span></li>`).join('')}</ul>` : '<p class="muted">No saved decks yet. Paste a list below and save it, or <a href="/decks.html">pick one of the top 100</a>.</p>'}</div>`;
}
async function importModal(pi) {
  const lib = await deckLibraryHTML();
  openModal(`<h2>Decks</h2>${lib}
  <div class="top100"><div class="eyebrow">Top 100 on Archidekt <button type="button" class="link" id="topToggle">Browse</button></div><div id="topBody" hidden><input id="topQ" type="search" placeholder="Search by name, builder or colors (e.g. UR)" autocomplete="off"><div class="toplist" id="topList"><p class="muted">Loading…</p></div></div></div>
  <p>Paste a text export from any deck site, one card per line like "1 Sol Ring" — or just paste an Archidekt or Moxfield deck link. Put the commander under a "Commander" heading, or type it below. Seating a deck resets that seat's board and life.</p>
  <div class="grid2"><label for="impSeat" ${S.players.filter((p, i) => i < S.seats && net.isMine(i) && !p.empty).length > 1 ? '' : 'hidden'}>Seat<select id="impSeat">${S.players.filter((p, i) => i < S.seats && net.isMine(i) && !p.empty).map((p) => { const i = S.players.indexOf(p); return `<option value="${i}" ${i === pi ? 'selected' : ''}>${esc(p.name)}</option>`; }).join('')}</select></label>
  <label for="impName">Player name<input id="impName" maxlength="24" value="${esc(P(pi).name)}"></label></div>
  <label for="impCmd">Commander (optional)<input id="impCmd" placeholder="Taken from the list if left blank"></label>
  <label for="impList">Decklist<textarea id="impList" rows="9" spellcheck="false" data-autofocus></textarea></label>
  <div class="summary" id="impSum"></div>
  <div class="grid2"><label for="impDeckName">Deck name (to save)<input id="impDeckName" maxlength="40" placeholder="Krenko goblins"></label></div>
  <div class="row"><button type="button" class="btn ghost" data-act="close">Cancel</button>${online ? '<button type="button" class="btn ghost" id="impSave">Save to my decks</button>' : ''}<button type="button" class="btn" id="impGo">Shuffle up and seat</button></div>`);
  const ta = $('#impList'); ta.value = P(pi).deckText || '';
  let editingId = P(pi).deckId || '';
  let top = null;
  const pipsOf = (cols) => (cols || 'C').split('').map((k) => `<i class="ms ms-${k.toLowerCase()} ms-cost"></i>`).join('');
  const drawTop = () => {
    const q = ($('#topQ').value || '').trim().toLowerCase(); const list = $('#topList'); if (!top) return;
    const rows = top.filter((d) => !q || `${d.name} ${d.owner} ${d.colors}`.toLowerCase().includes(q) || (q.length <= 5 && /^[wubrgc]+$/.test(q) && [...q.toUpperCase()].every((c) => d.colors.includes(c)))).slice(0, 40);
    list.innerHTML = rows.length ? rows.map((d) => `<div class="toprow"><span class="toprank">#${top.indexOf(d) + 1}</span><span class="topname"><b>${esc(d.name)}</b><small>${esc(d.owner)} · ${d.views >= 1000 ? Math.round(d.views / 1000) + 'k' : d.views} views${d.bracket ? ` · B${d.bracket}` : ''}</small></span><span class="pips">${pipsOf(d.colors)}</span><button type="button" class="btn ghost sm" data-top-load="${d.id}">Load</button><button type="button" class="btn sm" data-top-seat="${d.id}">Seat</button></div>`).join('') : '<p class="muted">No decks match.</p>';
  };
  const topDeck = async (id) => { const r = await fetch(`/api/deck/${id}`); const d = await r.json(); if (!r.ok || d.error) throw new Error(d.error || r.statusText); return d; };
  $('#topToggle').onclick = async () => {
    const body = $('#topBody'); body.hidden = !body.hidden; $('#topToggle').textContent = body.hidden ? 'Browse' : 'Hide';
    if (!body.hidden && !top) { try { const r = await fetch('/api/top-decks'); const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || r.statusText); top = j.decks; drawTop(); } catch (e) { $('#topList').innerHTML = `<p class="muted">Couldn't load the list (${esc(e.message)}).</p>`; } }
  };
  $('#topQ').oninput = drawTop;
  $('#topList').onclick = async (e) => {
    const b = e.target.closest('[data-top-load],[data-top-seat]'); if (!b) return;
    const id = b.dataset.topLoad || b.dataset.topSeat; b.disabled = true; b.textContent = '…';
    try {
      const d = await topDeck(id);
      ta.value = d.text; $('#impDeckName').value = d.name; $('#impCmd').value = ''; editingId = ''; sum();
      if (b.dataset.topSeat) $('#impGo').click(); else { toast(`Loaded ${d.name}. Seat it, or save it to your decks.`); ta.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    } catch (err) { toast(`Couldn't load that deck: ${err.message}`, 5000); b.disabled = false; b.textContent = b.dataset.topSeat ? 'Seat' : 'Load'; }
  };
  $('#impDeckName').value = P(pi).deckName || '';
  $$('[data-deck-load]').forEach((b) => { b.onclick = async () => { const d = await getDeck(b.dataset.deckLoad); if (!d) return; ta.value = d.list; $('#impDeckName').value = d.name; editingId = d.id; $('#impCmd').value = ''; sum(); toast(`Loaded ${d.name}`); }; });
  $$('[data-deck-del]').forEach((b) => { b.onclick = async () => { await deleteDeck(b.dataset.deckDel); toast('Deck deleted'); importModal(pi); }; });
  const saveBtn = $('#impSave'); if (saveBtn) saveBtn.onclick = async () => {
    const d = parseDeck(ta.value, $('#impCmd').value); const nm = $('#impDeckName').value.trim() || d.cmd[0] || 'Untitled deck';
    if (!d.count && !d.cmd.length) { toast('Paste a decklist first'); return; }
    try {
      const cols = [...new Set(d.cmd.flatMap((n) => (lookup(n).colors || '').split('')))].join('');
      const list = deckText(d);
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
  ta.oninput = async () => {
    const link = deckLink(ta.value);
    if (!link) { sum(); return; }
    ta.disabled = true; const was = ta.value; ta.value = `Importing from ${link.site === 'moxfield' ? 'Moxfield' : 'Archidekt'}…`;
    try { const j = await fetchLinkedDeck(link); ta.value = j.text; $('#impDeckName').value = j.name; editingId = ''; toast(`Loaded ${j.name}. Seat it, or save it to your decks.`); }
    catch (e) { ta.value = e.fallback === 'paste' ? '' : was; toast(e.fallback === 'paste' ? e.message : `Import failed: ${e.message}`, e.fallback ? 9000 : 6000); }
    ta.disabled = false; sum();
  }; $('#impCmd').oninput = sum;
  $('#impSeat').onchange = (e) => { const k = +e.target.value; $('#impName').value = P(k).name; ta.value = P(k).deckText || ''; sum(); };
  sum();
  $('#impGo').onclick = () => {
    const k = +$('#impSeat').value; const nm = $('#impName').value.trim(); if (nm) P(k).name = nm;
    const d = parseDeck(ta.value, $('#impCmd').value); if (!d.count && !d.cmd.length) { toast('The decklist is empty'); return; }
    if (!d.cmd.length) { toast('Pick a commander first'); $('#impCmdPick')?.focus(); return; }
    const text = deckText(d);
    loadDeck(k, text, null); P(k).deckId = editingId || ''; P(k).deckSrc = ''; P(k).deckName = $('#impDeckName').value.trim(); if (editingId) setLastDeckId(editingId); closeModal(); SFX.play('shuffle'); log(`${P(k).name} sat down with ${d.cmd.join(' + ')}`); toast(`${P(k).name} shuffled up and drew 7`); render();
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
  const search = ids.length > 8 ? `<input type="search" id="zq" class="zsearch" placeholder="Search by name, type or text…" autocomplete="off" data-autofocus>` : '';
  openModal(`<h2>${esc(title)}</h2>${note}${search}${ids.length ? `<div class="zgrid">${items}</div>` : '<p>Nothing here yet.</p>'}<div class="row"><span class="muted small" id="zcount"></span><span class="sp"></span><button type="button" class="btn" data-act="close">Done</button></div>`, { onClose: z === 'library' && !o.top ? () => shuffleLib(pi, true) : null });
  const zq = $('#zq'); if (zq) {
    const filt = () => { const q = zq.value.trim().toLowerCase(); let n = 0; $$('.zitem').forEach((el) => { const c = S.cards[el.querySelector('[data-mcid]')?.dataset.mcid]; const hit = !q || (c && `${c.name} ${c.type} ${c.oracle || ''} ${c.kw || ''}`.toLowerCase().includes(q)); el.hidden = !hit; if (hit) n++; }); $('#zcount').textContent = q ? `${n} of ${ids.length} cards` : `${ids.length} cards`; };
    zq.oninput = filt; filt();
  }
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
  const src = focusCard && focusCard(); const made = src ? tokensMadeBy(src) : [];
  openModal(`<h2>Create tokens</h2>${made.length ? `<p>${esc(src.name)} makes:</p><div class="row" style="margin-bottom:12px">${made.map((t, k) => `<button type="button" class="btn ghost sm" data-tk="${k}">${esc(t.pt ? t.pt + ' ' : '')}${esc(t.name)}</button>`).join('')}</div>` : ''}<div class="grid2"><label for="tkName">Name<input id="tkName" value="Goblin"></label><label for="tkPT">Power/toughness<input id="tkPT" value="1/1"></label>
  <label for="tkCol">Color<select id="tkCol">${opts}</select></label><label for="tkN">How many<input id="tkN" type="number" min="1" max="40" value="1"></label>
  <label for="tkFor">For<select id="tkFor">${S.players.map((p, i) => `<option value="${i}" ${i === S.view ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label></div>
  <div class="row"><button type="button" class="btn ghost" data-act="close">Cancel</button><button type="button" class="btn" id="tkGo">Create</button></div>`, { cls: 'narrow' });
  $('#tkCol').value = 'R';
  $$('[data-tk]').forEach((b) => { b.onclick = () => { const t = made[+b.dataset.tk]; $('#tkName').value = t.name; $('#tkPT').value = t.pt; $('#tkCol').value = t.color || 'C'; }; });
  $('#tkGo').onclick = () => {
    const name = $('#tkName').value.trim() || 'Token', pt = $('#tkPT').value.trim(), col = $('#tkCol').value, n = clamp(parseInt($('#tkN').value, 10) || 1, 1, 40), pi = +$('#tkFor').value;
    closeModal(); createTokens(pi, { name, cost: '', type: pt ? 'Token Creature' : 'Token', pt, colors: col === 'C' ? '' : col }, n);
  };
}
// "create a 1/1 green Saproling creature token" → { name, pt, color }
function tokensMadeBy(c) {
  const out = []; const re = /(?:an?|two|three|four|\d+|x) (\d+)\/(\d+) ((?:white|blue|black|red|green|colorless|and|,| )*?)([A-Z][\w' -]*?) (?:artifact |enchantment )?creature tokens?/gi;
  let m; const txt = c.oracle || '';
  while ((m = re.exec(txt))) { const name = m[4].replace(/^(?:(?:white|blue|black|red|green|colorless)[, ]*(?:and )?)+/i, '').trim(); const cols = (m[3] + ' ' + m[4]).toLowerCase(); const color = ['white', 'blue', 'black', 'red', 'green'].filter((w) => cols.includes(w)).map((w) => ({ white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' }[w])).join(''); if (name) out.push({ name, pt: `${m[1]}/${m[2]}`, color: color || 'C' }); }
  const seen = new Set(); return out.filter((t) => { const k = t.name + t.pt; if (seen.has(k)) return false; seen.add(k); return true; });
}
function logModal() {
  const fmt = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  openModal(`<h2>Game log</h2><ul class="loglist">${S.log.map((l) => `<li><time>${fmt(l.t)}</time><span>${esc(l.text)}</span></li>`).join('') || '<li>Nothing has happened yet.</li>'}</ul><div class="row"><button type="button" class="btn" data-act="close">Close</button></div>`, { cls: 'narrow' });
}

/* ---------- Input ---------- */
let lastPointerType = 'mouse';
function onCardClick(c) {
  const now = performance.now();
  if (lastPointerType === 'mouse' && c.zone === 'battlefield' && net.isMine(c.controller) && !blocking && !targeting) { lastClick = null; S.sel = c.id; $$('#table .card.sel').forEach((x) => x.classList.remove('sel')); cardEl(c.id)?.classList.add('sel'); toggleTap(c); return; }
  if (lastClick && lastClick.id === c.id && now - lastClick.t < 420) { lastClick = null; hideTapbar(); quick(c); return; }
  lastClick = { id: c.id, t: now }; S.sel = c.id;
  $$('#table .card.sel').forEach((x) => x.classList.remove('sel')); cardEl(c.id)?.classList.add('sel');
  if (lastPointerType !== 'mouse') showTapbar(c);
}
// On touch, one tap selects a card and offers its actions in a bar; no long-press needed (and nothing for the OS to copy).
function quickLabel(c) { return c.zone === 'battlefield' ? (c.tapped ? 'Untap' : 'Tap') : /Land/.test(c.type) ? 'Play' : 'Cast'; }
function showTapbar(c) {
  const bar = $('#tapbar'); const el = cardEl(c.id); if (!bar || !el) return;
  const canAct = net.isMine(c.controller) && ['hand', 'battlefield', 'command'].includes(c.zone);
  bar.innerHTML = `${canSee(c) ? `<button type="button" data-tb="look">Look closer</button>` : ''}${canAct ? `<button type="button" class="hot" data-tb="quick">${quickLabel(c)}</button>` : ''}<button type="button" data-tb="more">More…</button>`;
  bar.hidden = false; bar.dataset.id = c.id;
  const r = el.getBoundingClientRect(); const bw = bar.offsetWidth || 200, bh = bar.offsetHeight || 46;
  let x = r.left + r.width / 2; x = Math.max(bw / 2 + 6, Math.min(innerWidth - bw / 2 - 6, x));
  let y = r.top - bh - 10; if (y < 50) y = Math.min(innerHeight - bh - 8, r.bottom + 10);
  bar.style.left = x + 'px'; bar.style.top = y + 'px';
}
function hideTapbar() { const bar = $('#tapbar'); if (bar && !bar.hidden) { bar.hidden = true; bar.innerHTML = ''; } }
function quick(c) {
  if (c.zone === 'battlefield') toggleTap(c);
  else if (c.zone === 'hand' || c.zone === 'command') castToStack(c.id);
  else if (c.zone === 'stack' && S.stack[S.stack.length - 1] === c.id) resolveTop();
}
function clearHot() { $$('.hot').forEach((x) => x.classList.remove('hot')); }
function onDown(e) {
  hideZoom(); untilt(); lastPointerType = e.pointerType || 'mouse';
  if (!e.target.closest('#tapbar')) hideTapbar();
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
  const tb = e.target.closest('#tapbar [data-tb]');
  if (tb) {
    const c = S.cards[$('#tapbar').dataset.id]; if (!c) { hideTapbar(); return; }
    const r = cardEl(c.id)?.getBoundingClientRect();
    if (tb.dataset.tb === 'look') closerModal(c); else if (tb.dataset.tb === 'quick') quick(c); else cardMenu(c, r ? r.left + r.width / 2 : innerWidth / 2, r ? r.top : innerHeight / 2);
    hideTapbar(); return;
  }
  if (isCompact() && $('#app').classList.contains('show-side') && !e.target.closest('.side, #sideBtn')) { $('#app').classList.remove('show-side'); if (!e.target.closest('[data-act], .card, .seat')) return; }
  if (targeting) {
    const seat = e.target.closest('.seat.targetable');
    if (seat) { const c = S.cards[targeting.id]; const k = +seat.dataset.seat; stopTargeting(); if (c) attack(c, k); return; }
  }
  if (blocking) {
    const card = e.target.closest('#table .card[data-id]');
    if (card) {
      const a = S.attacks.find((x) => x.id === blocking.attackId); const b = S.cards[card.dataset.id]; const atk = a && S.cards[a.id];
      if (!a || !atk) { stopBlocking(); return; }
      if (b && b.controller === blocking.seat && b.zone === 'battlefield') { if (card.classList.contains('canblock') || (a.blockers || []).includes(b.id)) setBlock(a, b.id); else toast(!isCreature(b) ? `${b.name} isn't a creature` : b.tapped ? `${b.name} is tapped` : (Rules.blockLegal(atk, [b]).why || `${b.name} can't block that`)); }
      return;
    }
  }
  const pb = e.target.closest('#prompt [data-act]');
  if (pb) {
    const act = pb.dataset.act; const a = S.attacks.find((x) => x.id === pb.dataset.id);
    if (act === 'cancelTarget') stopTargeting(); else if (act === 'cancelBlock') { if (a) a.blockers = []; stopBlocking(); } else if (act === 'doneBlock') { const b = S.attacks.find((x) => x.id === blocking?.attackId); if (b) finishBlock(b); }
    else if (act === 'allow' && a) allowAttack(a); else if (act === 'block' && a) startBlocking(a); else if (act === 'unblock' && a) unblock(a);
    else if (act === 'allowAll') allowAll(+pb.dataset.p); else if (act === 'resolveCombat') resolveCombat(+pb.dataset.p);
    else if (act === 'pok') respondLocal('ack'); else if (act === 'phold') respondLocal('hold', true); else if (act === 'pcounter') respondLocal('counter');
    return;
  }
  const tab = e.target.closest('.side-tabs .tab');
  if (tab) { sideTab = tab.dataset.tab; $$('.side-tabs .tab').forEach((t) => t.classList.toggle('on', t === tab)); $('#sideLog').hidden = sideTab !== 'log'; $('#sideChat').hidden = sideTab !== 'chat'; return; }
  const a = e.target.closest('[data-act]'); if (!a || (a.closest('#modal') && a.dataset.act === 'close')) return;
  if (performance.now() < ignoreClick && e.target.closest('.card[data-id]')) return;
  if (a.dataset.act === 'pileclick' && e.target.closest('.card[data-id]') && !/-(graveyard|exile)$/.test(a.dataset.zone || '')) return;
  const act = a.dataset.act, p = +a.dataset.p; const r = a.getBoundingClientRect();
  if (SPECTATE && !['pile', 'pileclick', 'seatmenu', 'expand', 'close'].includes(act)) { toast('You\'re watching this table'); return; }
  switch (act) {
    case 'life': { const d = (+a.dataset.d) * (e.shiftKey ? 5 : 1); if (net.isMine(p)) changeLife(p, d, { manual: true }); else request(p, 'changeLife', d); break; }
    case 'tax': { const c = S.cards[a.dataset.id]; if (c && net.isMine(c.owner)) adjustTax(c, +a.dataset.d); break; }
    case 'pile': case 'pileclick': pileClick(a.dataset.zone, a); break;
    case 'seatmenu': seatMenu(p, r.left, r.bottom + 4); break;
    case 'dmg': dmgModal(p); break;
    case 'draw': if (net.isMine(p)) draw(p, 1); break;
    case 'mull': if (net.isMine(p)) mulligan(p); break;
    case 'expand': { const k = +a.dataset.p; expandedSeats.has(k) ? expandedSeats.delete(k) : (expandedSeats.clear(), expandedSeats.add(k)); render(); break; }
    case 'phase': { const k = +a.dataset.k; if (S.turn.phase === 2 && k !== 2) { S.attacks = []; blocking = null; } S.turn.phase = k; render(); break; }
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
  if (cardElm) { e.preventDefault(); const c = S.cards[cardElm.dataset.id]; if (c && c.zone === 'command' && net.isMine(c.owner) && commandersOf(c.owner).filter((x) => x.zone === 'command').length > 1) { commandMenu(c.owner, e.clientX, e.clientY); return; } if (c) cardMenu(c, e.clientX, e.clientY); return; }
  const pile = e.target.closest('[data-pile]');
  if (pile) {
    const [pi, z] = parseZone(pile.dataset.pile); if (pi < 0) return; e.preventDefault();
    if (!net.isMine(pi)) { if (z === 'graveyard' || z === 'exile') openZone(pi, z); return; }
    if (z === 'library') libraryMenu(pi, e.clientX, e.clientY);
    else if (z === 'command') commandMenu(pi, e.clientX, e.clientY);
    else if (z === 'graveyard' || z === 'exile') openZone(pi, z);
  }
}
/* ---------- Keyboard shortcuts ----------
   The card under the mouse wins; otherwise the selected card (click once to select). Nothing fires while typing. */
const SHORTCUTS = [
  { keys: ['T'], label: 'Tap / untap the card', group: 'Cards' },
  { keys: ['A'], label: 'Attack with the card (then click a player)', group: 'Cards' },
  { keys: ['B', 'Enter'], label: 'Play / cast the card (hand or command zone)', group: 'Cards' },
  { keys: ['G'], label: 'Send the card to the graveyard', group: 'Cards' },
  { keys: ['X'], label: 'Exile the card', group: 'Cards' },
  { keys: ['H'], label: 'Return the card to hand', group: 'Cards' },
  { keys: ['F'], label: 'Flip / transform (double-faced) or face-down', group: 'Cards' },
  { keys: ['L'], label: 'Look closer', group: 'Cards' },
  { keys: ['1', '2'], label: '+1/+1 counter · −1/−1 counter', group: 'Cards' },
  { keys: ['C'], label: 'Counter (generic) on the card', group: 'Cards' },
  { keys: ['D'], label: 'Draw a card', group: 'Turn' },
  { keys: ['U'], label: 'Untap all your permanents', group: 'Turn' },
  { keys: ['S'], label: 'Shuffle your library', group: 'Turn' },
  { keys: ['Space'], label: 'Next phase', group: 'Turn' },
  { keys: ['E'], label: 'End turn / pass', group: 'Turn' },
  { keys: ['M'], label: 'Mulligan', group: 'Turn' },
  { keys: ['−', '='], label: 'Life −1 / +1 (hold Shift for 5)', group: 'Table' },
  { keys: ['K'], label: 'Create a token', group: 'Table' },
  { keys: ['R'], label: 'Roll a d20', group: 'Table' },
  { keys: ['Shift', 'F'], label: 'Full screen', group: 'Table' },
  { keys: ['P'], label: 'Log & card panel', group: 'Table' },
  { keys: ['?'], label: 'This list', group: 'Table' },
  { keys: ['Esc'], label: 'Cancel / close', group: 'Table' },
];
let kbMouse = { x: -1, y: -1 };
document.addEventListener('pointermove', (e) => { if (e.pointerType === "mouse") kbMouse = { x: e.clientX, y: e.clientY }; }, { passive: true });
const focusCard = () => {
  const under = kbMouse.x >= 0 ? document.elementFromPoint(kbMouse.x, kbMouse.y)?.closest('#table .card[data-id]') : null;
  const id = under ? under.dataset.id : ((zoomId && S.cards[zoomId]) ? zoomId : S.sel);
  const c = id && S.cards[id]; return c && net.isMine(c.controller) ? c : null;
};
function onKey(e) {
  if (e.key === 'Escape') { closeMenu(); closeModal(); hideZoom(); untilt(); hideTapbar(); if (targeting) stopTargeting(); if (blocking) stopBlocking(); return; }
  if (e.target.closest('input,textarea,select,[contenteditable]') || !$('#modal').hidden || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key; const me = S.view; const c = focusCard(); const mine = (i) => net.isMine(i);
  const act = (fn) => { e.preventDefault(); fn(); };
  if (k === '?' || (k === '/' && e.shiftKey)) return act(shortcutsModal);
  if (k === 'F' && e.shiftKey) return act(() => doFullscreen());
  if (SPECTATE) { if (k.toLowerCase() === 'z' && c) return act(() => closerModal(c)); return; }
  if (k === ' ' && !e.target.closest('button')) return act(nextPhase);
  switch (k.toLowerCase()) {
    case 'd': if (mine(me)) act(() => draw(me, 1)); return;
    case 'u': if (mine(me)) act(() => { const ids = P(me).zones.battlefield.filter((id) => S.cards[id].tapped); ids.forEach((id) => { S.cards[id].tapped = false; }); if (ids.length) { log(`${P(me).name} untapped ${ids.length} permanent${ids.length > 1 ? 's' : ''}`); SFX.play('tick'); } render(); }); return;
    case 's': if (mine(me)) act(() => shuffleLib(me)); return;
    case 'e': if (mine(S.turn.active)) act(() => $('[data-act=pass]')?.click()); return;
    case 'm': if (mine(me)) act(() => mulligan(me)); return;
    case 'k': act(tokenModal); return;
    case 'r': act(() => $('[data-act=d20]')?.click()); return;
    case 'p': act(() => $('#sideBtn').click()); return;
    case '-': case '_': if (mine(me)) act(() => changeLife(me, e.shiftKey ? -5 : -1, { manual: true })); return;
    case '=': case '+': if (mine(me)) act(() => changeLife(me, e.shiftKey ? 5 : 1, { manual: true })); return;
  }
  if (!c) return;
  switch (k.toLowerCase()) {
    case 't': if (c.zone === 'battlefield') act(() => toggleTap(c)); return;
    case 'a': if (c.zone === 'battlefield' && isCreature(c)) act(() => startTargeting(c)); return;
    case 'b': case 'enter': if (c.zone === 'hand' || c.zone === 'command') act(() => castToStack(c.id)); return;
    case 'g': if (!c.isCmdr || c.zone !== 'command') act(() => { moveLog(c, 'graveyard'); moveCard(c.id, c.owner, 'graveyard'); }); return;
    case 'x': act(() => { moveLog(c, 'exile'); moveCard(c.id, c.owner, 'exile'); }); return;
    case 'h': if (c.zone !== 'hand') act(() => { moveLog(c, 'hand'); moveCard(c.id, c.controller, 'hand'); }); return;
    case 'f': if (c.zone === 'battlefield') act(() => { if (c.backImg) c.flipped = !c.flipped; else c.faceDown = !c.faceDown; render(); SFX.play('whoosh'); }); return;
    case 'l': if (canSee(c)) act(() => closerModal(c)); return;
    case '1': if (c.zone === 'battlefield') act(() => counter(c, 'p1', 1)); return;
    case '2': if (c.zone === 'battlefield') act(() => counter(c, 'p1', -1)); return;
    case 'c': if (c.zone === 'battlefield') act(() => counter(c, 'ctr', 1)); return;
  }
}
function shortcutsModal() {
  const groups = [...new Set(SHORTCUTS.map((x) => x.group))];
  openModal(`<h2>Keyboard shortcuts</h2><p>Hover a card (or click it once to select it), then press a key. Shortcuts are off while you type.</p>
  <div class="kgrid">${groups.map((g) => `<section><h3>${g}</h3>${SHORTCUTS.filter((x) => x.group === g).map((x) => `<div class="krow"><span class="keys">${x.keys.map((kk) => `<kbd>${kk}</kbd>`).join('<i>/</i>')}</span><span>${x.label}</span></div>`).join('')}</section>`).join('')}</div>
  <div class="row" style="justify-content:space-between;align-items:center"><span class="muted small">Mouse: double-click plays or taps · right-click for the full menu · drag between zones.</span><button type="button" class="btn" data-act="close">Done</button></div>`, { cls: 'wide' });
}
async function doFullscreen() {
  if (!fullscreenSupported()) { toast(isIOS() ? 'On iPhone, add EDH Club to your Home Screen for a full-screen table.' : 'Full screen isn’t available in this browser.', 5000); return; }
  const on = await toggleFullscreen(); if (on === null) toast('Full screen was blocked by the browser'); syncFsBtn();
}
async function installApp() {
  const r = await install();
  if (r === 'ios') openModal(`<h2>Add EDH Club to your Home Screen</h2><p>Safari doesn’t offer an install button, but it takes two taps:</p><ol class="steps"><li>Tap the <b>Share</b> button at the bottom of Safari.</li><li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol><p>You’ll get a full-screen table with no browser bars.</p><div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-act="close">Got it</button></div>`, { cls: 'narrow' });
  else if (r === 'installed') toast('EDH Club is installed. Open it from your home screen or app list.', 6000);
  else if (r === 'unavailable') toast('Your browser didn’t offer an install option here. Chrome, Edge and Android browsers usually do.', 6000);
}
function syncFsBtn() { const b = $('#fsBtn'); if (b) { b.classList.toggle('on', fullscreenOn()); b.title = fullscreenOn() ? 'Exit full screen (Shift+F)' : 'Full screen (Shift+F)'; } }
function bindUI() {
  FX.init();
  ['W', 'U', 'B', 'R', 'G', 'C'].forEach((k) => { HEX[k] = css('--m' + k) || '#aaa'; });
  $('#viewSel').onchange = (e) => { S.view = +e.target.value; S.sel = null; render(); };
  $('#motionSel').onchange = (e) => { S.motion = e.target.value; render(); };
  $('#fxBtn').onclick = () => { S.fx = !S.fx; render(); toast(S.fx ? 'Playmat effects on' : 'Playmat effects off'); };
  $('#tableBtn').onclick = () => { if (SPECTATE) { toast('Only players can manage the table'); return; } tableModal(); };
  $('#fsBtn').onclick = doFullscreen; document.addEventListener('fullscreenchange', syncFsBtn); document.addEventListener('webkitfullscreenchange', syncFsBtn);
  registerSW();
  $('#settingsBtn').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    openMenu([
      { label: `Playmat effects: ${S.fx ? 'on' : 'off'}`, fn: () => $('#fxBtn').click() },
      { label: `Sound: ${S.sound ? 'on' : 'off'}`, fn: () => $('#soundBtn').click() },
      { label: `Bot pace: ${{ relaxed: 'relaxed', normal: 'normal', fast: 'fast' }[S.botSpeed || 'normal']}`, fn: () => { S.botSpeed = { relaxed: 'normal', normal: 'fast', fast: 'relaxed' }[S.botSpeed || 'normal']; render(); toast(`Bots play at a ${S.botSpeed} pace`); } },
      { label: reminderSettingLabel(), fn: () => { S.reminders = S.reminders === false; render(); toast(S.reminders === false ? 'Trigger reminders off' : 'Trigger reminders on'); } },
      { label: `Foil effects: ${S.foilFx === false ? 'off' : 'on'}`, fn: () => { S.foilFx = S.foilFx === false; render(); toast(S.foilFx === false ? 'Foil effects off' : 'Foil effects on'); } },
      { label: `Card motion: ${{ full: 'full', reduced: 'reduced', off: 'off' }[S.motion]}`, fn: () => { S.motion = { full: 'reduced', reduced: 'off', off: 'full' }[S.motion]; render(); toast(`Card motion ${S.motion}`); } },
      { sep: true },
      { label: 'Keyboard shortcuts  (?)', fn: shortcutsModal },
      { label: fullscreenOn() ? 'Exit full screen' : 'Full screen  (Shift+F)', fn: doFullscreen },
      ...(canInstall() ? [{ label: 'Install EDH Club as an app', fn: installApp }] : []),
      { sep: true },
      { label: 'Game log', fn: logModal },
    ], r.left, r.bottom + 4, 'Settings');
  };
  $('#soundBtn').onclick = () => { S.sound = !S.sound; if (S.sound) { SFX.init(); SFX.play('chime', 'U'); } render(); };
  $('#importBtn').onclick = () => { if (SPECTATE) { toast('Spectators don\'t bring a deck. Join with the table code to play.'); return; } importModal(S.view); };
  $('#sideBtn').onclick = () => { const app = $('#app'); if (innerWidth <= 1280 || isCompact()) app.classList.toggle('show-side'); else app.classList.toggle('no-side'); requestAnimationFrame(() => { sizeBattlefields(); fanHand(); drawArrows(); }); };
  $('#newBtn').onclick = () => { if (SPECTATE) { toast('You\'re watching this table'); return; } if (net.active && !net.isHost) { toast('Only the host can start a new game'); return; } confirmModal('Life totals and the board reset. Everyone keeps their deck and draws a fresh 7.', 'New game', () => { if (net.active) net.send('all', { fn: 'newGame' }); newGame(true); render(); SFX.play('shuffle'); ensureArt(allNames(), { quiet: true }); }); };
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
  addEventListener('pagehide', () => { if (net.active) net.leave(); });
  $('#table').addEventListener('scroll', () => requestAnimationFrame(drawArrows), true);
  addEventListener('scroll', () => requestAnimationFrame(drawArrows));
}

/* ---------- Boot ---------- */
/* Board rules (stax, taxes, pillow fort): what the table currently lets a seat do. Bots obey these; humans get reminders. */
const allBattlefield = () => S ? S.players.flatMap((p, k) => (k < S.seats ? p.zones.battlefield.map((id) => S.cards[id]) : [])).filter(Boolean) : [];
function rulesFor(seat) { return boardRules(allBattlefield(), seat, isCreature, (k) => P(k).zones.hand.length); }
const castsThisTurn = (k) => (P(k).castsTurn && P(k).castsTurn.turn === S.turn.number ? P(k).castsTurn.n : 0);
const noteCast = (k) => { const p = P(k); if (!p.castsTurn || p.castsTurn.turn !== S.turn.number) p.castsTurn = { turn: S.turn.number, n: 0 }; p.castsTurn.n++; return p.castsTurn.n; };
const drawsThisTurn = (k) => (P(k).drawsTurn && P(k).drawsTurn.turn === S.turn.number ? P(k).drawsTurn.n : 0);
Rules.setVetoes({
  attack: (c) => { if (!S || MODE === 'hotseat') return null; const r = rulesFor(c.controller); for (const v of r.noAttack) { if (v.kind === 'all') return `${v.src}: creatures can't attack`; if (v.kind === 'nonflying' && !Rules.has(c, 'flying')) return `${v.src}: only fliers can attack`; if (v.kind === 'bridge' && powerOf(c) > v.hand) return `${v.src}: power above ${P(v.by).name}'s hand size`; } return null; },
  block: (b, a) => { if (!S || MODE === 'hotseat') return false; const r = rulesFor(b.controller); return r.noBlock.some((v) => v.kind === 'all' || (v.kind === 'even' && powerOf(b) % 2 === 0)); },
});
// Should this bot pay a "pay {n} or else" tax? Cheap ones yes when the mana is there; pricey ones only to deny the leader.
function botPays(i, n, src) {
  const mana = bot ? bot.manaAvailable(i) : 0; if (n > mana) return false;
  if (n <= 2) return true;
  const leader = oppsOf(i).sort((a, b) => P(b).life - P(a).life)[0];
  return src.controller === leader && mana >= n + 2;
}
Rules.setStaticContext((x) => {
  if (!S || x.zone !== 'battlefield') return null; let p = 0, t = 0; const kw = [];
  for (const id of (P(x.controller)?.zones.battlefield || [])) { const src = S.cards[id]; if (!src || !src.oracle) continue; const g = staticGrant(src, x); if (g) { p += g[0]; t += g[1]; if (g[2]) kw.push(g[2]); } }
  return p || t || kw.length ? { p, t, kw: kw.join(',') } : null;
});
function botApi() { return { S, P, moveCard, castToStack, toggleTap, cast: botCast, activate: botActivate, fire: fireEvent, runEffects, parseEffects, rulesFor, castTax, castBlock, castsThisTurn, manaValue, parseAbilities, spellKind, resolveTop, attack, combatDamage, nextPhase, passTurn, isCreature, powerOf, toughnessOf, log, Rules, draw, changeLife: changeLifeAny, request, net, toast, isMine: (k) => net.isMine(k), lookup, toGraveyard: (c) => { if (net.isMine(c.controller)) moveCard(c.id, c.owner, 'graveyard'); else request(c.controller, 'cardTo', c.id, 'graveyard'); }, toExile: (c) => { if (net.isMine(c.controller)) moveCard(c.id, c.owner, 'exile'); else request(c.controller, 'cardTo', c.id, 'exile'); } }; }
function roomBar() {
  if (MODE !== 'room') return;
  const t = $('#roomBar'); if (!t) return;
  const humans = new Set(Object.values(net.peers).filter((p) => p.seat != null && !net.botSeats().includes(p.seat)).map((p) => p.seat)).size;
  const watching = net.spectators().length;
  t.innerHTML = `<span class="code">${esc(ROOM.code)}</span>${SPECTATE ? '<span class="watching" title="You are watching this table">Watching</span>' : '<button type="button" class="btn ghost sm" id="copyInvite" title="Copy invite link">Invite</button>'}<button type="button" class="btn ghost sm" id="copyWatch" title="Copy a watch-only link">Watch link</button><span>${humans}/${net.humanSeats().length}</span>${watching ? `<span class="eye" title="${watching} watching">👁 ${watching}</span>` : ''}`;
  const copy = async (link, what) => { try { await navigator.clipboard.writeText(link); toast(`${what} copied`); } catch { toast(link, 8000); } };
  if ($('#copyInvite')) $('#copyInvite').onclick = () => copy(`${location.origin}/?join=${ROOM.code}`, 'Invite link');
  $('#copyWatch').onclick = () => copy(`${location.origin}/?watch=${ROOM.code}`, 'Watch link');
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
      const seat = await net.join({ code: ROOM.code, name: ROOM.name, isHost: ROOM.host && !SPECTATE, seats: ROOM.seats, bots: ROOM.bots, spectate: SPECTATE });
      ROOM.seats = net.seats; ROOM.bots = net.bots;
      S = null; newGame(false); S.view = seat ?? 0; if (seat != null) P(seat).avatar = localAvatar();
      if (SPECTATE) { document.body.classList.add('spectator'); S.players.forEach((p, k) => { if (k < S.seats) p.empty = !net.botSeats().includes(k); }); }
      const prior = SPECTATE ? null : recallRoom(ROOM.code);
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
      net.on('all', ({ fn, kind, cardId, seat, id, on, key, paid, nth, type, n }) => { if (fn === 'cast') { if (net.isHost) { const cc = S.cards[cardId] || { name: '?', controller: seat, type: type || '' }; fireEvent('opponentCasts', { caster: seat, card: cc, nth: nth || 1 }); } return; } if (fn === 'drew') { if (net.isHost) fireEvent('opponentDraws', { drawer: seat, n: n || 1 }); return; } if (fn === 'answer') { if (asks[key]) { asks[key](paid); delete asks[key]; } return; } if (fn === 'ack' || fn === 'hold' || fn === 'counter') { if (net.isHost) respond(fn, id, seat, on); return; } if (fn === 'wipe') ALL.wipe(kind); else if (fn === 'newGame') ALL.newGame(); else if (fn === 'attackEnd') ALL.attackEnd(cardId); else if (fn === 'kick' && seat === net.seat) { toast('The host removed you from this table', 6000); net.leave(); setTimeout(() => { location.href = '/'; }, 1500); } });
      net.on('peers', (peers) => {
        const host = Object.values(peers).find((pr) => pr.isHost && pr.seats);
        if (host && !net.isHost) applyLayout(host.seats, host.botList || []);
        Object.values(peers).forEach((pr) => { if (pr.spectator) return; if (pr.seat != null && pr.seat < S.seats && !net.isMine(pr.seat)) { const p = P(pr.seat); p.empty = false; if (p.name === SEAT_NAMES[pr.seat] || p.bot) { p.name = pr.name; p.bot = false; } } });
        // seats with no peer and no bot are open
        const seated = new Set(Object.values(peers).map((pr) => pr.seat));
        S.players.forEach((p, k) => { if (k < S.seats && k !== net.seat && !net.botSeats().includes(k) && !seated.has(k)) { if (!p.empty) { p.empty = true; purgeOwner(k); } } });
        roomBar(); render();
      });
      net.on('resend', () => { net.queueSync(seatSnap, sharedSnap); });
      let lastWatch = new Set();
      const watchNote = () => { const now = new Set(net.spectators().map((p) => p.name + '|' + (p.clientId || ''))); if (!SPECTATE && net.isHost) { [...now].filter((k) => !lastWatch.has(k)).forEach((k) => log(`${k.split('|')[0]} is watching`)); [...lastWatch].filter((k) => !now.has(k)).forEach((k) => log(`${k.split('|')[0]} stopped watching`)); } lastWatch = now; };
      const prevPeers = net.handlers.peers; net.on('peers', (peers) => { prevPeers(peers); watchNote(); });
      if (!ROOM.host) { ROOM.seats = S.seats; }
      toast(SPECTATE ? `Watching table ${ROOM.code}. Hands stay hidden; you can look at anything on the board.` : ROOM.host ? `Table ${ROOM.code} is open. Share the code.` : `You're seated at ${ROOM.code}`, 5000);
    } catch (e) {
      net.leave(); net.seat = null; net.ready = false;
      document.body.insertAdjacentHTML('afterbegin', `<div class="toast" style="position:fixed;left:50%;top:40%;transform:translateX(-50%);z-index:99;pointer-events:auto;max-width:460px">${esc(e.message)}<br><a href="/">Back to the lobby</a></div>`);
      S = null; newGame(false);
    }
  } else if (MODE === 'bots') { net.seats = ROOM.seats; net.botList = Array.from({ length: ROOM.bots }, (_, k) => ROOM.seats - 1 - k).sort(); S = null; newGame(false); S.view = 0; P(0).avatar = localAvatar(); }
  else if (!S) { S = null; newGame(false); }
  if (MODE !== 'hotseat') bot = makeBot(botApi());
  bindUI(); hydrate(); render(); roomBar();
  ensureArt(allNames());
  const want = SPECTATE ? '' : (Q.get('deck') || '');
  if (/^top:\d+$/.test(want) && !seatRestored) {
    try {
      const r = await fetch(`/api/deck/${want.slice(4)}`); const d = await r.json(); if (!r.ok || d.error) throw new Error(d.error || r.statusText);
      const me = net.active ? net.seat : 0; loadDeck(me, d.text, null); P(me).deckName = d.name; P(me).deckId = ''; render(); toast(`Seated with ${d.name}`); ensureArt(allNames(), { quiet: true });
      log(`${P(me).name} sat down with ${d.commander}`);
    } catch (e) { toast(`Couldn't load that deck: ${e.message}`, 6000); }
  } else if (want && !want.startsWith('top:') && online && !seatRestored) {
    try { const d = await getDeck(want); if (d) { const me = net.active ? net.seat : 0; loadDeck(me, d.list, null); P(me).deckId = d.id; P(me).deckName = d.name; if (d.mat && d.mat !== 'auto') P(me).mat = d.mat; render(); toast(`Seated with ${d.name}`); ensureArt(allNames(), { quiet: true }); bumpDeckPlays(d.id); } else toast('That deck isn\'t on your account', 5000); }
    catch (e) { toast(`Couldn't load that deck: ${e.message}`, 6000); }
  } else if (MODE !== 'hotseat' && online && !seatRestored && !SPECTATE) {
    try {
      const id = await defaultDeckId(); const d = id ? await getDeck(id) : null;
      if (d) { const me = net.active ? net.seat : 0; loadDeck(me, d.list, null); P(me).deckId = d.id; P(me).deckName = d.name; if (d.mat && d.mat !== 'auto') P(me).mat = d.mat; render(); toast(`Seated with ${d.name}`); ensureArt(allNames(), { quiet: true }); bumpDeckPlays(d.id); }
    } catch { /* deck library unavailable */ }
  }
  if (net.active) net.resendAll();
  if (MODE !== 'hotseat' && !seatRestored) dealBotDecks();
}
boot();
// Read-only hook for the test suite.
window.__edhState = () => S;
window.__edhMut = (fn) => { fn(S); render(); };
window.__edhApi = () => ({ fire: fireEvent, runEffects, parseEffects, parseAbilities, moveCard, activate: botActivate, spectate: SPECTATE, net, rulesFor, draw, Rules });
