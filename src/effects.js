// Card text interpreter. Reads oracle text into triggers, activated abilities, static effects and spell effects
// the bots can act on. It is deliberately a pattern library, not a rules engine: common Commander text resolves
// itself, anything it can't read is left on the table for the pod. Humans' own cards are never resolved for them;
// only static effects (anthems, keyword grants, equipment/aura bonuses) apply to everyone because they are pure math.
//
// Keyword reference (magic.wizards.com/en/keyword-glossary): evergreen combat keywords live in combat.js; the
// keyword actions (scry, surveil, mill, explore, connive, investigate, proliferate, goad, fight, exile, counter…)
// and the common deciduous keywords (equip, enchant, crew, ward, prowess, landfall, cycling, kicker, flashback,
// cascade, extort, exalted, sagas, loyalty abilities) are read here.

const lc = (s) => String(s || '').toLowerCase();
const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, x: 'x' };
const num = (w) => (w == null ? 1 : NUM[lc(w)] !== undefined ? NUM[lc(w)] : parseInt(w, 10) || 1);
const COLORS = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const cap = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());
const ART_TOKENS = { treasure: ['Token Artifact — Treasure', '{T}, Sacrifice this artifact: Add one mana of any color.'], clue: ['Token Artifact — Clue', '{2}, Sacrifice this artifact: Draw a card.'], food: ['Token Artifact — Food', '{2}, {T}, Sacrifice this artifact: You gain 3 life.'], blood: ['Token Artifact — Blood', '{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card.'], map: ['Token Artifact — Map', '{1}, {T}, Sacrifice this artifact: Target creature you control explores.'], junk: ['Token Artifact — Junk', '{T}, Sacrifice this artifact: Exile the top card of your library. You may play it this turn.'], powerstone: ['Token Artifact — Powerstone', '{T}: Add {C}. This mana can\'t be spent to cast a nonartifact spell.'], gold: ['Token Artifact — Gold', 'Sacrifice this artifact: Add one mana of any color.'], incubator: ['Token Artifact — Incubator', ''], 'walker': ['Token Creature — Zombie', ''] };
// what a pronoun / "this creature" / "target X" phrase points at
const WHO_OPP = /each opponent/; const WHO_ONE = /target opponent|target player|an opponent|that player|defending player/; const WHO_ALL = /each player/;
const whoOf = (s) => (WHO_OPP.test(s) ? 'opponents' : WHO_ONE.test(s) ? 'opponent' : WHO_ALL.test(s) ? 'all' : 'you');
const onOf = (w) => (/each (?:other )?creature you control|creatures you control/.test(w) ? 'mine' : /each creature|all creatures/.test(w) ? 'all' : /target/.test(w) ? 'target' : 'self');
const whatOf = (w) => { const m = lc(w).match(/(nonland permanent|permanent|creature|artifact or enchantment|artifact|enchantment|planeswalker|land|instant or sorcery|creature or planeswalker)/); const x = m ? m[1] : 'permanent'; return x === 'artifact or enchantment' ? 'artifact|enchantment' : x === 'creature or planeswalker' ? 'creature' : x === 'instant or sorcery' ? 'Instant|Sorcery' : x; };

/* ---------- Effect parsing: one clause → list of primitives ---------- */
export function parseEffects(text) {
  let src = String(text || '');
  if (/choose (?:one|two|one or both|one or more|any number)/i.test(src) && /•/.test(src)) { const modes = src.split('•').slice(1).map((x) => x.trim()); const parsed = modes.map((x) => parseEffects(x)); let k = parsed.findIndex((e) => e.length && !e.every((y) => y.k === 'counterspell')); if (k < 0) k = parsed.findIndex((e) => e.length); src = k >= 0 ? modes[k] : ''; if (!src) return []; }
  const out = []; const t = lc(src).replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
  let mm;
  if ((mm = t.match(/you may pay ((?:\{[^}]+\})+|\d+ life)\. if you do, /))) out.push({ k: 'optPay', n: /life/.test(mm[1]) ? 0 : manaIn(mm[1]), life: /life/.test(mm[1]) ? parseInt(mm[1], 10) : 0 });
  if ((mm = t.match(/exile the top (card|two cards|three cards) of your library\.?[^.]*\.? (?:until end of turn, |until your next turn, )?you may (?:play|cast) (?:it|them|that card|those cards)/))) out.push({ k: 'impulse', n: num(mm[1].split(' ')[0]) });
  for (const raw of t.split(/\.\s+|\. ?$|;\s*|\n/)) {
    const s = raw.trim(); if (!s) continue; let m;
    const who = whoOf(s);
    // --- card flow ---
    if ((m = s.match(/(you |each player |each opponent |target player |target opponent |that player |its controller |an opponent |you may )?draws? (a|two|three|four|five|x|\d+) cards?/))) { const pre = (m[1] || '').trim(); out.push({ k: 'draw', n: num(m[2]), who: pre === 'each player' ? 'all' : pre === 'each opponent' ? 'opponents' : /target player|target opponent|that player|its controller|an opponent/.test(pre) ? 'opponent' : 'you' }); }
    if ((m = s.match(/(?:you )?draw cards equal to/))) out.push({ k: 'draw', n: 'x', who: 'you' });
    if (/then discards? (a|two|that many) cards?|, then discard/.test(s) || (m = s.match(/^discard (a|two) cards?/))) out.push({ k: 'discard', n: num((s.match(/discards? (a|two)/) || [])[1] || 'a'), who: 'you' });
    if ((m = s.match(/(each opponent|target opponent|target player|that player|the player) discards? (a|two|three|\d+|that) cards?/))) out.push({ k: 'discard', n: m[2] === 'that' ? 1 : num(m[2]), who: who === 'you' ? 'opponent' : who });
    if ((m = s.match(/(?:each opponent|target opponent|target player|each player|that player) sacrifices? (a|an|two|\d+) (creature|artifact|enchantment|permanent|land)s?/))) out.push({ k: 'edict', n: num(m[1]), what: m[2], who: /that player/.test(s) && who === 'you' ? 'opponent' : who });
    if ((m = s.match(/(?:each player|target player|target opponent|each opponent)? ?(?:mills? (a|an|two|three|four|five|six|seven|eight|ten|\d+|x) cards?|puts? the top (\w+) cards? of (?:their|your|his or her) library into (?:their|your|his or her) graveyard)/)) && /mill|library into/.test(s)) { const n = m[1] || m[2]; out.push({ k: 'mill', n: num(n), who: /each player/.test(s) ? 'all' : /opponent|target player/.test(s) ? 'opponent' : 'you' }); }
    if ((m = s.match(/scry (\d+)/))) out.push({ k: 'scry', n: +m[1] });
    if ((m = s.match(/surveil (\d+)/))) out.push({ k: 'surveil', n: +m[1] });
    if (/\bexplores?\b/.test(s) && !/explorer/.test(s)) out.push({ k: 'explore', n: (s.match(/explores (twice)/) ? 2 : 1), on: /target creature/.test(s) ? 'target' : 'self' });
    if (/\bconnives?\b/.test(s)) out.push({ k: 'connive', on: 'self' });
    if (/\binvestigate\b/.test(s)) out.push({ k: 'token', n: num((s.match(/investigate (twice)/) ? 'two' : 'a')), pt: '', name: 'Clue', colors: '', type: ART_TOKENS.clue[0], oracle: ART_TOKENS.clue[1] });
    if (/\bproliferate\b/.test(s)) out.push({ k: 'proliferate' });
    if ((m = s.match(/look at the top (\w+) cards? of your library\.?[^.]*?(?:put (?:one of them|a (?:[a-z ]+?) card from among them|up to (\w+) of them|one|any number of them) (?:into your hand|onto the battlefield)|reveal)/)) || (m = s.match(/look at the top (\w+) cards? of your library/))) {
      const kind = (t.match(/put (?:a|an|up to \w+) ([a-z ]+?) cards? (?:with [a-z ]+ )?from among them/) || [])[1] || (t.match(/reveal (?:a|an|up to \w+) ([a-z ]+?) cards? from among them/) || [])[1] || null;
      out.push({ k: 'dig', n: num(m[1]), take: /onto the battlefield/.test(t) ? 'battlefield' : 'hand', what: kind, bottom: /bottom/.test(t), all: /put any number|put all/.test(t) });
    }
    if ((m = s.match(/return (target|up to \w+ target|all) (creature|permanent|nonland permanent|artifact|enchantment|planeswalker)s?(?: cards?)? (?:an opponent controls |you don't control |your opponents control )?(?:to (?:its|their) owners?'?s? hands?)/))) out.push({ k: 'bounce', what: m[2], all: m[1] === 'all', theirs: /opponent|don't control/.test(s) });
    if ((m = s.match(/return (?:target|up to \w+ target|a|all) creature cards? from your graveyard to the battlefield|put (?:target|a|up to \w+ target) (?:creature|creature or planeswalker|artifact|permanent) cards? from (?:your|a) graveyard onto the battlefield|return target creature card from a graveyard to the battlefield/))) out.push({ k: 'reanimate', any: /from a graveyard/.test(s), all: /all creature cards/.test(s) });
    if ((m = s.match(/return (?:target|up to \w+ target|a) (creature|permanent|artifact|enchantment|instant or sorcery|land|instant|sorcery)(?: or [a-z]+)?(?: cards?)? from your graveyard to your hand/))) out.push({ k: 'regrow', what: m[1] === 'instant or sorcery' ? 'Instant|Sorcery' : m[1] });
    if ((m = s.match(/search your library for (?:a |an |up to (\w+) )?(basic land|plains|island|swamp|mountain|forest|land|creature|artifact|enchantment|instant|sorcery|equipment|aura|planeswalker|legendary)(?:[a-z ]*?) cards?[^.]*?(?:put (?:it|them|that card|those cards|one|one of them) onto the battlefield( tapped)?|put (?:it|them|that card|those cards|that card into|them into) (?:into )?your hand|reveal (?:it|them|that card|those cards)?[^.]*put (?:it|them|that card|those cards) into your hand)/))) {
      out.push({ k: 'tutor', what: m[2], n: m[1] ? num(m[1]) : 1, to: /onto the battlefield/.test(s) ? 'battlefield' : 'hand', tapped: !!m[3] || /onto the battlefield tapped/.test(s), extra: /and the other into your hand|put one onto the battlefield[^.]*the rest into your hand/.test(s) });
    }
    // --- life, damage ---
    if ((m = s.match(/(?:you )?gain (\d+|x) life/))) out.push({ k: 'life', n: num(m[1]), who: 'you' });
    if (/gain life equal to (?:its|that creature's|its power|the damage dealt)/.test(s)) out.push({ k: 'life', n: 'x', who: 'you' });
    if ((m = s.match(/(each opponent|target opponent|target player|each player|that player) loses (\d+|x) life/))) out.push({ k: 'life', n: -num(m[2]), who });
    if ((m = s.match(/\byou lose (\d+|x) life/))) out.push({ k: 'life', n: -num(m[1]), who: 'you' });
    if ((m = s.match(/deals? (\d+|x) damage to (each opponent and each creature(?: and planeswalker)? they control|any target|each opponent|target creature or player|target creature or planeswalker|target player or planeswalker|target opponent or planeswalker|target opponent|target creature|each creature|each creature and each player|each other creature|each player|that player|its controller|that creature|each creature you don't control|each creature your opponents control|each non-[a-z]+ creature)/))) {
      const tg = m[2]; out.push({ k: 'damage', n: num(m[1]), to: /each creature and each player|each opponent and each creature/.test(tg) ? 'everything' : /each creature|each other creature|each non-/.test(tg) ? (/don't control|opponents control|each opponent and/.test(tg) ? 'theirCreatures' : 'creatures') : /each opponent/.test(tg) ? 'opponents' : /each player/.test(tg) ? 'all' : /any target/.test(tg) ? 'any' : /creature/.test(tg) ? 'creature' : 'opponent' });
    }
    if ((m = s.match(/deals damage equal to (?:its|this creature's|~'s|that creature's) power to (any target|target creature|each opponent|target player|target opponent|target creature or planeswalker)/))) out.push({ k: 'damage', n: 'power', to: /any target/.test(m[1]) ? 'any' : /creature/.test(m[1]) ? 'creature' : /each opponent/.test(m[1]) ? 'opponents' : 'opponent' });
    if (/\bfights? (target|another target|up to one target) creature/.test(s)) out.push({ k: 'fight', on: 'self' });
    // --- tokens ---
    if ((m = s.match(/(?:create|put) (a|an|two|three|four|five|six|x|\d+|that many|a number of) (\d+)\/(\d+) ((?:white|blue|black|red|green|colorless|and|,| )*?)([a-z][a-z' -]*?) (?:artifact |enchantment )?creature tokens?(?: with ([a-z ,]+?))?(?: onto the battlefield)?(?: tapped)?/))) {
      const name = m[5].replace(/^(?:(?:white|blue|black|red|green|colorless)[, ]*(?:and )?)+/, '').trim(); const cols = (m[4] + ' ' + m[5]).toLowerCase();
      out.push({ k: 'token', n: /that many|a number of/.test(m[1]) ? 'count' : num(m[1]), pt: `${m[2]}/${m[3]}`, name: cap(name), colors: Object.entries(COLORS).filter(([w]) => cols.includes(w)).map(([, c]) => c).join(''), kw: (m[6] || '').replace(/ and /g, ',').trim(), tapped: / tokens? (?:that are |that's )?tapped|onto the battlefield tapped/.test(s) });
    } else if ((m = s.match(/create (a|an|two|three|four|five|x|\d+) (treasure|clue|food|blood|map|junk|powerstone|gold|incubator) tokens?/))) out.push({ k: 'token', n: num(m[1]), pt: '', name: cap(m[2]), colors: '', type: ART_TOKENS[m[2]][0], oracle: ART_TOKENS[m[2]][1] });
    else if ((m = s.match(/create (a|an|two|three|x|\d+) tokens? that(?:'s| are) (?:a )?cop(?:y|ies) of (?:target|this|~|that) (creature|permanent|artifact)/))) out.push({ k: 'copy', n: num(m[1]), what: m[2] });
    else if ((m = s.match(/create (a|an|two|three) ([a-z]+ ){0,3}tokens? (?:named|that's|that is)/))) out.push({ k: 'token', n: num(m[1]), pt: '1/1', name: cap((m[2] || 'token').trim()), colors: '', kw: '' });
    // --- removal ---
    if ((m = s.match(/(destroy|exile) (target|each|all|up to \w+ (?:other )?target|another target|each other|all other) (?:(?:non)?(?:legendary|black|white|blue|red|green|artifact|enchantment|token|basic|tapped|untapped|attacking|blocking|flying|attacking or blocking|enchanted|equipped|other|creature) )?(creature|artifact|enchantment|nonland permanent|permanent|artifact or enchantment|creature or planeswalker|planeswalker|land|nonbasic land|creature or enchantment|artifact, creature, or enchantment|noncreature permanent|nonland permanent)s?(?: an opponent controls| you don't control| your opponents control| that player controls)?/))) {
      const what = m[3].replace(/s$/, ''); const n = /up to (\w+)/.test(m[2]) ? num(m[2].split(' ')[2]) : 1;
      if (/that player controls/.test(m[0])) { out.push({ k: 'edict', n: 1, what, who: 'opponent', actorOnly: true }); continue; }
      out.push({ k: m[1] === 'exile' ? 'exile' : 'destroy', what: /artifact or enchantment|artifact, creature, or enchantment|creature or enchantment|noncreature permanent/.test(what) ? 'artifact|enchantment' : /creature or planeswalker/.test(what) ? 'creature' : /nonbasic land/.test(what) ? 'nonbasic' : what, all: /^(each|all|each other|all other)$/.test(m[2]), other: /other/.test(m[2]), n, theirs: /opponent controls|don't control|opponents control/.test(s), except: (m[0].match(/ non(legendary|black|white|blue|red|green|artifact|enchantment|token|creature) /) || [])[1] || null });
    }
    if ((m = s.match(/(target creature|target creature an opponent controls|target creature you don't control|it|that creature|each creature your opponents control|creatures your opponents control|all creatures) gets? (-\d+)\/(-\d+)(?: until end of turn)?/))) out.push({ k: 'shrink', p: +m[2], t: +m[3], on: /^it|^that creature/.test(m[1]) ? 'that' : /opponents control/.test(m[1]) ? 'theirs' : /all creatures/.test(m[1]) ? 'all' : 'target' });
    if ((m = s.match(/exile (?:target player's|each opponent's|all cards from target player's|all cards from each opponent's) graveyard/))) out.push({ k: 'gyExile', who: /each opponent/.test(m[0]) ? 'opponents' : 'opponent' });
    if (/return all (?:creature |permanent )?cards from your graveyard to your hand/.test(s)) out.push({ k: 'regrow', what: /creature/.test(s) ? 'creature' : 'permanent', all: true });
    if ((m = s.match(/counter target (spell|creature spell|noncreature spell|instant or sorcery spell|activated or triggered ability)/))) out.push({ k: 'counterspell', what: m[1] });
    if ((m = s.match(/gain control of (target|up to one target) (creature|permanent|artifact|nonland permanent)(?: or vehicle)?( until end of turn)?/))) out.push({ k: 'steal', what: m[2], temp: !!m[3] || /until end of turn/.test(s), untap: /untap/.test(s), haste: /haste/.test(s) });
    if (/exile (target|up to one target|another target) (creature|permanent|nonland permanent)[^.]*?(?:then )?return (?:it|that card|the exiled card)[^.]*?(?:to|onto) the battlefield/.test(s) && !/your control/.test(s.split('return')[1] || '')) out.push({ k: 'flicker' });
    // --- counters and pumps ---
    if ((m = s.match(/put (a|an|two|three|four|five|x|\d+|that many) \+1\/\+1 counters? on (?:it|him|her|this creature|this permanent|this [a-z]+|~|target creature you control|target creature|another target creature you control|another target creature|each creature you control|each other creature you control|each creature|up to \w+ target creatures?|creatures you control|each creature token you control|each (?:[a-z]+) creature you control|each (?:[a-z]+) you control)/))) { const w = m[0]; const ft = (w.match(/each ([a-z]+) (?:creature )?you control/) || [])[1]; out.push({ k: 'counter', n: m[1] === 'that many' ? 'count' : num(m[1]), filter: ft && ft !== 'creature' && ft !== 'other' ? ft : null, on: /each creature you control|each other creature you control|creatures you control|each creature token|each [a-z]+ (?:creature )?you control/.test(w) ? 'mine' : /each creature(?! you)/.test(w) ? 'all' : /target/.test(w) ? 'target' : 'self', other: /each other/.test(w) }); }
    if ((m = s.match(/put (a|an|two|three|x|\d+) -1\/-1 counters? on (target creature|each creature|each creature your opponents control|each other creature|target creature an opponent controls)/))) out.push({ k: 'counter', n: -num(m[1]), on: /each creature your opponents/.test(m[2]) ? 'theirs' : /each/.test(m[2]) ? 'all' : 'target' });
    if ((m = s.match(/put (a|an|two) (charge|loyalty|lore|oil|shield|flying|first strike|deathtouch|lifelink|trample|vigilance|menace|hexproof|indestructible|reach|double strike) counters? on (it|this [a-z]+|~|target creature|target artifact|target permanent|another target creature)/))) out.push({ k: /charge|oil|lore/.test(m[2]) ? 'ctr' : 'kwcounter', n: num(m[1]), kw: m[2], on: /target/.test(m[3]) ? 'target' : 'self' });
    if ((m = s.match(/(target creature|target creature you control|another target creature|another target creature you control|creatures you control|each creature you control|it|this creature|that creature|~|they|those creatures) (?:each )?gets? \+(\d+|x)\/\+(\d+|x)(?: and (?:gains?|has) ([a-z ]+?))?(?: until end of turn|(?= and)|$)/)) && (/until end of turn/.test(s) || /^until end of turn/.test(s))) out.push({ k: 'pump', p: num(m[2]), t: num(m[3]), on: /creatures you control|each creature you control|they|those/.test(m[1]) ? 'mine' : /target/.test(m[1]) ? 'target' : 'self', kw: (m[4] || '').replace(/ and /g, ',') });
    if ((m = s.match(/(target creature|creatures you control|it|this creature|~) gains? ([a-z ]+?(?:, [a-z ]+)*(?:,? and [a-z ]+)?) until end of turn/)) && !/\+\d/.test(s)) out.push({ k: 'pump', p: 0, t: 0, on: /creatures you control/.test(m[1]) ? 'mine' : /target/.test(m[1]) ? 'target' : 'self', kw: m[2].replace(/,? and /g, ',').replace(/, /g, ',') });
    if ((m = s.match(/(target creature|creatures you control|each creature you control|~|it|this creature) (?:can't be blocked|gains? menace|gains? flying)[^.]*this turn/))) out.push({ k: 'pump', p: 0, t: 0, on: /creatures you control|each creature/.test(m[1]) ? 'mine' : /target/.test(m[1]) ? 'target' : 'self', kw: /can't be blocked/.test(s) ? 'unblockable' : /menace/.test(s) ? 'menace' : 'flying' });
    if ((m = s.match(/double (?:the number of )?(?:\+1\/\+1 )?counters on (?:it|this creature|target creature|each creature you control)/))) out.push({ k: 'doubleCounters', on: /each/.test(m[0]) ? 'mine' : /target/.test(m[0]) ? 'target' : 'self' });
    // --- untap / tap ---
    if (/^untap (all|each) (creature|land|permanent|artifact)s? you control|^untap (up to \w+ |target |another target |all )?(creature|land|permanent|artifact)s?|untap (it|this creature|~|that creature)/.test(s)) out.push({ k: 'untap', what: (s.match(/untap (?:all |each |up to \w+ |target |another target )?(creature|land|permanent|artifact)/) || [])[1] || 'self', n: num((s.match(/up to (\w+)/) || [])[1] || 'x'), self: /untap (it|this creature|~|that creature)/.test(s) });
    if ((m = s.match(/tap (target|up to \w+ target|all|each) (creature|artifact|permanent|land)s?(?: (?:an opponent controls|your opponents control|you don't control))?/))) out.push({ k: 'tap', what: m[2], all: /all|each/.test(m[1]), n: num((m[1].match(/up to (\w+)/) || [])[1] || 'a') });
    // --- mana / misc ---
    if (/add (?:\{[wubrgc]\})+|add one mana of any color|add (?:one|two|three) mana|add \{[wubrgc]\}(?:, \{[wubrgc]\})* or \{[wubrgc]\}/.test(s) && !/\{t\}/.test(s)) out.push({ k: 'mana', n: (s.match(/\{[wubrgc]\}/g) || ['x']).length });
    if (/you get \{e\}/.test(s)) out.push({ k: 'energy', n: (s.match(/\{e\}/g) || []).length });
    if (/goad (target|each|up to \w+ target) creature/.test(s)) out.push({ k: 'goad' });
    if (/you may pay \{(\d+|x)\}/.test(s) || /unless (?:that player|they|its controller) pays? \{(\d+|x)\}/.test(s) || /(?:that player|they) may pay \{(\d+|x)\}/.test(s)) { const v = (s.match(/pays? \{(\d+|x)\}/) || [])[1]; out.push({ k: 'tax', n: v === 'x' ? 'x' : +(v || 1) }); }
    if (/^sacrifice (it|this creature|this permanent|~|this artifact|this enchantment)(?: at the beginning of the next end step)?/.test(s) || /sacrifice (it|this creature|~) at the beginning/.test(s)) out.push({ k: 'sacSelf', later: /end step/.test(s) });
    if (/^(?:you may )?(?:put|return) (?:it|this creature|~|this permanent) (?:on|to) (?:the bottom of |the top of )?(?:its owner's library|your library|your hand|its owner's hand)/.test(s)) out.push({ k: 'returnSelf', to: /hand/.test(s) ? 'hand' : 'library' });
    if ((m = s.match(/you may put (?:a|an) (creature|artifact|enchantment|permanent|land|aura|equipment) card (?:with mana value \w+ or less )?from your hand onto the battlefield/))) out.push({ k: 'cheat', what: m[1] });
    if (/cast (?:it|that card|the exiled card|this card) without paying its mana cost|you may cast (?:a |an )?(?:[a-z ]+ )?spell from among (?:them|the exiled cards) without paying/.test(s) || /^cascade/.test(s)) out.push({ k: 'freecast' });
    if ((m = s.match(/(each opponent|target opponent|target player) (?:exiles?|reveals?) (?:the top|cards from the top)/))) out.push({ k: 'peekOpp', who });
  }
  return out;
}

/* ---------- Ability parsing: the card's whole text → triggers / activated / static ---------- */
const EVERGREEN = ['flying', 'reach', 'first strike', 'double strike', 'deathtouch', 'trample', 'lifelink', 'indestructible', 'menace', 'vigilance', 'haste', 'defender', 'hexproof', 'flash', 'shroud', 'fear', 'intimidate', 'horsemanship', 'unblockable'];
const ABILITY_WORD = /^(?:[a-z][a-z' -]*?) — (?=\S)/i;
const lineKind = (l) => (/^whenever|^when |^at the beginning/.test(l) ? 'trigger' : /^[^:]{1,80}: /.test(l) ? 'activated' : 'static');
export function parseAbilities(c) {
  const name = String(c.name || ''); const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let text = String(c.oracle || '');
  if (name) { const n0 = name.split(' // ')[0]; text = text.replace(new RegExp(esc(n0), 'g'), '~'); const n1 = name.split(',')[0]; if (n1.length > 3) text = text.replace(new RegExp(esc(n1), 'g'), '~'); }
  const abilities = []; const isSaga = /Saga/.test(c.type || ''); let level = 1;
  for (const raw0 of text.split(/\n/)) {
    let line = raw0.trim(); if (!line) continue;
    // sagas: "I — ...", "II, III — ..."
    let chapter = null; const sm = line.match(/^((?:I|II|III|IV|V)(?:, (?:I|II|III|IV|V))*) — (.+)$/); if (sm && isSaga) { chapter = sm[1].split(', ').map((r) => ({ I: 1, II: 2, III: 3, IV: 4, V: 5 }[r])); line = sm[2]; }
    // loyalty: "+1: ...", "−3: ..."
    const lm = line.match(/^\[?([+−-]\d+|0)\]?: (.+)$/); if (lm) { abilities.push({ kind: 'loyalty', cost: +lm[1].replace('−', '-'), effects: parseEffects(lm[2]), text: line }); continue; }
    // Class levels: "{2}{U}: Level 2" — abilities printed after it only work at that level
    const lvm = line.match(/^((?:\{[^}]+\})+): Level (\d)$/i); if (lvm) { level = +lvm[2]; abilities.push({ kind: 'levelup', n: level, mana: manaIn(lvm[1]), text: line }); continue; }
    line = line.replace(ABILITY_WORD, '').replace(/\s*\(.*?\)\s*/g, ' ').trim(); const l = lc(line); let m;
    if (chapter) { abilities.push({ kind: 'chapter', chapters: chapter, effects: parseEffects(line), text: raw0.trim() }); continue; }
    // keyword lines ("Flying, vigilance", "Equip {2}", "Ward {1}", "Prowess", "Landfall — …" handled above)
    if ((m = l.match(/^equip(?: [a-z]+)? (\{[^}]+\}(?:\{[^}]+\})*|\d+)/))) { abilities.push({ kind: 'equip', mana: manaIn(m[1]), text: line }); continue; }
    if ((m = l.match(/^enchant (creature|permanent|land|artifact|player|opponent|creature you control|creature an opponent controls|planeswalker)/))) { abilities.push({ kind: 'enchant', what: m[1], text: line }); continue; }
    if ((m = l.match(/^crew (\d+)/))) { abilities.push({ kind: 'crew', n: +m[1], text: line }); continue; }
    if ((m = l.match(/^ward[ —]*(\{[^}]+\}(?:\{[^}]+\})*|\d+|pay \d+ life|discard a card)/))) { abilities.push({ kind: 'ward', mana: /life|discard/.test(m[1]) ? 2 : manaIn(m[1]), text: line }); continue; }
    if (/^prowess\b/.test(l)) { abilities.push({ kind: 'trigger', event: 'youCast', scope: 'self', spell: 'noncreature', may: false, effects: [{ k: 'pump', p: 1, t: 1, on: 'self', kw: '' }], text: line }); continue; }
    if (/^exalted\b/.test(l)) { abilities.push({ kind: 'trigger', event: 'anyAttacks', scope: 'mine', alone: true, effects: [{ k: 'pump', p: 1, t: 1, on: 'attacker', kw: '' }], text: line }); continue; }
    if (/^extort\b/.test(l)) { abilities.push({ kind: 'trigger', event: 'youCast', scope: 'self', spell: 'all', extort: true, effects: [{ k: 'life', n: -1, who: 'opponents' }, { k: 'life', n: 1, who: 'you' }], text: line }); continue; }
    if ((m = l.match(/^cascade/))) { abilities.push({ kind: 'cascade', text: line }); continue; }
    if ((m = l.match(/^(cycling|basic landcycling|[a-z]+cycling) (\{[^}]+\}(?:\{[^}]+\})*|\d+)/))) { abilities.push({ kind: 'cycling', mana: manaIn(m[2]), land: /landcycling/.test(m[1]), text: line }); continue; }
    if ((m = l.match(/^kicker (\{[^}]+\}(?:\{[^}]+\})*)/))) { abilities.push({ kind: 'kicker', mana: manaIn(m[1]), text: line }); continue; }
    if ((m = l.match(/^flashback (\{[^}]+\}(?:\{[^}]+\})*)/))) { abilities.push({ kind: 'flashback', mana: manaIn(m[1]), text: line }); continue; }
    if (/^(?:[a-z ]+)(?:, [a-z ]+)*$/.test(l) && l.split(/, /).every((k) => EVERGREEN.includes(k.trim()) || /^(protection from|landwalk|[a-z]+walk|changeling|partner|lifelink|wither|infect|undying|persist|afflict \d|afterlife \d|annihilator \d|bushido \d|rampage \d|flanking|phasing|shadow|skulk|training|mentor|riot|boast|daybound|nightbound|decayed|toxic \d|backup \d|blitz|dash|evoke|ninjutsu|outlast|unleash|unearth|embalm|eternalize|escape|disturb|exploit|fabricate \d|myriad|melee|offspring|impending|gift|bargain|squad|encore|foretell|demonstrate|miracle|rebound|overload|split second|storm|convoke|delve|improvise|affinity|emerge|madness|morph|megamorph|manifest|disguise|cleave|casualty \d|compleated|crew \d|saddle \d|station|warp|mobilize|job select|devoid|prototype|amass|monstrosity|adapt|graft|modular|level up|suspend|vanishing|fading|cumulative upkeep|echo|buyback|entwine|splice|replicate|conspire|retrace|jump-start|surge|ravenous|renown|tribute|scavenge|bloodthirst|devour|evolve|battle cry|soulbond|totem armor|living weapon|reconfigure|for mirrodin!|living metal|equip)/.test(k.trim()))) { continue; } // bare keyword lists: combat.js reads kw directly
    if (lineKind(l) === 'activated' && (m = line.match(/^((?:\{[^}]+\}|[^:{]+?)(?:, (?:\{[^}]+\}|[^:{]+?))*): (.+)$/)) && /\{t\}|\{q\}|\{\d+\}|\{x\}|\{[wubrgc](?:\/[wubrgcp])?\}|sacrifice|pay \d+ life|discard a card|tap an untapped|remove|exile ~|exile this/.test(lc(m[1]))) {
      const cost = lc(m[1]); abilities.push({ kind: 'activated', cost, tap: /\{t\}/.test(cost), mana: manaIn(cost), sacSelf: /sacrifice ~|sacrifice this|exile ~|exile this/.test(cost), sacOther: /sacrifice (a|an|another|two|x) (creature|artifact|permanent|land|[a-z]+)/.test(cost), discard: /discard a card/.test(cost), life: +((cost.match(/pay (\d+) life/) || [])[1] || 0), sorcery: /only as a sorcery|during your turn/.test(l), effects: parseEffects(m[2]), text: line });
      continue;
    }
    if ((m = l.match(/^(whenever|when|at the beginning of) (.+?), (.+)$/))) {
      const cond = m[2]; let event = null; let scope = 'self'; let extra = {}; let m2;
      const SELF = '(?:~|this creature|this permanent|this artifact|this enchantment|this land|this planeswalker|this vehicle|this spacecraft|this aura|this equipment|this token|this card|this class|this saga|this [a-z]+|it)';
      if (new RegExp(`^${SELF} enters|^${SELF} or another [a-z ]+ enters`).test(cond)) { event = 'etb'; if (/or another/.test(cond)) extra = { alsoOthers: true }; }
      else if (new RegExp(`^${SELF} (?:or another creature )?dies|^${SELF} is put into a graveyard|^${SELF} leaves the battlefield`).test(cond)) { if (/or another creature/.test(cond)) { event = 'anyDies'; scope = 'any'; } else event = 'dies'; }
      else if (/^(a|another|one or more) (?:other )?(?:nontoken )?(?:creature|creatures|permanent|artifact|enchantment|land|planeswalker|[a-z]+) (?:you control )?dies|^(a|another) creature is put into a graveyard|^a creature an opponent controls dies|^a creature you don't control dies/.test(cond)) { event = 'anyDies'; scope = /you control/.test(cond) ? 'mine' : /opponent controls|don't control/.test(cond) ? 'theirs' : 'any'; extra = { ofType: (cond.match(/(creature|artifact|enchantment|land|permanent|[a-z]+) (?:you control )?(?:dies|is put)/) || [])[1] || 'creature' }; }
      else if (/^a land (?:you control )?enters|^a land enters(?: the battlefield)? under your control|^one or more lands/.test(cond)) event = 'landfall';
      else if (/^(a|another|one or more) (?:other )?(?:nontoken |non-token )?(creature|creatures|permanent|artifact|enchantment|[a-z]+)(?: tokens?)? (?:enters?|you control enters?)(?: the battlefield)?(?: under your control)?/.test(cond) || /^another (?:creature|[a-z]+) you control enters/.test(cond)) { event = 'creatureEnters'; scope = /under your control|you control/.test(cond) ? 'mine' : /under an opponent's control|an opponent controls/.test(cond) ? 'theirs' : 'any'; extra = { ofType: (cond.match(/^(?:a|another|one or more) (?:other )?(?:nontoken |non-token )?([a-z]+)/) || [])[1] || 'creature', token: /tokens?/.test(cond) }; }
      else if (new RegExp(`^${SELF} attacks|^${SELF} attacks or blocks|^${SELF} becomes blocked`).test(cond)) event = /blocks/.test(cond) && !/attacks/.test(cond) ? 'blocks' : 'attacks';
      else if (/^you attack|^one or more creatures you control attack/.test(cond)) { event = 'attackersDeclared'; }
      else if (/^(a|another) (?:other )?creatures? you control attacks?/.test(cond)) { event = 'anyAttacks'; extra = { alone: /alone/.test(cond) }; }
      else if (/^(a|another|one or more) creatures? attacks?(?: you| one of your)/.test(cond)) { event = 'attacked'; scope = 'theirs'; }
      else if (new RegExp(`^${SELF} deals combat damage to a player|^${SELF} deals combat damage|^${SELF} deals damage to (?:a player|an opponent)`).test(cond)) event = 'combatDamage';
      else if (/^(a|another|one or more) creatures? you control deals? (?:combat )?damage to (?:a player|an opponent)/.test(cond)) { event = 'anyCombatDamage'; scope = 'mine'; }
      else if ((m2 = cond.match(/^(?:an opponent|a player|another player|you) casts? (?:a|an|your|their) (first|second|third)? ?(instant|sorcery|creature|noncreature|artifact|enchantment|instant or sorcery|legendary|historic|spell)? ?(?:spell)?/))) { const you = /^you cast/.test(cond); event = you ? 'youCast' : 'opponentCasts'; scope = /^a player|^another player/.test(cond) ? 'any' : you ? 'self' : 'opponents'; extra = { nth: m2[1] ? { first: 1, second: 2, third: 3 }[m2[1]] : 0, spell: m2[2] && m2[2] !== 'spell' ? m2[2] : 'all' }; }
      else if (/^an opponent draws a card|^a player draws a card|^an opponent draws their (first|second) card/.test(cond)) { event = 'opponentDraws'; scope = /^a player/.test(cond) ? 'any' : 'opponents'; }
      else if (/^you draw a card|^you draw your (first|second) card/.test(cond)) { event = 'youDraw'; extra = { nth: /second/.test(cond) ? 2 : /first/.test(cond) ? 1 : 0 }; }
      else if (/^(your|each) upkeep|^the upkeep of each player|^each player's upkeep/.test(cond) || /beginning of your upkeep/.test(l)) { event = 'upkeep'; scope = /each/.test(cond) ? 'any' : 'self'; }
      else if (/^each opponent's upkeep|^an opponent's upkeep/.test(cond)) { event = 'upkeep'; scope = 'opponents'; }
      else if (/^your end step|^the end step|^each end step|^each player's end step/.test(cond) || /beginning of your end step/.test(l)) { event = 'endStep'; scope = /each/.test(cond) ? 'any' : 'self'; }
      else if (/^each opponent's end step|^an opponent's end step/.test(cond)) { event = 'endStep'; scope = 'opponents'; }
      else if (/^combat on your turn|^your combat|^combat on each of your turns/.test(cond)) event = 'combatBegin';
      else if (/^your precombat main phase|^your first main phase|^your main phase/.test(cond)) event = 'mainBegin';
      else if (/^your draw step|^your postcombat main/.test(cond)) event = 'upkeep';
      else if (/^(a|one or more) creature tokens? enters|^one or more tokens enter|^one or more (?:creature )?tokens you control enter/.test(cond)) event = 'tokenEnters';
      else if (/^you gain life/.test(cond)) event = 'gainLife';
      else if (/^you sacrifice a|^you sacrifice (?:a|an|another) (?:creature|permanent|artifact|land)/.test(cond) || /^a player sacrifices/.test(cond)) { event = 'youSacrifice'; extra = { ofType: (cond.match(/sacrifices? (?:a|an|another) ([a-z]+)/) || [])[1] || 'permanent' }; }
      else if (new RegExp(`^${SELF} becomes tapped`).test(cond)) event = 'becomesTapped';
      else if (new RegExp(`^${SELF} becomes untapped`).test(cond)) event = 'becomesUntapped';
      else if (/^you cast your (second|first) spell each turn/.test(cond)) { event = 'youCast'; extra = { nth: /second/.test(cond) ? 2 : 1, spell: 'all' }; }
      else if (/^you scry|^you surveil/.test(cond)) event = 'youScry';
      else if (/^you discard|^you cycle or discard/.test(cond)) event = 'youDiscard';
      else if (/^you create one or more tokens|^one or more tokens are created under your control|^you create a token/.test(cond)) event = 'tokenEnters';
      else if (/^(?:a|another) creature (?:you control )?becomes the target|^~ becomes the target/.test(cond)) event = 'targeted';
      else if (/^a player casts their|^an opponent activates/.test(cond)) event = null;
      if (event) { abilities.push({ kind: 'trigger', event, scope, may: /you may/.test(m[3]), ifCond: /^if /.test(m[3]) ? m[3].split(',')[0] : null, effects: parseEffects(m[3].replace(/^if [^,]+, /, '')), text: line, level: level > 1 ? level : undefined, ...extra }); continue; }
      if (/^this class becomes level (\d)/.test(cond)) { abilities.push({ kind: 'trigger', event: 'levelUp', scope: 'self', level: +cond.match(/level (\d)/)[1], effects: parseEffects(m[3]), text: line }); continue; }
    }
    // statics: anthems, keyword grants, equipment / aura bonuses
    if ((m = l.match(/^(other )?(creatures|[a-z]+ creatures|creature tokens|tokens|[a-z]+ tokens|[a-z]+s) you control (?:get|have) (\+(\d+)\/\+(\d+))?(?: and (?:have|gain) )?([a-z ,]+?)?\.?$/)) && (m[3] || m[6])) {
      const filt = m[2].replace(/ you control.*/, ''); abilities.push({ kind: 'static', other: !!m[1], filter: /^creatures$/.test(filt) ? null : filt.replace(/ creatures?$/, '').replace(/^creature /, '').replace(/ tokens?$/, '').replace(/s$/, ''), tokens: /tokens?/.test(filt), p: +(m[4] || 0), t: +(m[5] || 0), kw: (m[6] || '').replace(/ and /g, ',').trim(), text: line, level: level > 1 ? level : undefined }); continue;
    }
    if ((m = l.match(/^(equipped|enchanted) creature (?:gets|has|gains) (?:\+(\d+)\/\+(\d+))?(?:,? (?:and )?(?:has|gains) )?([a-z ,]+?)?(?:,? and can't be blocked)?\.?$/)) && (m[2] || m[4])) { abilities.push({ kind: 'static', attached: true, p: +(m[2] || 0), t: +(m[3] || 0), kw: ((m[4] || '').replace(/ and /g, ',').trim() + (/can't be blocked/.test(l) ? ',unblockable' : '')).replace(/^,/, ''), text: line }); continue; }
    if ((m = l.match(/^(equipped|enchanted) creature gets (-\d+)\/(-\d+)/))) { abilities.push({ kind: 'static', attached: true, p: +m[2], t: +m[3], kw: '', text: line }); continue; }
    if (/^enchanted creature can't attack or block|^enchanted creature can't attack|^enchanted creature doesn't untap|^enchanted permanent doesn't untap|^enchanted creature can't block/.test(l)) { abilities.push({ kind: 'static', attached: true, p: 0, t: 0, kw: /block/.test(l) && /attack/.test(l) ? "can't attack,can't block" : /block/.test(l) ? "can't block" : /untap/.test(l) ? "can't attack,can't block,frozen" : "can't attack", hostile: true, text: line }); continue; }
    if ((m = l.match(/^~ gets \+(\d+)\/\+(\d+) for each ([a-z]+)/))) { abilities.push({ kind: 'static', selfScale: m[3], p: +m[1], t: +m[2], text: line }); continue; }
    if ((m = l.match(/^(?:~|this creature)(?:'s power and toughness are each equal to|has power and toughness each equal to) the number of ([a-z ]+?)(?: you control| in your graveyard)/))) { abilities.push({ kind: 'static', pstar: m[1], text: line }); continue; }
  }
  return abilities;
}
export const manaIn = (cost) => (String(cost).match(/\{[wubrgc](?:\/[wubrgcp])?\}/gi) || []).length + (String(cost).match(/\{(\d+)\}/g) || []).reduce((a, x) => a + parseInt(x.slice(1, -1), 10), 0) + (/^\d+$/.test(String(cost).trim()) ? parseInt(cost, 10) : 0);
/** Static bonus a permanent grants to card `x` on the same side (anthems, lords, equipment, auras). Returns [p, t, keywordsCSV]. */
export function staticGrant(src, x) {
  let p = 0, t = 0; const kw = [];
  for (const a of parseAbilities(src)) {
    if (a.kind !== 'static') continue;
    if (a.level && (src.ctr || 1) < a.level) continue;
    if (a.attached) { if (src.attachedTo === x.id) { p += a.p; t += a.t; if (a.kw) kw.push(a.kw); } continue; }
    if (a.selfScale || a.pstar) continue;
    if (a.other && src.id === x.id) continue;
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
