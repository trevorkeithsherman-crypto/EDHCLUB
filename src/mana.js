// Mana the way the rules work it (CR 106, 107.4, 202): a cost is generic mana plus specific pips — colored {G},
// hybrid {G/U} (either), Phyrexian {G/P} (the color or 2 life), colorless {C} (only colorless mana pays it) — and a
// source produces mana of particular colors. Basics make their color; nonbasic lands and rocks make what their text
// says ({T}: Add {C} is colorless and cannot pay {G}); Command Tower / Arcane Signet make the commander's colors;
// Treasures make any color and are sacrificed; mana creatures work only when they are not summoning sick.
// The solver pays the specific pips first with the least flexible sources, then the generic part with whatever is
// left, preferring to keep colored sources open. Pure functions; the bots decide what to cast with them.

const COLORS = ['W', 'U', 'B', 'R', 'G'];
const BASIC = { plains: 'W', island: 'U', swamp: 'B', mountain: 'R', forest: 'G' };
const lc = (s) => String(s || '').toLowerCase();

/** "{2}{G}{G/U}{W/P}{C}{X}" → { generic, pips: [{opts:['G']},{opts:['G','U']},{opts:['W'],phy:true},{opts:['C']}], x } */
export function parseCost(costStr) {
  const out = { generic: 0, pips: [], x: false };
  for (const t of String(costStr || '').match(/\{[^}]+\}/g) || []) {
    const v = t.slice(1, -1).toUpperCase();
    if (/^\d+$/.test(v)) out.generic += +v;
    else if (v === 'X' || v === 'Y') out.x = true;
    else if (v === 'C') out.pips.push({ opts: ['C'] });
    else if (v === 'S') out.pips.push({ opts: ['C', ...COLORS] }); // snow: any mana here (no snow tracking)
    else if (/^[WUBRG]\/P$/.test(v)) out.pips.push({ opts: [v[0]], phy: true });
    else if (/^[WUBRG]\/[WUBRG]$/.test(v)) out.pips.push({ opts: [v[0], v[2]] });
    else if (/^2\/[WUBRG]$/.test(v)) out.pips.push({ opts: [v[2]], twobrid: true });
    else if (/^[WUBRG]$/.test(v)) out.pips.push({ opts: [v] });
    else if (/^[WUBRG]\/C$/.test(v)) out.pips.push({ opts: [v[0], 'C'] });
  }
  return out;
}
export const manaValueOf = (costStr) => { const c = parseCost(costStr); return c.generic + c.pips.length; };

/** Colors a land's type line gives it (Breeding Pool is a Forest Island). */
export function basicTypeColors(c) { const t = lc(c.type); return Object.entries(BASIC).filter(([n]) => new RegExp(`\\b${n}\\b`).test(t)).map(([, k]) => k); }

/**
 * Mana units a permanent can produce right now: [] when it cannot. Each unit = { colors: ['G'] | COLORS | ['C'], src }.
 * ctx: { identity: ['R','G'] (commander colors), sick: bool }
 */
export function unitsOf(c, ctx = {}) {
  if (!c || c.tapped || c.zone !== 'battlefield') return [];
  const o = lc(c.oracle).replace(/\(.*?\)/g, ''); const type = c.type || '';
  const isLand = /Land/.test(type); const isCreature = /Creature/.test(type) || c.anim;
  if (isCreature && (c.sick && !/haste/.test(lc(c.kw)))) return []; // summoning sickness stops {T} abilities
  if (!isLand && !/Artifact|Creature|Enchantment/.test(type)) return [];
  const units = []; const push = (colors, n = 1) => { for (let k = 0; k < n; k++) units.push({ colors, src: c }); };
  const idn = ctx.identity && ctx.identity.length ? ctx.identity : COLORS;
  // land types first
  const bt = isLand ? basicTypeColors(c) : [];
  if (bt.length) push(bt);
  // tap abilities in the text ("{T}: Add {G}", "{T}: Add {R} or {G}", "{T}: Add {C}{C}", "{T}: Add one mana of any color")
  const abilities = o.split('\n').filter((l) => /^\{t\}(?:, pay \d+ life)?: add|^\{t\}: add|^\{q\}: add/.test(l) || (/^\{\d\}, \{t\}: add/.test(l)));
  for (const l of abilities) {
    if (bt.length && isLand && /add \{[wubrg]\}\.?$/.test(l) && bt.includes(l.match(/add \{([wubrg])\}/)[1].toUpperCase())) continue; // basic already counted
    const feed = /^\{(\d)\}, \{t\}/.test(l) ? +l.match(/^\{(\d)\}/)[1] : 0; // Signets: pay {1} to get two → net one
    if (/any color|any one color|of any type|any combination of colors/.test(l)) { const n = /two mana|two additional/.test(l) ? 2 : /three mana/.test(l) ? 3 : 1; push(/commander's color identity|color in your commander's/.test(l) ? idn : COLORS, Math.max(1, n - feed)); continue; }
    if (/commander's color identity|a color in your commander's color identity/.test(l)) { push(idn, 1); continue; }
    const pipsOut = (l.match(/\{[wubrgc]\}/g) || []).map((p) => p[1].toUpperCase());
    if (!pipsOut.length) continue;
    if (/ or /.test(l) || new Set(pipsOut).size > 1 && / or |, or /.test(l)) { push([...new Set(pipsOut)], 1); continue; } // {R} or {G}
    if (feed) { push([...new Set(pipsOut)], Math.max(1, pipsOut.length - feed)); continue; } // Signet nets one of either color
    pipsOut.forEach((p) => push([p], 1)); // {C}{C}, {G}{G}
  }
  // Treasures and other "sacrifice: add" sources
  if (!units.length && /sacrifice (?:this artifact|~|this token|this creature): add one mana of any color/.test(o)) push(COLORS, 1), units.forEach((u) => { u.sac = true; });
  if (!units.length && isLand && !c.oracle && /Basic/.test(type)) push(bt.length ? bt : COLORS, 1);
  return units;
}

/**
 * Pay `cost` (parseCost result or string) + extra generic from `units`. Returns { used: [unit...], life, floatingUsed }
 * or null when it cannot be paid. `opts.life` lets Phyrexian pips be paid with life when no color is available.
 */
export function solve(costIn, units, opts = {}) {
  const cost = typeof costIn === 'string' ? parseCost(costIn) : { ...costIn };
  const generic = (cost.generic || 0) + (opts.extraGeneric || 0);
  let floating = opts.floating || 0; let life = 0;
  const pips = cost.pips.slice().sort((a, b) => a.opts.length - b.opts.length);
  const free = units.slice(); const used = [];
  const fits = (u, p) => p.opts.some((o) => u.colors.includes(o));
  // specific pips: bipartite matching, least flexible pip first, prefer the least flexible unit
  const assign = (idx) => {
    if (idx >= pips.length) return true;
    const p = pips[idx];
    const cands = free.filter((u) => !u._taken && fits(u, p)).sort((a, b) => a.colors.length - b.colors.length);
    for (const u of cands) { u._taken = true; if (assign(idx + 1)) { used.push(u); return true; } u._taken = false; }
    if (p.phy && (opts.life || 0) - life > 10) { life += 2; return assign(idx + 1); } // Phyrexian: 2 life instead
    if (p.twobrid && free.filter((u) => !u._taken).length >= 2) { const two = free.filter((u) => !u._taken).sort((a, b) => a.colors.length - b.colors.length).slice(0, 2); two.forEach((u) => { u._taken = true; used.push(u); }); if (assign(idx + 1)) return true; two.forEach((u) => { u._taken = false; used.pop(); used.pop(); }); }
    return false;
  };
  const ok = assign(0);
  free.forEach((u) => { delete u._taken; });
  if (!ok) return null;
  // generic: floating first, then the least flexible leftover units (keep rainbow sources open)
  let need = generic; const fl = Math.min(floating, need); need -= fl;
  const only = (u) => (u.colors.length === 1 && u.colors[0] === 'C' ? 0 : 1);
  const rest = free.filter((u) => !used.includes(u)).sort((a, b) => only(a) - only(b) || a.colors.length - b.colors.length || (a.sac ? 1 : 0) - (b.sac ? 1 : 0));
  if (rest.length < need) return null;
  used.push(...rest.slice(0, need));
  return { used, life, floatingUsed: fl };
}
export const canPay = (cost, units, opts) => !!solve(cost, units, opts);
