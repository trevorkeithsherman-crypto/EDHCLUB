// Card text interpreter. Reads oracle text into triggers, activated abilities, static effects and spell effects
// the bots can act on. It is deliberately a pattern library, not a rules engine: common Commander text resolves
// itself, anything it can't read is left on the table for the pod. Humans' own cards are never resolved for them;
// only static effects (anthems, keyword grants) apply to everyone because they are pure math.

const lc = (s) => String(s || '').toLowerCase();
const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, x: 'x' };
const num = (w) => (w == null ? 1 : NUM[lc(w)] !== undefined ? NUM[lc(w)] : parseInt(w, 10) || 1);
const COLORS = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const BASIC = ['plains', 'island', 'swamp', 'mountain', 'forest'];

/* ---------- Effect parsing: one clause → list of primitives ---------- */
export function parseEffects(text) {
  const out = []; const t = lc(text).replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
  for (const raw of t.split(/\.\s+|\. ?$|;\s*/)) {
    const s = raw.trim(); if (!s) continue; let m;
    const who = /each opponent/.test(s) ? 'opponents' : /target opponent|target player|an opponent/.test(s) ? 'opponent' : /each player/.test(s) ? 'all' : 'you';
    if ((m = s.match(/(?:you )?draw (a|two|three|four|five|x|\d+) cards?/))) { out.push({ k: 'draw', n: num(m[1]), who: /each player/.test(s) ? 'all' : /target player|target opponent|each opponent/.test(s) ? who : 'you' }); }
    if ((m = s.match(/(?:you )?gain (\d+|x) life/))) out.push({ k: 'life', n: num(m[1]), who: 'you' });
    if ((m = s.match(/(each opponent|target opponent|target player|each player) loses (\d+|x) life/))) out.push({ k: 'life', n: -num(m[2]), who });
    if ((m = s.match(/\byou lose (\d+|x) life/))) out.push({ k: 'life', n: -num(m[1]), who: 'you' });
    if ((m = s.match(/deals? (\d+|x) damage to (any target|each opponent|target creature or player|target creature or planeswalker|target player or planeswalker|target opponent or planeswalker|target opponent|target creature|each creature|each creature and each player|each player|that player|its controller)/))) {
      const tg = m[2]; out.push({ k: 'damage', n: num(m[1]), to: /each creature and each player/.test(tg) ? 'everything' : /each creature/.test(tg) ? 'creatures' : /each opponent/.test(tg) ? 'opponents' : /each player/.test(tg) ? 'all' : /any target/.test(tg) ? 'any' : /creature/.test(tg) ? 'creature' : 'opponent' });
    }
    if ((m = s.match(/(?:create|put) (a|an|two|three|four|five|x|\d+) (\d+)\/(\d+) ((?:white|blue|black|red|green|colorless|and|,| )*?)([a-z][a-z' -]*?) (?:artifact |enchantment )?creature tokens?(?: with ([a-z ,]+?))?(?: onto the battlefield)?/))) {
      const name = m[5].replace(/^(?:(?:white|blue|black|red|green|colorless)[, ]*(?:and )?)+/, '').trim(); const cols = (m[4] + ' ' + m[5]).toLowerCase();
      out.push({ k: 'token', n: num(m[1]), pt: `${m[2]}/${m[3]}`, name: name.replace(/\b\w/g, (c) => c.toUpperCase()), colors: Object.entries(COLORS).filter(([w]) => cols.includes(w)).map(([, c]) => c).join(''), kw: (m[6] || '').replace(/ and /g, ',').trim() });
    } else if ((m = s.match(/create (a|an|two|three|\d+) treasure tokens?/))) out.push({ k: 'token', n: num(m[1]), pt: '', name: 'Treasure', colors: '', type: 'Token Artifact — Treasure', oracle: '{T}, Sacrifice this artifact: Add one mana of any color.' });
    else if ((m = s.match(/create (a|an|two|three|\d+) (clue|food|blood) tokens?/))) out.push({ k: 'token', n: num(m[1]), pt: '', name: m[2].replace(/\b\w/g, (c) => c.toUpperCase()), colors: '', type: `Token Artifact — ${m[2].replace(/\b\w/g, (c) => c.toUpperCase())}` });
    if ((m = s.match(/(destroy|exile) (target|each|all) (creature|artifact|enchantment|nonland permanent|permanent|artifact or enchantment|creature or planeswalker|land)s?(?: an opponent controls| you don't control)?/))) {
      const what = m[3].replace(/s$/, ''); out.push({ k: m[1] === 'exile' ? 'exile' : 'destroy', what: /artifact or enchantment/.test(what) ? 'artifact|enchantment' : /creature or planeswalker/.test(what) ? 'creature' : what, all: m[2] !== 'target', theirs: /opponent controls|don't control/.test(s) });
    }
    if ((m = s.match(/return (target|up to \w+ target) (creature|permanent|nonland permanent|artifact|enchantment)(?: cards?)? (?:an opponent controls |you don't control )?(?:to (?:its|their) owners?'? hands?)/))) out.push({ k: 'bounce', what: m[2] });
    if ((m = s.match(/return target creature card from your graveyard to the battlefield/))) out.push({ k: 'reanimate' });
    if ((m = s.match(/return target (creature|permanent|artifact|enchantment|instant or sorcery|land)(?: card)? from your graveyard to your hand/))) out.push({ k: 'regrow', what: m[1] });
    if ((m = s.match(/search your library for (?:a |an |up to (\w+) )?(basic land|plains|island|swamp|mountain|forest|land|creature|artifact|enchantment|instant|sorcery)(?: cards?)?[^.]*?(?:put (?:it|them|that card|those cards|one|that card) onto the battlefield( tapped)?|put (?:it|them|that card|those cards) into your hand|reveal (?:it|them)[^.]*put (?:it|them) into your hand)/))) {
      out.push({ k: 'tutor', what: m[2], n: m[1] ? num(m[1]) : 1, to: /onto the battlefield/.test(s) ? 'battlefield' : 'hand', tapped: !!m[3] || /onto the battlefield tapped/.test(s), extra: /and the other into your hand|put one onto the battlefield[^.]*the rest into your hand/.test(s) });
    }
    if ((m = s.match(/put (a|an|two|three|x|\d+) \+1\/\+1 counters? on (it|this creature|this permanent|target creature|each creature you control|~)/))) out.push({ k: 'counter', n: num(m[1]), on: /target/.test(m[2]) ? 'target' : /each/.test(m[2]) ? 'mine' : 'self' });
    if ((m = s.match(/(target creature|creatures you control|it|this creature|that creature|~) gets? \+(\d+)\/\+(\d+)(?: and gains? ([a-z ]+?))? until end of turn/))) out.push({ k: 'pump', p: +m[2], t: +m[3], on: /creatures you control/.test(m[1]) ? 'mine' : /target/.test(m[1]) ? 'target' : 'self', kw: (m[4] || '').replace(/ and /g, ',') });
    if ((m = s.match(/(each opponent|target opponent|target player) (?:discards|discard) (a|two|three|\d+) cards?/))) out.push({ k: 'discard', n: num(m[2]), who });
    if ((m = s.match(/(?:each opponent|target opponent|target player|each player) sacrifices? (a|an|two|\d+) (creature|artifact|enchantment|permanent|land)s?/))) out.push({ k: 'edict', n: num(m[1]), what: m[2], who });
    if (/^untap (all|each) (creature|land|permanent)s? you control/.test(s) || /untap target (creature|land|permanent)/.test(s)) out.push({ k: 'untap', what: (s.match(/untap (?:all |each |target )?(creature|land|permanent)/) || [])[1] || 'permanent' });
    if ((m = s.match(/(?:each player|target player|target opponent|each opponent)? ?(?:mills?|puts? the top (\w+) cards? of (?:their|your|his or her) library into (?:their|your|his or her) graveyard)/)) && /mill|library into/.test(s)) { const n = (s.match(/mills? (\w+)/) || [])[1] || m[2]; if (n) out.push({ k: 'mill', n: num(n), who: /each player/.test(s) ? 'all' : /opponent|target player/.test(s) ? 'opponent' : 'you' }); }
    if (/add (?:\{[wubrgc]\})+|add one mana of any color|add (?:one|two|three) mana/.test(s) && !/\{t\}/.test(s)) out.push({ k: 'mana', n: (s.match(/\{[wubrgc]\}/g) || ['x']).length });
    if ((m = s.match(/scry (\d+)/))) out.push({ k: 'scry', n: +m[1] });
    if (/you may pay \{(\d+)\}/.test(s) || /unless (?:that player|they) pays? \{(\d+)\}/.test(s)) out.push({ k: 'tax', n: +((s.match(/pays? \{(\d+)\}/) || [])[1] || 1) });
  }
  return out;
}

/* ---------- Ability parsing: the card's whole text → triggers / activated / static ---------- */
export function parseAbilities(c) {
  const name = String(c.name || '');
  const text = !name ? String(c.oracle || '') : String(c.oracle || '').replace(new RegExp(name.split(' // ')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '~').replace(new RegExp(name.split(',')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '~');
  const abilities = [];
  for (const raw of text.split(/\n/)) {
    const line = raw.trim(); if (!line) continue; const l = lc(line); let m;
    if ((m = line.match(/^((?:\{[^}]+\}|[^:{]+?)(?:, (?:\{[^}]+\}|[^:{]+?))*): (.+)$/)) && /\{t\}|\{\d+\}|\{[wubrg]\}|sacrifice|pay \d+ life|discard a card|tap an untapped/.test(lc(m[1])) && !/^whenever|^when|^at the/.test(l)) {
      const cost = lc(m[1]); abilities.push({ kind: 'activated', cost, tap: /\{t\}/.test(cost), mana: (cost.match(/\{[wubrgc]\}/g) || []).length + (cost.match(/\{(\d+)\}/g) || []).reduce((a, x) => a + parseInt(x.slice(1, -1), 10), 0), sacSelf: /sacrifice ~|sacrifice this/.test(cost), sacOther: /sacrifice (a|an|another) (creature|artifact|permanent|land)/.test(cost), life: +((cost.match(/pay (\d+) life/) || [])[1] || 0), sorcery: /only as a sorcery/.test(l), effects: parseEffects(m[2]), text: line });
      continue;
    }
    if ((m = l.match(/^(whenever|when|at the beginning of) (.+?), (.+)$/))) {
      const cond = m[2]; let event = null; let scope = 'self';
      if (/^~ enters|^this (creature|permanent|artifact|enchantment) enters/.test(cond)) event = 'etb';
      else if (/^~ or another creature dies|^~ or another creature you control dies/.test(cond)) { event = 'anyDies'; scope = /you control/.test(cond) ? 'mine' : 'any'; }
      else if (/^~ dies|^this creature dies|^~ is put into a graveyard/.test(cond)) event = 'dies';
      else if (/^(a|another) creature (?:you control )?dies|^(a|another) creature is put into a graveyard/.test(cond)) { event = 'anyDies'; scope = /you control/.test(cond) ? 'mine' : 'any'; }
      else if (/^(a|another) (creature|nontoken creature|permanent) enters(?: the battlefield)? under your control|^(a|another) (creature|nontoken creature|permanent) you control enters|^one or more creatures you control enter/.test(cond)) { event = 'creatureEnters'; scope = 'mine'; }
      else if (/^a land enters(?: the battlefield)? under your control|^a land you control enters/.test(cond)) event = 'landfall';
      else if (/^~ attacks|^this creature attacks/.test(cond)) event = 'attacks';
      else if (/^(a|another|one or more) creatures? you control attacks?/.test(cond)) event = 'anyAttacks';
      else if (/^~ deals combat damage to a player|^this creature deals combat damage to a player/.test(cond)) event = 'combatDamage';
      else if (/^an opponent casts a spell|^an opponent casts an? (instant|sorcery|creature|noncreature) spell|^a player casts a spell/.test(cond)) { event = 'opponentCasts'; scope = /a player casts/.test(cond) ? 'any' : 'opponents'; }
      else if (/^you cast a (creature|spell|noncreature|instant or sorcery)/.test(cond)) event = 'youCast';
      else if (/^(your|each) upkeep|^the upkeep of each player/.test(cond) || /beginning of your upkeep/.test(l)) event = 'upkeep';
      else if (/^your end step|^the end step|^each end step/.test(cond) || /beginning of your end step/.test(l)) event = 'endStep';
      else if (/^(a|one or more) creature tokens? enters|^one or more tokens enter/.test(cond)) event = 'tokenEnters';
      else if (/^you gain life/.test(cond)) event = 'gainLife';
      else if (/^you draw a card|^you draw your (first|second) card/.test(cond)) event = 'youDraw';
      if (event) { abilities.push({ kind: 'trigger', event, scope, may: /you may/.test(m[3]), effects: parseEffects(m[3]), text: line }); continue; }
    }
    if ((m = l.match(/^(other )?(creatures|goblin creatures|elf creatures|[a-z]+ creatures|creature tokens|tokens) you control (?:get|have) (\+(\d+)\/\+(\d+))?(?: and (?:have|gain) )?([a-z ,]+?)?\.?$/))) {
      const filt = m[2].replace(/ you control.*/, ''); abilities.push({ kind: 'static', other: !!m[1], filter: /^creatures$/.test(filt) ? null : filt.replace(/ creatures?$/, '').replace(/^creature /, ''), tokens: /tokens?/.test(filt), p: +(m[4] || 0), t: +(m[5] || 0), kw: (m[6] || '').replace(/ and /g, ',').trim(), text: line }); continue;
    }
    if ((m = l.match(/^(other )?(creatures|[a-z]+ creatures) you control (?:get|have) \+(\d+)\/\+(\d+)(?: and have ([a-z ,]+))?/))) { abilities.push({ kind: 'static', other: !!m[1], filter: /^creatures$/.test(m[2]) ? null : m[2].replace(/ creatures?$/, ''), p: +m[3], t: +m[4], kw: (m[5] || '').replace(/ and /g, ',').trim(), text: line }); continue; }
  }
  return abilities;
}
/** Static bonus a permanent grants to card `x` on the same side. Returns [p, t, keywordsCSV]. */
export function staticGrant(src, x) {
  if (src === x && false) return null;
  let p = 0, t = 0; const kw = [];
  for (const a of parseAbilities(src)) {
    if (a.kind !== 'static') continue; if (a.other && src.id === x.id) continue;
    if (a.tokens && !x.token) continue;
    if (a.filter && !new RegExp(`\\b${a.filter}\\b`, 'i').test(x.type || '')) continue;
    p += a.p; t += a.t; if (a.kw) kw.push(a.kw);
  }
  return (p || t || kw.length) ? [p, t, kw.join(',')] : null;
}
export const isCreatureType = (c) => /Creature/.test(c?.type || '');
export const needsHumanChoice = (eff) => eff.some((e) => e.k === 'tax');
