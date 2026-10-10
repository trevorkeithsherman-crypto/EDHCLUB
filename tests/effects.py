"""Bots read their cards: triggers, activated abilities, statics, spells; humans get real choices + reminders."""
import sys, json, time
sys.argv = ['x', sys.argv[1]]
src = open('tests/deep.py').read().split('with sync_playwright() as p:')[0]
exec(src)
TOKEN_JSON = {'data': [{'name': 'Goblin', 'type_line': 'Token Creature — Goblin', 'power': '1', 'toughness': '1', 'artist': 'A', 'keywords': [], 'image_uris': {'normal': 'https://cards.scryfall.io/normal/tok.jpg', 'large': 'https://cards.scryfall.io/large/tok.jpg', 'art_crop': 'https://cards.scryfall.io/art/tok.jpg'}}]}
MK = """const mk=(seat,name,type,cost,pt,oracle,zone,extra={})=>{const id=(extra.id||name.replace(/[^a-z]/gi,'').slice(0,8)+Math.random().toString(36).slice(2,6)); st.cards[id]={id,name,type,cost,pt,oracle,colors:'',kw:'',img:'',big:'',art:'',backImg:'',backBig:'',artist:'',owner:seat,controller:seat,zone,tapped:false,sick:false,faceDown:false,flipped:false,p1:0,ctr:0,token:false,x:(st.players[seat].zones[zone].length%6)*.15,y:zone==='battlefield'?.3:0,isCmdr:false,casts:0,...extra}; st.players[seat].zones[zone].push(id); return id;};"""
def put(pg, seat, name, type_, cost, pt, oracle, zone='battlefield', extra=None):
    return pg.evaluate("([seat,name,type,cost,pt,oracle,zone,extra])=>{let out; __edhMut(st=>{" + MK + " out=mk(seat,name,type,cost,pt,oracle,zone,extra);}); return out;}", [seat, name, type_, cost, pt, oracle, zone, extra or {}])
def lands(pg, seat, n, name='Mountain'):
    for k in range(n): put(pg, seat, name, 'Basic Land — ' + name, '', '', '({T}: Add {R}.)')
def logs(pg): return [l['text'] for l in state(pg)['log']]
def run_bot_turn(pg, secs=45):
    t0 = time.time()
    while time.time() - t0 < secs and state(pg)['turn']['active'] != 0:
        pg.wait_for_timeout(250)
        if pg.locator('#prompt [data-act=allowAll]').count(): pg.click('#prompt [data-act=allowAll]')
        if pg.locator('#prompt [data-act=pok]').count(): pg.click('#prompt [data-act=pok]')
        if pg.locator('#payNo').count(): pg.click('#payNo')
def fresh(pg):
    pg.evaluate("__edhMut(st=>{ for (const p of st.players) { for (const z of Object.keys(p.zones)) { p.zones[z].forEach(id=>delete st.cards[id]); p.zones[z]=[]; } p.life=40; p.floating=0; } st.stack=[]; st.attacks=[]; st.turn.active=0; st.turn.phase=1; st.log=[]; })")

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(); pg, errs = setup(ctx)
    pg.route('https://api.scryfall.com/cards/search**', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(TOKEN_JSON)))
    pg.goto(BASE + '/table.html?mode=bots&seats=2&bots=1'); pg.wait_for_timeout(2500)
    pg.evaluate("__edhMut(st=>{ st.botSpeed='fast'; })")

    # ---- parser sanity ----
    r = pg.evaluate("()=>{const a=__edhApi(); return {rhystic:a.parseAbilities({oracle:'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',type:'Enchantment',zone:'battlefield'}), krenko:a.parseAbilities({oracle:'{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.',type:'Creature',zone:'battlefield'}), swords:a.parseEffects('Exile target creature. Its controller gains life equal to its power.'), cultivate:a.parseEffects('Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.')};}")
    check('parser: Rhystic Study = opponentCasts trigger with draw + tax', r['rhystic'][0]['event'] == 'opponentCasts' and any(e['k'] == 'draw' for e in r['rhystic'][0]['effects']) and any(e['k'] == 'tax' and e['n'] == 1 for e in r['rhystic'][0]['effects']), json.dumps(r['rhystic']))
    check('parser: Krenko = tap ability making X goblin tokens', r['krenko'][0]['kind'] == 'activated' and r['krenko'][0]['tap'] and r['krenko'][0]['effects'][0]['k'] == 'token' and r['krenko'][0]['effects'][0]['n'] == 'x', json.dumps(r['krenko']))
    check('parser: Swords = exile a creature', r['swords'][0]['k'] == 'exile' and r['swords'][0]['what'] == 'creature', json.dumps(r['swords']))
    check('parser: Cultivate = tutor 2 basics, one to battlefield tapped', r['cultivate'][0]['k'] == 'tutor' and r['cultivate'][0]['n'] == 2 and r['cultivate'][0]['to'] == 'battlefield' and r['cultivate'][0]['tapped'], json.dumps(r['cultivate']))

    # ---- ETB: bot casts Elvish Visionary and draws ----
    fresh(pg); lands(pg, 1, 4, 'Forest')
    for k in range(5): put(pg, 1, 'Forest', 'Basic Land — Forest', '', '', '', 'library')
    put(pg, 1, 'Elvish Visionary', 'Creature — Elf Shaman', '{1}{G}', '1/1', 'When Elvish Visionary enters, draw a card.', 'hand')
    pg.evaluate("__edhMut(st=>{ st.turn.active=1; st.turn.phase=1; })"); run_bot_turn(pg)
    st = state(pg); bf = [st['cards'][i]['name'] for i in st['players'][1]['zones']['battlefield']]
    check('bot cast Elvish Visionary', 'Elvish Visionary' in bf, str(bf))
    check('its ETB drew the bot a card (logged)', any('Elvish Visionary triggers: draw 1' in t for t in logs(pg)), str(logs(pg)[-6:]))

    # ---- Impact Tremors: creature entering pings each opponent ----
    fresh(pg); lands(pg, 1, 3)
    put(pg, 1, 'Impact Tremors', 'Enchantment', '{1}{R}', '', 'Whenever a creature you control enters, Impact Tremors deals 1 damage to each opponent.')
    put(pg, 1, 'Goblin Guide', 'Creature — Goblin Scout', '{R}', '2/2', 'Haste', 'hand')
    pg.evaluate("__edhMut(st=>{ st.turn.active=1; st.turn.phase=1; })"); run_bot_turn(pg)
    check('Impact Tremors hit me for 1 when the Goblin entered', state(pg)['players'][0]['life'] <= 39 and any('Impact Tremors triggers: 1 damage to' in t for t in logs(pg)), str(logs(pg)[-6:]))

    # ---- Blood Artist drains when a creature dies ----
    fresh(pg); pg.evaluate("__edhMut(st=>{ st.turn.active=0; })")
    put(pg, 1, 'Blood Artist', 'Creature — Vampire', '{1}{B}', '0/1', 'Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.')
    bear = put(pg, 1, 'Grizzly Bears', 'Creature — Bear', '{1}{G}', '2/2', '')
    pg.evaluate(f"()=>__edhApi().moveCard('{bear}', 1, 'graveyard')"); pg.wait_for_timeout(900); st = state(pg)
    check('Blood Artist: I lost 1 and the bot gained 1', st['players'][0]['life'] == 39 and st['players'][1]['life'] == 41, f"{st['players'][0]['life']} {st['players'][1]['life']}")

    # ---- static anthem + keyword grant (Goblin Chieftain) ----
    fresh(pg)
    put(pg, 1, 'Goblin Chieftain', 'Creature — Goblin', '{1}{R}{R}', '2/2', 'Haste\nOther Goblin creatures you control get +1/+1 and have haste.')
    g = put(pg, 1, 'Goblin Piker', 'Creature — Goblin Warrior', '{1}{R}', '2/1', '', extra={'sick': True})
    pg.wait_for_timeout(200)
    r = pg.evaluate(f"()=>{{const c=__edhState().cards['{g}']; return [c.pt, document.querySelector('.card[data-id=\"{g}\"] .cp, .card[data-id=\"{g}\"] .ptm')?.textContent]}}")
    check('Goblin Piker shows 3/2 under the Chieftain anthem', r[1] and '3/2' in r[1], str(r))
    put(pg, 1, 'Grizzly Bears', 'Creature — Bear', '{1}{G}', '2/2', '')
    r = pg.evaluate("()=>[...document.querySelectorAll('.card .cp, .card .ptm')].map(e=>e.textContent)")
    check('non-Goblin Bears stay 2/2 (anthem is Goblins only)', '2/2' in r and '3/2' in r, str(r))
    pg.evaluate("__edhMut(st=>{ st.turn.active=1; st.turn.phase=1; st.players[1].zones.hand=[]; })"); run_bot_turn(pg)
    check('summoning-sick Piker attacked anyway (haste granted by Chieftain)', any('Goblin Piker attacks' in t for t in logs(pg)), str(logs(pg)[-8:]))

    # ---- Krenko: bot taps it for tokens at end of its turn ----
    fresh(pg)
    put(pg, 1, 'Krenko, Mob Boss', 'Legendary Creature — Goblin Warrior', '{2}{R}{R}', '3/3', '{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.')
    put(pg, 1, 'Goblin Piker', 'Creature — Goblin Warrior', '{1}{R}', '2/1', '')
    pg.evaluate("__edhMut(st=>{ st.turn.active=1; st.turn.phase=1; st.players[1].zones.hand=[]; st.players[0].life=40; })"); run_bot_turn(pg)
    st = state(pg); toks = [c for c in st['cards'].values() if c['token'] and c['owner'] == 1]
    check('bot activated Krenko and made Goblin tokens (X = goblins it controls)', len(toks) >= 2 and any('activates Krenko' in t for t in logs(pg)), f"{len(toks)} {logs(pg)[-5:]}")
    check('tokens got Scryfall art', all('tok.jpg' in (t.get('img') or '') for t in toks), str([t.get('img') for t in toks]))

    # ---- Rhystic Study: human is asked to pay ----
    fresh(pg); pg.evaluate("__edhMut(st=>{ st.turn.active=0; st.turn.phase=1; })")
    put(pg, 1, 'Rhystic Study', 'Enchantment', '{2}{U}', '', "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.")
    for k in range(3): put(pg, 1, 'Island', 'Basic Land — Island', '', '', '', 'library')
    spell = put(pg, 0, 'Lightning Bolt', 'Instant', '{R}', '', 'Lightning Bolt deals 3 damage to any target.', 'hand')
    pg.locator(f'.card[data-id="{spell}"]').dblclick(); pg.wait_for_timeout(700)
    check('casting a spell asks me: Pay {1}?', pg.locator('#payYes').count() == 1 and 'Rhystic Study' in pg.locator('#modal').text_content())
    pg.click('#payNo'); pg.wait_for_timeout(600); st = state(pg)
    check("declining lets the bot draw", len(st['players'][1]['zones']['hand']) == 1 and any("didn't pay for Rhystic Study: draw 1" in t for t in logs(pg)), str(logs(pg)[-4:]))
    spell = put(pg, 0, 'Shock', 'Instant', '{R}', '', 'Shock deals 2 damage to any target.', 'hand')
    pg.locator(f'.card[data-id="{spell}"]').dblclick(); pg.wait_for_timeout(700); pg.click('#payYes'); pg.wait_for_timeout(500); st = state(pg)
    check('paying keeps the bot from drawing', len(st['players'][1]['zones']['hand']) == 1 and any('paid {1} for Rhystic Study' in t for t in logs(pg)))

    # ---- Phyrexian Arena: upkeep on the bot's turn ----
    fresh(pg); lands(pg, 1, 2)
    put(pg, 1, 'Phyrexian Arena', 'Enchantment', '{1}{B}{B}', '', 'At the beginning of your upkeep, you draw a card and you lose 1 life.')
    for k in range(3): put(pg, 1, 'Swamp', 'Basic Land — Swamp', '', '', '', 'library')
    pg.evaluate("__edhMut(st=>{ st.turn.active=0; st.turn.phase=1; })"); pg.click('[data-act=pass]'); run_bot_turn(pg); st = state(pg)
    check('Arena: bot drew an extra card and lost 1 at upkeep', st['players'][1]['life'] == 39 and any('Phyrexian Arena triggers' in t for t in logs(pg)), f"{st['players'][1]['life']} {logs(pg)[:6]}")

    # ---- Swords to Plowshares: bot exiles my best creature ----
    fresh(pg); lands(pg, 1, 2, 'Plains')
    put(pg, 0, 'Grizzly Bears', 'Creature — Bear', '{1}{G}', '2/2', '')
    big = put(pg, 0, 'Serra Angel', 'Creature — Angel', '{3}{W}{W}', '4/4', 'Flying, vigilance', extra={'kw': 'flying,vigilance'})
    put(pg, 1, 'Swords to Plowshares', 'Instant', '{W}', '', 'Exile target creature. Its controller gains life equal to its power.', 'hand')
    pg.evaluate("__edhMut(st=>{ st.turn.active=1; st.turn.phase=1; })"); run_bot_turn(pg); st = state(pg)
    check('bot Swords-ed my Serra Angel (biggest threat) into exile', st['cards'][big]['zone'] == 'exile' and any('Swords to Plowshares: exile Serra Angel' in t for t in logs(pg)), f"{st['cards'][big]['zone']} {logs(pg)[-5:]}")

    # ---- Cultivate: ramp from the library ----
    fresh(pg); lands(pg, 1, 3, 'Forest')
    for k in range(4): put(pg, 1, 'Forest', 'Basic Land — Forest', '', '', '', 'library')
    put(pg, 1, 'Cultivate', 'Sorcery', '{2}{G}', '', 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.', 'hand')
    pg.evaluate("__edhMut(st=>{ st.turn.active=1; st.turn.phase=1; })"); run_bot_turn(pg); st = state(pg)
    bf_forests = [i for i in st['players'][1]['zones']['battlefield'] if st['cards'][i]['name'] == 'Forest']
    check('Cultivate put a Forest onto the battlefield tapped and one in hand', len(bf_forests) >= 4 and any(st['cards'][i]['name'] == 'Forest' for i in st['players'][1]['zones']['hand']) and any('search for Forest, Forest' in t for t in logs(pg)), f"{len(bf_forests)} {logs(pg)[-5:]}")

    # ---- Wrath: destroy all creatures ----
    fresh(pg); lands(pg, 1, 4, 'Plains')
    a = put(pg, 0, 'Grizzly Bears', 'Creature — Bear', '{1}{G}', '2/2', ''); b = put(pg, 0, 'Hill Giant', 'Creature — Giant', '{3}{R}', '3/3', ''); c = put(pg, 0, 'Serra Angel', 'Creature — Angel', '{3}{W}{W}', '4/4', 'Flying', extra={'kw': 'flying'})
    put(pg, 1, 'Wrath of God', 'Sorcery', '{2}{W}{W}', '', "Destroy all creatures. They can't be regenerated.", 'hand')
    pg.evaluate("__edhMut(st=>{ st.turn.active=1; st.turn.phase=1; })"); run_bot_turn(pg); st = state(pg)
    check('bot cast Wrath when behind on board; my creatures hit the graveyard', all(st['cards'][i]['zone'] == 'graveyard' for i in (a, b, c)), str([st['cards'][i]['zone'] for i in (a, b, c)]))

    # ---- edict: human picks what to sacrifice ----
    fresh(pg); lands(pg, 1, 2, 'Swamp')
    a = put(pg, 0, 'Grizzly Bears', 'Creature — Bear', '{1}{G}', '2/2', ''); b = put(pg, 0, 'Serra Angel', 'Creature — Angel', '{3}{W}{W}', '4/4', 'Flying', extra={'kw': 'flying'})
    put(pg, 1, 'Innocent Blood', 'Sorcery', '{B}', '', 'Each player sacrifices a creature.', 'hand')
    pg.evaluate("__edhMut(st=>{ st.turn.active=1; st.turn.phase=1; })")
    t0 = time.time()
    while time.time() - t0 < 40 and not pg.locator('#pickGo').count():
        pg.wait_for_timeout(250)
        if pg.locator('#prompt [data-act=pok]').count(): pg.click('#prompt [data-act=pok]')
    check('Innocent Blood asks me which creature to sacrifice', pg.locator('#pickGo').count() == 1 and 'Sacrifice' in pg.locator('#modal').text_content())
    pg.click(f'[data-pick="{a}"]'); pg.click('#pickGo'); pg.wait_for_timeout(500); st = state(pg)
    check('I chose the Bears; the Angel stays', st['cards'][a]['zone'] == 'graveyard' and st['cards'][b]['zone'] == 'battlefield')
    run_bot_turn(pg)

    # ---- temp pump wears off at end of turn ----
    fresh(pg); lands(pg, 1, 2, 'Forest')
    pk = put(pg, 1, 'Goblin Piker', 'Creature — Goblin Warrior', '{1}{R}', '2/1', '')
    put(pg, 1, 'Giant Growth', 'Instant', '{G}', '', 'Target creature gets +3/+3 until end of turn.', 'hand')
    pg.evaluate("__edhMut(st=>{ st.turn.active=1; st.turn.phase=1; })"); run_bot_turn(pg); st = state(pg)
    check('Giant Growth pump is gone after the turn ends', not st['cards'][pk].get('tp') and any('+3/+3 until end of turn' in t for t in logs(pg)), f"{st['cards'][pk].get('tp')} {logs(pg)[-6:]}")

    # ---- my own triggers: reminder toast, no auto-resolve ----
    fresh(pg); pg.evaluate("__edhMut(st=>{ st.turn.active=0; st.turn.phase=1; })")
    put(pg, 0, 'Impact Tremors', 'Enchantment', '{1}{R}', '', 'Whenever a creature you control enters, Impact Tremors deals 1 damage to each opponent.')
    cr = put(pg, 0, 'Grizzly Bears', 'Creature — Bear', '{1}{G}', '2/2', '', 'hand'); pg.locator(f'.card[data-id="{cr}"]').dblclick(); pg.wait_for_timeout(900)
    check('my own Impact Tremors only reminds me (toast), bot life untouched', 'Reminder — Impact Tremors' in pg.locator('#toasts').text_content() and state(pg)['players'][1]['life'] == 40, pg.locator('#toasts').text_content())
    pg.click('#settingsBtn'); pg.wait_for_timeout(200)
    check('Settings has a Trigger reminders toggle', pg.locator('.menu .mi:has-text("Trigger reminders")').count() == 1)
    pg.locator('.menu .mi:has-text("Trigger reminders")').click(); pg.wait_for_timeout(200); check('toggle turns reminders off', state(pg)['reminders'] is False)
    pg.keyboard.press('Escape')

    check('no page errors', not errs, str(errs[:3]))
    browser.close()
print(f"\n{sum(1 for r in results if r[1])}/{len(results)} passed"); sys.exit(0 if all(r[1] for r in results) else 1)
