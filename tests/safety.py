"""Matchmaking basics (tables page filters, seats-open counts, table title, Post to Discord, lock, club webhook) and
account/safety (block + report from a seat menu, blocked chat hidden, host keeps blocked players out, change email,
blocked list, delete account). Run: python3 tests/safety.py <port>"""
import sys, json, time
sys.argv = ['x', sys.argv[1]]
src = open('tests/deep.py').read().split('with sync_playwright() as p:')[0]
exec(src)
def menu_items(pg): return [t.strip() for t in pg.locator('#menu .mi').all_text_contents()]
with sync_playwright() as p:
    browser = p.chromium.launch()
    # ---------- tables page ----------
    ctx = browser.new_context(); pg, errs = setup(ctx)
    pg.goto(BASE + '/tables.html'); pg.wait_for_timeout(1200)
    check('tables page has bracket / bots / seats-open / voice filters and a notify toggle', pg.locator('#tableFilters select').count() == 2 and pg.locator('#tableFilters [data-f=open]').is_checked() and pg.locator('#notifyMe').count() == 1)
    body = pg.locator('#openBody').text_content()
    check('a full table is hidden by default (seats open filter) and the open one shows seats, voice and bracket', 'Mira' in body and '2 seats open' in body and 'voice' in body and 'cEDH grinders' not in body)
    pg.uncheck('#tableFilters [data-f=open]'); pg.wait_for_timeout(600); body = pg.locator('#openBody').text_content()
    check('turning the filter off shows the full table by its title, greyed, with Watch but no Join', 'cEDH grinders' in body and pg.locator('#openBody li.full').count() == 1 and pg.locator('#openBody li.full [data-join]').count() == 0 and pg.locator('#openBody li.full [data-watch]').count() == 1)
    pg.select_option('#tableFilters [data-f=bracket]', '5'); pg.wait_for_timeout(500)
    check('bracket filter narrows the list and the meta says "1 of 2"', 'Mira' not in pg.locator('#openBody').text_content() and '1 of 2' in pg.locator('#openMeta').text_content())
    pg.select_option('#tableFilters [data-f=bracket]', ''); pg.select_option('#tableFilters [data-f=bots]', 'no'); pg.wait_for_timeout(500)
    check('"No bots" hides the table with a bot', 'Mira' not in pg.locator('#openBody').text_content() and 'cEDH' in pg.locator('#openBody').text_content())
    # host form has a title
    pg.click('[data-go=create]'); pg.wait_for_timeout(300)
    check('host form has an optional table name', pg.locator('#ttl').count() == 1)
    ctx.close()
    # ---------- in-room: lock, announce, block, report ----------
    ctx = browser.new_context(); ctx.add_init_script(FAKE_CHANNEL_JS); ctx.add_init_script("window.__edhSkipOpening = true;")
    host, he = setup(ctx); guest, ge = setup(ctx)
    announced = []
    host.route('**/api/announce/**', lambda r: (announced.append(r.request.url), r.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'posted': 1}))))
    host.goto(BASE + '/table.html?room=SAFE1&host=1&name=Host&seats=3&bots=0'); host.wait_for_timeout(2000)
    guest.goto(BASE + '/table.html?room=SAFE1&name=Guest'); guest.wait_for_timeout(2600)
    gseat = guest.evaluate("__edhApi().net.seat")
    # the mock signs everyone in as the same test user; give the guest its own id so blocking has someone to block
    guest.evaluate(f"__edhMut(st=>{{ st.seatsBy[{gseat}].uid = '22222222-2222-4222-8222-222222222222'; }})"); guest.evaluate("__edhApi().net.uid = '22222222-2222-4222-8222-222222222222'; __edhApi().net.track()")
    host.wait_for_timeout(2000)
    patches = [p for c, p in STORE['room_patches'] if c == 'SAFE1']
    check('host keeps the listing live: seated humans and open seats are pushed to the rooms row', patches and patches[-1].get('seated') == 2 and patches[-1].get('open_seats') == 1 and patches[-1].get('status') == 'open', str(patches[-1:]))
    host.click('#tableBtn'); host.wait_for_timeout(300)
    check('Table dialog offers Lock and Post to Discord', host.locator('#tmLock').count() == 1 and host.locator('#tmAnnounce').count() == 1)
    host.click('#tmAnnounce'); host.wait_for_timeout(600)
    check('Post to Discord calls the announce endpoint and reports success', len(announced) == 1 and announced[0].endswith('/api/announce/SAFE1') and 'Posted to 1 Discord channel' in host.locator('#toasts').text_content())
    host.check('#tmLock'); host.wait_for_timeout(800); host.keyboard.press('Escape')
    patches = [p for c, p in STORE['room_patches'] if c == 'SAFE1']
    check('locking marks the room locked and takes it out of the open list (status live)', patches[-1].get('locked') is True and patches[-1].get('status') == 'live', str(patches[-1]))
    check('the guest learns the table is locked', guest.evaluate("__edhState().locked") is True)
    # block from the seat menu
    host.click(f'.seat[data-seat="{gseat}"] .pname'); host.wait_for_timeout(300)
    items = menu_items(host)
    check('host\'s seat menu for the guest offers Block, Report and Remove', any(i.startswith('Block') for i in items) and any(i.startswith('Report') for i in items) and any(i.startswith('Remove') for i in items), str(items))
    host.locator('#menu .mi:has-text("Report")').click(); host.wait_for_timeout(300)
    check('report dialog has a reason and details', host.locator('#rpReason').count() == 1 and host.locator('#rpDetails').count() == 1)
    host.select_option('#rpReason', 'harassment'); host.fill('#rpDetails', 'said rude things'); host.click('#rpSend'); host.wait_for_timeout(600)
    check('report is filed with reporter, reported name, room code, reason, details and a log excerpt', STORE['reports'] and STORE['reports'][-1]['reported_name'] == 'Guest' and STORE['reports'][-1]['room_code'] == 'SAFE1' and STORE['reports'][-1]['reason'] == 'harassment' and STORE['reports'][-1]['details'] == 'said rude things' and isinstance(STORE['reports'][-1]['log'], list) and 'Report sent' in host.locator('#toasts').text_content(), str(STORE['reports'][-1:])[:200])
    # the guest says something; then the host blocks them and their chat is hidden + they're removed
    guest.click('.side-tabs .tab[data-tab=chat]'); guest.wait_for_timeout(200); guest.fill('#chatInput', 'hello before block'); guest.keyboard.press('Enter'); guest.wait_for_timeout(600)
    host.click('.side-tabs .tab[data-tab=chat]'); host.wait_for_timeout(200)
    check('chat arrives normally before the block', 'hello before block' in host.locator('#chatList').text_content())
    host.click(f'.seat[data-seat="{gseat}"] .pname'); host.wait_for_timeout(300); host.locator('#menu .mi:has-text("Block")').click(); host.wait_for_timeout(2000)
    check('Block writes a block row and, as host, removes the player', STORE['blocks'] and STORE['blocks'][-1]['blocked_name'] == 'Guest' and 'blocked' in host.locator('#toasts').text_content().lower() and ('table.html' not in guest.url or 'removed you' in guest.locator('#toasts').text_content()), f"{STORE['blocks']} {guest.url}")
    check('no JS errors (room)', not he and not ge, str(he + ge)[:300])
    ctx.close()
    # ---------- account panel ----------
    ctx = browser.new_context(); pg, errs = setup(ctx)
    pg.goto(BASE + '/'); pg.wait_for_timeout(800); pg.click('nav [data-go=signin]'); pg.wait_for_timeout(200); pg.fill('#em', 'new@example.com'); pg.fill('#pw', 'longenough1'); pg.click('#login'); pg.wait_for_timeout(1500)
    pg.click('nav [data-go=signin]'); pg.wait_for_timeout(800)
    t = pg.locator('#lobbyBody').text_content()
    check('account panel: blocked players list and delete account are there (email change shows for non-guest accounts)', 'Blocked players' in t and pg.locator('#delAcct').count() == 1)
    check('blocked list shows the player blocked at the table with Unblock', 'Guest' in pg.locator('#blockList').text_content() and pg.locator('#blockList [data-unblock]').count() == 1)
    pg.click('#blockList [data-unblock]'); pg.wait_for_timeout(600)
    check('Unblock removes the row', not STORE['blocks'] and 'Nobody blocked' in pg.locator('#blockList').text_content())

    pg.click('#delAcct'); pg.wait_for_timeout(300)
    check('delete asks you to type DELETE and keeps the button disabled until you do', pg.locator('#delGo').is_disabled())
    pg.fill('#delWord', 'DELETE'); pg.wait_for_timeout(100); check('…enabled after typing DELETE', pg.locator('#delGo').is_enabled())
    pg.click('#delGo'); pg.wait_for_timeout(1800)
    check('delete calls the delete_me function and sends you to the landing page', STORE['deleted'] == 1 and pg.url.rstrip('/') == BASE.rstrip('/'), pg.url)
    check('no JS errors (account)', not errs, str(errs)[:300])
    ctx.close()
    # ---------- a permanent (non-guest) account sees the email change ----------
    FAKE_USER['is_anonymous'] = False; FAKE_USER['email'] = 'old@example.com'
    ctx = browser.new_context(); pg, errs = setup(ctx)
    pg.goto(BASE + '/'); pg.wait_for_timeout(800); pg.click('nav [data-go=signin]'); pg.wait_for_timeout(200); pg.fill('#em', 'old@example.com'); pg.fill('#pw', 'longenough1'); pg.click('#login'); pg.wait_for_timeout(1500)
    pg.click('nav [data-go=signin]'); pg.wait_for_timeout(800)
    check('permanent account: Change email section with the current address', pg.locator('#chem').count() == 1 and 'old@example.com' in pg.locator('#lobbyBody').text_content())
    pg.fill('#newEm', 'bad'); pg.click('#chem'); pg.wait_for_timeout(200); check('change email validates', 'valid email' in pg.locator('#toasts').text_content())
    pg.fill('#newEm', 'trevor@example.com'); pg.click('#chem'); pg.wait_for_timeout(600)
    check('change email calls auth and tells you to confirm', STORE['email_changes'] and STORE['email_changes'][-1].get('email') == 'trevor@example.com' and 'confirmation' in pg.locator('#toasts').text_content(), str(STORE['email_changes']))
    FAKE_USER['is_anonymous'] = True; FAKE_USER.pop('email', None)
    browser.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
