"""Top 100 decks page: list, filter, play deep-link seats the deck, save to account."""
import sys, json
sys.argv = ['x', sys.argv[1]]
src = open('tests/deep.py').read().split('with sync_playwright() as p:')[0]
exec(src)
TOP = {'decks': [{'id': 100 + i, 'name': f'Deck {i}', 'views': 5000 - i, 'owner': 'hans', 'featured': '', 'colors': ['R', 'UR', 'WG', 'B'][i % 4], 'bracket': 3, 'size': 100, 'updated': '2026-10-01', 'tags': []} for i in range(100)], 'fetched': 'now'}
DECK = {'id': 100, 'name': 'Deck 0', 'owner': 'hans', 'commander': 'Krenko, Mob Boss', 'commanders': ['Krenko, Mob Boss'], 'count': 100, 'text': 'Commander\n1 Krenko, Mob Boss\n\nDeck\n1 Goblin Chieftain\n98 Mountain', 'url': 'https://archidekt.com/decks/100'}
saved = []
def api(route):
    u = route.request.url
    if u.endswith('/api/top-decks'): route.fulfill(status=200, content_type='application/json', body=json.dumps(TOP))
    elif '/api/deck/' in u: route.fulfill(status=200, content_type='application/json', body=json.dumps(DECK))
    else: route.continue_()
def deck_mock(route):
    if '/rest/v1/decks' in route.request.url and route.request.method == 'POST':
        saved.append(json.loads(route.request.post_data)); route.fulfill(status=201, content_type='application/json', body=json.dumps({**saved[-1], 'id': 'd9'})); return
    supabase_mock(route)
with sync_playwright() as p:
    browser = p.chromium.launch(); ctx = browser.new_context(); pg, errs = setup(ctx)
    pg.route('**/api/**', api); pg.unroute('https://*.supabase.co/**'); pg.route('https://*.supabase.co/**', deck_mock)
    pg.goto(BASE + '/decks.html'); pg.wait_for_timeout(1200)
    check('100 deck cards render', pg.locator('.deckcard').count() == 100)
    check('signed out: save button asks to sign in', 'Sign in' in pg.locator('[data-save]').first.text_content())
    pg.fill('#q', 'Deck 7'); pg.wait_for_timeout(200); check('search filters', pg.locator('.deckcard').count() == 11)
    pg.fill('#q', ''); pg.click('#colors [data-c=U]'); pg.wait_for_timeout(200); check('color filter', pg.locator('.deckcard').count() == 25)
    pg.click('#colors [data-c=U]')
    # sign in as guest on the lobby, then save from the deck page
    pg.goto(BASE + '/'); pg.wait_for_timeout(800); pg.click('[data-go="signin"]'); pg.wait_for_timeout(200); pg.click('.tab:has-text("guest")'); pg.wait_for_timeout(200); pg.click('#guest'); pg.wait_for_timeout(1200)
    check('lobby links to the deck page', pg.locator('a[href="/decks.html"]').count() >= 1)
    pg.goto(BASE + '/decks.html'); pg.wait_for_timeout(1200)
    pg.locator('[data-save]').first.click(); pg.wait_for_timeout(1200)
    check('save stores the converted list on the account', saved and saved[0]['name'] == 'Deck 0' and saved[0]['list'].startswith('Commander\n1 Krenko') and saved[0]['card_count'] == 100, str(saved)[:200])
    check('button confirms', 'Saved' in pg.locator('[data-save]').first.text_content())
    # play deep link
    pg.goto(BASE + '/table.html?mode=bots&deck=top:100'); pg.wait_for_timeout(2500); st = state(pg)
    check('play link seats the deck at a bots table', any(c['name'] == 'Krenko, Mob Boss' and c['isCmdr'] for c in st['cards'].values() if c['owner'] == 0) and len(st['players'][0]['zones']['hand']) == 7)
    check('decks page: no JS errors', not errs, str(errs)[:300])
    browser.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
