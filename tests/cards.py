"""Real cards, real oracle text: does each mechanic do what the card says when a bot plays it, and does the table
keep the state right? Equipment, auras, crew, ward, prowess, sagas, planeswalkers, cascade, steal, explore,
proliferate, landfall, ETB damage, once-per-combat triggers, -1/-1 counters + state-based actions, class levels,
impulse draw, optional payments, graveyard exile, lifegain triggers."""
import sys, json, time
sys.argv = ['x', sys.argv[1]]
exec(open('tests/effects.py').read().split('with sync_playwright() as p:\n')[0].replace("sys.argv = ['x', sys.argv[1]]", ''))
sys.path.insert(0, 'tests'); import realcards
def real(pg, seat, name, zone='battlefield', extra=None):
    """Put a real card (by name) into a zone; oracle/type/pt/kw come from the card database."""
    cid = put(pg, seat, name, 'Creature', '', '', '', zone, extra or {})
    pg.evaluate("()=>__edhApi().ensureArt(__edhApi().allNames(), {quiet:true})"); pg.wait_for_timeout(350)
    return cid
def bot_turn(pg): pg.evaluate("__edhMut(st=>{ st.turn.active=1; st.turn.phase=1; })"); run_bot_turn(pg)
def card(pg, seat, name): st = state(pg); return next((c for c in st['cards'].values() if c['owner'] == seat and c['name'] == name), None)
def zone_names(pg, seat, zone): st = state(pg); return [st['cards'][i]['name'] for i in st['players'][seat]['zones'][zone]]
with sync_playwright() as p:
    browser = p.chromium.launch(); ctx = browser.new_context(); pg, errs = setup(ctx)
    pg.unroute('https://api.scryfall.com/**'); pg.route('https://api.scryfall.com/**', realcards.scry_route)
    pg.goto(BASE + '/table.html?mode=bots&seats=2&bots=1'); pg.wait_for_timeout(2500)
    pg.evaluate("__edhMut(st=>{ st.botSpeed='fast'; st.reminders=false; })")

    # ---- Equipment: Bonesplitter ----
    fresh(pg); lands(pg, 1, 2); real(pg, 1, 'Bonesplitter'); b = real(pg, 1, 'Grizzly Bears')
    pg.evaluate("__edhMut(st=>{ st.players[0].life=40; st.players[1].zones.hand=[]; })"); bot_turn(pg); st = state(pg)
    bs = card(pg, 1, 'Bonesplitter')
    check('Bonesplitter: bot pays equip {1} and attaches it to the Bears', bs['attachedTo'] == b and any('equips Grizzly Bears with Bonesplitter' in t for t in logs(pg)), str(logs(pg)[-6:]))
    check('…and the Bears hit as a 4/2', st['players'][0]['life'] == 36 and any('Grizzly Bears dealt 4 damage' in t for t in logs(pg)), f"{st['players'][0]['life']} {logs(pg)[-5:]}")
    pg.evaluate(f"()=>__edhApi().moveCard('{b}', 1, 'graveyard')"); pg.wait_for_timeout(300)
    check('equipment stays when its creature dies, unattached', card(pg, 1, 'Bonesplitter')['zone'] == 'battlefield' and not card(pg, 1, 'Bonesplitter')['attachedTo'])

    # ---- Aura: Pacifism on my best creature; aura dies with the creature ----
    fresh(pg); lands(pg, 1, 2, 'Plains'); real(pg, 1, 'Pacifism', 'hand'); angel = real(pg, 0, 'Serra Angel'); real(pg, 0, 'Grizzly Bears')
    pg.evaluate("__edhMut(st=>{ st.players[1].zones.hand=st.players[1].zones.hand.filter(id=>st.cards[id].name==='Pacifism'); })"); bot_turn(pg); st = state(pg)
    pac = card(pg, 1, 'Pacifism')
    check('Pacifism: bot enchants my Serra Angel (the biggest threat)', pac and pac['zone'] == 'battlefield' and pac['attachedTo'] == angel, str(logs(pg)[-5:]))
    r = pg.evaluate(f"()=>__edhApi().Rules.canAttack(__edhState().cards['{angel}'])")
    check("…and the Angel can't attack (menu says so)", r['ok'] is False and "Can't attack" in r['why'], str(r))
    pg.evaluate(f"()=>__edhApi().moveCard('{angel}', 0, 'graveyard')"); pg.wait_for_timeout(400)
    check('when the Angel leaves, Pacifism goes to the graveyard', card(pg, 1, 'Pacifism')['zone'] == 'graveyard')
    # a human can attach by clicking
    pg.evaluate("__edhMut(st=>{ st.turn.active=0; st.turn.phase=1; })"); eq = real(pg, 0, 'Bonesplitter'); mine = real(pg, 0, 'Grizzly Bears')
    pg.locator(f'.card[data-id="{eq}"]').click(button='right'); pg.wait_for_timeout(150); pg.locator('.menu .mi:has-text("Attach to a creature")').click(); pg.wait_for_timeout(200)
    pg.locator(f'.card[data-id="{mine}"]').click(); pg.wait_for_timeout(300)
    check('human: Attach to a creature… then click the creature', state(pg)['cards'][eq].get('attachedTo') == mine and '4/2' in pg.locator(f'.card[data-id="{mine}"]').text_content())

    # ---- Vehicle: Smuggler's Copter crewed by a 1-power creature ----
    fresh(pg); real(pg, 1, "Smuggler's Copter"); pk = real(pg, 1, 'Goblin Piker'); real(pg, 1, 'Hill Giant')
    pg.evaluate("__edhMut(st=>{ st.players[0].life=40; st.players[1].zones.hand=[]; })"); bot_turn(pg); st = state(pg)
    check("Copter: crewed with the Piker and attacks for 3 in the air", any('crews Smuggler' in t and 'Goblin Piker' in t for t in logs(pg)) and any("Smuggler's Copter attacks" in t for t in logs(pg)), str(logs(pg)[-8:]))
    check('crew wears off at end of turn', not card(pg, 1, "Smuggler's Copter").get('anim'))

    # ---- Ward: bot removal skips a warded creature it can't pay for ----
    fresh(pg); lands(pg, 1, 1, 'Plains'); w = real(pg, 0, 'Hulking Raptor'); small = real(pg, 0, 'Grizzly Bears')
    real(pg, 1, 'Swords to Plowshares', 'hand'); pg.evaluate("__edhMut(st=>{ st.players[1].zones.hand=st.players[1].zones.hand.filter(id=>st.cards[id].name==='Swords to Plowshares'); })"); bot_turn(pg); st = state(pg)
    check("Ward {2}: with one land the bot can't pay, so Swords hits the Bears instead of the 5/3 Raptor", st['cards'][small]['zone'] == 'exile' and st['cards'][w]['zone'] == 'battlefield', str(logs(pg)[-4:]))
    fresh(pg); lands(pg, 1, 4, 'Plains'); w = real(pg, 0, 'Hulking Raptor'); real(pg, 0, 'Grizzly Bears')
    real(pg, 1, 'Swords to Plowshares', 'hand'); pg.evaluate("__edhMut(st=>{ st.players[1].zones.hand=st.players[1].zones.hand.filter(id=>st.cards[id].name==='Swords to Plowshares'); })"); bot_turn(pg); st = state(pg)
    check('with four lands it pays the ward and exiles the Raptor', st['cards'][w]['zone'] == 'exile' and any('pays {2} for ward on Hulking Raptor' in t for t in logs(pg)), str(logs(pg)[-5:]))

    # ---- Prowess ----
    fresh(pg); lands(pg, 1, 2); sw = real(pg, 1, 'Monastery Swiftspear'); put(pg, 1, 'Sigil of Ember', 'Enchantment', '{R}', '', '', 'hand')
    pg.evaluate("__edhMut(st=>{ st.players[0].life=40; })")
    put(pg, 0, 'Serra Angel', 'Creature — Angel', '{3}{W}{W}', '4/4', 'Flying', extra={'kw': 'flying'})
    pg.evaluate("__edhMut(st=>{ st.turn.active=1; st.turn.phase=1; })")
    t0 = time.time(); seen = False
    while time.time() - t0 < 30 and state(pg)['turn']['active'] == 1:
        pg.wait_for_timeout(200); c = state(pg)['cards'].get(sw)
        if c and c.get('tp'): seen = True
        if pg.locator('#prompt [data-act=allowAll]').count(): pg.click('#prompt [data-act=allowAll]')
        if pg.locator('#prompt [data-act=pok]').count(): pg.click('#prompt [data-act=pok]')
    check('Prowess: Swiftspear got +1/+1 when the bot cast a noncreature spell, gone by end of turn', seen and not state(pg)['cards'][sw].get('tp') and any('Monastery Swiftspear triggers: +1/+1' in t for t in logs(pg)), str(logs(pg)[-6:]))

    # ---- Saga: The Eldest Reborn ----
    fresh(pg); lands(pg, 1, 5, 'Swamp'); real(pg, 1, 'The Eldest Reborn', 'hand'); pg.evaluate("__edhMut(st=>{ st.players[1].zones.hand=st.players[1].zones.hand.filter(id=>st.cards[id].name==='The Eldest Reborn'); })")
    a1 = real(pg, 0, 'Grizzly Bears'); real(pg, 0, 'Hill Giant', 'hand'); real(pg, 1, 'Serra Angel', 'graveyard')
    pg.evaluate("__edhMut(st=>{ st.turn.active=1; st.turn.phase=1; })")
    t0 = time.time()
    while time.time() - t0 < 40 and not pg.locator('#pickGo').count():
        pg.wait_for_timeout(200)
        if pg.locator('#prompt [data-act=pok]').count(): pg.click('#prompt [data-act=pok]')
    check('Eldest Reborn I: I am asked to sacrifice a creature', pg.locator('#pickGo').count() == 1 and card(pg, 1, 'The Eldest Reborn')['ctr'] == 1)
    pg.click(f'[data-pick="{a1}"]'); pg.click('#pickGo'); run_bot_turn(pg)
    pg.click('[data-act=pass]'); t0 = time.time()
    while time.time() - t0 < 40 and not pg.locator('#pickGo').count():
        pg.wait_for_timeout(200)
        if pg.locator('#prompt [data-act=pok]').count(): pg.click('#prompt [data-act=pok]')
    check('Eldest Reborn II (next turn): I am asked to discard', pg.locator('#pickGo').count() == 1 and 'Discard' in pg.locator('#modal').text_content() and card(pg, 1, 'The Eldest Reborn')['ctr'] == 2)
    pg.evaluate("()=>{document.querySelector('[data-pick]').click(); document.querySelector('#pickGo').click();}"); run_bot_turn(pg); pg.click('[data-act=pass]'); run_bot_turn(pg); st = state(pg)
    check('Eldest Reborn III: Serra Angel comes back, then the Saga is sacrificed', card(pg, 1, 'Serra Angel')['zone'] == 'battlefield' and card(pg, 1, 'The Eldest Reborn')['zone'] == 'graveyard', str([t for t in logs(pg) if 'Eldest' in t][-4:]))

    # ---- Planeswalker: Chandra, Torch of Defiance ----
    fresh(pg); lands(pg, 1, 4); real(pg, 1, 'Chandra, Torch of Defiance', 'hand'); pg.evaluate("__edhMut(st=>{ st.players[1].zones.hand=st.players[1].zones.hand.filter(id=>st.cards[id].name==='Chandra, Torch of Defiance'); st.players[0].life=40; })")
    ang = real(pg, 0, 'Serra Angel'); bot_turn(pg); st = state(pg); ch = card(pg, 1, 'Chandra, Torch of Defiance')
    check('Chandra enters with 4 loyalty and uses −3 on my Serra Angel', ch and ch['ctr'] == 1 and st['cards'][ang]['zone'] == 'graveyard' and any('activates Chandra, Torch of Defiance (-3, loyalty 1)' in t for t in logs(pg)), f"{ch and ch['ctr']} {logs(pg)[-5:]}")
    pg.evaluate("__edhMut(st=>{ st.players[1].zones.hand=[]; })"); pg.click('[data-act=pass]'); run_bot_turn(pg); ch = card(pg, 1, 'Chandra, Torch of Defiance')
    check('next turn she uses a +1 (loyalty 2) and pings each opponent for 2 if the exiled card is not cast', ch['ctr'] == 2, f"{ch['ctr']} {logs(pg)[-6:]}")

    # ---- Cascade: Bloodbraid Elf ----
    fresh(pg); lands(pg, 1, 2); lands(pg, 1, 2, 'Forest'); real(pg, 1, 'Bloodbraid Elf', 'hand'); pg.evaluate("__edhMut(st=>{ st.players[1].zones.hand=st.players[1].zones.hand.filter(id=>st.cards[id].name==='Bloodbraid Elf'); st.players[0].life=40; })")
    bolt = real(pg, 1, 'Lightning Bolt', 'library'); pg.evaluate(f"__edhMut(st=>{{ const l=st.players[1].zones.library; l.splice(l.indexOf('{bolt}'),1); l.unshift('{bolt}'); }})")
    bot_turn(pg); st = state(pg)
    check('Bloodbraid Elf cascades into Lightning Bolt for free; it hits me for 3', any('casts Lightning Bolt for free (Bloodbraid Elf' in t for t in logs(pg)) and st['players'][0]['life'] <= 37, f"{st['players'][0]['life']} {logs(pg)[-6:]}")

    # ---- Act of Treason: steal, swing, give back ----
    fresh(pg); lands(pg, 1, 3); real(pg, 1, 'Act of Treason', 'hand'); pg.evaluate("__edhMut(st=>{ st.players[1].zones.hand=st.players[1].zones.hand.filter(id=>st.cards[id].name==='Act of Treason'); st.players[0].life=40; })")
    ang = real(pg, 0, 'Serra Angel'); bot_turn(pg); st = state(pg)
    check('Act of Treason: the bot took my Angel, attacked me with it, and gave it back at end of turn', st['cards'][ang]['controller'] == 0 and ang in st['players'][0]['zones']['battlefield'] and any('Serra Angel attacks Planeswalker' in t for t in logs(pg)) and any('Serra Angel returns to Planeswalker' in t for t in logs(pg)), str(logs(pg)[-8:]))

    # ---- Explore ----
    fresh(pg); lands(pg, 1, 2, 'Forest'); real(pg, 1, 'Merfolk Branchwalker', 'hand'); pg.evaluate("__edhMut(st=>{ st.players[1].zones.hand=st.players[1].zones.hand.filter(id=>st.cards[id].name==='Merfolk Branchwalker'); st.players[1].zones.library=[]; })")
    put(pg, 1, 'Serra Angel', 'Creature — Angel', '{3}{W}{W}', '4/4', '', 'library'); bot_turn(pg); mb = card(pg, 1, 'Merfolk Branchwalker')
    check('Explore with a nonland on top: +1/+1 counter, card stays', mb['p1'] == 1 and zone_names(pg, 1, 'library') == ['Serra Angel'], str(logs(pg)[-4:]))
    fresh(pg); lands(pg, 1, 2, 'Forest'); real(pg, 1, 'Merfolk Branchwalker', 'hand'); pg.evaluate("__edhMut(st=>{ st.players[1].zones.hand=st.players[1].zones.hand.filter(id=>st.cards[id].name==='Merfolk Branchwalker'); st.players[1].zones.library=[]; })")
    put(pg, 1, 'Forest', 'Basic Land — Forest', '', '', '', 'library'); bot_turn(pg); mb = card(pg, 1, 'Merfolk Branchwalker')
    check('Explore with a land on top: the land goes to hand, no counter', not mb['p1'] and 'Forest' in zone_names(pg, 1, 'hand'))

    # ---- Landfall + proliferate (Evolution Sage) ----
    fresh(pg); real(pg, 1, 'Evolution Sage'); g = put(pg, 1, 'Grizzly Bears', 'Creature — Bear', '{1}{G}', '2/2', '', extra={'p1': 1}); put(pg, 1, 'Forest', 'Basic Land — Forest', '', '', '', 'hand')
    bot_turn(pg); check('Evolution Sage: landfall → proliferate adds a second +1/+1 counter', state(pg)['cards'][g]['p1'] == 2, str(logs(pg)[-5:]))

    # ---- ETB damage to opponents and their creatures (Goblin Chainwhirler) ----
    fresh(pg); lands(pg, 1, 3); real(pg, 1, 'Goblin Chainwhirler', 'hand'); pg.evaluate("__edhMut(st=>{ st.players[1].zones.hand=st.players[1].zones.hand.filter(id=>st.cards[id].name==='Goblin Chainwhirler'); st.players[0].life=40; })")
    x1 = put(pg, 0, 'Goblin Piker', 'Creature — Goblin', '{1}{R}', '2/1', ''); bot_turn(pg); st = state(pg)
    check("Chainwhirler: I take 1 and my 2/1 dies; the bot's own creatures are untouched", st['players'][0]['life'] == 39 and st['cards'][x1]['zone'] == 'graveyard' and card(pg, 1, 'Goblin Chainwhirler')['zone'] == 'battlefield', f"{st['players'][0]['life']} {logs(pg)[-5:]}")

    # ---- once per combat (Rabble Rousing) ----
    fresh(pg); real(pg, 1, 'Rabble Rousing'); real(pg, 1, 'Hill Giant'); real(pg, 1, 'Grizzly Bears')
    pg.evaluate("__edhMut(st=>{ st.players[1].zones.hand=[]; st.players[0].life=40; })"); bot_turn(pg); st = state(pg)
    toks = [c for c in st['cards'].values() if c['token'] and c['owner'] == 1 and c['name'] == 'Citizen']
    check('Rabble Rousing: attacking with two creatures makes exactly two Citizens (one trigger)', len(toks) == 2, f"{len(toks)} {logs(pg)[-6:]}")

    # ---- -1/-1 counters and state-based actions (Grim Affliction) ----
    fresh(pg); lands(pg, 1, 3, 'Swamp'); real(pg, 1, 'Grim Affliction', 'hand'); pg.evaluate("__edhMut(st=>{ st.players[1].zones.hand=st.players[1].zones.hand.filter(id=>st.cards[id].name==='Grim Affliction'); })")
    x1 = put(pg, 0, 'Goblin Piker', 'Creature — Goblin', '{1}{R}', '1/1', ''); bot_turn(pg); pg.wait_for_timeout(800)
    check('Grim Affliction: -1/-1 counter kills my 1/1 (state-based action)', state(pg)['cards'][x1]['zone'] == 'graveyard', str(logs(pg)[-5:]))

    # ---- Class levels (Wizard Class) ----
    fresh(pg); lands(pg, 1, 2, 'Island'); real(pg, 1, 'Wizard Class'); g = real(pg, 1, 'Grizzly Bears'); pg.evaluate("__edhMut(st=>{ st.players[1].zones.hand=[]; })")
    for k in range(3): put(pg, 1, 'Island', 'Basic Land — Island', '', '', '', 'library')
    bot_turn(pg)
    check('Wizard Class at level 1: drawing does not add counters', not state(pg)['cards'][g]['p1'] and not any('Wizard Class triggers' in t for t in logs(pg)), str(logs(pg)[-6:]))
    fresh(pg); lands(pg, 1, 6, 'Island'); real(pg, 1, 'Wizard Class'); pg.evaluate("__edhMut(st=>{ st.players[1].zones.hand=[]; })")
    for k in range(5): put(pg, 1, 'Island', 'Basic Land — Island', '', '', '', 'library')
    bot_turn(pg); wc = card(pg, 1, 'Wizard Class')
    check('with spare mana the bot levels Wizard Class to 2 and draws two', wc['ctr'] == 2 and any('levels Wizard Class up to 2' in t for t in logs(pg)) and any('Wizard Class triggers: draw 2' in t for t in logs(pg)), f"{wc['ctr']} {logs(pg)[-6:]}")

    # ---- Impulse draw (Light Up the Stage) ----
    fresh(pg); lands(pg, 1, 4); real(pg, 1, 'Light Up the Stage', 'hand'); pg.evaluate("__edhMut(st=>{ st.players[1].zones.hand=st.players[1].zones.hand.filter(id=>st.cards[id].name==='Light Up the Stage'); st.players[1].zones.library=[]; })")
    put(pg, 1, 'Goblin Piker', 'Creature — Goblin', '{1}{R}', '2/1', '', 'library'); put(pg, 1, 'Mountain', 'Basic Land — Mountain', '', '', '', 'library'); bot_turn(pg)
    check('Light Up the Stage: exiles two and plays one of them', any('exile 2, play' in t for t in logs(pg)), str(logs(pg)[-5:]))

    # ---- Optional payment: Leshrac's Sigil ----
    fresh(pg); lands(pg, 1, 2, 'Swamp'); real(pg, 1, "Leshrac's Sigil"); pg.evaluate("__edhMut(st=>{ st.turn.active=0; st.turn.phase=1; })")
    real(pg, 0, 'Hill Giant', 'hand'); gs = put(pg, 0, 'Giant Growth', 'Instant', '{G}', '', 'Target creature gets +3/+3 until end of turn.', 'hand', extra={'colors': 'G'})
    pg.locator(f'.card[data-id="{gs}"]').dblclick(); pg.wait_for_timeout(900)
    check("Leshrac's Sigil: bot pays {B}{B} and I'm asked to discard", pg.locator('#pickGo').count() == 1 and any("Leshrac's Sigil triggers: pays {2}" in t for t in logs(pg)), str(logs(pg)[-4:]))
    pg.evaluate("()=>{document.querySelector('[data-pick]').click(); document.querySelector('#pickGo').click();}"); pg.wait_for_timeout(300)

    # ---- Bojuka Bog ----
    fresh(pg); real(pg, 1, 'Bojuka Bog', 'hand'); pg.evaluate("__edhMut(st=>{ st.players[1].zones.hand=st.players[1].zones.hand.filter(id=>st.cards[id].name==='Bojuka Bog'); })")
    for n in ['Hill Giant', 'Grizzly Bears']: real(pg, 0, n, 'graveyard')
    bot_turn(pg); st = state(pg)
    check('Bojuka Bog: enters tapped and exiles my graveyard', card(pg, 1, 'Bojuka Bog')['tapped'] and len(st['players'][0]['zones']['graveyard']) == 0 and len(st['players'][0]['zones']['exile']) == 2, str(logs(pg)[-4:]))

    # ---- Lifegain trigger (Ajani's Pridemate + Gift of Paradise) ----
    fresh(pg); lands(pg, 1, 3, 'Forest'); pm = real(pg, 1, "Ajani's Pridemate"); real(pg, 1, 'Gift of Paradise', 'hand'); pg.evaluate("__edhMut(st=>{ st.players[1].zones.hand=st.players[1].zones.hand.filter(id=>st.cards[id].name==='Gift of Paradise'); st.players[1].life=40; })")
    bot_turn(pg); st = state(pg)
    check("Gift of Paradise gains 3; Ajani's Pridemate grows", st['players'][1]['life'] == 43 and st['cards'][pm]['p1'] == 1, f"{st['players'][1]['life']} {st['cards'][pm]['p1']} {logs(pg)[-5:]}")

    # ---- Krenko X tokens + Steel Overseer tap ----
    fresh(pg); real(pg, 1, 'Steel Overseer'); so = card(pg, 1, 'Steel Overseer')['id']; real(pg, 1, 'Grizzly Bears'); pg.evaluate("__edhMut(st=>{ st.players[1].zones.hand=[]; })"); bot_turn(pg)
    check('Steel Overseer taps to put +1/+1 counters on artifact creatures (itself)', state(pg)['cards'][so]['p1'] >= 1, str(logs(pg)[-5:]))

    check('no JS errors', not errs, str(errs)[:400])
    browser.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
