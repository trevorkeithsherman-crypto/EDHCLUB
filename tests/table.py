"""Table management: add/kick bots, open seats for people, change bot decks, seat count. Bots mode and rooms."""
import sys, json
sys.argv = ['x', sys.argv[1]]
src = open('tests/deep.py').read().split('with sync_playwright() as p:')[0]
exec(src)
TOP = {'decks': [{'id': 100, 'name': 'Top Deck', 'views': 1, 'owner': 'x', 'featured': '', 'colors': 'R', 'bracket': 3, 'size': 100, 'updated': '', 'tags': []}]}
DECK = {'id': 100, 'name': 'Top Deck', 'owner': 'x', 'commander': 'Krenko, Mob Boss', 'commanders': ['Krenko, Mob Boss'], 'count': 100, 'text': 'Commander\n1 Krenko, Mob Boss\n\nDeck\n1 Goblin Chieftain\n98 Mountain'}
def api(route):
    u = route.request.url
    if u.endswith('/api/top-decks'): route.fulfill(status=200, content_type='application/json', body=json.dumps(TOP))
    elif '/api/deck/' in u: route.fulfill(status=200, content_type='application/json', body=json.dumps(DECK))
    else: route.continue_()
def seats(pg): return [(p['name'], p['bot'], p.get('empty', False), p['out']) for p in state(pg)['players']]

with sync_playwright() as p:
    browser = p.chromium.launch()
    # ---------- bots mode ----------
    ctx = browser.new_context(); pg, errs = setup(ctx); pg.route('**/api/**', api)
    pg.goto(BASE + '/table.html?mode=bots'); pg.wait_for_timeout(2000)
    pg.click('#tableBtn'); pg.wait_for_timeout(300)
    check('Table modal lists four seats: you + three bots', pg.locator('.tm-row').count() == 4 and pg.locator('.tm-row.is-bot').count() == 3 and 'You' in pg.locator('.tm-row').first.text_content())
    check('bot rows offer Change deck / Random deck / Remove', pg.locator('.tm-row.is-bot [data-tm=deck]').count() == 3 and pg.locator('.tm-row.is-bot [data-tm=random]').count() == 3 and pg.locator('.tm-row.is-bot [data-tm=kick]').count() == 3)
    # remove the last bot
    pg.click('.tm-row [data-tm=kick][data-k="3"]'); pg.wait_for_timeout(500); st = state(pg)
    check('removed bot: seat sits out, no longer a bot, its cards are gone', st['players'][3]['out'] and not st['players'][3]['bot'] and not any(c['owner'] == 3 for c in st['cards'].values()))
    check('removed bot shows an Add a bot button', pg.locator('.tm-row [data-tm=add][data-k="3"]').count() == 1)
    check('table shows only two opponents now', pg.locator('.opps .avatar.bot').count() == 2)
    # add it back
    pg.click('.tm-row [data-tm=add][data-k="3"]'); pg.wait_for_timeout(800); st = state(pg)
    check('added bot: back in with a deck and a 7-card hand', st['players'][3]['bot'] and not st['players'][3]['out'] and len(st['players'][3]['zones']['hand']) == 7 and len(st['players'][3]['zones']['command']) == 1)
    # random deck swaps the commander (eventually; 4 samples, so retry a few times)
    before = state(pg)['cards'][state(pg)['players'][1]['zones']['command'][0]]['name']; changed = False
    for _ in range(6):
        pg.click('.tm-row [data-tm=random][data-k="1"]'); pg.wait_for_timeout(500)
        now = state(pg)['cards'][state(pg)['players'][1]['zones']['command'][0]]['name']
        if now != before: changed = True; break
    check('Random deck gives the bot a different commander', changed, f'{before} -> {now}')
    # change a bot's deck via the Decks modal (paste + Top 100)
    pg.click('.tm-row [data-tm=deck][data-k="2"]'); pg.wait_for_timeout(400)
    check('Change deck opens the deck modal on that bot\'s seat', pg.locator('#impSeat').count() == 1 and pg.locator('#impSeat').input_value() == '2' and not pg.locator('label[for=impSeat]').is_hidden())
    pg.click('#topToggle'); pg.wait_for_timeout(600); pg.locator('[data-top-seat]').first.click(); pg.wait_for_timeout(1500); st = state(pg)
    check('bot now plays the chosen Top 100 deck', any(c['name'] == 'Krenko, Mob Boss' and c['isCmdr'] and c['owner'] == 2 for c in st['cards'].values()) and len(st['players'][2]['zones']['hand']) == 7)
    # seat count 2 -> one bot
    pg.click('#tableBtn'); pg.wait_for_timeout(200); pg.click('[data-tm=seats][data-k="2"]'); pg.wait_for_timeout(500); st = state(pg)
    check('seat count 2: seats 3 and 4 sit out', st['seats'] == 2 and st['players'][2]['out'] and st['players'][3]['out'] and pg.locator('.tm-row').count() == 2)
    pg.click('[data-tm=seats][data-k="4"]'); pg.wait_for_timeout(500); st = state(pg)
    check('back to 4: the two seats come back as empty seats ready for bots', st['seats'] == 4 and pg.locator('.tm-row').count() == 4 and pg.locator('.tm-row [data-tm=add]').count() == 2)
    pg.keyboard.press('Escape')
    # the remaining bot still takes its turn after all that
    pg.click('[data-act=pass]'); t0 = __import__('time').time()
    while __import__('time').time() - t0 < 30 and state(pg)['turn']['active'] != 0:
        pg.wait_for_timeout(500)
        if pg.locator('#prompt [data-act=allowAll]').count(): pg.click('#prompt [data-act=allowAll]')
    check('bots still play after the reshuffle of seats', state(pg)['turn']['active'] == 0 and state(pg)['turn']['number'] == 2)
    # seat menu shortcuts
    pg.click('.opps .seat[data-seat="1"] .pname'); pg.wait_for_timeout(200)
    check('bot seat menu offers deck change and removal', pg.locator('.menu .mi:has-text("Change this bot")').count() == 1 and pg.locator('.menu .mi:has-text("Remove this bot")').count() == 1); pg.keyboard.press('Escape')
    # ---- auto playmats never collide at the start ----
    pg.goto(BASE + '/table.html?mode=bots'); pg.wait_for_timeout(1500)
    mats = pg.eval_on_selector_all('.seat[data-seat]', 'els=>els.map(e=>e.dataset.mat)')
    check('four auto mats are all different', len(set(mats)) == 4, str(mats))
    # make everyone mono-red: still four different mats, and the first seat keeps its first choice
    pg.evaluate("__edhMut(st=>{ for (const p of st.players) p.mat='auto'; Object.values(st.cards).forEach(c=>{ if (c.isCmdr) c.colors='R'; }); })"); pg.wait_for_timeout(200)
    mats = pg.eval_on_selector_all('.seat[data-seat]', 'els=>els.map(e=>e.dataset.mat)')
    by_seat = dict(zip(pg.eval_on_selector_all('.seat[data-seat]', 'els=>els.map(e=>+e.dataset.seat)'), mats))
    check('four mono-red commanders: Rakdos, Boros, Izzet, Gruul in seat order, no repeats', [by_seat[k] for k in range(4)] == ['rakdos', 'boros', 'izzet', 'gruul'], str(by_seat))
    # a hand-picked mat is respected and auto seats route around it
    pg.evaluate("__edhMut(st=>{ st.players[2].mat='rakdos'; })"); pg.wait_for_timeout(200)
    mats = dict(zip(pg.eval_on_selector_all('.seat[data-seat]', 'els=>els.map(e=>+e.dataset.seat)'), pg.eval_on_selector_all('.seat[data-seat]', 'els=>els.map(e=>e.dataset.mat)')))
    check('seat 3 picks Rakdos by hand; seat 1 auto moves to Boros so they differ', mats[2] == 'rakdos' and mats[0] == 'boros' and len(set(mats.values())) == 4, str(mats))
    pg.evaluate("__edhMut(st=>{ st.players[0].mat='rakdos'; })"); pg.wait_for_timeout(200)
    mats = dict(zip(pg.eval_on_selector_all('.seat[data-seat]', 'els=>els.map(e=>+e.dataset.seat)'), pg.eval_on_selector_all('.seat[data-seat]', 'els=>els.map(e=>e.dataset.mat)')))
    check('two players may choose the same mat on purpose', mats[0] == 'rakdos' and mats[2] == 'rakdos', str(mats))
    check('bots mode: no JS errors', not errs, str(errs)[:300])
    ctx.close()

    # ---------- room: host kicks a bot, a friend takes the seat, host adds a bot back ----------
    ctx = browser.new_context(); ctx.add_init_script(FAKE_CHANNEL_JS)
    host, he = setup(ctx); g1, e1 = setup(ctx); g2, e2 = setup(ctx)
    host.goto(BASE + '/table.html?room=TBL01&host=1&name=Host&seats=4&bots=3'); host.wait_for_timeout(2200)
    g1.goto(BASE + '/table.html?room=TBL01&name=Friend'); g1.wait_for_timeout(2600)
    check('room full of bots: a guest cannot sit (table is full)', 'full' in (g1.locator('#toasts').text_content() + g1.locator('body').text_content()).lower() or state(g1) is None or g1.locator('.me .pname').count() == 0)
    # host kicks the seat-1 bot
    host.click('#tableBtn'); host.wait_for_timeout(300); host.click('.tm-row [data-tm=kick][data-k="1"]'); host.wait_for_timeout(900)
    check('host: seat 1 is now an open seat', state(host)['players'][1]['empty'] and not state(host)['players'][1]['bot'] and 'Waiting' in host.locator('.seat[data-seat="1"]').text_content())
    check('room bar now counts 1/2 humans', '1/2' in host.locator('#roomBar').text_content(), host.locator('#roomBar').text_content())
    host.keyboard.press('Escape')
    g1.goto(BASE + '/table.html?room=TBL01&name=Friend'); g1.wait_for_timeout(3000)
    check('friend takes the opened seat 1', state(g1)['view'] == 1 and 'Friend' in g1.locator('.me .pname').text_content())
    check('host sees the friend in seat 1 with 7 cards', 'Friend' in host.locator('.seat[data-seat="1"] .pname').text_content() and not state(host)['players'][1]['bot'] and len(state(host)['players'][1]['zones']['hand']) == 7)
    check('friend sees seats 2 and 3 as bots owned by the host', state(g1)['players'][2]['bot'] and state(g1)['players'][3]['bot'] and g1.locator('.opps .avatar.bot').count() == 2)
    # host changes bot 2's deck; friend sees the new commander
    host.click('#tableBtn'); host.wait_for_timeout(200); host.click('.tm-row [data-tm=random][data-k="2"]'); host.wait_for_timeout(1500)
    hc = state(host)['cards'][state(host)['players'][2]['zones']['command'][0]]['name']; gc = state(g1)['cards'][state(g1)['players'][2]['zones']['command'][0]]['name']
    check('bot deck change syncs to the friend', hc == gc, f'{hc} vs {gc}')
    host.keyboard.press('Escape')
    # host kicks bot 3; a second friend joins; then host removes that friend
    host.click('#tableBtn'); host.wait_for_timeout(200); host.click('.tm-row [data-tm=kick][data-k="3"]'); host.wait_for_timeout(900); host.keyboard.press('Escape')
    g2.goto(BASE + '/table.html?room=TBL01&name=Second'); g2.wait_for_timeout(3000)
    check('second friend takes seat 3', state(g2)['view'] == 3)
    check('friend 1 sees friend 2 arrive (not a bot, not open)', not state(g1)['players'][3]['bot'] and not state(g1)['players'][3]['empty'] and 'Second' in g1.locator('.seat[data-seat="3"] .pname').text_content())
    host.click('#tableBtn'); host.wait_for_timeout(200); host.click('.tm-row [data-tm=kickh][data-k="3"]'); host.wait_for_timeout(200); host.click('#okBtn'); g2.wait_for_timeout(2500)
    check('removed player is sent back to the lobby', g2.url.rstrip('/') == BASE.rstrip('/') or 'table.html' not in g2.url)
    host.wait_for_timeout(1500); host.keyboard.press('Escape'); host.wait_for_timeout(200)
    check('host: seat 3 is open again after the kick', state(host)['players'][3]['empty'] and not state(host)['players'][3]['bot'])
    # host adds a bot into the open seat 3
    host.click('#tableBtn'); host.wait_for_timeout(200); host.click('.tm-row [data-tm=add][data-k="3"]'); host.wait_for_timeout(1500); host.keyboard.press('Escape')
    check('host added a bot to seat 3', state(host)['players'][3]['bot'] and len(state(host)['players'][3]['zones']['hand']) == 7)
    check('friend sees the new bot', state(g1)['players'][3]['bot'] and g1.locator('.seat[data-seat="3"] .avatar.bot').count() == 1)
    # the guest cannot manage the table
    g1.click('#tableBtn'); g1.wait_for_timeout(300); check('guests get a polite no on the Table button', 'Only the host' in g1.locator('#toasts').text_content() and g1.locator('.tm-row').count() == 0)
    # turn order survives: host passes, friend gets the turn, bots after
    host.click('[data-act=pass]'); g1.wait_for_timeout(1500); check('turn passes host -> friend in seat 1', state(g1)['turn']['active'] == 1)
    check('room: no JS errors', not he and not e1 and not e2, str(he + e1 + e2)[:300])
    ctx.close(); browser.close()

fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
