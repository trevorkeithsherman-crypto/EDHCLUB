"""Second pass: multiplayer edge cases, decks inside rooms, reconnects, club game record, 2-player tables."""
import sys, time, json
sys.argv = ['x', sys.argv[1]]
src = open('tests/deep.py').read().split('with sync_playwright() as p:')[0]
exec(src)
posted = []
_orig = supabase_mock
def supabase_mock2(route):
    if route.request.method in ('POST', 'PATCH') and '/rest/v1/' in route.request.url:
        try: posted.append((route.request.url.split('/rest/v1/')[1].split('?')[0], json.loads(route.request.post_data or '{}')))
        except Exception: posted.append((route.request.url, None))
    _orig(route)
def setup2(ctx):
    pg, errs = setup(ctx); pg.unroute('https://*.supabase.co/**'); pg.route('https://*.supabase.co/**', supabase_mock2); return pg, errs

with sync_playwright() as p:
    browser = p.chromium.launch()
    # ---- 1. Three humans + one bot, seat allocation, full table ----
    ctx = browser.new_context(); ctx.add_init_script(FAKE_CHANNEL_JS)
    host, he = setup2(ctx); g1, e1 = setup2(ctx); g2, e2 = setup2(ctx); g3, e3 = setup2(ctx)
    host.goto(BASE + '/table.html?room=ROOM4&host=1&name=Host&seats=4&bots=1&club=c1'); host.wait_for_timeout(2500)
    g1.goto(BASE + '/table.html?room=ROOM4&name=Guest1'); g1.wait_for_timeout(2600)
    g2.goto(BASE + '/table.html?room=ROOM4&name=Guest2'); g2.wait_for_timeout(2600)
    host.wait_for_timeout(800)
    seats = host.eval_on_selector_all('.seat .pname span:first-child', 'e=>e.map(x=>x.textContent)')
    check('three humans seated with distinct seats; bot in the last seat', 'Guest1' in seats and 'Guest2' in seats and host.locator('.seat[data-seat="3"] .avatar.bot').count() == 1, str(seats))
    check('every client sees every other name', 'Guest2' in g1.locator('#opps').text_content() and 'Host' in g2.locator('#opps').text_content() and 'Guest1' in g2.locator('#opps').text_content())
    g3.goto(BASE + '/table.html?room=ROOM4&name=Guest3'); g3.wait_for_timeout(2600)
    check('a fourth human is told the table is full', 'full' in g3.locator('body').text_content().lower())
    check('seated count shows 3 of 3', '3/3' in host.locator('#roomBar').text_content(), host.locator('#roomBar').text_content())
    # chain of plays visible everywhere
    for pg_, nm in ((host, 'Host'), (g1, 'Guest1'), (g2, 'Guest2')):
        menu(pg_, pg_.locator('.hand .card').first, 'Put onto battlefield')
    host.wait_for_timeout(1500)
    tot = lambda pg_: sum(len(state(pg_)['players'][k]['zones']['battlefield']) for k in range(3))
    check('plays from all three clients converge on every screen', tot(host) == 3 and tot(g1) == 3 and tot(g2) == 3, f"{tot(host)},{tot(g1)},{tot(g2)}")
    # turn order and bot
    host.click('[data-act=pass]'); g1.wait_for_timeout(1200); check("turn goes to Guest1 (seat 1)", state(g1)['turn']['active'] == 1)
    g1.click('[data-act=pass]'); g2.wait_for_timeout(1200); check('Guest1 passes to Guest2', state(g2)['turn']['active'] == 2)
    g2.click('[data-act=pass]'); host.wait_for_timeout(9000); g1.wait_for_timeout(500)
    check('bot (host-run) takes its turn and passes back to Host, seen by Guest1', state(g1)['turn']['active'] == 0 and state(g1)['turn']['number'] == 2, str(state(g1)['turn']))
    # cross damage from a guest to another guest
    g1.locator('.seat[data-seat="2"] [data-act=life][data-d="-1"]').click(modifiers=['Shift'], force=True); host.wait_for_timeout(1200)
    check('guest-to-guest life request converges on all clients', state(host)['players'][2]['life'] == 35 and state(g2)['players'][2]['life'] == 35 and state(g1)['players'][2]['life'] == 35)
    # reconnect: guest2 reloads mid-game
    g2life = state(g2)['players'][2]['life']; g2.reload(); g2.wait_for_timeout(3200); host.wait_for_timeout(1500)
    check('a reloaded guest rejoins the same seat', state(g2)['view'] == 2 and 'Guest2' in host.locator('.seat[data-seat="2"] .pname').text_content())
    check('after reload the guest sees the others\' boards again (resend on hello)', len(state(g2)['players'][0]['zones']['battlefield']) >= 1 and len(state(g2)['players'][1]['zones']['battlefield']) >= 1)
    check('after reload the guest\'s own board and life survive', len(state(g2)['players'][2]['zones']['battlefield']) >= 1 and state(g2)['players'][2]['life'] == g2life, 'own seat resets on reload')
    # deck save inside a room
    host.click('#importBtn'); host.wait_for_timeout(900)
    check('Decks dialog inside a room shows the library', host.locator('.decklib').count() == 1)
    host.fill('#impList', 'Commander\n1 Krenko, Mob Boss\n\nDeck\n1 Goblin Chieftain\n98 Mountain'); host.fill('#impDeckName', 'Room Deck'); host.click('#impSave'); host.wait_for_timeout(900)
    check('Save to my decks from a room table', any(t == 'decks' for t, _ in posted) and 'Saved Room Deck' in host.locator('#toasts').text_content())
    host.click('#impGo'); host.wait_for_timeout(1500); g1.wait_for_timeout(600)
    check('seating a new deck in a room is seen by others (commander name updates)', 'Krenko' in g1.locator('.seat[data-seat="0"] .cmdn').text_content())
    check('import in a room has no seat picker (own seat only)', host.locator('#impSeat').count() == 0 or host.locator('#impSeat').is_hidden())
    # concede in a room and win record to club
    g1.click('.me .pname'); g1.wait_for_timeout(150); g1.click('.mi:has-text("Concede")'); host.wait_for_timeout(1200)
    check('a guest conceding is seen as Out by the host', host.locator('.seat[data-seat="1"] .outtag').count() == 1)
    g2.click('.me .pname'); g2.wait_for_timeout(150); g2.click('.mi:has-text("Concede")'); host.wait_for_timeout(1200)
    # eliminate bot via poison from host (host owns bot seat)
    host.locator('.lifebadge[data-p="3"]').click(); host.wait_for_timeout(200)
    for _ in range(10): host.locator('[data-dm=poison][data-d="1"]').click(); host.wait_for_timeout(60)
    host.wait_for_timeout(2500)
    check('last player standing: host sees the win recap', host.locator('.recap').count() == 1 and 'Host wins' in host.locator('.recap').text_content())
    check('win is recorded to the games table with club id', any(t == 'games' and (b or {}).get('club_id') == 'c1' and (b or {}).get('winner_name') == 'Host' for t, b in posted), str([b for t, b in posted if t == 'games'])[:200])
    check('room marked finished', any(t == 'rooms' and (b or {}).get('status') == 'finished' for t, b in posted))
    g1.wait_for_timeout(800); check('guests see the game over too', state(g1)['over'] is True)
    check('no JS errors across four clients', not (he or e1 or e2 or e3), str(he + e1 + e2 + e3)[:300])
    ctx.close()

    # ---- 2. Two-player table, no bots; late joiner gets host's existing board ----
    ctx = browser.new_context(); ctx.add_init_script(FAKE_CHANNEL_JS)
    host, he = setup2(ctx)
    host.goto(BASE + '/table.html?room=DUEL1&host=1&name=Host&seats=2&bots=0'); host.wait_for_timeout(2500)
    for _ in range(2): menu(host, host.locator('.hand .card').first, 'Put onto battlefield')
    check('2-seat table shows one opponent slot', host.locator('.opps .seat').count() == 1)
    guest, ge = setup2(ctx); guest.goto(BASE + '/table.html?room=DUEL1&name=Late'); guest.wait_for_timeout(3200)
    check('late joiner receives the host\'s existing board', len(state(guest)['players'][0]['zones']['battlefield']) == 2)
    check('late joiner sees phase/turn from host', state(guest)['turn']['active'] == 0)
    # custom mat on host is NOT synced (expected gap)
    from PIL import Image; Image.new('RGB', (600, 400), (10, 120, 90)).save(SP + 'm.jpg')
    host.click('.me .pname'); host.click('.mi:has-text("Choose playmat")'); host.wait_for_timeout(200); host.set_input_files('#matFile', SP + 'm.jpg'); host.wait_for_timeout(800); host.keyboard.press('Escape'); guest.wait_for_timeout(800)
    check('host custom mat is private to host (KNOWN GAP: not shared)', guest.eval_on_selector('.seat[data-seat="0"]', 'e=>e.dataset.mat') != 'custom')
    # built-in mat choice IS synced
    host.click('.me .pname'); host.click('.mi:has-text("Choose playmat")'); host.wait_for_timeout(200); host.click('[data-mat-pick=orzhov]'); host.wait_for_timeout(300); host.keyboard.press('Escape'); guest.wait_for_timeout(900)
    check('built-in mat choice syncs to the other player', guest.eval_on_selector('.seat[data-seat="0"]', 'e=>e.dataset.mat') == 'orzhov')
    # guest views host graveyard (allowed) and cannot draw for host
    menu(host, host.locator('.me .bf .card').first, 'Put in graveyard'); guest.wait_for_timeout(900)
    guest.locator('.seat[data-seat="0"] [data-zone$=graveyard]').click(); guest.wait_for_timeout(300)
    check('guest can view the host\'s graveyard', guest.locator('.zitem').count() == 1); guest.keyboard.press('Escape')
    guest.locator('.seat[data-seat="0"] [data-zone$=library]').click(); guest.wait_for_timeout(300)
    check('guest cannot draw from the host\'s library', len(state(guest)['players'][0]['zones']['library']) == len(state(host)['players'][0]['zones']['library']))
    # tokens created by guest show on host
    guest.click('[data-act=token]'); guest.wait_for_timeout(200); guest.fill('#tkN', '2'); guest.click('#tkGo'); host.wait_for_timeout(1200)
    check('guest tokens appear on host', sum(1 for c in state(host)['cards'].values() if c['token'] and c['owner'] == 1) == 2)
    # guest attacks host, host sees arrow + tapped attacker
    tok = guest.locator('.me .bf .card').first; menu(guest, tok, 'Attack Host'); host.wait_for_timeout(900)
    check('attack arrow and tapped attacker visible on host', host.locator('#arrows path.arw').count() >= 1 and any(c['tapped'] for c in state(host)['cards'].values() if c['owner'] == 1))
    check('no JS errors (duel)', not (he or ge), str(he + ge)[:200])
    ctx.close()

    # ---- 3. Sign-up with email confirmation required (no session returned) ----
    ctx = browser.new_context(); pg, errs = setup2(ctx)
    def signup_noconfirm(route):
        if '/auth/v1/signup' in route.request.url: route.fulfill(status=200, content_type='application/json', body=json.dumps({'id': 'u2', 'email': 'new@example.com', 'confirmation_sent_at': '2026-10-08T00:00:00Z', 'user_metadata': {}, 'app_metadata': {}, 'aud': 'authenticated', 'role': '', 'created_at': '2026-10-08T00:00:00Z'})); return
        supabase_mock2(route)
    pg.unroute('https://*.supabase.co/**'); pg.route('https://*.supabase.co/**', signup_noconfirm)
    pg.goto(BASE + '/'); pg.wait_for_timeout(600); pg.click('nav [data-go=signup]'); pg.wait_for_timeout(200)
    pg.fill('#nm', 'Newbie'); pg.fill('#em', 'new@example.com'); pg.fill('#pw', 'longenough1'); pg.click('#signup'); pg.wait_for_timeout(900)
    check('sign-up with confirmation required shows the check-your-email screen', 'Check your email' in pg.locator('#lobbyTitle').text_content())
    def dup(route):
        if '/auth/v1/signup' in route.request.url: route.fulfill(status=422, content_type='application/json', body=json.dumps({'code': 422, 'msg': 'User already registered'})); return
        supabase_mock2(route)
    pg.unroute('https://*.supabase.co/**'); pg.route('https://*.supabase.co/**', dup)
    pg.click('nav [data-go=signup]'); pg.wait_for_timeout(200); pg.fill('#nm', 'Newbie'); pg.fill('#em', 'new@example.com'); pg.fill('#pw', 'longenough1'); pg.click('#signup'); pg.wait_for_timeout(600)
    check('duplicate email gets a friendly message', 'already has an account' in pg.locator('#toasts').text_content())
    def badpw(route):
        if '/auth/v1/token' in route.request.url: route.fulfill(status=400, content_type='application/json', body=json.dumps({'error': 'invalid_grant', 'error_description': 'Invalid login credentials'})); return
        supabase_mock2(route)
    pg.unroute('https://*.supabase.co/**'); pg.route('https://*.supabase.co/**', badpw)
    pg.click('nav [data-go=signin]'); pg.wait_for_timeout(200); pg.fill('#em', 'new@example.com'); pg.fill('#pw', 'wrongpass1'); pg.click('#login'); pg.wait_for_timeout(600)
    check('wrong password gets a friendly message', 'Wrong email or password' in pg.locator('#toasts').text_content())
    check('auth: no JS errors', not errs, str(errs)[:200])
    ctx.close()

    # ---- 4. Hotseat regression spot checks at phone width ----
    ctx = browser.new_context(has_touch=True); pg, errs = setup2(ctx); pg.set_viewport_size({'width': 400, 'height': 860})
    pg.goto(BASE + '/table.html'); pg.evaluate('localStorage.clear()'); pg.reload(); pg.wait_for_timeout(2000)
    check('phone: turn bar and hand render', pg.locator('.turnbar').count() == 1 and pg.locator('.hand .card').count() == 7)
    pg.locator('.hand .card').last.tap(); pg.wait_for_timeout(100); pg.locator('.hand .card').last.tap(); pg.wait_for_timeout(1200)
    check('phone: double-tap plays a card', len(state(pg)['players'][0]['zones']['hand']) == 6 or len(state(pg)['players'][0]['zones']['battlefield']) >= 1)
    check('phone: no horizontal scroll after play', not pg.evaluate('document.documentElement.scrollWidth > innerWidth + 1'))
    check('phone: no JS errors', not errs, str(errs)[:200])
    ctx.close(); browser.close()

fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
