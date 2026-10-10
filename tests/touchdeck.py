"""Deck actions by touch: everything right-click offers on desktop must be reachable on a phone.
Long-press the library for its menu; a Library button on the hand bar; scry, surveil, mill, search, shuffle, look at
top 3, reveal; graveyard / exile / command piles; menu rows finger-sized. Run: python3 tests/touchdeck.py <port>"""
import sys, json, time
sys.argv = ['x', sys.argv[1]]
src = open('tests/deep.py').read().split('with sync_playwright() as p:')[0]
exec(src)
def press(pg, sel, ms=650):
    """Touch press-and-hold without moving (CDP touch events so pointer events carry pointerType=touch)."""
    b = pg.locator(sel).first.bounding_box(); x, y = b['x'] + b['width'] / 2, b['y'] + b['height'] / 2
    cdp = pg.context.new_cdp_session(pg)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]}); pg.wait_for_timeout(ms)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); pg.wait_for_timeout(250)
def tall_enough(pg, sel, px=36):
    boxes = pg.eval_on_selector_all(sel, 'els=>els.map(e=>e.getBoundingClientRect().height)')
    return bool(boxes) and all(h >= px - 0.5 for h in boxes), str([round(h) for h in boxes])
def menu_items(pg): return [t.strip() for t in pg.locator('#menu .mi').all_text_contents()]
def lib(pg): return state(pg)['players'][0]['zones']['library']
def gy(pg): return state(pg)['players'][0]['zones']['graveyard']
def hand(pg): return state(pg)['players'][0]['zones']['hand']
with sync_playwright() as p:
    browser = p.chromium.launch()
    for (w, h, label) in [(390, 844, 'phone portrait'), (844, 390, 'phone landscape')]:
        ctx = browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg, errs = setup(ctx); pg.set_viewport_size({'width': w, 'height': h})
        pg.goto(BASE + '/table.html?mode=bots&seats=2&bots=1'); pg.wait_for_timeout(1800)
        T = lambda s: f'{label}: {s}'
        # Library button on the hand bar
        check(T('hand bar has a Library button beside Draw'), pg.locator('.me [data-act=libmenu]').count() == 1 and pg.locator('.me [data-act=libmenu]').is_visible())
        pg.locator('.me [data-act=libmenu]').tap(); pg.wait_for_timeout(300)
        items = menu_items(pg)
        check(T('Library button opens the full library menu'), 'Draw a card' in items and 'Scry…' in items and 'Surveil…' in items and 'Mill 1' in items and 'Search library' in items and 'Shuffle' in items, str(items))
        box = pg.locator('#menu').bounding_box(); check(T('menu fits on screen'), box and box['x'] >= 0 and box['y'] >= 0 and box['x'] + box['width'] <= w + 1 and box['y'] + box['height'] <= h + 1, str(box))
        check(T('menu rows are finger-sized (>= 38px)'), *tall_enough(pg, '#menu .mi', 38))
        # Mill 1
        n0 = len(lib(pg)); g0 = len(gy(pg)); pg.locator('#menu .mi:has-text("Mill 1")').tap(); pg.wait_for_timeout(400)
        check(T('Mill 1 moves the top card to the graveyard'), len(lib(pg)) == n0 - 1 and len(gy(pg)) == g0 + 1)
        # Scry 2 via the button
        pg.locator('.me [data-act=libmenu]').tap(); pg.wait_for_timeout(200); pg.locator('#menu .mi:has-text("Scry")').tap(); pg.wait_for_timeout(400)
        check(T('Scry… opens the count picker'), pg.locator('#modal').is_visible() and pg.locator('#modal').text_content().lower().count('scry') >= 1)
        two = pg.locator('#modal button:has-text("2")').first
        if two.count(): two.tap(); pg.wait_for_timeout(400)
        check(T('scry shows the top cards with keep/bottom controls'), pg.locator('#peekBody .peek').count() == 2 and pg.locator('#peekBody [data-pk]').count() >= 2, str(pg.locator('#modal').text_content())[:120])
        top_before = lib(pg)[:2]
        pg.locator('#peekBody [data-pk=toggle]').first.tap(); pg.wait_for_timeout(200)
        pg.locator('#modal .btn:not(.ghost)').last.tap(); pg.wait_for_timeout(500)
        L = lib(pg); check(T('scry: the toggled card went to the bottom, the other stayed on top'), L[-1] == top_before[0] and L[0] == top_before[1], f'{top_before} -> top {L[:2]} bottom {L[-1]}')
        # Surveil 1 → graveyard
        pg.locator('.me [data-act=libmenu]').tap(); pg.wait_for_timeout(200); pg.locator('#menu .mi:has-text("Surveil")').tap(); pg.wait_for_timeout(400)
        one = pg.locator('#modal button:has-text("1")').first
        if one.count(): one.tap(); pg.wait_for_timeout(400)
        g1 = len(gy(pg)); top = lib(pg)[0]; pg.locator('#peekBody [data-pk=toggle]').first.tap(); pg.wait_for_timeout(200); pg.locator('#modal .btn:not(.ghost)').last.tap(); pg.wait_for_timeout(500)
        check(T('surveil: the toggled card went to the graveyard'), len(gy(pg)) == g1 + 1 and gy(pg)[-1] == top)
        # Search library → put a card in hand
        pg.locator('.me [data-act=libmenu]').tap(); pg.wait_for_timeout(200); pg.locator('#menu .mi:has-text("Search library")').tap(); pg.wait_for_timeout(600)
        check(T('Search library opens a browsable list of the whole library'), pg.locator('#modal .zitem').count() >= 10)
        h0 = len(hand(pg)); pg.locator('#modal .zitem [data-za=hand]').first.tap(); pg.wait_for_timeout(500)
        check(T('a found card can be put into hand'), len(hand(pg)) == h0 + 1)
        if not pg.locator('#modal').is_hidden(): pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
        # Long-press the library pile → same menu
        press(pg, '.me .piles .slot[data-zone$="-library"]')
        check(T('press-and-hold on the library pile opens the library menu'), pg.locator('#menu').is_visible() and 'Scry…' in menu_items(pg), str(menu_items(pg)))
        n1 = len(hand(pg)); pg.locator('#menu .mi:has-text("Shuffle")').tap(); pg.wait_for_timeout(400)
        check(T('…and choosing Shuffle did not also draw (the tap was swallowed)'), len(hand(pg)) == n1 and any('shuffled' in l['text'] for l in state(pg)['log'][:3]))
        # A plain tap still draws
        n2 = len(hand(pg)); pg.locator('.me .piles .slot[data-zone$="-library"]').tap(); pg.wait_for_timeout(500)
        check(T('a plain tap on the library still draws a card'), len(hand(pg)) == n2 + 1)
        # Graveyard pile: tap opens the zone; long-press too
        pg.locator('.me .piles .slot[data-zone$="-graveyard"]').tap(); pg.wait_for_timeout(500)
        check(T('tapping the graveyard opens it'), pg.locator('#modal').is_visible() and pg.locator('#modal .zitem').count() >= 1); pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
        press(pg, '.me .piles .slot[data-zone$="-graveyard"]')
        check(T('press-and-hold on the top graveyard card gives that card\'s menu (return to hand, exile…)'), pg.locator('#menu').is_visible() and len(menu_items(pg)) >= 2, str(menu_items(pg))); pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
        # Command pile: tap gives the commander menu
        pg.locator('.me .piles .slot[data-zone$="-command"]').tap(); pg.wait_for_timeout(400)
        check(T('tapping the commander selects it with Cast / More… in the tap bar'), pg.locator('#tapbar').is_visible() and 'Cast' in pg.locator('#tapbar').inner_text() and 'More' in pg.locator('#tapbar').inner_text(), pg.locator('#tapbar').inner_text() if pg.locator('#tapbar').is_visible() else 'no tapbar')
        pg.locator('#tapbar [data-tb=more]').tap(); pg.wait_for_timeout(300)
        check(T('More… gives the commander menu (cast, tax…)'), pg.locator('#menu').is_visible() and any('Cast' in t for t in menu_items(pg)) and any('tax' in t.lower() for t in menu_items(pg)), str(menu_items(pg))); pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
        press(pg, '.me .piles .slot[data-zone$="-command"]')
        check(T('press-and-hold on the command zone opens its menu'), pg.locator('#menu').is_visible(), str(menu_items(pg))); pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
        check(T('no JS errors'), not errs, str(errs)[:300])
        ctx.close()
    browser.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
