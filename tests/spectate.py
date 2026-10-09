"""Spectator mode: watch a live room without a seat. Read-only board, hidden hands, live updates, host sees who's watching."""
import sys, json, time
sys.argv = ['x', sys.argv[1]]
src = open('tests/deep.py').read().split('with sync_playwright() as p:')[0]
exec(src)
with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(); ctx.add_init_script(FAKE_CHANNEL_JS)
    host, he = setup(ctx); guest, ge = setup(ctx); spec, se = setup(ctx)
    host.goto(BASE + '/table.html?room=WATCH1&host=1&name=Host&seats=3&bots=1'); host.wait_for_timeout(2200)
    guest.goto(BASE + '/table.html?room=WATCH1&name=Guest'); guest.wait_for_timeout(2400)
    spec.goto(BASE + '/table.html?room=WATCH1&spectate=1&name=Watcher'); spec.wait_for_timeout(2800)
    api = spec.evaluate("()=>{const a=__edhApi(); return {spectate:a.spectate, seat:a.net.seat, spectator:a.net.spectator, host:a.net.isHost}}")
    check('spectator joins with no seat and is never the host', api['spectate'] and api['seat'] is None and api['spectator'] and not api['host'], str(api))
    check('spectator page is marked read-only', spec.evaluate("()=>document.body.classList.contains('spectator')"))
    check('spectator sees a Watching badge and no Invite button', spec.locator('#roomBar .watching').count() == 1 and spec.locator('#copyInvite').count() == 0)
    st = state(spec)
    check('spectator sees both humans seated and the bot', st['players'][0]['name'] == 'Host' and st['players'][1]['name'] == 'Guest' and st['players'][2]['bot'])
    hand0 = [st['cards'][i] for i in st['players'][0]['zones']['hand']]
    check('spectator never sees card names from any hand in the DOM', spec.locator('.hand .card:not(.facedown)').count() == 0)
    # host still counts seated humans correctly and sees who's watching
    host.wait_for_timeout(600)
    check('host room bar counts 2/2 players and 1 watching', '2/2' in host.locator('#roomBar').text_content() and '👁 1' in host.locator('#roomBar').text_content(), host.locator('#roomBar').text_content())
    check('host log notes the spectator', any('Watcher is watching' in l['text'] for l in state(host)['log']))
    check('spectator does not occupy a seat on the host', not any(p['name'] == 'Watcher' for p in state(host)['players']))
    # live updates flow to the spectator: host plays a land and changes life
    host.evaluate("__edhMut(st=>{ st.players[0].life = 33; })"); host.wait_for_timeout(900)
    check('life change shows up for the spectator', state(spec)['players'][0]['life'] == 33)
    hid = host.evaluate("()=>{const st=__edhState(); const id=st.players[0].zones.hand[0]; __edhApi().moveCard(id, 0, 'battlefield'); return id;}"); host.wait_for_timeout(1000)
    sc = state(spec)['cards'].get(hid)
    check('a card played to the battlefield appears face up for the spectator', sc and sc['zone'] == 'battlefield' and sc['name'], str(sc)[:120])
    # spectator cannot act
    spec.locator('[data-act=pass]').first.dispatch_event('click'); spec.wait_for_timeout(500)
    check('Pass turn does nothing for a spectator (toast instead)', state(spec)['turn']['active'] == state(host)['turn']['active'] and "watching" in spec.locator('#toasts').text_content())
    spec.locator('[data-act=life][data-d="1"]').first.dispatch_event('click'); spec.wait_for_timeout(600)
    check('life buttons do nothing for a spectator', state(host)['players'][0]['life'] == 33)
    spec.keyboard.press('t'); spec.keyboard.press(' '); spec.wait_for_timeout(400)
    check('keyboard shortcuts are inert for a spectator', state(spec)['turn']['phase'] == state(host)['turn']['phase'])
    spec.locator(f'.card[data-id="{hid}"]').first.click(button='right'); spec.wait_for_timeout(200)
    check('right-click on a card offers Look closer only', spec.locator('.menu .mi').count() == 1 and 'Look closer' in spec.locator('.menu').text_content()); spec.keyboard.press('Escape')
    check('Import / Table / New game controls are hidden for spectators', spec.locator('#importBtn').is_hidden() and spec.locator('#tableBtn').is_hidden() and spec.locator('#newBtn').is_hidden())
    check('spectator sends no seat or shared snapshots', spec.evaluate("()=>{const n=__edhApi().net; return n.ownedSeats().length===0 && n.lastSentShared===''}"))
    # the host's watch link
    check('host has a Watch link button', host.locator('#copyWatch').count() == 1)
    # spectator leaving is logged
    spec.close(); host.wait_for_timeout(1200)
    check('host log notes when the spectator leaves', any('Watcher stopped watching' in l['text'] for l in state(host)['log']))
    check('no JS errors', not he and not ge and not se, str(he + ge + se)[:300])
    ctx.close()
    # ---- lobby: Watch button / ?watch= link ----
    ctx = browser.new_context(); pg, errs = setup(ctx)
    pg.goto(BASE + '/?watch=WATCH'); pg.wait_for_timeout(900)
    check('?watch= link opens Join with the code and a Watch button', pg.locator('#code').input_value() == 'WATCH' and pg.locator('#watch').count() == 1)
    pg.fill('#nm', 'Spec')
    pg.click('#watch'); pg.wait_for_timeout(600)
    check('Watch goes to the table as a spectator', 'spectate=1' in pg.url and 'room=WATCH&' in pg.url, pg.url)
    check('lobby: no JS errors', not errs, str(errs)[:300])
    browser.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
