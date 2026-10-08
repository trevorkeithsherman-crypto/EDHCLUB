// Practice bots. They play Magic the way a tired friend does at 1 a.m.: drop a land, cast the biggest
// thing they can see, swing at whoever is winning, pass. No rules engine, so they only touch the
// bookkeeping the table already tracks. The host's client runs them.

export function makeBot(api) {
  const { S, P, moveCard, castToStack, resolveTop, attack, combatDamage, nextPhase, passTurn, isCreature, powerOf, log } = api;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const speed = () => (S.botSpeed === 'fast' ? 0.35 : 1);
  let running = false;

  async function takeTurn(i) {
    if (running) return; running = true;
    const p = P(i);
    try {
      const d = (ms) => wait(ms * speed());
      await d(900);
      // 1. Land
      const land = p.zones.hand.map((id) => S.cards[id]).find((c) => /Land/.test(c.type));
      if (land) { castToStack(land.id); await d(700); }
      // 2. Commander first if it's home and we have "mana" (count lands on board; tax ignored on purpose)
      const lands = p.zones.battlefield.map((id) => S.cards[id]).filter((c) => /Land/.test(c.type)).length;
      const cmdr = p.zones.command.map((id) => S.cards[id])[0];
      let spent = 0;
      const cost = (c) => (c.cost.match(/\{[^}]+\}/g) || []).reduce((a, t) => { const v = t.slice(1, -1); return a + (/^\d+$/.test(v) ? +v : 1); }, 0);
      if (cmdr && cost(cmdr) <= lands) { castToStack(cmdr.id); await d(1100); resolveTop(); spent += cost(cmdr); await d(700); }
      // 3. Cast the most expensive affordable permanents, then spells
      const hand = () => p.zones.hand.map((id) => S.cards[id]).filter((c) => !/Land/.test(c.type)).sort((a, b) => cost(b) - cost(a));
      for (let k = 0; k < 3; k++) {
        const pick = hand().find((c) => cost(c) <= lands - spent);
        if (!pick) break;
        castToStack(pick.id); await d(900); resolveTop(); spent += cost(pick); await d(600);
      }
      // 4. Combat: swing with everything untapped that has power, at the healthiest opponent
      nextPhase(); await d(500);
      const targets = S.players.map((q, k) => ({ q, k })).filter(({ q, k }) => k !== i && !q.out);
      if (targets.length) {
        const t = targets.sort((a, b) => b.q.life - a.q.life)[0].k;
        const attackers = p.zones.battlefield.map((id) => S.cards[id]).filter((c) => isCreature(c) && !c.tapped && powerOf(c) > 0 && !c.summoning);
        for (const c of attackers.slice(0, 6)) { attack(c, t); await d(350); }
        await d(900);
        for (const c of attackers.slice(0, 6)) { if (S.attacks.find((a) => a.id === c.id)) { combatDamage(c, t); await d(450); } }
      }
      await d(600);
      log(`${p.name} (bot) passes`);
      passTurn();
    } finally { running = false; }
  }
  return { takeTurn, get busy() { return running; } };
}
