"""Alternate artwork per card (Scryfall printings), foil effects and the toggle, in the editor and at the table."""
import sys, json, re
sys.argv = ['x', sys.argv[1]]
src = open('tests/deep.py').read().split('with sync_playwright() as p:')[0]
exec(src)
exec(open('tests/mydecks.py').read().split('def setupd(ctx):')[0].split("exec(src)")[1])  # LIST, store, profile, decks_mock
def setupd(ctx):
    pg, errs = setup(ctx); pg.unroute('https://*.supabase.co/**'); pg.route('https://*.supabase.co/**', decks_mock); return pg, errs
PRINTS = {'data': [
  {'name': 'Krenko, Mob Boss', 'set': 'm19', 'collector_number': '110', 'set_name': 'Core Set 2019', 'released_at': '2018-07-13', 'artist': 'Karl Kopinski', 'finishes': ['nonfoil', 'foil'], 'type_line': 'Legendary Creature — Goblin Warrior', 'mana_cost': '{2}{R}{R}', 'power': '3', 'toughness': '3', 'colors': ['R'], 'image_uris': {'normal': 'https://cards.scryfall.io/normal/m19-krenko.jpg', 'large': 'https://cards.scryfall.io/large/m19-krenko.jpg', 'art_crop': 'https://cards.scryfall.io/art/m19-krenko.jpg'}},
  {'name': 'Krenko, Mob Boss', 'set': 'mb2', 'collector_number': '83', 'set_name': 'Mystery Booster 2', 'released_at': '2024-08-02', 'artist': 'Ilse Gort', 'finishes': ['foil'], 'full_art': True, 'type_line': 'Legendary Creature — Goblin Warrior', 'mana_cost': '{2}{R}{R}', 'power': '3', 'toughness': '3', 'colors': ['R'], 'image_uris': {'normal': 'https://cards.scryfall.io/normal/mb2-krenko.jpg', 'large': 'https://cards.scryfall.io/large/mb2-krenko.jpg', 'art_crop': 'https://cards.scryfall.io/art/mb2-krenko.jpg'}},
], 'has_more': False}
def scry(route):
    u = route.request.url
    if '/cards/search' in u and 'unique=prints' in u: route.fulfill(status=200, content_type='application/json', body=json.dumps(PRINTS)); return
    if route.request.method == 'POST':
        body = json.loads(route.request.post_data); data = []
        for i in body['identifiers']:
            if 'set' in i: hit = next((c for c in PRINTS['data'] if c['set'] == i['set'] and c['collector_number'] == i['collector_number']), None); data.append(hit) if hit else None
        if data: route.fulfill(status=200, content_type='application/json', body=json.dumps({'data': data, 'not_found': []})); return
    collection(route)

with sync_playwright() as p:
    browser = p.chromium.launch(); ctx = browser.new_context(); pg, errs = setupd(ctx)
    pg.unroute('https://api.scryfall.com/**'); pg.route('https://api.scryfall.com/**', scry)
    # ---- table: pick artwork, foil, setting ----
    pg.goto(BASE + '/table.html'); pg.evaluate('localStorage.clear()'); pg.reload(); pg.wait_for_timeout(1800)
    cm = next(c for c in state(pg).get('cards').values() if c['isCmdr'] and c['owner'] == 0)
    el = pg.locator(f'.me [data-zone$=command] .card[data-id="{cm["id"]}"]')
    el.click(button='right'); pg.wait_for_timeout(150); check('card menu offers Choose artwork and Make it foil', pg.locator('.menu .mi:has-text("Choose artwork")').count() == 1 and pg.locator('.menu .mi:has-text("Make it foil")').count() == 1)
    pg.locator('.menu .mi:has-text("Choose artwork")').click(); pg.wait_for_timeout(800)
    check('artwork picker lists the printings with set, year and artist', pg.locator('.artopt').count() == 2 and 'Mystery Booster 2' in pg.locator('.artgrid').text_content() and 'Ilse Gort' in pg.locator('.artgrid').text_content() and 'foil only' in pg.locator('.artgrid').text_content())
    pg.locator('.artopt').nth(1).click(); pg.wait_for_timeout(500); st = state(pg); c = st['cards'][cm['id']]
    check('picking a printing swaps the image and remembers set/number', c['set'] == 'mb2' and c['num'] == '83' and 'mb2-krenko' in c['img'])
    check('a foil-only printing turns foil on automatically', c['foil'] is True and pg.locator('#artFoil').is_checked())
    check('the seat\'s decklist text now carries (set) number *F*', re.search(r'Krenko, Mob Boss \(mb2\) 83 \*F\*', st['players'][0]['deckText']) is not None, st['players'][0]['deckText'][:120])
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    check('foil card renders with the foil class', pg.locator(f'.card[data-id="{cm["id"]}"].foil').count() == 1)
    pg.click('#settingsBtn'); pg.wait_for_timeout(150); pg.locator('.menu .mi:has-text("Foil effects")').click(); pg.wait_for_timeout(300)
    check('Foil effects toggle removes the shader (card stays marked foil)', pg.locator(f'.card[data-id="{cm["id"]}"].foil').count() == 0 and state(pg)['cards'][cm['id']]['foil'] is True and state(pg)['foilFx'] is False)
    pg.click('#settingsBtn'); pg.wait_for_timeout(150); pg.locator('.menu .mi:has-text("Foil effects")').click(); pg.wait_for_timeout(300); check('…and back on', pg.locator(f'.card[data-id="{cm["id"]}"].foil').count() == 1)
    # a list with printing tags loads the right printing at the table
    pg.click('#importBtn'); pg.wait_for_timeout(300); pg.fill('#impList', 'Commander\n1 Krenko, Mob Boss (m19) 110\n\nDeck\n1 Goblin Chieftain *F*\n98 Mountain'); pg.wait_for_timeout(300); pg.click('#impGo'); pg.wait_for_timeout(1500); st = state(pg)
    k = next(c for c in st['cards'].values() if c['isCmdr'] and c['owner'] == 0); g = next(c for c in st['cards'].values() if c['name'] == 'Goblin Chieftain' and c['owner'] == 0)
    check('importing "(m19) 110" seats that printing', k['set'] == 'm19' and k['num'] == '110' and 'm19-krenko' in k['img'])
    check('importing "*F*" marks the card foil', g['foil'] is True)
    check('table artwork: no JS errors', not errs, str(errs)[:300])
    # ---- deck editor: Artwork tab ----
    pg.goto(BASE + '/'); pg.wait_for_timeout(500); pg.click('[data-go="signin"]'); pg.wait_for_timeout(200); pg.click('.tab:has-text("guest")'); pg.wait_for_timeout(150); pg.click('#guest'); pg.wait_for_timeout(1000)
    pg.goto(BASE + '/decks.html'); pg.wait_for_timeout(1000); pg.click('#newDeck'); pg.wait_for_timeout(300); pg.fill('#edName', 'Art test'); pg.fill('#edList', LIST); pg.wait_for_timeout(500)
    pg.click('[data-ed=art]'); pg.wait_for_timeout(800)
    check('Cards tab shows every card as art, commander first', pg.locator('.artcard').count() == 3 and pg.locator('.artcard').first.evaluate('e=>e.classList.contains("cmdr")'))
    pg.fill('#edArtQ', 'kren'); pg.wait_for_timeout(200); check('filter narrows the cards', pg.locator('.artcard').count() == 1)
    pg.locator('.artcard').first.click(button='right'); pg.wait_for_timeout(800)
    check('right-click opens the artwork picker on top of the editor', pg.locator('#modal2 .artopt').count() == 2 and not pg.locator('#modal').is_hidden())
    pg.locator('#modal2 .artopt').first.click(); pg.wait_for_timeout(600)
    check('choice is written into the list; editor stays open on Cards', '(m19) 110' in pg.locator('#edList').input_value() and pg.locator('#modal2').is_hidden() and not pg.locator('#edArt').is_hidden())
    check('the card now shows its set and number', 'M19 #110' in pg.locator('.artcard').first.text_content())
    pg.locator('.artcard').first.click(button='right'); pg.wait_for_timeout(600); pg.check('#artFoil'); pg.wait_for_timeout(300); pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    check('foil checkbox adds *F*; Escape closes just the picker', '(m19) 110 *F*' in pg.locator('#edList').input_value() and pg.locator('#modal2').is_hidden() and not pg.locator('#modal').is_hidden())
    # ⋯ menu: copies and commander
    pg.fill('#edArtQ', ''); pg.wait_for_timeout(200)
    pg.locator('.artcard:not(.cmdr)').first.hover(); pg.locator('.artcard:not(.cmdr) .more').first.click(); pg.wait_for_timeout(200)
    check('card menu offers artwork, foil, copies, commander', pg.locator('#edMenu .mi').count() == 5 and 'Add a copy' in pg.locator('#edMenu').text_content())
    name = pg.locator('.artcard:not(.cmdr) .cap').first.text_content().split('\n')[0].strip()
    pg.locator('#edMenu .mi:has-text("Add a copy")').click(); pg.wait_for_timeout(400)
    check('Add a copy bumps the count in the list', pg.locator('.artcard .qty:has-text("×2")').count() == 1 and '2 Goblin Chieftain' in pg.locator('#edList').input_value())
    pg.locator('.artcard:not(.cmdr) .more').first.click(); pg.wait_for_timeout(200); pg.locator('#edMenu .mi:has-text("Remove one copy")').click(); pg.wait_for_timeout(400)
    check('Remove one copy brings it back down', pg.locator('.artcard .qty:has-text("×2")').count() == 0 and '1 Goblin Chieftain' in pg.locator('#edList').input_value())
    pg.click('#edSave'); pg.wait_for_timeout(900)
    check('saved list keeps the printing and foil tags', any('(m19) 110 *F*' in d['list'] for d in store.values()))
    # reopening an existing deck lands on Cards
    pg.locator('[data-mine=edit]').first.click(); pg.wait_for_timeout(900)
    check('editing a saved deck opens on the Cards view', not pg.locator('#edArt').is_hidden() and pg.locator('.artcard').count() == 3)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    check('editor artwork: no JS errors', not errs, str(errs)[:300])
    browser.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
