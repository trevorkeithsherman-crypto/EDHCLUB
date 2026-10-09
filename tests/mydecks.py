"""My decks page: create with validation, edit, favorite, default, duplicate, export, delete, the 20-deck cap, in-game load."""
import sys, json, re, time
sys.argv = ['x', sys.argv[1]]
src = open('tests/deep.py').read().split('with sync_playwright() as p:')[0]
exec(src)
LIST = 'Commander\n1 Krenko, Mob Boss\n\nDeck\n1 Goblin Chieftain\n98 Mountain'
store = {}; profile = {'id': FAKE_USER['id'], 'display_name': 'Tester', 'avatar_url': None, 'default_deck_id': None}
def rows(url):
    out = list(store.values())
    m = re.search(r'[?&]id=eq\.([\w-]+)', url)
    if m: out = [d for d in out if d['id'] == m.group(1)]
    out.sort(key=lambda d: (not d.get('favorite'), d.get('updated_at') or ''), reverse=False)
    return out
def decks_mock(route):
    url = route.request.url; m = route.request.method; hdr = route.request.headers
    if '/rest/v1/decks' in url:
        if m == 'GET':
            if 'head' in hdr.get('prefer', '') or hdr.get('range-unit') == 'items' and 'count=exact' in hdr.get('prefer', ''): route.fulfill(status=200, content_type='application/json', headers={'content-range': f'0-0/{len(store)}'}, body='[]'); return
            r = rows(url); single = 'object' in hdr.get('accept', '') or 'single' in hdr.get('accept', '')
            route.fulfill(status=200, content_type='application/json', body=json.dumps(r[0] if single and r else (None if single else r))); return
        if m == 'POST':
            body = json.loads(route.request.post_data); body = body[0] if isinstance(body, list) else body
            did = body.get('id') or f'd{len(store) + 1:02d}'
            if did not in store and len(store) >= 20: route.fulfill(status=400, content_type='application/json', body=json.dumps({'message': 'Deck limit reached: each account can keep up to 20 decks', 'code': 'P0001'})); return
            row = {**store.get(did, {'favorite': False, 'plays': 0, 'last_played_at': None, 'created_at': '2026-10-09T00:00:00Z'}), **body, 'id': did}; store[did] = row
            route.fulfill(status=201, content_type='application/json', body=json.dumps(row if 'object' in hdr.get('accept', '') else [row])); return
        if m == 'PATCH':
            body = json.loads(route.request.post_data)
            for d in rows(url): d.update(body)
            route.fulfill(status=200, content_type='application/json', body='[]'); return
        if m == 'DELETE':
            for d in rows(url): store.pop(d['id'], None)
            route.fulfill(status=204, body=''); return
    if '/rest/v1/profiles' in url:
        if m == 'PATCH': profile.update(json.loads(route.request.post_data)); route.fulfill(status=200, content_type='application/json', body='[]'); return
        single = 'object' in hdr.get('accept', '') or 'single' in hdr.get('accept', '')
        route.fulfill(status=200, content_type='application/json', body=json.dumps(profile if single else [profile])); return
    supabase_mock(route)
def setupd(ctx):
    pg, errs = setup(ctx); pg.unroute('https://*.supabase.co/**'); pg.route('https://*.supabase.co/**', decks_mock); return pg, errs

with sync_playwright() as p:
    browser = p.chromium.launch(); ctx = browser.new_context(accept_downloads=True); pg, errs = setupd(ctx)
    pg.goto(BASE + '/'); pg.wait_for_timeout(600); pg.click('[data-go="signin"]'); pg.wait_for_timeout(200); pg.click('.tab:has-text("guest")'); pg.wait_for_timeout(150); pg.click('#guest'); pg.wait_for_timeout(1200)
    pg.goto(BASE + '/decks.html'); pg.wait_for_timeout(1200)
    check('signed in: My decks tab is the default view with an empty state', not pg.locator('#viewMine').is_hidden() and pg.locator('.empty-decks').count() == 1 and '0/20' in pg.locator('#deckCount').text_content())
    # new deck with validation
    pg.click('#newDeck'); pg.wait_for_timeout(300)
    pg.fill('#edList', 'Deck\n1 Goblin Chieftain\n30 Mountain'); pg.wait_for_timeout(400)
    check('editor flags a missing commander and a wrong count', 'No commander' in pg.locator('#edSum').text_content() and '31 cards' in pg.locator('#edSum').text_content())
    pg.click('#edSave'); pg.wait_for_timeout(300); check('cannot save without a commander', 'commander' in pg.locator('#toasts').text_content().lower() and not pg.locator('#modal').is_hidden())
    pg.fill('#edList', 'Commander\n1 Krenko, Mob Boss\n\nDeck\n2 Goblin Chieftain\n97 Mountain'); pg.wait_for_timeout(400)
    check('editor flags duplicate nonbasics', 'Duplicates' in pg.locator('#edSum').text_content())
    pg.fill('#edList', LIST); pg.fill('#edName', 'Krenko goblins'); pg.wait_for_timeout(500)
    check('a legal 100 gets the green check', 'legal' in pg.locator('#edSum').text_content())
    pg.click('#edSave'); pg.wait_for_timeout(1200)
    check('deck saved, card shows commander and count, becomes the default', pg.locator('.deckcard').count() == 1 and 'Krenko, Mob Boss' in pg.locator('.deckcard').text_content() and '100 cards' in pg.locator('.deckcard').text_content() and pg.locator('.deckcard.is-default').count() == 1 and profile['default_deck_id'] == 'd01')
    # edit
    pg.click('[data-mine=edit]'); pg.wait_for_timeout(500); check('edit opens with the saved list', 'Krenko' in pg.locator('#edList').input_value() and pg.locator('#edName').input_value() == 'Krenko goblins')
    pg.fill('#edName', 'Krenko v2'); pg.click('#edSave'); pg.wait_for_timeout(800); check('rename persists', store['d01']['name'] == 'Krenko v2' and 'Krenko v2' in pg.locator('.deckcard h3').first.text_content())
    # more menu: favorite, duplicate, export, copy
    pg.click('[data-mine=menu]'); pg.wait_for_timeout(300); pg.click('[data-dk=fav]'); pg.wait_for_timeout(800); check('favorite toggles', store['d01']['favorite'] is True and pg.locator('.deckart .fav').count() == 1)
    pg.click('[data-mine=menu]'); pg.wait_for_timeout(300); pg.click('[data-dk=dup]'); pg.wait_for_timeout(1000); check('duplicate makes a copy', pg.locator('.deckcard').count() == 2 and any('(copy)' in d['name'] for d in store.values()) and '2/20' in pg.locator('#deckCount').text_content())
    pg.locator('[data-mine=menu]').first.click(); pg.wait_for_timeout(300)
    with pg.expect_download() as dl: pg.click('[data-dk=export]')
    f = dl.value; check('export downloads a .txt of the list', f.suggested_filename.endswith('.txt'))
    # default switch to the copy
    pg.locator('[data-mine=menu]').nth(1).click(); pg.wait_for_timeout(300); pg.click('[data-dk=default]'); pg.wait_for_timeout(500)
    check('default can be moved to another deck', profile['default_deck_id'] == 'd02' and pg.evaluate("localStorage.getItem('edhclub-last-deck')") == 'd02')
    # the cap
    for k in range(3, 21): store[f'd{k:02d}'] = {'id': f'd{k:02d}', 'user_id': FAKE_USER['id'], 'name': f'Deck {k}', 'commander': 'Krenko, Mob Boss', 'colors': 'R', 'card_count': 100, 'list': LIST, 'mat': 'auto', 'favorite': False, 'plays': 0, 'last_played_at': None, 'created_at': '2026-10-01T00:00:00Z', 'updated_at': '2026-10-01T00:00:00Z'}
    pg.reload(); pg.wait_for_timeout(1500)
    check('20/20 shown and New deck is disabled', '20/20' in pg.locator('#deckCount').text_content() and pg.locator('#newDeck').is_disabled() and pg.locator('.deckcard').count() == 20)
    pg.locator('[data-mine=menu]').first.click(); pg.wait_for_timeout(300); pg.click('[data-dk=dup]'); pg.wait_for_timeout(600)
    check('duplicating at the cap is refused with a clear message', '20 decks' in pg.locator('#toasts').text_content() and len(store) == 20)
    # delete frees a slot
    pg.locator('.deckcard[data-id="d20"] [data-mine=menu]').click(); pg.wait_for_timeout(300); pg.click('[data-dk=del]'); pg.wait_for_timeout(300); pg.click('#delGo'); pg.wait_for_timeout(800)
    check('delete works and the counter drops', len(store) == 19 and 'd20' not in store and '19/20' in pg.locator('#deckCount').text_content())
    # Top 100 tab still there
    pg.click('[data-view=top]'); pg.wait_for_timeout(300); check('Top 100 tab switches views', pg.locator('#viewMine').is_hidden() and not pg.locator('#viewTop').is_hidden())
    # in-game: the default deck is seated and play count bumps; deep link by id works
    pg.goto(BASE + '/table.html?mode=bots'); pg.wait_for_timeout(2500); st = state(pg)
    check('bots table seats my default deck', st['players'][0]['deckId'] == 'd02' and any(c['name'] == 'Krenko, Mob Boss' and c['isCmdr'] and c['owner'] == 0 for c in st['cards'].values()))
    check('play count recorded', store['d02']['plays'] == 1 and store['d02']['last_played_at'])
    pg.goto(BASE + '/table.html?mode=bots&deck=d05'); pg.wait_for_timeout(2500)
    check('Play vs bots link seats that specific deck', state(pg)['players'][0]['deckId'] == 'd05')
    pg.click('#importBtn'); pg.wait_for_timeout(500); check('in-game library lists all saved decks with a Manage link', pg.locator('[data-deck-load]').count() == 19 and 'Manage decks' in pg.locator('#modal').text_content())
    check('my decks: no JS errors', not errs, str(errs)[:300])
    browser.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
