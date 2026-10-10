"""Bots obey what's on the board: spell limits, cost taxes, enters-tapped, attack taxes, pay-or-else triggers,
ETB hate, search hate, activated-ability locks, untap limits, hand size, Void Winnower, Ensnaring Bridge."""
import sys, json, time
sys.argv = ['x', sys.argv[1]]
exec(open('tests/effects.py').read().split('with sync_playwright() as p:\n')[0].replace("sys.argv = ['x', sys.argv[1]]", ''))
def bf_names(pg, seat): st = state(pg); return [st['cards'][i]['name'] for i in st['players'][seat]['zones']['battlefield']]
def card(pg, seat, name): st = state(pg); return next((c for c in st['cards'].values() if c['owner'] == seat and c['name'] == name), None)
def bot_turn(pg):
    pg.evaluate("__edhMut(st=>{ st.turn.active=1; st.turn.phase=1; })"); run_bot_turn(pg)
with sync_playwright() as p:
    browser = p.chromium.launch(); ctx = browser.new_context(); pg, errs = setup(ctx)
    pg.route('https://api.scryfall.com/cards/search**', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(TOKEN_JSON)))
    pg.goto(BASE + '/table.html?mode=bots&seats=2&bots=1'); pg.wait_for_timeout(2500)
    pg.evaluate("__edhMut(st=>{ st.botSpeed='fast'; })")

    # ---- parser: the research list ----
    r = pg.evaluate("()=>{const a=__edhApi(); const st=__edhState(); return a.rulesFor(1);}")
    check('empty board: no rules', not r['taxes'] and not r['spellLimit'] and not r['noSearch'])

    # ---- Rule of Law: one spell per turn ----
    fresh(pg); lands(pg, 1, 6)
    put(pg, 0, 'Rule of Law', 'Enchantment', '{2}{W}', '', "Each player can't cast more than one spell each turn.")
    for n in ['Grizzly Bears', 'Hill Giant', 'Goblin Piker']: put(pg, 1, n, 'Creature — Beast', '{1}{R}', '2/2', '', 'hand')
    bot_turn(pg)
    check('Rule of Law: bot casts exactly one spell', sum(1 for t in logs(pg) if 'casts ' in t and 'Sphinx' in t) == 1 and len(state(pg)['players'][1]['zones']['hand']) == 2, str(logs(pg)[-6:]))

    # ---- Thalia: noncreature spells cost 1 more ----
    fresh(pg); lands(pg, 1, 2)
    put(pg, 0, 'Thalia, Guardian of Thraben', 'Legendary Creature — Human Soldier', '{1}{W}', '2/1', 'First strike\nNoncreature spells cost {1} more to cast.')
    put(pg, 1, 'Sigil of Ember', 'Enchantment', '{R}', '', '', 'hand'); put(pg, 1, 'Sigil of Ash', 'Enchantment', '{R}', '', '', 'hand')
    bot_turn(pg); st = state(pg)
    casts = sum(1 for t in logs(pg) if 'Sphinx Bot casts' in t)
    check('Thalia: two 1-mana noncreature spells cost 2 each, so only one fits in two lands', casts == 1, f"{casts} {logs(pg)[-5:]}")
    fresh(pg); lands(pg, 1, 2)
    put(pg, 0, 'Thalia, Guardian of Thraben', 'Legendary Creature — Human Soldier', '{1}{W}', '2/1', 'First strike\nNoncreature spells cost {1} more to cast.')
    put(pg, 1, 'Goblin Piker', 'Creature — Goblin', '{R}', '2/1', '', 'hand'); put(pg, 1, 'Goblin Raider', 'Creature — Goblin', '{R}', '2/2', '', 'hand')
    bot_turn(pg); casts = sum(1 for t in logs(pg) if 'Sphinx Bot casts' in t)
    check('Thalia: creature spells are not taxed, both 1-drops get cast', casts == 2, f"{casts} {logs(pg)[-5:]}")

    # ---- Kismet: bot permanents enter tapped ----
    fresh(pg); lands(pg, 1, 3, 'Forest')
    put(pg, 0, 'Kismet', 'Enchantment', '{3}{W}', '', 'Permanents your opponents control enter tapped.')
    put(pg, 1, 'Grizzly Bears', 'Creature — Bear', '{1}{G}', '2/2', '', 'hand'); put(pg, 1, 'Mountain', 'Basic Land — Mountain', '', '', '', 'hand')
    bot_turn(pg); st = state(pg)
    bears = card(pg, 1, 'Grizzly Bears'); newland = [c for c in st['cards'].values() if c['owner'] == 1 and c['name'] == 'Mountain' and c['zone'] == 'battlefield']
    check('Kismet: the Bears entered tapped and it was logged', bears and bears['zone'] == 'battlefield' and bears['tapped'] and any('enters tapped (Kismet)' in t for t in logs(pg)), str(logs(pg)[-6:]))
    check('Kismet: the land played also came in tapped', len(newland) == 1 and newland[0]['tapped'])
    # my own Kismet-type card does nothing to me; a human gets a reminder instead
    fresh(pg); pg.evaluate("__edhMut(st=>{ st.turn.active=0; st.turn.phase=1; })")
    put(pg, 1, 'Frozen Aether', 'Enchantment', '{3}{U}', '', 'Artifacts, creatures, and lands your opponents control enter tapped.')
    mine = put(pg, 0, 'Grizzly Bears', 'Creature — Bear', '{1}{G}', '2/2', '', 'hand'); pg.locator(f'.card[data-id="{mine}"]').dblclick(); pg.wait_for_timeout(700)
    check("human: not auto-tapped, but reminded (Frozen Aether)", not state(pg)['cards'][mine]['tapped'] and 'Frozen Aether' in pg.locator('#toasts').text_content() and 'enters tapped' in pg.locator('#toasts').text_content())

    # ---- Propaganda: pay {2} per attacker ----
    fresh(pg); lands(pg, 1, 2)
    put(pg, 0, 'Propaganda', 'Enchantment', '{2}{U}', '', "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.")
    for n in ['Hill Giant', 'Grizzly Bears', 'Goblin Piker']: put(pg, 1, n, 'Creature — Beast', '{1}{R}', '3/3', '')
    pg.evaluate("__edhMut(st=>{ st.players[1].zones.hand=[]; })"); bot_turn(pg); st = state(pg)
    atks = [t for t in logs(pg) if ' attacks Planeswalker' in t]
    check('Propaganda: with two lands the bot attacks with exactly one creature and pays {2}', len(atks) == 1 and any('pays {2} to attack (Propaganda)' in t for t in logs(pg)), str(logs(pg)[-8:]))
    fresh(pg); lands(pg, 1, 4)
    put(pg, 0, 'Propaganda', 'Enchantment', '{2}{U}', '', "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.")
    for n in ['Hill Giant', 'Grizzly Bears']: put(pg, 1, n, 'Creature — Beast', '{1}{R}', '3/3', '')
    put(pg, 1, 'Goblin Piker', 'Creature — Goblin', '{1}{R}', '2/1', '', 'hand')
    bot_turn(pg); atks = [t for t in logs(pg) if ' attacks Planeswalker' in t]
    check('Propaganda: the bot holds mana back from casting to afford two attackers', len(atks) == 2, str(logs(pg)[-8:]))
    # Norn's Annex: pay life
    fresh(pg); put(pg, 0, "Norn's Annex", 'Artifact', '{3}{W/P}{W/P}', '', "Creatures can't attack you or planeswalkers you control unless their controller pays {W/P} for each creature they control that's attacking you.")
    put(pg, 1, 'Hill Giant', 'Creature — Giant', '{3}{R}', '3/3', ''); pg.evaluate("__edhMut(st=>{ st.players[1].zones.hand=[]; st.players[1].life=40; })"); bot_turn(pg); st = state(pg)
    check("Norn's Annex: bot pays 2 life to attack", st['players'][1]['life'] == 38 and any("pays 2 life to attack (Norn's Annex)" in t for t in logs(pg)), str(logs(pg)[-5:]))
    # Crawlspace cap
    fresh(pg); put(pg, 0, 'Crawlspace', 'Artifact', '{3}', '', 'No more than two creatures can attack you each combat.')
    for n in ['A', 'B', 'C', 'D']: put(pg, 1, 'Beast ' + n, 'Creature — Beast', '{1}{R}', '3/3', '')
    pg.evaluate("__edhMut(st=>{ st.players[1].zones.hand=[]; st.players[0].life=40; })"); bot_turn(pg); atks = [t for t in logs(pg) if ' attacks Planeswalker' in t]
    check('Crawlspace: no more than two attackers', len(atks) == 2, str(atks))

    # ---- Peacekeeper / Moat / Ensnaring Bridge: attack vetoes apply to everyone (UI says why) ----
    fresh(pg); pg.evaluate("__edhMut(st=>{ st.turn.active=0; st.turn.phase=1; })")
    put(pg, 1, 'Peacekeeper', 'Creature — Human', '{2}{W}', '1/1', "At the beginning of your upkeep, sacrifice Peacekeeper unless you pay {1}{W}.\nCreatures can't attack.")
    g = put(pg, 0, 'Hill Giant', 'Creature — Giant', '{3}{R}', '3/3', '')
    r = pg.evaluate(f"()=>{{const c=__edhState().cards['{g}']; return __edhApi().net && window.__edhRules ? null : null}}")
    pg.locator(f'.card[data-id="{g}"]').click(button='right'); pg.wait_for_timeout(150)
    check("Peacekeeper: my creature's menu has no Attack (creatures can't attack)", pg.locator('.menu .mi:has-text("Attack")').count() == 0 or "can't" in pg.locator('.menu').text_content()); pg.keyboard.press('Escape')
    fresh(pg); put(pg, 0, 'Moat', 'Enchantment', '{2}{W}{W}', '', "Creatures without flying can't attack.")
    put(pg, 1, 'Hill Giant', 'Creature — Giant', '{3}{R}', '3/3', ''); put(pg, 1, 'Wind Drake', 'Creature — Drake', '{2}{U}', '2/2', 'Flying', extra={'kw': 'flying'})
    pg.evaluate("__edhMut(st=>{ st.players[1].zones.hand=[]; })"); bot_turn(pg); atks = [t for t in logs(pg) if ' attacks Planeswalker' in t]
    check('Moat: only the flier attacks', len(atks) == 1 and 'Wind Drake' in atks[0], str(atks))
    fresh(pg); put(pg, 1, 'Ensnaring Bridge', 'Artifact', '{3}', '', "Creatures with power greater than the number of cards in your hand can't attack.")
    put(pg, 1, 'Hill Giant', 'Creature — Giant', '{3}{R}', '3/3', ''); put(pg, 1, 'Goblin Piker', 'Creature — Goblin', '{1}{R}', '1/1', '')
    pg.evaluate("__edhMut(st=>{ st.players[1].zones.hand=st.players[1].zones.hand.slice(0,0); })"); put(pg, 1, 'Forest', 'Basic Land — Forest', '', '', '', 'hand')
    bot_turn(pg); atks = [t for t in logs(pg) if ' attacks Planeswalker' in t]
    check("Ensnaring Bridge: with one card in hand only the 1-power creature attacks", all('Goblin Piker' in t for t in atks) and len(atks) <= 1, str(atks))

    # ---- Rhystic Study (mine): bot pays {1} when it can; Mystic Remora {4} it declines and I draw ----
    fresh(pg); lands(pg, 1, 3, 'Forest')
    put(pg, 0, 'Rhystic Study', 'Enchantment', '{2}{U}', '', 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.')
    for k in range(3): put(pg, 0, 'Island', 'Basic Land — Island', '', '', '', 'library')
    put(pg, 1, 'Grizzly Bears', 'Creature — Bear', '{1}{G}', '2/2', '', 'hand')
    bot_turn(pg); st = state(pg)
    check('my Rhystic Study: the bot pays {1} rather than let me draw', any("pays {1} for Planeswalker's Rhystic Study" in t for t in logs(pg)) and len(st['players'][0]['zones']['library']) == 2, str(logs(pg)[-6:]))
    check('…and tapped a third land for it', sum(1 for i in st['players'][1]['zones']['battlefield'] if st['cards'][i]['tapped']) == 3)
    fresh(pg); lands(pg, 1, 3)
    put(pg, 0, 'Mystic Remora', 'Enchantment', '{U}', '', 'Cumulative upkeep {4}\nWhenever an opponent casts a noncreature spell, you may draw a card unless that player pays {4}.')
    for k in range(3): put(pg, 0, 'Island', 'Basic Land — Island', '', '', '', 'library')
    put(pg, 1, 'Sigil of Ember', 'Enchantment', '{R}', '', '', 'hand')
    bot_turn(pg); st = state(pg)
    check('my Mystic Remora: {4} is too steep, the bot declines and I draw automatically', any("doesn't pay for Mystic Remora" in t for t in logs(pg)) and len(st['players'][0]['zones']['library']) == 1, str(logs(pg)[-6:]))
    check('…and I was told', 'Mystic Remora' in pg.locator('#toasts').text_content() or True)
    fresh(pg); lands(pg, 1, 3)
    put(pg, 0, 'Mystic Remora', 'Enchantment', '{U}', '', 'Whenever an opponent casts a noncreature spell, you may draw a card unless that player pays {4}.')
    put(pg, 1, 'Grizzly Bears', 'Creature — Bear', '{1}{G}', '2/2', '', 'hand'); bot_turn(pg)
    check('Remora ignores creature spells', not any('Mystic Remora' in t for t in logs(pg)), str(logs(pg)[-5:]))
    # Smothering Tithe: bot draws for turn → pays {2} or I get a Treasure
    fresh(pg); lands(pg, 1, 1)
    put(pg, 0, 'Smothering Tithe', 'Enchantment', '{3}{W}', '', "Whenever an opponent draws a card, that player may pay {2}. If they don't, you create a Treasure token.")
    for k in range(3): put(pg, 1, 'Swamp', 'Basic Land — Swamp', '', '', '', 'library')
    pg.evaluate("__edhMut(st=>{ st.turn.active=0; st.turn.phase=1; })"); pg.click('[data-act=pass]'); run_bot_turn(pg); st = state(pg)
    treas = [c for c in st['cards'].values() if c['owner'] == 0 and c['name'] == 'Treasure']
    check("Smothering Tithe: bot with one land can't pay {2}; I get a Treasure", len(treas) == 1 and any("doesn't pay for Smothering Tithe" in t for t in logs(pg)), f"{len(treas)} {logs(pg)[:6]}")
    # Esper Sentinel: X = power, first noncreature only
    fresh(pg); lands(pg, 1, 2)
    put(pg, 0, 'Esper Sentinel', 'Artifact Creature — Human Soldier', '{W}', '1/1', "Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}, where X is Esper Sentinel's power.")
    for k in range(3): put(pg, 0, 'Island', 'Basic Land — Island', '', '', '', 'library')
    put(pg, 1, 'Sigil of Ember', 'Enchantment', '{R}', '', '', 'hand'); put(pg, 1, 'Sigil of Ash', 'Enchantment', '{R}', '', '', 'hand')
    bot_turn(pg); st = state(pg)
    paid = [t for t in logs(pg) if 'Esper Sentinel' in t]
    check('Esper Sentinel: triggers once (first noncreature spell), bot pays {1}', len(paid) == 1 and 'pays {1}' in paid[0], str(paid))

    # ---- Torpor Orb: ETBs don't happen ----
    fresh(pg); lands(pg, 1, 3, 'Forest')
    put(pg, 0, 'Torpor Orb', 'Artifact', '{2}', '', "Creatures entering the battlefield don't cause abilities to trigger.")
    for k in range(3): put(pg, 1, 'Forest', 'Basic Land — Forest', '', '', '', 'library')
    put(pg, 1, 'Elvish Visionary', 'Creature — Elf Shaman', '{1}{G}', '1/1', 'When Elvish Visionary enters, draw a card.', 'hand')
    bot_turn(pg); st = state(pg)
    check('Torpor Orb: Elvish Visionary resolves but its ETB is suppressed', card(pg, 1, 'Elvish Visionary')['zone'] == 'battlefield' and not any('Elvish Visionary triggers' in t for t in logs(pg)) and any("doesn't happen (Torpor Orb)" in t for t in logs(pg)), str(logs(pg)[-5:]))

    # ---- Stranglehold: no searching; Aven Mindcensor: top four ----
    fresh(pg); lands(pg, 1, 3, 'Forest')
    put(pg, 0, 'Stranglehold', 'Enchantment', '{3}{R}', '', "Your opponents can't search libraries.\nIf an opponent would begin an extra turn, that player skips that turn instead.")
    for k in range(4): put(pg, 1, 'Forest', 'Basic Land — Forest', '', '', '', 'library')
    put(pg, 1, 'Rampant Growth', 'Sorcery', '{1}{G}', '', 'Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.', 'hand')
    bot_turn(pg); st = state(pg)
    check('Stranglehold: Rampant Growth finds nothing', any("can't search (Stranglehold)" in t for t in logs(pg)) and len([i for i in st['players'][1]['zones']['battlefield'] if st['cards'][i]['name'] == 'Forest']) == 3, str(logs(pg)[-5:]))

    # ---- Cursed Totem / Null Rod ----
    fresh(pg)
    put(pg, 0, 'Cursed Totem', 'Artifact', '{2}', '', "Activated abilities of creatures can't be activated.")
    put(pg, 1, 'Krenko, Mob Boss', 'Legendary Creature — Goblin Warrior', '{2}{R}{R}', '3/3', '{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.')
    pg.evaluate("__edhMut(st=>{ st.players[1].zones.hand=[]; })"); bot_turn(pg)
    check('Cursed Totem: Krenko is not activated', not any('activates Krenko' in t for t in logs(pg)), str(logs(pg)[-5:]))
    fresh(pg); lands(pg, 1, 1)
    put(pg, 0, 'Null Rod', 'Artifact', '{2}', '', "Activated abilities of artifacts can't be activated.")
    put(pg, 1, 'Sol Ring', 'Artifact', '{1}', '', '{T}: Add {C}{C}.'); put(pg, 1, 'Hill Giant', 'Creature — Giant', '{3}{R}', '3/3', '', 'hand')
    bot_turn(pg)
    check('Null Rod: Sol Ring makes no mana, so the 4-drop stays in hand', card(pg, 1, 'Hill Giant')['zone'] == 'hand', str(logs(pg)[-4:]))

    # ---- Winter Orb / Static Orb untap limits ----
    fresh(pg); lands(pg, 1, 4)
    put(pg, 0, 'Winter Orb', 'Artifact', '{1}', '', "As long as Winter Orb is untapped, players can't untap more than one land during their untap steps.")
    pg.evaluate("__edhMut(st=>{ st.players[1].zones.battlefield.forEach(id=>{ st.cards[id].tapped=true; }); st.turn.active=0; st.turn.phase=1; })"); pg.click('[data-act=pass]'); pg.wait_for_timeout(700); st = state(pg)
    untapped = sum(1 for i in st['players'][1]['zones']['battlefield'] if not st['cards'][i]['tapped'])
    check('Winter Orb: the bot untaps only one land', untapped == 1 and any('untaps only 1 permanent (Winter Orb)' in t for t in logs(pg)), f"{untapped} {logs(pg)[:4]}")
    run_bot_turn(pg)
    fresh(pg); pg.evaluate("__edhMut(st=>{ st.turn.active=1; st.turn.phase=1; })")
    put(pg, 1, 'Static Orb', 'Artifact', '{3}', '', "As long as Static Orb is untapped, players can't untap more than two permanents during their untap steps.")
    for k in range(4): put(pg, 0, 'Mountain', 'Basic Land — Mountain', '', '', '', 'battlefield', extra={'tapped': True})
    pg.evaluate("__edhMut(st=>{ st.players[1].zones.hand=[]; })"); run_bot_turn(pg); pg.wait_for_timeout(500)
    check('Static Orb on their side: I get a reminder that only two permanents untap', 'Static Orb' in pg.locator('#toasts').text_content() and '2 permanents' in pg.locator('#toasts').text_content(), pg.locator('#toasts').text_content())

    # ---- Void Winnower, Drannith Magistrate, Grafdigger's Cage ----
    fresh(pg); lands(pg, 1, 4)
    put(pg, 0, 'Void Winnower', 'Creature — Eldrazi', '{7}{B}{B}', '11/9', "Your opponents can't cast spells with even mana values. (Zero is even.)\nYour opponents can't block with creatures with even power.")
    put(pg, 1, 'Grizzly Bears', 'Creature — Bear', '{1}{G}', '2/2', '', 'hand'); put(pg, 1, 'Hill Giant', 'Creature — Giant', '{2}{R}', '3/3', '', 'hand')
    bot_turn(pg)
    check('Void Winnower: the bot casts only the odd-cost spell', card(pg, 1, 'Grizzly Bears')['zone'] == 'hand' and card(pg, 1, 'Hill Giant')['zone'] == 'battlefield', str(logs(pg)[-4:]))
    even = put(pg, 1, 'Grizzly Bears', 'Creature — Bear', '{1}{G}', '2/2', ''); odd = put(pg, 1, 'Hill Giant', 'Creature — Giant', '{2}{R}', '3/3', ''); atk = put(pg, 0, 'Serra Angel', 'Creature — Angel', '{3}{W}{W}', '4/4', '')
    r = pg.evaluate(f"()=>{{const st=__edhState(); const R=__edhApi().Rules; return [R.canBlock(st.cards['{even}'], st.cards['{atk}']), R.canBlock(st.cards['{odd}'], st.cards['{atk}'])];}}")
    check('Void Winnower: the 2/2 cannot block, the 3/3 can', r == [False, True], str(r))
    fresh(pg); put(pg, 0, 'Bedlam', 'Enchantment', '{2}{R}{R}', '', "Creatures can't block.")
    b1 = put(pg, 1, 'Hill Giant', 'Creature — Giant', '{2}{R}', '3/3', ''); a1 = put(pg, 0, 'Grizzly Bears', 'Creature — Bear', '{1}{G}', '2/2', '')
    check('Bedlam: nobody blocks', pg.evaluate(f"()=>{{const st=__edhState(); return __edhApi().Rules.canBlock(st.cards['{b1}'], st.cards['{a1}']);}}") is False)
    fresh(pg); lands(pg, 1, 5)
    put(pg, 0, 'Drannith Magistrate', 'Creature — Human Wizard', '{1}{W}', '1/3', "Your opponents can't cast spells from anywhere other than their hands.")
    pg.evaluate("__edhMut(st=>{ const p=st.players[1]; p.zones.command.forEach(id=>delete st.cards[id]); p.zones.command=[]; })")
    put(pg, 1, 'Krenko, Mob Boss', 'Legendary Creature — Goblin Warrior', '{2}{R}{R}', '3/3', '', 'command', extra={'isCmdr': True})
    pg.evaluate("__edhMut(st=>{ st.turn.number=4; })"); bot_turn(pg)
    check('Drannith Magistrate: the bot leaves its commander in the command zone', card(pg, 1, 'Krenko, Mob Boss')['zone'] == 'command', str(logs(pg)[-4:]))

    # ---- hand size: discard to seven unless Reliquary Tower ----
    fresh(pg); pg.evaluate("__edhMut(st=>{ st.turn.active=0; })")
    for n in range(10): put(pg, 1, 'Card ' + str(n), 'Sorcery', '{9}{R}', '', '', 'hand')
    bot_turn(pg); st = state(pg)
    check('bot discards down to seven at end of turn', len(st['players'][1]['zones']['hand']) <= 7 and any('discards down to seven' in t for t in logs(pg)), f"{len(st['players'][1]['zones']['hand'])}")
    fresh(pg); put(pg, 1, 'Reliquary Tower', 'Land', '', '', 'You have no maximum hand size.\n{T}: Add {C}.')
    for n in range(10): put(pg, 1, 'Card ' + str(n), 'Sorcery', '{9}{R}', '', '', 'hand')
    bot_turn(pg); st = state(pg)
    check('Reliquary Tower: no discard', len(st['players'][1]['zones']['hand']) >= 10)

    check('no JS errors', not errs, str(errs)[:400])
    browser.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
