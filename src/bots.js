// Practice bots that play like an average Commander player: curve out, keep up removal, don't suicide
// attackers into bigger blockers, block when the math says so, chump when it's lethal, and go for the
// kill when it's there. No rules engine; they reason over the same card data and combat simulator the
// table uses. The host's client runs them.

export function makeBot(api) {
  const { S, P, castToStack, cast, resolveTop, attack, combatDamage, nextPhase, passTurn, isCreature, powerOf, toughnessOf, log, Rules, draw, changeLife, toGraveyard, toExile, moveCard, toggleTap } = api;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const speed = () => ({ fast: 0.35, relaxed: 1.7 }[S.botSpeed] || 1.25);
  const jitter = (ms) => ms * (0.75 + Math.random() * 0.5);
  let running = false;

  /* ---------- reading cards ---------- */
  const cost = (c) => (String(c.cost || '').match(/\{[^}]+\}/g) || []).reduce((a, t) => { const v = t.slice(1, -1); return a + (/^\d+$/.test(v) ? +v : v === 'X' ? 0 : 1); }, 0);
  const oracle = (c) => String(c.oracle || '').toLowerCase();
  const isLand = (c) => /Land/.test(c.type);
  // What a land actually does, read from its type line and text. Basics are mana; nonbasics only if they tap for mana.
  const BASIC = { plains: 'W', island: 'U', swamp: 'B', mountain: 'R', forest: 'G' };
  const basicTypes = (l) => Object.entries(BASIC).filter(([t]) => new RegExp(`\\b${t}\\b`, 'i').test(l.type)).map(([, k]) => k);
  const tapsForMana = (l) => isLand(l) && (basicTypes(l).length > 0 || /\{t\}: add/.test(oracle(l)) || /\{t\}, pay \d+ life: add/.test(oracle(l)) || (!l.oracle && /Basic/.test(l.type)));
  const isFetch = (l) => isLand(l) && /sacrifice [^.:]*: search your library for (?:a |an |up to \w+ )?(?:basic land|plains|island|swamp|mountain|forest)/.test(oracle(l));
  const entersTapped = (l) => /enters (?:the battlefield )?tapped/.test(oracle(l)) && !/unless/.test(oracle(l));
  const landMana = (l) => { if (!tapsForMana(l)) return 0; const n = (oracle(l).match(/\{t\}: add (\{[wubrgc]\}){2,}/) || [])[0]; return n ? (n.match(/\{/g).length - 1) : 1; };
  const isRock = (c) => !isLand(c) && /Artifact/.test(c.type) && /\{t\}: add/.test(oracle(c));
  const rockMana = (c) => { const m = oracle(c).match(/\{t\}: add ((\{[wubrgc]\})+|\{[wubrgc]\}|one mana|two mana)/); if (!m) return 0; if (/two/.test(m[1])) return 2; const pips = (m[1].match(/\{/g) || []).length; return Math.max(1, pips); };
  const isRamp = (c) => !isLand(c) && /search your library for (a|up to \w+) basic land/.test(oracle(c));
  const isDraw = (c) => { const m = oracle(c).match(/draw (a|two|three|\d+) cards?/); return m ? ({ a: 1, two: 2, three: 3 }[m[1]] || +m[1] || 1) : 0; };
  const isCreatureKill = (c) => !isCreature(c) && /(destroy|exile) target (creature|nonland permanent|permanent)/.test(oracle(c));
  const burn = (c) => { const m = oracle(c).match(/deals (\d+) damage to (any target|target creature|target creature or player|target player or planeswalker|target opponent|each opponent)/); return m ? { n: +m[1], face: /any target|player|opponent/.test(m[2]), creature: /any target|creature/.test(m[2]) } : null; };
  const isWipe = (c) => /destroy all creatures|exile all creatures|each creature/.test(oracle(c)) && !isCreature(c);
  const value = (c) => (isCreature(c) ? powerOf(c) + toughnessOf(c) + Rules.shownKeywords(c).length * 1.5 + (c.isCmdr ? 4 : 0) : cost(c) + 1);

  /* ---------- table reading ---------- */
  const bf = (k) => P(k).zones.battlefield.map((id) => S.cards[id]).filter(Boolean);
  const creatures = (k) => bf(k).filter(isCreature);
  const opponents = (i) => S.players.map((q, k) => ({ q, k })).filter(({ q, k }) => k !== i && k < (S.seats || 4) && !q.out && !q.empty);
  const manaOf = (k) => bf(k).reduce((n, c) => n + (c.tapped ? 0 : isLand(c) ? landMana(c) : isRock(c) ? rockMana(c) : 0), 0);
  // Pay for a spell by tapping lands (colored pips first) and mana rocks, like a person would.
  const pips = (c) => (String(c.cost || '').match(/\{[WUBRG]\}/g) || []).map((t) => t[1]);
  const landColors = (l) => { const o = oracle(l); const t = l.type.toLowerCase(); return ['W', 'U', 'B', 'R', 'G'].filter((k) => (o.includes(`{${k.toLowerCase()}}`) && /add/.test(o)) || t.includes({ W: 'plains', U: 'island', B: 'swamp', R: 'mountain', G: 'forest' }[k]) || (/add (?:one mana of )?any color/.test(o))); };
  function tapMana(k, c) {
    let need = cost(c) + (c.isCmdr && c.zone !== 'battlefield' ? 2 * (c.casts || 0) : 0); if (need <= 0) return;
    const avail = bf(k).filter((x) => !x.tapped && ((isLand(x) && tapsForMana(x)) || isRock(x)));
    const want = pips(c);
    const tap = (x) => { if (need <= 0 || x.tapped) return; toggleTap(x); need -= isLand(x) ? landMana(x) : rockMana(x); };
    for (const col of want) { const l = avail.find((x) => !x.tapped && isLand(x) && landColors(x).includes(col)); if (l) tap(l); }
    avail.filter((x) => isRock(x) && rockMana(x) >= 2).forEach(tap);
    avail.filter((x) => isLand(x) && landColors(x).length === 0).forEach(tap); // colorless/utility lands first
    avail.filter((x) => isLand(x)).forEach(tap);
    avail.filter((x) => isRock(x)).forEach(tap);
  }
  const blockersOf = (k, atk) => creatures(k).filter((b) => Rules.canBlock(b, atk));
  const biggestThreat = (i) => opponents(i).flatMap(({ k }) => creatures(k)).sort((a, b) => value(b) - value(a))[0];

  // Evolving Wilds and friends: sacrifice, find the basic the hand wants, it comes in tapped if the card says so.
  async function crackFetches(i, d) {
    const p = P(i);
    for (const l of bf(i).filter((x) => isFetch(x) && !x.tapped)) {
      const o = oracle(l); const wants = (o.match(/for (?:a |an |up to \w+ )?(basic land|plains|island|swamp|mountain|forest)(?: or (plains|island|swamp|mountain|forest))?/) || []).slice(1).filter(Boolean);
      const need = new Set(p.zones.hand.concat(p.zones.command).map((id) => S.cards[id]).flatMap((c) => (c.colors || '').split('')));
      const lib = p.zones.library.map((id) => S.cards[id]).filter((b) => /Basic/.test(b.type) && (wants.includes('basic land') || wants.some((w) => new RegExp(w, 'i').test(b.type))));
      if (!lib.length) continue;
      const pick = lib.sort((a, b) => (need.has(basicTypes(b)[0]) ? 1 : 0) - (need.has(basicTypes(a)[0]) ? 1 : 0))[0];
      moveCard(l.id, i, 'graveyard'); moveCard(pick.id, i, 'battlefield'); if (/onto the battlefield tapped/.test(o)) pick.tapped = true;
      log(`${p.name} cracks ${l.name} for ${pick.name}`); await d(500);
    }
  }
  /* ---------- casting ---------- */
  function pickLand(p) {
    const lands = p.zones.hand.map((id) => S.cards[id]).filter(isLand); if (!lands.length) return null;
    const need = new Set(p.zones.hand.concat(p.zones.command).map((id) => S.cards[id]).flatMap((c) => (c.colors || '').split('')));
    const colorOf = (l) => { const o = oracle(l); return ['w', 'u', 'b', 'r', 'g'].filter((k) => o.includes(`{${k}}`) || new RegExp(`\\b${{ w: 'plains', u: 'island', b: 'swamp', r: 'mountain', g: 'forest' }[k]}\\b`).test(l.type.toLowerCase())).map((k) => k.toUpperCase()); };
    const have = new Set(bf(S.players.indexOf(p)).filter(isLand).flatMap(colorOf));
    return lands.sort((a, b) => (tapsForMana(b) || isFetch(b)) - (tapsForMana(a) || isFetch(a)) || colorOf(b).filter((k) => need.has(k) && !have.has(k)).length - colorOf(a).filter((k) => need.has(k) && !have.has(k)).length || colorOf(b).length - colorOf(a).length)[0];
  }
  // Pick what to cast this turn: ramp early, answer threats, refill when empty-handed, otherwise the best curve.
  function plan(i, mana) {
    const p = P(i); const hand = p.zones.hand.map((id) => S.cards[id]).filter((c) => !isLand(c) && cost(c) <= mana);
    const picks = []; let left = mana;
    const take = (c) => { if (c && cost(c) <= left && !picks.includes(c)) { picks.push(c); left -= cost(c); } };
    const round = S.turn.number;
    const threat = biggestThreat(i);
    if (threat && value(threat) >= 7) { take(hand.filter((c) => isCreatureKill(c) || (burn(c) && burn(c).creature && burn(c).n >= toughnessOf(threat))).sort((a, b) => cost(a) - cost(b))[0]); }
    if (round <= 4) { take(hand.filter(isRamp).sort((a, b) => cost(a) - cost(b))[0]); take(hand.filter(isRock).sort((a, b) => cost(a) - cost(b))[0]); }
    const cmdr = p.zones.command.map((id) => S.cards[id]).find((c) => c.isCmdr);
    if (cmdr && cost(cmdr) + 2 * (cmdr.casts || 0) <= left && round >= 2) picks.push(cmdr), left -= cost(cmdr) + 2 * (cmdr.casts || 0);
    if (p.zones.hand.length <= 3) take(hand.filter(isDraw).sort((a, b) => isDraw(b) - isDraw(a))[0]);
    const myPower = creatures(i).reduce((s, c) => s + powerOf(c), 0); const theirPower = Math.max(0, ...opponents(i).map(({ k }) => creatures(k).reduce((s, c) => s + powerOf(c), 0)));
    if (theirPower >= myPower + 8 && creatures(i).length <= 2) take(hand.filter(isWipe)[0]);
    // fill the curve: best value per mana, biggest first, then cheap stuff with what's left
    const rest = hand.filter((c) => !picks.includes(c) && !isWipe(c) && !(isCreatureKill(c) || burn(c)) || (isCreature(c) && !picks.includes(c))).sort((a, b) => cost(b) - cost(a) || value(b) - value(a));
    for (const c of rest) take(c);
    return picks;
  }
  async function resolveSpell(i, c, d) {
    const p = P(i);
    if (isCreature(c) || /Land/.test(c.type) || (!/Instant|Sorcery/.test(c.type) && !isRamp(c) && !isDraw(c))) return; // permanents just land
    const o = oracle(c); const b = burn(c); const n = isDraw(c);
    if (isRamp(c)) { const lands = p.zones.library.map((id) => S.cards[id]).filter((l) => /Basic Land/.test(l.type)); const want = /two|up to two/.test(o) ? 2 : 1; for (const l of lands.slice(0, want)) { moveCard(l.id, i, 'battlefield'); l.tapped = true; await d(300); } log(`${p.name} ramps with ${c.name}`); return; }
    if (n) { draw(i, n); log(`${p.name} draws ${n} off ${c.name}`); return; }
    const threat = biggestThreat(i);
    if (isCreatureKill(c) && threat) { log(`${p.name}'s ${c.name} removes ${threat.name}`); (/exile/.test(o) ? toExile : toGraveyard)(threat); return; }
    if (b) {
      if (b.creature && threat && toughnessOf(threat) - (threat.dmg || 0) <= b.n && value(threat) >= 5) { log(`${p.name}'s ${c.name} burns ${threat.name}`); toGraveyard(threat); return; }
      if (b.face) { const t = opponents(i).sort((x, y) => x.q.life - y.q.life)[0]; if (t) { log(`${p.name}'s ${c.name} hits ${t.q.name} for ${b.n}`); changeLife(t.k, -b.n); } return; }
    }
    if (isWipe(c)) { log(`${p.name} casts ${c.name}: the board is wiped`); S.players.forEach((q, k) => { if (k < (S.seats || 4)) creatures(k).forEach((x) => toGraveyard(x)); }); }
  }

  /* ---------- combat ---------- */
  // Is swinging this creature at seat k a reasonable attack?
  function attackScore(i, c, k) {
    const bl = blockersOf(k, c);
    if (!bl.length) return 2 + powerOf(c); // free damage
    const outcomes = bl.map((b) => Rules.simulate(c, [b]));
    const safe = outcomes.every((r) => !r.attackerDies);
    const trades = outcomes.some((r) => r.attackerDies && r.blockersDie.length);
    const eaten = outcomes.some((r) => r.attackerDies && !r.blockersDie.length);
    if (safe) return 1 + powerOf(c) * 0.5;
    if (eaten && !trades) return -3;
    return trades ? 0.2 : -1;
  }
  function planAttacks(i) {
    const p = P(i); const ready = creatures(i).filter((c) => Rules.canAttack(c).ok && powerOf(c) > 0);
    if (!ready.length) return [];
    const opps = opponents(i); if (!opps.length) return [];
    // lethal check: who can we kill through their possible blocks?
    for (const { q, k } of opps.slice().sort((a, b) => a.q.life - b.q.life)) {
      const unblockable = ready.filter((c) => !blockersOf(k, c).length).reduce((s, c) => s + powerOf(c), 0);
      const nBlockers = creatures(k).filter((b) => !b.tapped).length;
      const throughBlocks = ready.map(powerOf).sort((a, b) => b - a).slice(nBlockers).reduce((s, n) => s + n, 0); // they block our biggest
      if (unblockable >= q.life || throughBlocks >= q.life) return ready.map((c) => ({ c, k }));
    }
    // otherwise pressure the leader, keeping enough home to not die on the crack-back
    const leader = opps.slice().sort((a, b) => b.q.life - a.q.life)[0].k;
    const incoming = Math.max(0, ...opps.map(({ k }) => creatures(k).filter((c) => !c.tapped && !Rules.has(c, 'defender')).reduce((s, c) => s + powerOf(c), 0)));
    const keepHome = incoming >= p.life * 0.6 ? Math.min(2, ready.length - 1) : 0;
    const scored = ready.map((c) => ({ c, k: leader, s: attackScore(i, c, leader) })).sort((a, b) => b.s - a.s);
    const go = scored.filter((x) => x.s > 0);
    return go.slice(0, Math.max(0, go.length - keepHome));
  }
  // Blocks for an incoming attack. Returns blocker ids (possibly two for a gang block), or [] to take it.
  function chooseBlock(a, used = new Set()) {
    const atk = S.cards[a.id]; const me = a.target; const p = P(me); if (!atk) return [];
    const cands = blockersOf(me, atk).filter((b) => !used.has(b.id));
    if (!cands.length) return [];
    const incomingTotal = S.attacks.filter((x) => x.target === me).reduce((s, x) => s + powerOf(S.cards[x.id] || {}), 0);
    const lethalSoon = incomingTotal >= p.life || (atk.isCmdr && (p.cmdDmg[atk.id] || 0) + powerOf(atk) >= 21);
    const menace = Rules.has(atk, 'menace');
    const single = cands.map((b) => ({ ids: [b.id], r: Rules.simulate(atk, [b]), b }));
    const pairs = [];
    for (let x = 0; x < cands.length; x++) for (let y = x + 1; y < cands.length; y++) pairs.push({ ids: [cands[x].id, cands[y].id], r: Rules.simulate(atk, [cands[x], cands[y]]), bs: [cands[x], cands[y]] });
    const score = (o) => { const lost = (o.bs || [o.b]).filter((b) => o.r.blockersDie.includes(b.id)).reduce((s, b) => s + value(b), 0); return (o.r.attackerDies ? value(atk) + 1 : 0) - lost - (o.ids.length - 1) * 0.5; };
    const options = (menace ? pairs : [...single, ...pairs]).map((o) => ({ ...o, s: score(o) })).sort((a, b) => b.s - a.s);
    const best = options[0];
    if (best && best.s > 0) return best.ids;                       // we come out ahead
    if (lethalSoon) { const cheap = (menace ? pairs : single).sort((x, y) => (x.bs || [x.b]).reduce((s, b) => s + value(b), 0) - (y.bs || [y.b]).reduce((s, b) => s + value(b), 0))[0]; return cheap ? cheap.ids : []; } // chump
    if (best && best.s === 0 && powerOf(atk) >= 4) return best.ids; // even trade against something big
    return [];
  }

  /* ---------- the turn ---------- */
  async function takeTurn(i) {
    if (running) return; running = true;
    const p = P(i);
    try {
      const d = (ms) => wait(jitter(ms) * speed());
      await d(900);
      const land = pickLand(p); if (land) { castToStack(land.id); if (entersTapped(land)) { land.tapped = true; } await d(650); }
      await crackFetches(i, d);
      const mana = manaOf(i);
      const picks = plan(i, mana);
      for (const c of picks) {
        if (!S.cards[c.id] || (c.zone !== 'hand' && c.zone !== 'command')) continue;
        tapMana(i, c); const ok = await cast(c); if (!ok) { await d(500); continue; }
        await d(600); await resolveSpell(i, c, d); await d(500);
      }
      // combat
      nextPhase(); await d(500);
      const plans = planAttacks(i);
      for (const { c, k } of plans) { attack(c, k); await d(350); }
      if (plans.length) {
        await d(800);
        const mine = () => S.attacks.filter((a) => plans.some((x) => x.c.id === a.id));
        const answered = (a) => a.ok || (a.blockers && a.blockers.length) || P(a.target).bot;
        for (let w = 0; w < 40 && mine().some((a) => !answered(a)); w++) await d(500);
        mine().filter((a) => !answered(a)).forEach((a) => { a.ok = true; log(`${P(a.target).name} didn't answer; the attack goes through`); });
        for (const a of mine()) { const c = S.cards[a.id]; if (c) combatDamage(c, a.target); await d(450); }
      }
      // second main: anything affordable we held back (cheap creatures after combat)
      const late = plan(i, manaOf(i)).filter((c) => isCreature(c) && S.cards[c.id] && c.zone === 'hand');
      for (const c of late.slice(0, 2)) { tapMana(i, c); await cast(c); await d(600); }
      await d(500);
      log(`${p.name} passes`);
      passTurn();
    } finally { running = false; }
  }
  return { takeTurn, chooseBlock, get busy() { return running; } };
}
