"""Opening hand screen: big cards, View battlefield / Mulligan / Keep; free first mulligan then London bottoms;
only your own hand; bots keep and wait for you; gone once kept or the game has started."""
import sys, json, time
sys.argv = ['x', sys.argv[1]]
src = open('tests/deep.py').read().split('with sync_playwright() as p:')[0]
exec(src)
OPT_IN = "window.__edhOpening = true;"
def ids_hand(pg, k=0): return state(pg)['players'][k]['zones']['hand']
with sync_playwright() as p:
    browser = p.chromium.launch()
    # ---------- bots mode ----------
    ctx = browser.new_context(); ctx.add_init_script(OPT_IN); pg, errs = setup(ctx)
    pg.goto(BASE + '/table.html?mode=bots&seats=4&bots=3'); pg.wait_for_timeout(2200)
    check('opening hand screen shows on a new game', pg.locator('#opening').is_visible() and pg.locator('#opening .oc').count() == 7)
    hand = ids_hand(pg); shown = [b.get_attribute('data-oc') for b in pg.locator('#opening .oc').all()]
    check('it shows exactly my hand, nobody else\'s', sorted(shown) == sorted(hand))
    check('buttons: View battlefield, Mulligan, Keep hand', pg.locator('#opening [data-op=view]').count() == 1 and pg.locator('#opening [data-op=mull]').count() == 1 and 'Keep hand' in pg.locator('#opening [data-op=keep]').text_content())
    check('cards are big (>= 150px wide on desktop)', pg.locator('#opening .oc').first.bounding_box()['width'] >= 150)
    check('no Mulligan button on the hand bar', pg.locator('.handbar [data-act=mull]').count() == 0)
    # hover near the bottom edge: the hit area stays put, so the card lifts once and stays up (no bounce)
    pg.wait_for_timeout(1200); oc = pg.locator('#opening .oc').nth(3); bb = oc.bounding_box(); cid = oc.get_attribute('data-oc')
    pg.mouse.move(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] - 4); samples = []
    for _ in range(14):
        pg.wait_for_timeout(60)
        samples.append(pg.evaluate("([x,y,id])=>{ const el=document.elementFromPoint(x,y); const b=el && el.closest('.oc'); const f=document.querySelector(`.oc[data-oc='${id}'] .oc-face`) || document.querySelector(`.oc[data-oc='${id}']`); return [b ? b.dataset.oc : null, Math.round(f.getBoundingClientRect().top)]; }", [bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] - 4, cid]))
    settled = samples[8:]
    check('hovering at the bottom edge: same card stays under the pointer, face lifts and holds still', all(x[0] == cid for x in samples) and max(x[1] for x in settled) - min(x[1] for x in settled) <= 1 and settled[-1][1] < bb['y'] - 10, str(samples))
    check('the button itself never moves on hover (only the face)', abs(oc.bounding_box()['y'] - bb['y']) < 1)
    pg.mouse.move(5, 5); pg.wait_for_timeout(300)
    st = state(pg); check('bots kept automatically', all(st['players'][k].get('kept', True) for k in (1, 2, 3)) and all(st['players'][k]['mulls'] == 0 for k in (1, 2, 3)))
    pg.wait_for_timeout(2500); st = state(pg)
    check('bots wait while I decide (turn does not move, nothing cast)', st['turn']['number'] == 1 and all(not st['players'][k]['zones']['battlefield'] for k in (1, 2, 3)))
    pg.click('#opening [data-op=view]'); pg.wait_for_timeout(300)
    check('View battlefield hides the screen and leaves a way back', pg.locator('#opening').count() == 0 and pg.locator('#openingBack').is_visible())
    pg.click('#openingBack'); pg.wait_for_timeout(300); check('…and comes back', pg.locator('#opening').is_visible())
    lib0 = len(state(pg)['players'][0]['zones']['library'])
    pg.click('#opening [data-op=mull]'); pg.wait_for_timeout(500); st = state(pg)
    check('first mulligan is free: new 7, mulls 1, no draw triggers', len(ids_hand(pg)) == 7 and st['players'][0]['mulls'] == 1 and sorted(ids_hand(pg)) != sorted(hand) and len(st['players'][0]['zones']['library']) == lib0)
    check('…keep button still says Keep hand', 'Keep hand' in pg.locator('#opening [data-op=keep]').text_content() and 'free' in pg.locator('#opening .op-sub').text_content())
    pg.click('#opening [data-op=mull]'); pg.wait_for_timeout(500)
    check('second mulligan: asks for 1 card to the bottom, keep disabled until chosen', 'choose' in pg.locator('#opening .op-sub').text_content() and pg.locator('#opening [data-op=keep]').is_disabled())
    first = pg.locator('#opening .oc').first.get_attribute('data-oc'); pg.locator('#opening .oc').first.click(); pg.wait_for_timeout(300)
    check('tapping a card marks it for the bottom', pg.locator('#opening .oc.picked').count() == 1 and pg.locator('#opening [data-op=keep]').is_enabled() and 'Bottom 1' in pg.locator('#opening [data-op=keep]').text_content())
    pg.click('#opening [data-op=keep]'); pg.wait_for_timeout(500); st = state(pg)
    check('Keep: 6 in hand, the chosen card on the bottom of the library, screen gone', len(ids_hand(pg)) == 6 and st['players'][0]['zones']['library'][-1] == first and pg.locator('#opening').count() == 0 and st['players'][0].get('kept') is True)
    check('logged', any('keeps 6' in l['text'] for l in st['log']))
    pg.keyboard.press('m'); pg.wait_for_timeout(300); check('after keeping, M does not bring it back', pg.locator('#opening').count() == 0)
    # bots play once I've kept (end my turn)
    pg.click('.endturn'); t0 = time.time()
    while time.time() - t0 < 30 and state(pg)['turn']['active'] == 1 and not state(pg)['players'][1]['zones']['battlefield']: pg.wait_for_timeout(400)
    check('after I keep, the bots take their turns', state(pg)['turn']['active'] != 1 or state(pg)['players'][1]['zones']['battlefield'])
    check('no JS errors (bots)', not errs, str(errs)[:300])
    pg.screenshot(path='tests/reports/opening-after.png')
    # screenshot of the screen itself + phone
    pg.click('#newBtn'); pg.wait_for_timeout(200); pg.click('#modal .btn:not(.ghost)'); pg.wait_for_timeout(1500)
    check('New game brings the opening hand back', pg.locator('#opening').is_visible())
    pg.screenshot(path='tests/reports/opening-desktop.png')
    ctx.close()
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=2); ctx.add_init_script(OPT_IN); pm, em = setup(ctx); pm.set_viewport_size({'width': 390, 'height': 844})
    pm.goto(BASE + '/table.html?mode=bots'); pm.wait_for_timeout(2000); pm.screenshot(path='tests/reports/opening-phone.png')
    boxes = [b.bounding_box() for b in pm.locator('#opening .oc').all()] + [pm.locator('#opening [data-op=keep]').bounding_box()]
    check('phone: all 7 cards and the Keep button fit on screen', all(b and b['x'] >= 0 and b['x'] + b['width'] <= 390 and b['y'] + b['height'] <= 844 for b in boxes), str(boxes[-1]))
    ctx.close()
    # ---------- live room: host and guest each see only their own ----------
    ctx = browser.new_context(); ctx.add_init_script(FAKE_CHANNEL_JS); ctx.add_init_script(OPT_IN)
    host, he = setup(ctx); guest, ge = setup(ctx)
    host.goto(BASE + '/table.html?room=OPEN1&host=1&name=Host&seats=3&bots=1'); host.wait_for_timeout(2000)
    guest.goto(BASE + '/table.html?room=OPEN1&name=Guest'); guest.wait_for_timeout(2600)
    hs = state(host); gseat = guest.evaluate("__edhApi().net.seat")
    check('host sees their own opening hand', host.locator('#opening').is_visible() and sorted(b.get_attribute('data-oc') for b in host.locator('#opening .oc').all()) == sorted(hs['players'][0]['zones']['hand']))
    gs = state(guest)
    check('guest sees only their own opening hand', guest.locator('#opening').is_visible() and sorted(b.get_attribute('data-oc') for b in guest.locator('#opening .oc').all()) == sorted(gs['players'][gseat]['zones']['hand']))
    host.click('#opening [data-op=keep]'); host.wait_for_timeout(2500)
    check('bot still waits for the guest to keep', state(host)['turn']['number'] == 1 and not any(state(host)['players'][k]['zones']['battlefield'] for k in range(3) if state(host)['players'][k].get('bot')))
    guest.click('#opening [data-op=keep]'); guest.wait_for_timeout(1200)
    check('guest keep syncs to the host', state(host)['players'][gseat].get('kept') is True)
    spec = ctx.new_page(); spec.goto(BASE + '/table.html?room=OPEN1&spectate=1&name=W'); spec.wait_for_timeout(2000)
    check('spectators never get the screen', spec.locator('#opening').count() == 0)
    check('no JS errors (room)', not he and not ge, str(he + ge)[:300])
    browser.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
