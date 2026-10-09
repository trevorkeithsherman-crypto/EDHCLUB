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
    if ((m = s.match(/(?:each opponent|target opponent|target player|each player|that player) sacrifices? (a|an|two|\d+) (creature|artifact|enchantment|permanent|land)s?/))) out.push({ k: 'edict', n: num(m[1]), what: m[2], who: /that player/.test(s) && who === 'you' ? 'opponent' : who });
    if (/^untap (all|each) (creature|land|permanent)s? you control/.test(s) || /untap target (creature|land|permanent)/.test(s)) out.push({ k: 'untap', what: (s.match(/untap (?:all |each |target )?(creature|land|permanent)/) || [])[1] || 'permanent' });
    if ((m = s.match(/(?:each player|target player|target opponent|each opponent)? ?(?:mills?|puts? the top (\w+) cards? of (?:their|your|his or her) library into (?:their|your|his or her) graveyard)/)) && /mill|library into/.test(s)) { const n = (s.match(/mills? (\w+)/) || [])[1] || m[2]; if (n) out.push({ k: 'mill', n: num(n), who: /each player/.test(s) ? 'all' : /opponent|target player/.test(s) ? 'opponent' : 'you' }); }
    if (/add (?:\{[wubrgc]\})+|add one mana of any color|add (?:one|two|three) mana/.test(s) && !/\{t\}/.test(s)) out.push({ k: 'mana', n: (s.match(/\{[wubrgc]\}/g) || ['x']).length });
    if ((m = s.match(/scry (\d+)/))) out.push({ k: 'scry', n: +m[1] });
    if (/you may pay \{(\d+|x)\}/.test(s) || /unless (?:that player|they) pays? \{(\d+|x)\}/.test(s) || /(?:that player|they) may pay \{(\d+|x)\}/.test(s)) { const v = (s.match(/pays? \{(\d+|x)\}/) || [])[1]; out.push({ k: 'tax', n: v === 'x' ? 'x' : +(v || 1) }); }
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
      const cond = m[2]; let event = null; let scope = 'self'; let extra = {}; let m2;
      if (/^~ enters|^this (creature|permanent|artifact|enchantment) enters/.test(cond)) event = 'etb';
      else if (/^~ or another creature dies|^~ or another creature you control dies/.test(cond)) { event = 'anyDies'; scope = /you control/.test(cond) ? 'mine' : 'any'; }
      else if (/^~ dies|^this creature dies|^~ is put into a graveyard/.test(cond)) event = 'dies';
      else if (/^(a|another) creature (?:you control )?dies|^(a|another) creature is put into a graveyard/.test(cond)) { event = 'anyDies'; scope = /you control/.test(cond) ? 'mine' : 'any'; }
      else if (/^(a|another) (creature|nontoken creature|permanent) enters(?: the battlefield)? under your control|^(a|another) (creature|nontoken creature|permanent) you control enters|^one or more creatures you control enter/.test(cond)) { event = 'creatureEnters'; scope = 'mine'; }
      else if (/^a land enters(?: the battlefield)? under your control|^a land you control enters/.test(cond)) event = 'landfall';
      else if (/^~ attacks|^this creature attacks/.test(cond)) event = 'attacks';
      else if (/^(a|another|one or more) creatures? you control attacks?/.test(cond)) event = 'anyAttacks';
      else if (/^~ deals combat damage to a player|^this creature deals combat damage to a player/.test(cond)) event = 'combatDamage';
      else if ((m2 = cond.match(/^(?:an opponent|a player|another player) casts (?:a|an|their (first|second|third)) ?(instant|sorcery|creature|noncreature|artifact|enchantment|instant or sorcery)? ?spell/))) { event = 'opponentCasts'; scope = /^a player|^another player/.test(cond) ? 'any' : 'opponents'; extra = { nth: m2[1] ? { first: 1, second: 2, third: 3 }[m2[1]] : 0, spell: m2[2] || 'all' }; }
      else if (/^an opponent draws a card|^a player draws a card|^an opponent draws their (first|second) card/.test(cond)) { event = 'opponentDraws'; scope = /^a player/.test(cond) ? 'any' : 'opponents'; }
      else if (/^you cast a (creature|spell|noncreature|instant or sorcery)/.test(cond)) event = 'youCast';
      else if (/^(your|each) upkeep|^the upkeep of each player/.test(cond) || /beginning of your upkeep/.test(l)) event = 'upkeep';
      else if (/^your end step|^the end step|^each end step/.test(cond) || /beginning of your end step/.test(l)) event = 'endStep';
      else if (/^(a|one or more) creature tokens? enters|^one or more tokens enter/.test(cond)) event = 'tokenEnters';
      else if (/^you gain life/.test(cond)) event = 'gainLife';
      else if (/^you draw a card|^you draw your (first|second) card/.test(cond)) event = 'youDraw';
      if (event) { abilities.push({ kind: 'trigger', event, scope, may: /you may/.test(m[3]), effects: parseEffects(m[3]), text: line, ...extra }); continue; }
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

/* ---------- Board rules: static effects that change what a player may do ----------
   Stax, taxes, pillow fort, hate bears. Parsed from oracle text so unnamed cards with the same wording work too.
   Each rule carries a scope: 'all' (every player), 'opp' (the controller's opponents) or 'self'. */
const TYPE_WORDS = { creature: 'creature', creatures: 'creature', artifact: 'artifact', artifacts: 'artifact', enchantment: 'enchantment', enchantments: 'enchantment', land: 'land', lands: 'land', 'nonbasic land': 'nonbasic', 'nonbasic lands': 'nonbasic', permanent: 'permanent', permanents: 'permanent', noncreature: 'noncreature', nonartifact: 'nonartifact', nonland: 'nonland', instant: 'instant', sorcery: 'sorcery', 'instant and sorcery': 'instant|sorcery', 'artifact and enchantment': 'artifact|enchantment', 'artifact, creature, and enchantment': 'artifact|creature|enchantment' };
const kindOf = (w) => TYPE_WORDS[w.trim()] || null;
export function parseRules(c) {
  const name = String(c.name || ''); const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const text = lc(name ? String(c.oracle || '').replace(new RegExp(esc(name.split(' // ')[0]), 'g'), '~').replace(new RegExp(esc(name.split(',')[0]), 'g'), '~') : c.oracle).replace(/\(.*?\)/g, '');
  const rules = [];
  for (const raw of text.split(/\n/)) {
    const s = raw.trim().replace(/\s+/g, ' '); if (!s || /^(whenever|when|at the beginning)/.test(s) || /^\{[^}]*\}[^:]*:/.test(s)) continue;
    const scope = /your opponents|an opponent controls|opponents can't|each opponent|your opponents'|opponents control/.test(s) ? 'opp' : /\byou\b|your\b/.test(s) && !/each player|players\b/.test(s) ? 'self' : 'all';
    const cond = /as long as ~ is untapped|as long as this permanent is untapped/.test(s) ? 'untapped' : /during your turn|on your turn/.test(s) ? 'myTurn' : null;
    let m;
    // one spell a turn (Rule of Law, Arcane Laboratory, Eidolon of Rhetoric, Archon of Emeria, Deafening Silence, Ethersworn Canonist)
    if ((m = s.match(/(?:each player|players|each opponent|your opponents|you) can't cast more than (one|two) (noncreature |nonartifact |creature |)spells? each turn/))) { rules.push({ k: 'spellLimit', n: num(m[1]), kind: kindOf(m[2]) || 'all', scope, cond }); continue; }
    // cost taxes (Thalia, Sphere, Thorn, Lodestone, Grand Arbiter, Aura of Silence, Vryn Wingmare, Glowrider, Defense Grid, Aether Barrier)
    if ((m = s.match(/^((?:noncreature |nonartifact |creature |artifact |enchantment |instant |sorcery |instant and sorcery |artifact and enchantment |artifact, creature, and enchantment )?)spells?(?: your opponents cast| each opponent casts| you cast| that aren't [a-z]+)? costs? \{(\d+)\} more to cast(?: for each [a-z ]+)?/))) {
      if (/for each/.test(s)) continue; rules.push({ k: 'tax', n: +m[2], kind: kindOf(m[1]) || 'all', scope: /your opponents cast|each opponent casts/.test(s) ? 'opp' : /you cast/.test(s) ? 'self' : 'all', cond }); continue;
    }
    if (/each spell costs \{3\} more to cast unless it's that player's turn|each spell costs \{3\} more to cast unless its controller cast it during their turn/.test(s)) { rules.push({ k: 'tax', n: 3, kind: 'all', scope: 'all', cond: 'notMyTurn' }); continue; }
    if (/each spell with mana value less than 3 costs \{3\} to cast|spells with mana value less than 3 cost \{3\}|each spell that costs less than three mana to cast costs three mana to cast/.test(s) || /^spells cost as if they had mana value 3/.test(s)) { rules.push({ k: 'minCost', n: 3, scope: 'all' }); continue; }
    // enters tapped (Kismet, Frozen Aether, Loxodon Gatekeeper, Authority of the Consuls, Blind Obedience, Urabrask, Imposing Sovereign, Thalia Heretic Cathar, Root Maze, Archon of Emeria for lands, Manglehorn)
    if ((m = s.match(/^((?:(?:nonbasic )?(?:creatures|artifacts|lands|permanents|enchantments)(?:, | and |, and ))*(?:nonbasic )?(?:creatures|artifacts|lands|permanents|enchantments))(?: your opponents control| an opponent controls)? enters? (?:the battlefield )?tapped/))) {
      const kinds = m[1].split(/, and |, | and /).map((w) => kindOf(w)).filter(Boolean); rules.push({ k: 'entersTapped', kinds, scope: /your opponents control|an opponent controls/.test(s) ? 'opp' : 'all', cond }); continue;
    }
    // attack taxes (Propaganda, Ghostly Prison, Windborn Muse, Baird, Koskun Falls, Archangel of Tithes, Sphere of Safety, Norn's Annex)
    if ((m = s.match(/creatures can't attack you(?: or planeswalkers you control)? unless their controller pays (\{[^}]+\}|\{x\})(?: for each creature| for each of those creatures| for each creature they control that's attacking you)/))) {
      const cst = m[1]; const life = /\{w\/p\}|\{[wubrg]\/p\}/.test(cst) ? 2 : 0; const n = cst === '{x}' ? 'x' : +(cst.match(/\d+/) || [1])[0]; rules.push({ k: 'attackTax', n: life ? 1 : n, life, scope: 'opp', cond, xCount: cst === '{x}' ? (s.match(/number of ([a-z]+)s? you control/) || [])[1] : null }); continue;
    }
    if ((m = s.match(/no more than (one|two|three) creatures? can attack (?:you )?each combat/))) { rules.push({ k: 'maxAttackers', n: num(m[1]), scope: /attack you/.test(s) ? 'opp' : 'all', cond }); continue; }
    if (/^creatures can't attack\.?$/.test(s) || /^creatures can't attack(?: or block)?\.?$/.test(s)) { rules.push({ k: 'noAttack', kind: 'all', scope: 'all', cond }); continue; }
    if (/^creatures without flying can't attack/.test(s)) { rules.push({ k: 'noAttack', kind: 'nonflying', scope: 'all', cond }); continue; }
    if (/^creatures can't attack you(?: or planeswalkers you control)?\.?$/.test(s)) { rules.push({ k: 'noAttack', kind: 'you', scope: 'opp', cond }); continue; }
    if (/creatures with power greater than the number of cards in your hand can't attack/.test(s)) { rules.push({ k: 'noAttack', kind: 'bridge', scope: 'all', cond }); continue; }
    if (/^creatures can't block\.?$/.test(s)) { rules.push({ k: 'noBlock', kind: 'all', scope: 'all', cond }); continue; }
    if (/your opponents can't block with creatures with even power/.test(s)) { rules.push({ k: 'noBlock', kind: 'even', scope: 'opp', cond }); continue; }
    if (/your opponents can't cast spells with even mana values/.test(s)) { rules.push({ k: 'noCast', kind: 'even', scope: 'opp', cond }); continue; }
    // activated abilities (Cursed Totem, Linvala, Null Rod, Stony Silence, Collector Ouphe, Karn, Clarion Conqueror)
    if ((m = s.match(/activated abilities of (creatures|artifacts|artifacts and creatures|creatures and artifacts|nonland permanents|planeswalkers)(?: your opponents control| an opponent controls)? can't be activated/))) { const kinds = m[1].split(' and ').map((w) => kindOf(w)).filter(Boolean); rules.push({ k: 'noAbilities', kinds, scope: /your opponents control|an opponent controls/.test(s) ? 'opp' : 'all', cond }); continue; }
    // ETB / dies hate (Torpor Orb, Hushwing Gryff, Hushbringer, Tocatli Honor Guard)
    if (/creatures entering the battlefield(?: or dying)? don't cause abilities to trigger/.test(s)) { rules.push({ k: 'noETB', dies: /or dying/.test(s), scope: 'all' }); continue; }
    if (/^creatures entering the battlefield don't cause abilities to trigger/.test(s)) { rules.push({ k: 'noETB', scope: 'all' }); continue; }
    // searching (Stranglehold, Mindlock Orb, Ashiok, Leonin Arbiter, Aven Mindcensor, Ob Nixilis Unshackled, Opposition Agent)
    if (/players can't search libraries|your opponents can't search libraries|can't search libraries/.test(s)) { rules.push({ k: 'noSearch', scope: /your opponents/.test(s) ? 'opp' : 'all' }); continue; }
    if ((m = s.match(/players can't search libraries\. any player may pay \{(\d+)\}|any player may pay \{(\d+)\} for that player to ignore this effect/))) { rules.push({ k: 'searchTax', n: +(m[1] || m[2]), scope: 'all' }); continue; }
    if (/if an opponent would search a library, that player searches the top four cards of that library instead/.test(s)) { rules.push({ k: 'searchTop', n: 4, scope: 'opp' }); continue; }
    if (/whenever an opponent searches (?:their|his or her) library, that player loses 10 life/.test(s)) { rules.push({ k: 'noSearch', scope: 'opp', penalty: 10 }); continue; }
    // casting from the command zone / outside hand (Drannith Magistrate, Lavinia, Gaddock Teeg, Void Winnower above)
    if (/your opponents can't cast spells from anywhere other than their hands/.test(s)) { rules.push({ k: 'handOnly', scope: 'opp' }); continue; }
    if (/each opponent can't cast noncreature spells with mana value greater than the number of lands that player controls/.test(s)) { rules.push({ k: 'noCast', kind: 'lavinia', scope: 'opp' }); continue; }
    if (/noncreature spells with mana value 4 or greater can't be cast/.test(s)) { rules.push({ k: 'noCast', kind: 'mv4+', scope: 'all' }); continue; }
    // untap restrictions (Winter Orb, Static Orb, Stasis, Hokori, Rising Waters, Mana Vortex-ish)
    if (/players can't untap more than one land during their untap steps/.test(s)) { rules.push({ k: 'untap', lands: 1, scope: 'all', cond }); continue; }
    if (/players can't untap more than two permanents during their untap steps/.test(s)) { rules.push({ k: 'untap', permanents: 2, scope: 'all', cond }); continue; }
    if (/^permanents don't untap during their controllers' untap steps/.test(s)) { rules.push({ k: 'untap', permanents: 0, scope: 'all' }); continue; }
    if (/^lands don't untap during their controllers' untap steps/.test(s)) { rules.push({ k: 'untap', lands: 0, plusUpkeep: /untaps a land/.test(text) ? 1 : 0, scope: 'all' }); continue; }
    // life / draw (Sulfuric Vortex, Erebos, Narset, Spirit of the Labyrinth, Alms Collector)
    if (/players can't gain life|your opponents can't gain life/.test(s)) { rules.push({ k: 'noLifeGain', scope: /your opponents/.test(s) ? 'opp' : 'all' }); continue; }
    if (/(?:each opponent|your opponents|each player|players) can't draw more than one card each turn/.test(s)) { rules.push({ k: 'drawLimit', n: 1, scope: /opponent/.test(s) ? 'opp' : 'all' }); continue; }
    if (/you have no maximum hand size/.test(s)) { rules.push({ k: 'noMaxHand', scope: 'self' }); continue; }
    if (/creature cards in graveyards and libraries can't enter the battlefield/.test(s)) { rules.push({ k: 'noReanimate', scope: 'all' }); continue; }
  }
  return rules;
}
/** Everything the board says seat `me` must obey, from every permanent on the battlefield. */
export function boardRules(cards, me, isCreatureFn, handSizeOf) {
  const out = { spellLimit: null, taxes: [], minCost: 0, entersTapped: new Set(), attackTax: [], maxAttackers: null, noAttack: [], noBlock: [], noCast: [], noAbilities: new Set(), noETB: false, noDies: false, noSearch: false, searchTax: 0, searchTop: 0, handOnly: false, untap: null, noLifeGain: false, drawLimit: null, noMaxHand: false, noReanimate: false, sources: [] };
  for (const c of cards) {
    if (!c || c.zone !== 'battlefield' || !c.oracle) continue;
    for (const r of parseRules(c)) {
      const applies = r.scope === 'all' || (r.scope === 'opp' && c.controller !== me) || (r.scope === 'self' && c.controller === me);
      if (!applies) continue;
      if (r.cond === 'untapped' && c.tapped) continue;
      out.sources.push({ name: c.name, rule: r.k, by: c.controller });
      switch (r.k) {
        case 'spellLimit': if (!out.spellLimit || r.n < out.spellLimit.n) out.spellLimit = { n: r.n, kind: r.kind, src: c.name }; break;
        case 'tax': out.taxes.push({ n: r.n, kind: r.kind, src: c.name, cond: r.cond }); break;
        case 'minCost': out.minCost = Math.max(out.minCost, r.n); break;
        case 'entersTapped': r.kinds.forEach((k) => out.entersTapped.add(k)); break;
        case 'attackTax': out.attackTax.push({ n: r.n === 'x' ? cards.filter((x) => x.controller === c.controller && x.zone === 'battlefield' && new RegExp((r.xCount || 'enchantment').replace(/s$/, ''), 'i').test(x.type)).length : r.n, life: r.life, src: c.name, by: c.controller }); break;
        case 'maxAttackers': if (!out.maxAttackers || r.n < out.maxAttackers.n) out.maxAttackers = { n: r.n, src: c.name, by: r.scope === 'opp' ? c.controller : null }; break;
        case 'noAttack': out.noAttack.push({ kind: r.kind, src: c.name, by: c.controller, hand: handSizeOf ? handSizeOf(c.controller) : 0 }); break;
        case 'noBlock': out.noBlock.push({ kind: r.kind, src: c.name, by: c.controller }); break;
        case 'noCast': out.noCast.push({ kind: r.kind, src: c.name }); break;
        case 'noAbilities': r.kinds.forEach((k) => out.noAbilities.add(k)); break;
        case 'noETB': out.noETB = true; if (r.dies) out.noDies = true; break;
        case 'noSearch': out.noSearch = true; break;
        case 'searchTax': out.searchTax = Math.max(out.searchTax, r.n); break;
        case 'searchTop': out.searchTop = r.n; break;
        case 'handOnly': out.handOnly = true; break;
        case 'untap': out.untap = { lands: Math.min(r.lands ?? Infinity, out.untap?.lands ?? Infinity), permanents: Math.min(r.permanents ?? Infinity, out.untap?.permanents ?? Infinity), plusUpkeep: Math.max(r.plusUpkeep || 0, out.untap?.plusUpkeep || 0), src: c.name }; break;
        case 'noLifeGain': out.noLifeGain = true; break;
        case 'drawLimit': out.drawLimit = r.n; break;
        case 'noMaxHand': out.noMaxHand = true; break;
        case 'noReanimate': out.noReanimate = true; break;
      }
    }
  }
  return out;
}
/** Does a spell of this card's type fall under `kind`? */
export function spellKind(c, kind) {
  const t = c.type || ''; const creature = /Creature/.test(t);
  switch (kind) {
    case 'all': return true; case 'creature': return creature; case 'noncreature': return !creature;
    case 'artifact': return /Artifact/.test(t); case 'nonartifact': return !/Artifact/.test(t); case 'enchantment': return /Enchantment/.test(t);
    case 'instant': return /Instant/.test(t); case 'sorcery': return /Sorcery/.test(t); case 'instant|sorcery': return /Instant|Sorcery/.test(t); case 'artifact|enchantment': return /Artifact|Enchantment/.test(t);
    case 'artifact|creature|enchantment': return /Artifact|Creature|Enchantment/.test(t); case 'land': return /Land/.test(t); case 'nonbasic': return /Land/.test(t) && !/Basic/.test(t);
    case 'permanent': return !/Instant|Sorcery/.test(t); case 'nonland': return !/Land/.test(t); default: return false;
  }
}
export const manaValue = (c) => (String(c.cost || '').match(/\{[^}]+\}/g) || []).reduce((a, t) => { const v = t.slice(1, -1); return a + (/^\d+$/.test(v) ? +v : v === 'X' ? 0 : 1); }, 0);
/** Extra mana a spell costs under the board's taxes. */
export function castTax(rules, c, myTurn = true) {
  let extra = 0;
  for (const t of rules.taxes) { if (t.cond === 'notMyTurn' && myTurn) continue; if (spellKind(c, t.kind)) extra += t.n; }
  const mv = manaValue(c); if (rules.minCost && mv + extra < rules.minCost) extra = rules.minCost - mv;
  return extra;
}
/** Why this seat can't cast the card right now under the board rules, or null. */
export function castBlock(rules, c, ctx) {
  const mv = manaValue(c);
  if (rules.handOnly && c.zone !== 'hand') return 'can only cast from hand';
  if (rules.spellLimit && ctx.castsThisTurn >= rules.spellLimit.n && (rules.spellLimit.kind === 'all' || spellKind(c, rules.spellLimit.kind))) return `${rules.spellLimit.src}: one spell this turn`;
  for (const b of rules.noCast) {
    if (b.kind === 'even' && mv % 2 === 0) return `${b.src}: no even mana values`;
    if (b.kind === 'mv4+' && !/Creature/.test(c.type) && mv >= 4) return `${b.src}: no noncreature spells of 4+`;
    if (b.kind === 'lavinia' && !/Creature/.test(c.type) && mv > (ctx.lands || 0)) return `${b.src}: mana value above land count`;
  }
  return null;
}
