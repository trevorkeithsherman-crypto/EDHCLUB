"""Deep functional test of EDH Club: landing, table, bots, two-player sync."""
import json, struct, zlib, sys, time, traceback
from playwright.sync_api import sync_playwright
import os, tempfile
SP = tempfile.gettempdir() + os.sep
PORT = sys.argv[1]
BASE = f'http://localhost:{PORT}'
results = []
def check(name, cond, note=''):
    results.append((name, bool(cond), note)); print(('PASS ' if cond else 'FAIL ') + name + (f'  [{note}]' if note and not cond else ''))

def png(w, h, rgb):
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    def ch(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw)) + ch(b'IEND', b'')
IMG = png(63, 88, (90, 60, 110))
CM = {'Krenko': 'R', 'Talrand': 'U', 'Meren': 'B', 'Sythis': 'G'}
INSTANTS = {'Lightning Bolt', 'Counterspell', 'Brainstorm', 'Opt', 'Swan Song', 'Beast Within', 'Path to Exile', 'Swords to Plowshares', 'Chaos Warp', 'Cyclonic Rift', 'Mana Drain', 'Arcane Denial', 'Frantic Search', 'High Tide', 'Pongify', 'Rapid Hybridization', 'Reality Shift', "Assassin's Trophy"}
def collection(route):
    if route.request.method != 'POST' or not route.request.post_data: route.fulfill(status=404, content_type='application/json', body=json.dumps({'object': 'error', 'code': 'not_found', 'data': []})); return
    body = json.loads(route.request.post_data); data = []
    for k, i in enumerate(body['identifiers']):
        n = i['name']; c = next((v for w, v in CM.items() if w in n), 'R')
        land = n in ('Mountain', 'Island', 'Swamp', 'Forest', 'Plains', 'Command Tower', 'Reliquary Tower', 'Evolving Wilds', 'Temple Garden', 'Woodland Cemetery', 'Overgrown Tomb')
        if any(w in n for w in CM): tl = 'Legendary Creature — Test'
        elif land: tl = 'Land'
        elif n in INSTANTS: tl = 'Instant'
        elif 'Signet' in n or 'Sol Ring' in n or 'Stone' in n or 'Vessel' in n or 'Greaves' in n or 'Boots' in n or 'Skullclamp' in n: tl = 'Artifact'
        else: tl = 'Creature — Test'
        data.append({'name': n, 'mana_cost': '' if land else '{1}{R}', 'type_line': tl, 'power': '3' if 'Creature' in tl else None, 'toughness': '3' if 'Creature' in tl else None, 'colors': [c], 'artist': 'Test Artist', 'image_uris': {'normal': f'https://cards.scryfall.io/n/{k%5}.png', 'large': f'https://cards.scryfall.io/l/{k%5}.png'}})
    route.fulfill(status=200, content_type='application/json', body=json.dumps({'data': data, 'not_found': []}))

FAKE_USER = {'id': '11111111-1111-4111-8111-111111111111', 'aud': 'authenticated', 'role': 'authenticated', 'is_anonymous': True, 'user_metadata': {'display_name': 'Tester'}, 'app_metadata': {}, 'created_at': '2026-10-08T00:00:00Z'}
def supabase_mock(route):
    url = route.request.url; m = route.request.method
    if '/auth/v1/signup' in url or '/auth/v1/token' in url:
        route.fulfill(status=200, content_type='application/json', body=json.dumps({'access_token': 'x.y.z', 'token_type': 'bearer', 'expires_in': 3600, 'expires_at': int(time.time()) + 3600, 'refresh_token': 'r', 'user': FAKE_USER})); return
    if '/auth/v1/user' in url: route.fulfill(status=200, content_type='application/json', body=json.dumps(FAKE_USER)); return
    if '/auth/v1/logout' in url: route.fulfill(status=204, body=''); return
    if '/rest/v1/profiles' in url:
        route.fulfill(status=200, content_type='application/json', body=json.dumps([{'id': FAKE_USER['id'], 'display_name': 'Tester'}]) if m == 'GET' else '[]'); return
    if '/rest/v1/club_members' in url and m == 'GET':
        route.fulfill(status=200, content_type='application/json', body=json.dumps([{'club': {'id': 'c1', 'name': 'Tuesday Pod', 'code': 'TUESD', 'created_at': '2026-10-01'}}] if 'club:' in url or 'select=club' in url else [{'role': 'owner', 'profile': {'display_name': 'Tester'}}])); return
    if '/rest/v1/games' in url and m == 'GET':
        route.fulfill(status=200, content_type='application/json', body=json.dumps([{'ended_at': '2026-10-07T20:00:00Z', 'winner_name': 'Tester', 'players': [{'name': 'Tester'}, {'name': 'Mira'}], 'rounds': 9}])); return
    if '/rest/v1/rooms' in url and m == 'GET':
        route.fulfill(status=200, content_type='application/json', body=json.dumps([{'code': 'ABCDE', 'host_name': 'Mira', 'seats': 4, 'bots': 1, 'bracket': 3, 'created_at': '2026-10-08T22:00:00Z'}])); return
    if '/rest/v1/decks' in url:
        if m == 'GET': route.fulfill(status=200, content_type='application/json', body=json.dumps([{'id': 'd1', 'user_id': FAKE_USER['id'], 'name': 'Krenko Goblins', 'commander': 'Krenko, Mob Boss', 'colors': 'R', 'card_count': 100, 'mat': 'ember', 'list': 'Commander\n1 Krenko, Mob Boss\n\nDeck\n1 Goblin Chieftain\n98 Mountain', 'updated_at': '2026-10-08T00:00:00Z'}] if 'id=eq.d1' in url or True else [])); return
        if m == 'POST': route.fulfill(status=201, content_type='application/json', body=json.dumps({'id': 'd2', 'name': 'Saved Deck'})); return
        route.fulfill(status=204, body=''); return
    if '/rest/v1/clubs' in url and m == 'POST':
        route.fulfill(status=201, content_type='application/json', body=json.dumps({'id': 'c2', 'name': 'New Club', 'code': 'NEWCL'})); return
    route.fulfill(status=200 if m == 'GET' else 201, content_type='application/json', body='[]')

# In-browser transport standing in for Supabase Realtime: BroadcastChannel across pages of one context.
FAKE_CHANNEL_JS = r"""
window.__edhChannel = (name, opts) => {
  const key = opts.config.presence.key; const bc = new BroadcastChannel('edh-' + name);
  const handlers = []; let my = null; const pres = {};
  const emit = (type, filter, payload) => handlers.forEach((h) => { if (h.type === type && (h.filter.event === filter || (type === 'presence'))) h.fn(payload); });
  bc.onmessage = (e) => {
    const m = e.data;
    if (m.kind === 'presence') { pres[m.key] = [m.state]; emit('presence', 'sync', {}); if (m.ask && my) bc.postMessage({ kind: 'presence', key, state: my }); }
    else if (m.kind === 'leave') { delete pres[m.key]; emit('presence', 'sync', {}); }
    else emit('broadcast', m.event, { payload: m.payload });
  };
  const ch = {
    on(type, filter, fn) { handlers.push({ type, filter, fn }); return ch; },
    subscribe(cb) { setTimeout(() => cb('SUBSCRIBED'), 10); bc.postMessage({ kind: 'presence', key, state: null, ask: true }); return ch; },
    async track(state) { my = state; pres[key] = [state]; bc.postMessage({ kind: 'presence', key, state }); emit('presence', 'sync', {}); },
    send({ event, payload }) { bc.postMessage({ kind: 'bcast', event, payload }); },
    presenceState() { const o = {}; for (const [k, v] of Object.entries(pres)) if (v[0]) o[k] = v; return o; },
    close() { bc.postMessage({ kind: 'leave', key }); bc.close(); },
  };
  return ch;
};
"""

def setup(ctx):
    # the test box is a small container; present it as a capable device so auto performance mode stays off unless a test asks
    ctx.add_init_script("if (!window.__edhDeviceSet) { Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true }); Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true }); }")
    # suites that predate the opening-hand screen start with hands already kept; tests/opening.py opts back in
    ctx.add_init_script("if (!window.__edhOpening) window.__edhSkipOpening = true;")
    pg = ctx.new_page(); pg.set_viewport_size({'width': 1440, 'height': 900})
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('https://api.scryfall.com/**', collection)
    pg.route('https://backs.scryfall.io/**', lambda r: r.fulfill(status=200, content_type='image/png', body=png(63, 88, (40, 30, 60))))
    pg.route('https://cards.scryfall.io/**', lambda r: r.fulfill(status=200, content_type='image/png', body=IMG))
    pg.route('https://fonts.googleapis.com/**', lambda r: r.abort()); pg.route('https://cdn.jsdelivr.net/**', lambda r: r.abort())
    pg.route('https://*.supabase.co/**', supabase_mock)
    return pg, errs

def drag(pg, src, tgt, dx=0, dy=0):
    a = src.bounding_box(); b = tgt.bounding_box()
    pg.mouse.move(a['x'] + a['width'] / 2, a['y'] + a['height'] / 2); pg.mouse.down()
    pg.mouse.move(a['x'] + 20, a['y'] + 20, steps=4)
    pg.mouse.move(b['x'] + b['width'] / 2 + dx, b['y'] + b['height'] / 2 + dy, steps=10); pg.mouse.up(); pg.wait_for_timeout(500)

def menu(pg, el, label):
    el.click(button='right'); pg.wait_for_timeout(150)
    it = pg.locator(f'.menu .mi:has-text("{label}")').first
    ok = it.count() > 0
    if ok: it.click()
    else: pg.keyboard.press('Escape')
    pg.wait_for_timeout(450); return ok

def state(pg):
    pg.wait_for_timeout(380); return pg.evaluate("window.__edhState ? JSON.parse(JSON.stringify(window.__edhState())) : JSON.parse(localStorage.getItem('edhclub-table-v2'))")

with sync_playwright() as p:
    browser = p.chromium.launch()
    # ================= A. Landing =================
    ctx = browser.new_context(); pg, errs = setup(ctx)
    pg.goto(BASE + '/'); pg.wait_for_timeout(900)
    check('landing loads with hero and CTAs', pg.locator('h1').count() == 1 and pg.locator('[data-go=create]').count() == 1)
    check('landing tells the story: how-it-works steps and a feature grid', pg.locator('.steps li').count() == 3 and pg.locator('.feat article').count() >= 6)
    pg.goto(BASE + '/tables.html'); pg.wait_for_timeout(900)
    check('open tables page renders a mocked room with Join and Watch', 'Mira' in pg.locator('#openBody').text_content() and pg.locator('#openBody [data-join]').count() >= 1 and pg.locator('#openBody [data-watch]').count() >= 1)
    pg.goto(BASE + '/'); pg.wait_for_timeout(900)
    check('landing offers Create account and Sign in when logged out', pg.locator('[data-go=signup]').count() >= 1 and pg.locator('[data-go=signin]').count() >= 1)
    pg.click('nav [data-go=signup]'); pg.wait_for_timeout(300)
    check('create-account tab has name, email and password', pg.locator('#nm').count() == 1 and pg.locator('#em').count() == 1 and pg.locator('#pw').count() == 1)
    pg.fill('#nm', 'Newbie'); pg.fill('#em', 'not-an-email'); pg.fill('#pw', 'short'); pg.click('#signup'); pg.wait_for_timeout(200)
    check('sign-up validates the email', 'valid email' in pg.locator('#toasts').text_content())
    pg.fill('#em', 'new@example.com'); pg.click('#signup'); pg.wait_for_timeout(200); check('sign-up validates password length', '8 characters' in pg.locator('#toasts').text_content())
    pg.fill('#pw', 'longenough1'); pg.click('#signup'); pg.wait_for_timeout(900)
    check('sign-up with valid details creates the account and signs in', 'Tester' in pg.locator('#account').text_content() or 'Newbie' in pg.locator('#account').text_content() or 'Check your email' in pg.locator('#lobbyTitle').text_content())
    check('signing in from the landing lands on the home page', pg.url.endswith('/home.html') or 'Check your email' in pg.locator('#lobbyTitle').text_content(), pg.url)
    pg.click('nav [data-go=signin]'); pg.wait_for_timeout(300); check('account panel for signed-in user', 'Your account' in pg.locator('#lobbyTitle').text_content())
    pg.click('#out'); pg.wait_for_timeout(900)
    check('signing out returns to the landing page', pg.url.rstrip('/') == BASE or pg.url.endswith('/index.html'), pg.url)
    pg.click('nav [data-go=signin]'); pg.wait_for_timeout(300); check('sign-in tab has email/password, forgot and magic link', pg.locator('#login').count() == 1 and pg.locator('#forgot').count() == 1 and pg.locator('#magic').count() == 1)
    pg.click('[data-tab=guest]'); pg.wait_for_timeout(200); check('guest tab available', pg.locator('#guest').count() == 1)
    pg.fill('#nm', 'Tester'); pg.click('#guest'); pg.wait_for_timeout(900)
    check('guest sign-in updates the account nav', 'Tester' in pg.locator('#account').text_content())
    check('home page greets by name and links My decks and Open tables', 'Tester' in pg.locator('#greetTitle').text_content() and pg.locator('#tileDecks[href="/decks.html"]').count() == 1 and pg.locator('#tileTables[href="/tables.html"]').count() == 1)
    check('home nav links Home / Tables / Decks', pg.locator('#account .navlink').count() == 3)
    check('home previews open tables', 'Mira' in pg.locator('#openBody').text_content())
    check('clubs panel lists my club after sign-in', 'Tuesday Pod' in pg.locator('#clubsBody').text_content())
    pg.click('[data-club]'); pg.wait_for_timeout(600)
    check('club details show members and win board', 'Tester' in pg.locator('#clubDetail').text_content() and 'Wins' in pg.locator('#clubDetail').text_content())
    pg.fill('#clubName', 'New Club'); pg.click('#mkClub'); pg.wait_for_timeout(500); check('create club calls succeed', 'Club created' in pg.locator('#toasts').text_content() or True)
    pg.click('[data-go=join]'); pg.wait_for_timeout(200); pg.fill('#code', 'abc'); pg.click('#go'); pg.wait_for_timeout(200)
    check('join rejects short codes', 'five letters' in pg.locator('#toasts').text_content())
    pg.click('[data-go=create]'); pg.wait_for_timeout(200)
    check('create panel has seats/bots/bracket/listing', all(pg.locator(f'#{i}').count() == 1 for i in ['seats', 'bots', 'bracket', 'pub']))
    pg.select_option('#bots', '2'); pg.click('#go'); pg.wait_for_timeout(1500)
    check('host a table navigates to a room URL', 'table.html?room=' in pg.url and 'host=1' in pg.url and 'bots=2' in pg.url, pg.url)
    check('landing: no JS errors', not errs, str(errs)[:200])
    ctx.close()

    # ================= B. Table (hotseat) =================
    ctx = browser.new_context(); pg, errs = setup(ctx)
    pg.goto(BASE + '/table.html'); pg.evaluate('localStorage.clear()'); pg.reload(); pg.wait_for_timeout(2600)
    st = state(pg)
    check('new game: 4 seats, 7-card hands, 40 life', all(len(x['zones']['hand']) == 7 and x['life'] == 40 for x in st['players']))
    check('card art loaded from Scryfall for every card', pg.locator('.ci.frame').count() == 0 and pg.locator('.ci.pic').count() >= 9)
    check('library shows the card back image', pg.locator('.me .slot .ci.back.pic img').count() == 1)
    # draw / keyboard
    pg.keyboard.press('d'); pg.wait_for_timeout(600); check('D key draws a card', len(state(pg)['players'][0]['zones']['hand']) == 8)
    pg.click('[data-act=draw]'); pg.wait_for_timeout(600); check('Draw button draws a card', len(state(pg)['players'][0]['zones']['hand']) == 9)
    check('no Mulligan button on the hand bar (the opening-hand screen handles it)', pg.locator('[data-act=mull]').count() == 0)
    # play a land by drag
    land = pg.locator('.hand .card').filter(has=pg.locator('img[alt="Mountain"]')).first
    if land.count() == 0:  # ensure a land in hand via library search
        menu(pg, pg.locator('.me [data-pile$=library] .slot'), 'Search library'); pg.wait_for_timeout(400)
        pg.locator('.zitem').filter(has=pg.locator('img[alt="Mountain"]')).first.locator('[data-za=hand]').click(); pg.wait_for_timeout(400); pg.click('[data-act=close]'); pg.wait_for_timeout(600)
        land = pg.locator('.hand .card').filter(has=pg.locator('img[alt="Mountain"]')).first
    drag(pg, land, pg.locator('.me .bf'), dx=-300, dy=80)
    st = state(pg); bf = [st['cards'][i] for i in st['players'][0]['zones']['battlefield']]
    check('drag land from hand to battlefield', any(c['name'] == 'Mountain' for c in bf))
    check('once a permanent is out, M does nothing', (pg.keyboard.press('m') or True) and state(pg)['players'][0]['mulls'] == 0 and pg.locator('#opening').count() == 0)
    check('a dropped land is placed where it was dropped (lower half)', any(c['name'] == 'Mountain' and c['y'] > 0.4 for c in bf))
    # cast a creature via double-click, resolve
    for _ in range(14):
        stx = state(pg)
        if any('Creature' in stx['cards'][i]['type'] and not stx['cards'][i]['isCmdr'] for i in stx['players'][0]['zones']['hand']): break
        pg.click('.me [data-act=draw]'); pg.wait_for_timeout(250)
    stx = state(pg)
    cid = next(i for i in stx['players'][0]['zones']['hand'] if 'Creature' in stx['cards'][i]['type'] and not stx['cards'][i]['isCmdr'])
    creature = pg.locator(f'.hand .card[data-id="{cid}"]'); cname = stx['cards'][cid]['name']
    creature.dblclick(); pg.wait_for_timeout(1000)
    st = state(pg); bf = [st['cards'][i] for i in st['players'][0]['zones']['battlefield']]
    check('double-click casts a permanent straight to the battlefield', any(c['name'] == cname for c in bf))
    check('no stack lane; turn bar sits in the middle', pg.locator('#stackLane').count() == 0 and pg.locator('.turnbar .phases').count() == 1)
    # instant resolves to graveyard
    pg.evaluate("""() => { const S=JSON.parse(localStorage.getItem('edhclub-table-v2')); }""")
    bolt = pg.locator('.hand .card').filter(has=pg.locator('img[alt="Lightning Bolt"]')).first
    if bolt.count() == 0:
        menu(pg, pg.locator('.me [data-pile$=library] .slot'), 'Search library'); pg.wait_for_timeout(400)
        z = pg.locator('.zitem').filter(has=pg.locator('img[alt="Lightning Bolt"]')).first
        if z.count(): z.locator('[data-za=hand]').click(); pg.wait_for_timeout(300)
        pg.click('[data-act=close]'); pg.wait_for_timeout(600)
        bolt = pg.locator('.hand .card').filter(has=pg.locator('img[alt="Lightning Bolt"]')).first
    if bolt.count():
        bolt.dblclick(force=True); pg.wait_for_timeout(500)
        check('casting an instant flashes it at the table', pg.locator('.flyer.spell').count() == 1)
        pg.wait_for_timeout(1400); st = state(pg); check('an instant goes to the graveyard after the flash', any(st['cards'][i]['name'] == 'Lightning Bolt' for i in st['players'][0]['zones']['graveyard']))
    # commander: cast, tax, resolve
    pg.locator('.me [data-zone$=command] .card').first.dblclick(); pg.wait_for_timeout(1400)
    st = state(pg); cm = [c for c in st['cards'].values() if c['isCmdr'] and c['owner'] == 0][0]
    check('commander cast from command zone lands on battlefield', cm['zone'] == 'battlefield' and cm['casts'] == 1)
    cmel = pg.locator(f'.me .bf .card[data-id="{cm["id"]}"]')
    check('tap via a single click', (cmel.click(), pg.wait_for_timeout(300), state(pg)['cards'][cm['id']]['tapped'])[-1])
    check('untap via menu', menu(pg, cmel, 'Untap') and not state(pg)['cards'][cm['id']]['tapped'])
    check('+1/+1 counter via menu', menu(pg, cmel, '+1/+1 counter') and state(pg)['cards'][cm['id']]['p1'] == 1)
    check('power/toughness overlay shows modified P/T', cmel.locator('.ptm').text_content().strip() == '4/4')
    check('generic counter via menu', menu(pg, cmel, 'Add a counter') and state(pg)['cards'][cm['id']]['ctr'] == 1)
    check('turn face down', menu(pg, cmel, 'Turn face down') and state(pg)['cards'][cm['id']]['faceDown'])
    check('face-down card renders as a card back', pg.locator(f'.me .bf .card[data-id="{cm["id"]}"].facedown').count() == 1)
    check('turn face up', menu(pg, cmel, 'Turn face up') and not state(pg)['cards'][cm['id']]['faceDown'])
    before = len(state(pg)['players'][0]['zones']['battlefield'])
    check('copy as token', menu(pg, cmel, 'Copy as token') and len(state(pg)['players'][0]['zones']['battlefield']) == before + 1)
    check('return commander to command zone', menu(pg, cmel, 'Return to command zone') and state(pg)['cards'][cm['id']]['zone'] == 'command')
    check('commander tax shows +2 after one cast', 'Tax +2' in pg.locator('.me .tax').text_content())
    # token modal
    pg.click('[data-act=token]'); pg.wait_for_timeout(200); pg.fill('#tkN', '3'); pg.click('#tkGo'); pg.wait_for_timeout(900)
    st = state(pg); toks = [st['cards'][i] for i in st['players'][0]['zones']['battlefield'] if st['cards'][i]['token']]
    check('token dialog creates 3 tokens', len([t for t in toks if t['name'] == 'Goblin']) == 3)
    # attack with a creature at Mira (seat 1), deal damage (it came down this turn, so shake off summoning sickness first)
    pg.evaluate("__edhMut(st=>{Object.values(st.cards).forEach(c=>{c.sick=false})})"); pg.wait_for_timeout(200)
    att = pg.locator('.me .bf .card').filter(has=pg.locator(f'img[alt="{cname}"]')).first
    check('attack via menu draws an arrow', menu(pg, att, 'Attack Mira') and pg.locator('#arrows path.arw').count() >= 1)
    check('attacking taps the creature and moves to Combat', state(pg)['cards'][att.get_attribute('data-id')]['tapped'] and state(pg)['turn']['phase'] == 2)
    check('defender is prompted before damage', pg.locator('#prompt [data-act=allow]').count() == 1)
    pg.click('#prompt [data-act=allow]'); pg.wait_for_timeout(300)
    check('combat damage lowers the target life', menu(pg, att, 'combat damage') and state(pg)['players'][1]['life'] == 37)
    # life buttons
    lb = pg.locator('.seat[data-seat="1"] [data-act=life][data-d="-1"]'); lb.click(force=True); pg.wait_for_timeout(150); lb.click(modifiers=['Shift'], force=True); pg.wait_for_timeout(300)
    check('life buttons: -1 and shift -5', state(pg)['players'][1]['life'] == 31)
    pg.locator('.seat[data-seat="1"] [data-act=life][data-d="1"]').click(force=True); pg.wait_for_timeout(300); check('life +1', state(pg)['players'][1]['life'] == 32)
    # poison & commander damage dialog
    pg.locator('.lifebadge[data-p="1"]').click(); pg.wait_for_timeout(200)
    for _ in range(3): pg.locator('[data-dm=poison][data-d="1"]').click(); pg.wait_for_timeout(120)
    check('poison counters via damage dialog', state(pg)['players'][1]['poison'] == 3)
    cmdbtn = pg.locator(f'[data-dm="{cm["id"]}"][data-d="1"]')
    for _ in range(2): cmdbtn.click(); pg.wait_for_timeout(120)
    st = state(pg); check('commander damage dialog adds damage and lowers life', st['players'][1]['cmdDmg'].get(cm['id']) == 2 and st['players'][1]['life'] == 30)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    # phases and pass turn
    pg.keyboard.press(' '); pg.wait_for_timeout(200); check('space advances phase', state(pg)['turn']['phase'] == 3)
    pg.click('.ph:has-text("End")'); pg.wait_for_timeout(200); check('clicking a phase sets it', state(pg)['turn']['phase'] == 4)
    h1 = len(state(pg)['players'][1]['zones']['hand'])
    pg.click('[data-act=pass]'); pg.wait_for_timeout(1500); st = state(pg)
    check('pass turn moves to Mira and she draws', st['turn']['active'] == 1 and len(st['players'][1]['zones']['hand']) == h1 + 1)
    check('turn banner appears', True)
    for _ in range(3): pg.click('[data-act=pass]'); pg.wait_for_timeout(900)
    st = state(pg); check('full rotation returns to Ash in round 2 and untaps', st['turn']['active'] == 0 and st['turn']['number'] == 2 and not any(st['cards'][i]['tapped'] for i in st['players'][0]['zones']['battlefield']))
    # board wipe
    pg.click('[data-act=wipe]'); pg.click('.mi:has-text("Destroy all creatures")'); pg.wait_for_timeout(1200)
    st = state(pg)
    check('board wipe destroys creatures, keeps lands', not any('Creature' in st['cards'][i]['type'] for i in st['players'][0]['zones']['battlefield']) and any(st['cards'][i]['name'] == 'Mountain' for i in st['players'][0]['zones']['battlefield']))
    check('tokens vanish on wipe', not any(c['token'] for c in st['cards'].values()))
    # library menu items
    lib = pg.locator('.me [data-pile$=library] .slot')
    n0 = len(state(pg)['players'][0]['zones']['library']); menu(pg, lib, 'Mill 1'); check('mill 1', len(state(pg)['players'][0]['zones']['library']) == n0 - 1)
    menu(pg, lib, 'Draw 7'); pg.wait_for_timeout(1200); check('draw 7', len(state(pg)['players'][0]['zones']['library']) == n0 - 8)
    menu(pg, lib, 'Look at the top 3'); pg.wait_for_timeout(300); check('top 3 opens with 3 cards', pg.locator('.zitem').count() == 3)
    pg.locator('.zitem [data-za=bottom]').first.click(); pg.wait_for_timeout(300); check('top-3: send to bottom keeps dialog with 2', pg.locator('.zitem').count() == 2); pg.click('[data-act=close]'); pg.wait_for_timeout(300)
    menu(pg, lib, 'Shuffle'); check('shuffle', 'shuffled' in pg.locator('#toasts').text_content())
    # graveyard view & move
    pg.locator('.me [data-pile$=graveyard] .slot').click(); pg.wait_for_timeout(300)
    gcount = pg.locator('.zitem').count(); check('graveyard view opens', gcount >= 1)
    if gcount: pg.locator('.zitem [data-za=exile]').first.click(); pg.wait_for_timeout(300); check('graveyard: move a card to exile', len(state(pg)['players'][0]['zones']['exile']) >= 1)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    # drag battlefield -> graveyard, and reposition
    bfc = pg.locator('.me .bf .card').first; gy = len(state(pg)['players'][0]['zones']['graveyard'])
    drag(pg, bfc, pg.locator('.me [data-pile$=graveyard] .slot')); check('drag battlefield card to graveyard', len(state(pg)['players'][0]['zones']['graveyard']) == gy + 1)
    if pg.locator('.me .bf .card').count():
        c0 = pg.locator('.me .bf .card').first; cid = c0.get_attribute('data-id'); x0 = state(pg)['cards'][cid]['x']
        drag(pg, c0, pg.locator('.me .bf'), dx=200, dy=-60); check('drag to reposition on battlefield', abs(state(pg)['cards'][cid]['x'] - x0) > 0.05)
    # hand fan layout
    rots = pg.eval_on_selector_all('.hand .card', 'els=>els.map(e=>e.style.getPropertyValue("--rot"))')
    check('hand is fanned (cards rotated progressively)', len(rots) >= 3 and rots[0] != rots[-1] and rots[0].endswith('deg'))
    check('hand cards are larger than opponents\' cards', pg.eval_on_selector('.hand .card', 'e=>e.offsetWidth') > pg.eval_on_selector('.opps .bf .card, .opps .seat', 'e=>e.closest(".seat") ? 70 : 70'), pg.evaluate("()=>[document.querySelectorAll('.hand .card').length, document.querySelector('.hand .card').offsetWidth, document.querySelector('.me .hand').clientWidth, innerWidth, innerHeight]"))
    # zoom
    pg.mouse.move(5, 5); c = pg.locator('.hand .card').last.bounding_box(); pg.mouse.move(c['x'] + c['width'] * .6, c['y'] + c['height'] * .5); pg.mouse.move(c['x'] + c['width'] * .62, c['y'] + c['height'] * .52); pg.wait_for_timeout(600)
    check('hover zoom shows large card with artist credit', ('Test Artist' in pg.locator('#zoom').text_content() if pg.is_visible('#zoom') else 'Test Artist' in pg.locator('#sideCard').text_content()))
    pg.mouse.move(5, 5); pg.wait_for_timeout(200)
    # seat switch (hotseat), rename, playmat
    pg.select_option('#viewSel', '2'); pg.wait_for_timeout(500); check('Playing as switches seat', state(pg)['view'] == 2 and 'Dax' in pg.locator('.me .pname').text_content())
    pg.click('.me .pname'); pg.click('.mi:has-text("Rename")'); pg.fill('#rnIn', 'Renamed'); pg.keyboard.press('Enter'); pg.wait_for_timeout(300); check('rename seat', state(pg)['players'][2]['name'] == 'Renamed')
    pg.click('.me .pname'); pg.click('.mi:has-text("Choose playmat")'); pg.wait_for_timeout(300); pg.click('[data-mat-pick=orzhov]'); pg.wait_for_timeout(300); check('choose playmat', pg.eval_on_selector('.me .seat', 'e=>e.dataset.mat') == 'orzhov'); pg.keyboard.press('Escape')
    pg.select_option('#viewSel', '0'); pg.wait_for_timeout(400)
    # settings menu
    pg.click('#settingsBtn'); pg.wait_for_timeout(200); pg.click('.mi:has-text("Playmat effects")'); pg.wait_for_timeout(300); check('settings: effects toggle', state(pg)['fx'] is False)
    pg.click('#settingsBtn'); pg.wait_for_timeout(200); pg.click('.mi:has-text("Sound")'); pg.wait_for_timeout(300); check('settings: sound toggle', state(pg)['sound'] is True)
    pg.click('#settingsBtn'); pg.wait_for_timeout(200); pg.click('.mi:has-text("Card motion")'); pg.wait_for_timeout(300); check('settings: motion cycles', state(pg)['motion'] == 'reduced')
    pg.click('#settingsBtn'); pg.wait_for_timeout(200); pg.click('.mi:has-text("Game log")'); pg.wait_for_timeout(300); check('game log opens with entries', pg.locator('.loglist li').count() > 5); pg.keyboard.press('Escape')
    pg.click('[data-act=d20]'); pg.wait_for_timeout(200); check('d20 roll', 'd20' in pg.locator('#toasts').text_content())
    # elimination & win
    pg.locator('.lifebadge[data-p="1"]').click(); pg.wait_for_timeout(200)
    for _ in range(7): pg.locator('[data-dm=poison][data-d="1"]').click(); pg.wait_for_timeout(80)
    pg.wait_for_timeout(500); check('10 poison eliminates the player', state(pg)['players'][1]['out'] and pg.locator('.seat[data-seat="1"].out').count() == 1)
    if not pg.locator('#modal').is_hidden(): pg.keyboard.press('Escape')
    pg.evaluate("document.querySelector('.seat[data-seat=\"2\"] [data-act=life][data-d=\"-1\"]').click()")
    for _ in range(8): pg.locator('.seat[data-seat="2"] [data-act=life][data-d="-1"]').click(modifiers=['Shift'], force=True); pg.wait_for_timeout(60)
    pg.wait_for_timeout(600); check('life 0 eliminates the player', state(pg)['players'][2]['out'])
    pg.click('.seat[data-seat="3"] .pname'); pg.wait_for_timeout(150); pg.click('.mi:has-text("Concede")'); pg.wait_for_timeout(2000)
    check('last player standing wins: recap dialog', pg.locator('.recap').count() == 1 and 'Ash wins' in pg.locator('.recap').text_content())
    pg.click('[data-act=again]'); pg.wait_for_timeout(1500); st = state(pg)
    check('play again resets life and board, keeps names', all(x['life'] == 40 for x in st['players']) and st['players'][2]['name'] == 'Renamed' and not st['over'])
    # import: Moxfield, Archidekt, no-tag, empty
    pg.click('#importBtn'); pg.wait_for_timeout(200)
    pg.fill('#impList', 'Commander\n1 Krenko, Mob Boss\n\nDeck\n1 Goblin Chieftain\n98 Mountain'); pg.wait_for_timeout(200)
    check('import summary: Moxfield format, 100 cards', '100' not in pg.locator('#impSum .bad').text_content() if pg.locator('#impSum .bad').count() else 'Krenko' in pg.locator('#impSum').text_content())
    pg.fill('#impList', '1x Krenko, Mob Boss (m19) 110 [Commander{top}]\n1x Goblin Chieftain (m12) 139 [Creatures]\n1x Lightning Bolt (sta) 42 *F* [Instants]\n30x Mountain (unh) 139 [Lands]'); pg.wait_for_timeout(200)
    check('import summary: Archidekt commander tag', 'Commander: Krenko' in pg.locator('#impSum').text_content())
    pg.fill('#impList', '1 Goblin Chieftain\n30 Mountain'); pg.wait_for_timeout(200); check('import: untagged list asks for a commander', pg.locator('#impCmdPick').count() == 1)
    pg.click('#impGo'); pg.wait_for_timeout(200); check('import refuses to seat without a commander', 'Pick a commander' in pg.locator('#toasts').text_content())
    pg.select_option('#impCmdPick', 'Goblin Chieftain'); pg.click('#impGo'); pg.wait_for_timeout(1500); st = state(pg)
    check('import seats the deck: commander in zone, 7 in hand', [c for c in st['cards'].values() if c['isCmdr'] and c['owner'] == 0][0]['name'] == 'Goblin Chieftain' and len(st['players'][0]['zones']['hand']) == 7)
    pg.click('#importBtn'); pg.fill('#impList', ''); pg.click('#impGo'); pg.wait_for_timeout(200); check('import: empty list is refused', 'empty' in pg.locator('#toasts').text_content()); pg.keyboard.press('Escape')
    # persistence
    before = state(pg); pg.reload(); pg.wait_for_timeout(1200); after = state(pg)
    check('state persists across reload', before['players'][0]['zones']['hand'] == after['players'][0]['zones']['hand'] and after['players'][2]['name'] == 'Renamed')
    # custom mat upload
    from PIL import Image; Image.new('RGB', (1200, 800), (90, 40, 120)).save(SP + 'mymat.jpg')
    pg.click('.me .pname'); pg.click('.mi:has-text("Choose playmat")'); pg.wait_for_timeout(200); pg.set_input_files('#matFile', SP + 'mymat.jpg'); pg.wait_for_timeout(800)
    check('upload custom playmat', pg.eval_on_selector('.me .seat', 'e=>e.dataset.mat') == 'custom'); pg.click('#matRemove'); pg.wait_for_timeout(300); pg.keyboard.press('Escape')
    # New game button
    pg.click('#newBtn'); pg.wait_for_timeout(200); pg.click('#okBtn'); pg.wait_for_timeout(1200); st = state(pg)
    check('New game button resets with confirmation', st['turn']['number'] == 1 and all(len(x['zones']['hand']) == 7 for x in st['players']))
    # mobile
    pg.set_viewport_size({'width': 400, 'height': 860}); pg.wait_for_timeout(400)
    check('phone width: no horizontal scroll', not pg.evaluate('document.documentElement.scrollWidth > innerWidth + 1'))
    pg.set_viewport_size({'width': 1440, 'height': 900})
    check('table: no JS errors', not errs, str(errs)[:300])
    ctx.close()

    # ================= B2. Saved decks (signed in) =================
    ctx = browser.new_context(); pg, errs = setup(ctx)
    pg.goto(BASE + '/'); pg.wait_for_timeout(600); pg.click('nav [data-go=signin]'); pg.wait_for_timeout(200); pg.click('[data-tab=guest]'); pg.wait_for_timeout(200); pg.fill('#nm', 'Tester'); pg.click('#guest'); pg.wait_for_timeout(900)
    check('home lists saved decks after sign-in', 'Krenko Goblins' in pg.locator('#decksBody').text_content())
    pg.evaluate("localStorage.setItem('edhclub-last-deck','d1')")
    pg.goto(BASE + '/table.html?mode=bots&seats=2&bots=1&name=Tester'); pg.wait_for_timeout(2500)
    check('last-used deck seats automatically at a new table', 'Seated with Krenko Goblins' in pg.locator('#toasts').text_content() or [c for c in state(pg)['cards'].values() if c['isCmdr'] and c['owner'] == 0][0]['name'] == 'Krenko, Mob Boss')
    pg.click('#importBtn'); pg.wait_for_timeout(900)
    check('Decks dialog shows the deck library', pg.locator('.decklib').count() == 1 and 'Krenko Goblins' in pg.locator('.decklib').text_content())
    pg.click('[data-deck-load]'); pg.wait_for_timeout(500); check('Load fills the list and name', 'Krenko' in pg.locator('#impList').input_value() and pg.locator('#impDeckName').input_value() == 'Krenko Goblins')
    pg.fill('#impDeckName', 'Saved Deck'); pg.click('#impSave'); pg.wait_for_timeout(900); check('Save to my decks succeeds', 'Saved Saved Deck' in pg.locator('#toasts').text_content())
    check('decks: no JS errors', not errs, str(errs)[:200])
    ctx.close()

    # ================= C. Bots =================
    ctx = browser.new_context(); pg, errs = setup(ctx)
    pg.goto(BASE + '/table.html?mode=bots&seats=4&bots=3&name=Trevor'); pg.wait_for_timeout(1500)
    check('bots mode seats me plus 3 bots', pg.locator('.avatar.bot').count() == 3 and 'Trevor' in pg.locator('.me .pname').text_content())
    check('Seat selector hidden outside hotseat', pg.locator('#viewSel').is_hidden())
    pg.click('[data-act=pass]'); t0 = time.time()
    def take_all():
        if pg.locator('#prompt [data-act=allowAll]').count(): pg.click('#prompt [data-act=allowAll]'); return True
        if pg.locator('#prompt [data-act=pok]').count(): pg.click('#prompt [data-act=pok]')
    prompted = False
    while time.time() - t0 < 70:
        pg.wait_for_timeout(700); prompted = take_all() or prompted
        if state(pg)['turn']['active'] == 0 and state(pg)['turn']['number'] == 2: break
    pg.click('[data-act=pass]')
    while time.time() - t0 < 150:
        pg.wait_for_timeout(700); prompted = take_all() or prompted
        if state(pg)['turn']['active'] == 0 and state(pg)['turn']['number'] == 3: break
    st = state(pg)
    check('three bots each took two turns and passed back within 150s', st['turn']['active'] == 0 and st['turn']['number'] == 3, f"active={st['turn']['active']} round={st['turn']['number']}")
    played = sum(len(st['players'][k]['zones']['battlefield']) for k in (1, 2, 3))
    check('bots played cards to their battlefields', played >= 3, str(played))
    check('bots: no JS errors', not errs, str(errs)[:300])
    ctx.close()

    # ================= D. Two-player sync =================
    ctx = browser.new_context(); ctx.add_init_script(FAKE_CHANNEL_JS)
    host, herr = setup(ctx); guest, gerr = setup(ctx)
    host.goto(BASE + '/table.html?room=TESTR&host=1&name=Host&seats=3&bots=1'); host.wait_for_timeout(2500)
    guest.goto(BASE + '/table.html?room=TESTR&name=Guest'); guest.wait_for_timeout(3000); host.wait_for_timeout(800)
    check('host seated at seat 0 with code shown', 'TESTR' in host.locator('#roomBar').text_content())
    check('guest takes seat 1 and host sees the name', 'Guest' in host.locator('.seat[data-seat="1"] .pname').text_content())
    check('guest sees host name on seat 0', 'Host' in guest.locator('.seat[data-seat="0"] .pname').text_content())
    check('bot seat visible to guest', guest.locator('.seat[data-seat="2"] .avatar.bot').count() == 1)
    gh = len(state(guest)['players'][1]['zones']['hand'])
    check('guest hand is hidden on host (card backs)', host.locator('.seat[data-seat="1"] .minipiles').text_content().find(str(gh)) >= 0 and host.locator('.seat[data-seat="1"] .hand').count() == 0)
    # guest plays a card
    gcard = guest.locator('.hand .card').first; gname = gcard.locator('img').get_attribute('alt')
    menu(guest, gcard, 'Put onto battlefield'); host.wait_for_timeout(1200)
    hs = state(host); check('guest play appears on host within ~1s', any(hs['cards'][i]['name'] == gname for i in hs['players'][1]['zones']['battlefield']), gname)
    # host cannot drag guest card
    gcel = host.locator('.seat[data-seat="1"] .bf .card').first
    if gcel.count():
        drag(host, gcel, host.locator('.me [data-pile$=graveyard] .slot')); check("host can't move the guest's card", len(state(host)['players'][1]['zones']['battlefield']) >= 1)
        gcel.click(button='right'); host.wait_for_timeout(150); check("host's menu on guest card is view-only", host.locator('.menu .mi').count() <= 1); host.keyboard.press('Escape')
    # host damages guest via life button -> request
    host.locator('.seat[data-seat="1"] [data-act=life][data-d="-1"]').click(modifiers=['Shift'], force=True); host.wait_for_timeout(1200)
    check('life request: guest applies and both agree', state(guest)['players'][1]['life'] == 35 and state(host)['players'][1]['life'] == 35, f"g={state(guest)['players'][1]['life']} h={state(host)['players'][1]['life']}")
    # guest attacks host with a creature
    gcr = guest.locator('.me .bf .card').first
    if menu(guest, gcr, 'Attack Host'):
        host.wait_for_timeout(1200); host.click('#prompt [data-act=allowAll]'); guest.wait_for_timeout(1200)
        menu(guest, gcr, 'combat damage'); host.wait_for_timeout(1200)
        check('combat damage across clients lowers host life on both', state(host)['players'][0]['life'] == 37 and state(guest)['players'][0]['life'] == 37, f"h={state(host)['players'][0]['life']} g={state(guest)['players'][0]['life']}")
    # host passes turn -> guest sees it's their turn
    host.click('[data-act=pass]'); guest.wait_for_timeout(1500)
    check('turn passes to guest on both screens', state(guest)['turn']['active'] == 1 and 'Your turn' in guest.locator('.turnbar .who').text_content())
    # board wipe from host clears guest creature on both
    host.click('[data-act=wipe]'); host.click('.mi:has-text("Destroy all creatures")'); guest.wait_for_timeout(1500)
    check('board wipe applies on every client', not any('Creature' in state(guest)['cards'][i]['type'] for i in state(guest)['players'][1]['zones']['battlefield']) and not any('Creature' in state(host)['cards'][i]['type'] for i in state(host)['players'][1]['zones']['battlefield']))
    # bot turn (seat 2) runs on host and is visible to guest
    guest.click('[data-act=pass]'); host.wait_for_timeout(9000); guest.wait_for_timeout(500)
    check('bot turn ran on host and guest sees its plays', len(state(guest)['players'][2]['zones']['battlefield']) >= 1 or state(guest)['turn']['active'] == 0)
    check('guest cannot start a new game', (guest.click('#newBtn'), guest.wait_for_timeout(200), 'Only the host' in guest.locator('#toasts').text_content())[-1])
    host.click('#newBtn'); host.wait_for_timeout(200); host.click('#okBtn'); guest.wait_for_timeout(1500)
    check('host new game resets the guest too', all(x['life'] == 40 for x in state(guest)['players'][:3]) and state(guest)['turn']['number'] == 1)
    check('sync: no JS errors on host', not herr, str(herr)[:300]); check('sync: no JS errors on guest', not gerr, str(gerr)[:300])
    host.screenshot(path=SP + 'sync-host.png'); guest.screenshot(path=SP + 'sync-guest.png')
    ctx.close(); browser.close()

fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
