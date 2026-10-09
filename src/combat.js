// Combat rules the table understands: evasion, first strike, deathtouch, trample, lifelink, indestructible,
// menace, vigilance, haste and summoning sickness. Pure functions over card objects, shared by the UI and the bots.
// Still a manual table: anything not covered here the pod resolves by hand.

const num = (s) => { const n = parseInt(s, 10); return isNaN(n) ? 0 : n; };
// The table can register a context function that returns static bonuses (anthems, keyword grants) for a card.
let ctxFn = null;
export function setStaticContext(fn) { ctxFn = fn; }
const grant = (c) => (ctxFn && c && c.zone === 'battlefield' ? ctxFn(c) : null) || { p: 0, t: 0, kw: '' };
export function ptOf(c) {
  if (!c || !c.pt) return [0, 0];
  const m = String(c.pt).split('/'); const p1 = c.p1 || 0; const g = grant(c);
  return [num(m[0]) + p1 + (c.tp || 0) + g.p, num(m[1]) + p1 + (c.tt || 0) + g.t];
}
export const powerOf = (c) => Math.max(0, ptOf(c)[0]);
export const toughnessOf = (c) => ptOf(c)[1];
export const kws = (c) => `${c?.kw || ''},${c?.tkw || ''},${grant(c).kw}`.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
export const has = (c, k) => kws(c).includes(k);
// Stationed spacecraft, crewed vehicles, animated lands and the like: a permanent counts as a creature when its
// type says so, when the player flags it ("It's a creature now"), or when a Station threshold is met by counters.
export function stationThreshold(c) { const m = String(c?.oracle || '').match(/artifact creature at (\d+)\+/i); return m ? +m[1] : 0; }
export const isCreature = (c) => !!c && (/Creature/.test(c.type || '') || !!c.anim || (stationThreshold(c) > 0 && (c.ctr || 0) >= stationThreshold(c)));
export const KEYWORDS = ['flying', 'reach', 'first strike', 'double strike', 'deathtouch', 'trample', 'lifelink', 'indestructible', 'menace', 'vigilance', 'haste', 'defender', 'hexproof', 'flash'];
export const shownKeywords = (c) => kws(c).filter((k) => KEYWORDS.includes(k));

/** Can this creature be declared as an attacker right now? */
export function canAttack(c) {
  if (!isCreature(c)) return { ok: false, why: 'Not a creature' };
  if (c.tapped) return { ok: false, why: 'Tapped' };
  if (has(c, 'defender')) return { ok: false, why: 'Defender' };
  if (c.sick && !has(c, 'haste')) return { ok: false, why: 'Summoning sick' };
  return { ok: true };
}
/** Can this creature block that attacker (ignoring menace, which is a property of the whole block)? */
export function canBlock(b, a) {
  if (!isCreature(b) || b.tapped) return false;
  if (kws(b).some((k) => k === "can't block")) return false;
  if (has(a, 'flying') && !(has(b, 'flying') || has(b, 'reach'))) return false;
  return true;
}
export function blockLegal(a, blockers) {
  if (!blockers.length) return { ok: true };
  if (blockers.some((b) => !canBlock(b, a))) return { ok: false, why: has(a, 'flying') ? 'Only flying or reach creatures can block it' : 'That creature can\'t block' };
  if (has(a, 'menace') && blockers.length < 2) return { ok: false, why: 'Menace: needs two or more blockers' };
  return { ok: true };
}

/**
 * Resolve one blocked (or unblocked) attack. Returns the damage events in order, who dies, and what reaches the player.
 * Damage already marked on cards (c.dmg) counts toward lethal.
 */
export function simulate(a, blockers, o = {}) {
  const dmg = new Map(); const dead = new Set(); const events = []; const lifelink = {};
  let toPlayer = 0;
  const marked = (c) => (c.dmg || 0) + (dmg.get(c.id) || 0);
  const lethalFor = (src, dst) => (has(src, 'deathtouch') ? 1 : Math.max(0, toughnessOf(dst) - marked(dst)));
  const alive = (c) => !dead.has(c.id);
  const hit = (src, dst, n) => { if (n <= 0) return; dmg.set(dst.id, (dmg.get(dst.id) || 0) + n); events.push({ from: src.id, to: dst.id, n }); if (has(src, 'lifelink')) lifelink[src.controller] = (lifelink[src.controller] || 0) + n; };
  const face = (src, n) => { if (n <= 0) return; toPlayer += n; events.push({ from: src.id, to: 'player', n }); if (has(src, 'lifelink')) lifelink[src.controller] = (lifelink[src.controller] || 0) + n; };
  const settle = () => { [a, ...blockers].forEach((c) => { if (alive(c) && !has(c, 'indestructible')) { const t = toughnessOf(c); if ((t > 0 && marked(c) >= t) || events.some((e) => e.to === c.id && has(idToCard(e.from), 'deathtouch'))) dead.add(c.id); } }); };
  const all = [a, ...blockers]; const idToCard = (id) => all.find((c) => c.id === id);
  const strikes = (c, step) => (step === 1 ? has(c, 'first strike') || has(c, 'double strike') : !has(c, 'first strike') || has(c, 'double strike'));

  const attackerDeals = () => {
    let left = powerOf(a); const live = blockers.filter(alive);
    if (!live.length) { if (!blockers.length || has(a, 'trample')) face(a, left); return; }
    for (const b of live) { const need = lethalFor(a, b); const n = has(a, 'trample') ? Math.min(left, need) : (b === live[live.length - 1] ? left : Math.min(left, need)); hit(a, b, n); left -= n; if (left <= 0) break; }
    if (left > 0 && has(a, 'trample')) face(a, left);
  };
  for (const step of [1, 2]) {
    const aStrikes = alive(a) && strikes(a, step);
    const bs = blockers.filter((b) => alive(b) && strikes(b, step));
    if (aStrikes) attackerDeals();
    bs.forEach((b) => hit(b, a, powerOf(b)));
    settle();
  }
  const blockersDie = blockers.filter((b) => dead.has(b.id)).map((b) => b.id);
  return { events, attackerDies: dead.has(a.id), blockersDie, toPlayer, lifelink, damage: Object.fromEntries(dmg) };
}

/** One-line human summary of a simulated block, for prompts and the log. */
export function describe(a, blockers, r) {
  const parts = [];
  if (!blockers.length) return `${a.name} is unblocked for ${powerOf(a)}`;
  parts.push(r.attackerDies ? `${a.name} dies` : `${a.name} survives`);
  blockers.forEach((b) => parts.push(r.blockersDie.includes(b.id) ? `${b.name} dies` : `${b.name} survives`));
  if (r.toPlayer) parts.push(`${r.toPlayer} tramples through`);
  return parts.join(' · ');
}
