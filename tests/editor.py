"""Deck editor: in-editor card search (Scryfall, filtered to the commander's colors) that adds to the list, and the
Stats tab (curve, pips, types, price, identity/legality checks, playtest hand). Run: python3 tests/editor.py <port>"""
import sys, json, urllib.parse
sys.argv = ['x', sys.argv[1]]
exec(open('tests/mydecks.py').read().split('def setupd(ctx):')[0].replace("sys.argv = ['x', sys.argv[1]]", ''))
def setupd(ctx):
    pg, errs = setup(ctx); pg.unroute('https://*.supabase.co/**'); pg.route('https://*.supabase.co/**', decks_mock); return pg, errs
def card(name, cost, tl, ci, cmc, usd, legal='legal', power=None):
    o = {'object': 'card', 'id': 'id-' + name.lower().replace(' ', '-'), 'name': name, 'mana_cost': cost, 'type_line': tl, 'oracle_text': 'Does things.', 'colors': [c for c in ci], 'color_identity': [c for c in ci], 'cmc': cmc, 'keywords': [], 'artist': 'A', 'set': 'tst', 'collector_number': '1',
         'prices': {'usd': usd}, 'legalities': {'commander': legal}, 'image_uris': {'normal': 'https://cards.scryfall.io/normal/x.jpg', 'large': 'https://cards.scryfall.io/large/x.jpg', 'art_crop': 'https://cards.scryfall.io/art/x.jpg'}}
    if power is not None: o['power'] = str(power); o['toughness'] = str(power)
    return o
DB = {c['name']: c for c in [
    card('Krenko, Mob Boss', '{2}{R}{R}', 'Legendary Creature — Goblin Warrior', 'R', 4, '3.50', power=3),
    card('Goblin Chieftain', '{1}{R}{R}', 'Creature — Goblin', 'R', 3, '1.20', power=2), card('Lightning Bolt', '{R}', 'Instant', 'R', 1, '1.00'),
    card('Sol Ring', '{1}', 'Artifact', '', 1, '2.00'), card('Mountain', '', 'Basic Land — Mountain', '', 0, '0.10'),
    card('Skullclamp', '{1}', 'Artifact — Equipment', '', 1, '4.00'), card('Counterspell', '{U}{U}', 'Instant', 'U', 2, '0.80'),
    card('Goblin Guide', '{R}', 'Creature — Goblin Scout', 'R', 1, '0.90', power=2), card('Goblin King', '{1}{R}{R}', 'Creature — Goblin', 'R', 3, '0.50', power=2),
    card('Griselbrand', '{4}{B}{B}{B}{B}', 'Legendary Creature — Demon', 'B', 8, '9.00', legal='banned', power=7),
]}
SEARCHES = []
def scry(route):
    u = route.request.url; req = route.request
    if req.method == 'POST' and req.post_data:
        body = json.loads(req.post_data); data = []; nf = []
        for i in body.get('identifiers', []):
            n = i.get('name'); c = DB.get(n)
            if c: data.append(c)
            else: nf.append(i)
        route.fulfill(status=200, content_type='application/json', body=json.dumps({'data': data, 'not_found': nf})); return
    if '/cards/search' in u:
        q = urllib.parse.unquote(urllib.parse.urlparse(u).query); SEARCHES.append(q)
        import re
        m = re.search(r'name:"([^"]+)"', q); term = (m.group(1) if m else '').lower()
        idm = re.search(r'id<=([WUBRGC]+)', q); ident = set(idm.group(1)) if idm else None
        data = [c for c in DB.values() if term in c['name'].lower() and (ident is None or set(c['color_identity']) <= ident)]
        if not data: route.fulfill(status=404, content_type='application/json', body=json.dumps({'object': 'error', 'code': 'not_found'})); return
        route.fulfill(status=200, content_type='application/json', body=json.dumps({'data': data, 'has_more': False})); return
    route.fulfill(status=404, content_type='application/json', body=json.dumps({'object': 'error', 'code': 'not_found', 'data': []}))
with sync_playwright() as p:
    browser = p.chromium.launch(); ctx = browser.new_context(); pg, errs = setupd(ctx)
    pg.unroute('https://api.scryfall.com/**'); pg.route('https://api.scryfall.com/**', scry)
    pg.goto(BASE + '/'); pg.wait_for_timeout(600); pg.click('[data-go="signin"]'); pg.wait_for_timeout(200); pg.click('.tab:has-text("guest")'); pg.wait_for_timeout(150); pg.click('#guest'); pg.wait_for_timeout(1200)
    pg.goto(BASE + '/decks.html'); pg.wait_for_timeout(1000); pg.click('#newDeck'); pg.wait_for_timeout(300)
    pg.fill('#edList', 'Commander\n1 Krenko, Mob Boss\n\nDeck\n1 Goblin Chieftain\n1 Lightning Bolt\n1 Sol Ring\n1 Griselbrand\n1 Counterspell\n30 Mountain'); pg.wait_for_timeout(800)
    check('editor has Cards / List / Stats tabs', pg.locator('[data-ed=stats]').count() == 1 and pg.locator('[data-ed=art]').count() == 1)
    # ---- add cards ----
    pg.click('[data-ed=art]'); pg.wait_for_timeout(600)
    check('Cards tab has an Add a card search with a My colors toggle on', pg.locator('#edAddQ').is_visible() and pg.locator('#edAddId').is_checked())
    pg.fill('#edAddQ', 'goblin'); pg.wait_for_timeout(900)
    rows = pg.locator('.addrow').all_text_contents()
    check('typing searches Scryfall inside the commander\'s identity (id<=R) and lists matches with type, cost and price', len(SEARCHES) >= 1 and 'id<=R' in SEARCHES[-1] and 'f:commander' in SEARCHES[-1] and any('Goblin Guide' in r for r in rows) and any('$0.90' in r for r in rows), f'{SEARCHES[-1:]} {rows[:2]}')
    check('cards already in the deck are marked', any('in deck ×1' in r for r in rows if 'Goblin Chieftain' in r))
    before = pg.locator('#edList').input_value()
    pg.locator('.addrow:has-text("Goblin Guide") [data-add]').click(); pg.wait_for_timeout(500)
    after = pg.locator('#edList').input_value()
    check('+ Add puts "1 Goblin Guide" into the Deck section of the list', '1 Goblin Guide' in after and after.index('1 Goblin Guide') > after.index('Deck') and 'Added Goblin Guide' in pg.locator('#toasts').text_content(), after[:200])
    pg.locator('.addrow:has-text("Goblin Chieftain") [data-add]').click(); pg.wait_for_timeout(400)
    check('adding a card already in the list bumps its count', '2 Goblin Chieftain' in pg.locator('#edList').input_value())
    pg.fill('#edAddQ', 'counterspell'); pg.wait_for_timeout(900)
    check('a blue card is hidden while My colors is on', 'No cards match' in pg.locator('#edAddRes').text_content() and 'untick' in pg.locator('#edAddRes').text_content())
    pg.uncheck('#edAddId'); pg.wait_for_timeout(900)
    check('…and appears once My colors is off (query drops id<=)', 'Counterspell' in pg.locator('#edAddRes').text_content() and 'id<=' not in SEARCHES[-1])
    pg.fill('#edAddQ', 't:goblin'); pg.wait_for_timeout(900)
    check('Scryfall syntax is passed through untouched', 'q=t:goblin f:commander' in SEARCHES[-1], SEARCHES[-1])
    # ---- stats ----
    pg.click('[data-ed=stats]'); pg.wait_for_timeout(1200)
    s = pg.locator('#edStats').text_content()
    check('Stats: mana curve, color pips, types and price render', pg.locator('.curve .bar').count() == 8 and pg.locator('.pipbar').count() >= 2 and 'Creature' in s and 'Land' in s and 'Price' in s)
    bars = [t.strip() for t in pg.locator('.curve .bar b').all_text_contents()]
    check('curve counts nonland cards by mana value (1-drops: Bolt, Sol Ring, Guide; 3-drops: 2 Chieftain; 4: Krenko; 7+: Griselbrand)', bars[1] == '3' and bars[3] == '2' and bars[4] == '1' and bars[7] == '1' and bars[0] == '', str(bars))
    check('land count and spells', '30 lands' in s and '/ ' in s)
    price = pg.locator('.stat .big').text_content()
    check('price sums Scryfall USD × count', price.startswith('$') and 20 <= float(price[1:]) <= 30, price)
    checks = pg.locator('.checks li').all_text_contents()
    check('checks flag the off-color card and the banned card', any('Outside' in c and 'Counterspell' in c for c in checks) and any('Not Commander-legal' in c and 'Griselbrand' in c for c in checks), str(checks))
    check('checks flag the card count', any('cards' in c and '✕' in c for c in checks))
    pg.click('#ptNew'); pg.wait_for_timeout(600)
    check('playtest hand draws 7 from the list and counts lands', pg.locator('.ptcard').count() == 7 and 'land' in pg.locator('#ptNote').text_content())
    pg.click('#ptOne'); pg.wait_for_timeout(300); check('Draw one more makes 8', pg.locator('.ptcard').count() == 8)
    check('no JS errors', not errs, str(errs)[:300])
    browser.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
