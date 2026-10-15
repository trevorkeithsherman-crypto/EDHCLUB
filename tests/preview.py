"""Desktop: the side panel starts closed, so pointing at a card shows the big floating preview; the rail's Panel button
opens the log/chat and the preview moves into the panel; the × in the panel closes it again; the choice sticks on this
device. Phones keep the drawer exactly as before (no floating preview). Run: python3 tests/preview.py <port>"""
import sys, json
sys.argv = ['x', sys.argv[1]]
src = open('tests/deep.py').read().split('with sync_playwright() as p:')[0]
exec(src)
def side_shown(pg): return pg.evaluate("getComputedStyle(document.getElementById('side')).display !== 'none'")
def zoom_shown(pg): return pg.evaluate("!document.getElementById('zoom').hidden && getComputedStyle(document.getElementById('zoom')).display !== 'none' && document.getElementById('zoom').innerHTML.length > 0")
with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(); ctx.add_init_script('window.__edhSideDefault = true;'); pg, errs = setup(ctx); pg.set_viewport_size({'width': 1440, 'height': 900})
    pg.goto(BASE + '/table.html?mode=bots&name=Trevor&seats=2&bots=1'); pg.wait_for_timeout(1500)
    check('desktop: the side panel starts closed and the board uses the width', not side_shown(pg) and pg.evaluate("document.getElementById('app').classList.contains('no-side')") and pg.evaluate("document.querySelector('.table').getBoundingClientRect().width") > 1300)
    b = pg.locator('.me .hand .card').nth(3).bounding_box(); pg.mouse.move(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2); pg.wait_for_timeout(600)
    check('pointing at a card shows the big floating preview with its name', zoom_shown(pg) and pg.locator('#zoom .zmeta b').count() == 1 and pg.evaluate("document.getElementById('zoom').getBoundingClientRect().width") >= 280)
    pg.mouse.move(700, 450); pg.wait_for_timeout(400)
    check('…and it goes away when the pointer leaves', not zoom_shown(pg))
    pg.click('#sideBtn'); pg.wait_for_timeout(300)
    check('the rail Panel button opens the log/chat panel, which has a × close button', side_shown(pg) and pg.locator('#sideClose').is_visible())
    b = pg.locator('.me .hand .card').nth(3).bounding_box(); pg.mouse.move(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2); pg.wait_for_timeout(600)
    check('with the panel open the preview shows inside the panel, not floating', not zoom_shown(pg) and pg.locator('#sideCard .zmeta b').count() == 1)
    pg.click('#sideClose'); pg.wait_for_timeout(300)
    check('× closes the panel', not side_shown(pg) and pg.evaluate("localStorage.getItem('edhclub-side')") == 'closed')
    pg.click('#sideBtn'); pg.wait_for_timeout(200); pg.reload(); pg.wait_for_timeout(1500)
    check('an open panel is remembered across reloads on this device', side_shown(pg))
    pg.click('#sideClose'); pg.wait_for_timeout(200); pg.reload(); pg.wait_for_timeout(1500)
    check('…and so is closed', not side_shown(pg))
    pg.keyboard.press('p'); pg.wait_for_timeout(200)
    check('hotkey P toggles it too', side_shown(pg))
    check('no JS errors (desktop)', not errs, str(errs)[:200])
    ctx.close()
    # phone: unchanged — drawer from the Panel button, no floating preview
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True); ctx.add_init_script('window.__edhSideDefault = true;'); pg, errs = setup(ctx); pg.set_viewport_size({'width': 390, 'height': 844})
    pg.goto(BASE + '/table.html?mode=bots&name=Trevor&seats=2&bots=1'); pg.wait_for_timeout(1500)
    check('phone: panel hidden, no floating preview element in use', not side_shown(pg) and pg.evaluate("getComputedStyle(document.getElementById('zoom')).display") == 'none' and pg.evaluate("localStorage.getItem('edhclub-side')") is None)
    pg.click('#sideBtn'); pg.wait_for_timeout(300)
    check('phone: Panel opens the drawer (show-side), position fixed as before', side_shown(pg) and pg.evaluate("document.getElementById('app').classList.contains('show-side')") and pg.evaluate("getComputedStyle(document.getElementById('side')).position") == 'fixed')
    pg.click('#sideClose'); pg.wait_for_timeout(300)
    check('phone: × closes the drawer', not side_shown(pg))
    check('no JS errors (phone)', not errs, str(errs)[:200])
    browser.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
