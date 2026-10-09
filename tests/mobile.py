"""Mobile pass: phones in portrait and landscape must show every control on screen, keep tap targets usable,
and complete the core loop (play, attack, pass, decks, panel) by touch. Run: python3 tests/mobile.py <port>"""
import sys, json
sys.argv = ['x', sys.argv[1]]
src = open('tests/deep.py').read().split('with sync_playwright() as p:')[0]
exec(src)
TOP = {'decks': [{'id': 100 + i, 'name': f'Deck {i}', 'views': 5000 - i, 'owner': 'hans', 'featured': '', 'colors': 'R', 'bracket': 3, 'size': 100, 'updated': '', 'tags': []} for i in range(100)]}
DECK = {'id': 100, 'name': 'Deck 0', 'owner': 'hans', 'commander': 'Krenko, Mob Boss', 'commanders': ['Krenko, Mob Boss'], 'count': 100, 'text': 'Commander\n1 Krenko, Mob Boss\n\nDeck\n1 Goblin Chieftain\n98 Mountain'}
def api(route):
    u = route.request.url
    if u.endswith('/api/top-decks'): route.fulfill(status=200, content_type='application/json', body=json.dumps(TOP))
    elif '/api/deck/' in u: route.fulfill(status=200, content_type='application/json', body=json.dumps(DECK))
    else: route.continue_()

VIEWPORTS = [('iPhone portrait', 390, 844), ('iPhone landscape', 844, 390), ('small Android portrait', 360, 740), ('small Android landscape', 740, 360)]

def inside(pg, sel, w, h, label=None, nth=0):
    """Element exists, is visible and its box is fully inside the viewport."""
    loc = pg.locator(sel).nth(nth)
    if not loc.count(): return False, 'missing'
    b = loc.bounding_box()
    if not b: return False, 'no box'
    ok = b['x'] >= -1 and b['y'] >= -1 and b['x'] + b['width'] <= w + 1 and b['y'] + b['height'] <= h + 1 and b['width'] > 0 and b['height'] > 0
    return ok, f"{sel} box={ {k: round(v) for k, v in b.items()} }"
def no_overflow(pg): return not pg.evaluate('document.documentElement.scrollWidth > innerWidth + 1 || document.scrollingElement.scrollHeight > innerHeight + 1')
def tall_enough(pg, sel, px=36):
    boxes = pg.eval_on_selector_all(sel, 'els=>els.map(e=>e.getBoundingClientRect().height)')
    return bool(boxes) and all(h >= px - 0.5 for h in boxes), str([round(h) for h in boxes])

with sync_playwright() as p:
    browser = p.chromium.launch()
    for name, w, h in VIEWPORTS:
        ctx = browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg, errs = setup(ctx); pg.set_viewport_size({'width': w, 'height': h}); pg.route('**/api/**', api)
        T = lambda s: f'[{name}] {s}'
        pg.goto(BASE + '/table.html?mode=bots'); pg.evaluate('localStorage.clear()'); pg.reload(); pg.wait_for_timeout(2200)
        # ---- visibility ----
        check(T('no page scroll or horizontal overflow'), no_overflow(pg))
        for sel in ['.endturn', '.me .hand .card >> nth=-1', '.phases .ph.on', '#importBtn', '#sideBtn', '#settingsBtn', '.me .avatar', '.me .piles .slot >> nth=0', '.me .piles .slot >> nth=1', '.opps .seat[data-seat="1"] .lifebadge', '.opps .seat[data-seat="2"] .lifebadge', '.opps .seat[data-seat="3"] .lifebadge', '.me .handwrap [data-act=draw]']:
            ok, note = inside(pg, sel, w, h); check(T(f'on screen: {sel}'), ok, note)
        check(T('hand cards are not overlapped into unreachability (last card fully visible)'), inside(pg, '.me .hand .card >> nth=-1', w, h)[0])
        # ---- tap targets ----
        check(T('End turn is a comfortable tap target'), *tall_enough(pg, '.endturn', 36))
        check(T('rail buttons are comfortable tap targets'), *tall_enough(pg, '.rail-btn:not(.on)', 36))
        check(T('phase pills are tappable'), *tall_enough(pg, '.ph', 24))
        check(T('expand buttons on opponent tiles'), *tall_enough(pg, '.xp', 30))
        # ---- opponent tile expand ----
        base_h = pg.eval_on_selector('.opps .seat[data-seat="1"]', 'e=>e.getBoundingClientRect().height')
        pg.locator('.xp[data-p="1"]').tap(); pg.wait_for_timeout(300)
        exp_h = pg.eval_on_selector('.opps .seat[data-seat="1"]', 'e=>e.getBoundingClientRect().height')
        check(T('expanding an opponent tile makes it taller and full width'), exp_h > base_h + 20 and pg.eval_on_selector('.opps .seat[data-seat="1"]', 'e=>e.getBoundingClientRect().width') > w * 0.9, f'{base_h}->{exp_h}')
        check(T('expanded tile shows piles; my hand still on screen'), pg.locator('.opps .seat.expanded .minipiles').is_visible() and inside(pg, '.me .hand .card >> nth=-1', w, h)[0] and no_overflow(pg))
        pg.locator('.xp[data-p="1"]').tap(); pg.wait_for_timeout(200); check(T('collapses again'), pg.locator('.seat.expanded').count() == 0)
        # ---- tap action bar (no long-press needed) ----
        first = pg.locator('.me .hand .card').last; first.tap(); pg.wait_for_timeout(250)
        ok, note = inside(pg, '#tapbar', w, h); check(T('one tap shows the action bar inside the viewport'), ok and pg.locator('#tapbar [data-tb=look]').count() == 1 and pg.locator('#tapbar [data-tb=quick]').count() == 1 and pg.locator('#tapbar [data-tb=more]').count() == 1, note)
        check(T('action bar buttons are tap-sized'), *tall_enough(pg, '#tapbar button', 36))
        pg.locator('#tapbar [data-tb=look]').tap(); pg.wait_for_timeout(400)
        ok, note = inside(pg, '.mpanel', w, h); check(T('Look closer opens a modal that fits'), ok and pg.locator('#tapbar').is_hidden(), note)
        pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
        first = pg.locator('.me .hand .card').last; first.tap(); pg.wait_for_timeout(250); pg.locator('#tapbar [data-tb=more]').tap(); pg.wait_for_timeout(250)
        ok, note = inside(pg, '.menu', w, h); check(T('More… opens the card menu inside the viewport'), ok and pg.locator('.menu .mi').count() >= 2, note)
        pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
        pg.touchscreen.tap(w / 2, 60); pg.wait_for_timeout(600)
        check(T('nothing is text-selectable on the table surface'), pg.evaluate("getComputedStyle(document.querySelector('#table')).userSelect === 'none' && getComputedStyle(document.querySelector('.me .hand .card')).webkitUserSelect === 'none'"))
        # ---- play by touch: double-tap a land ----
        before = len(state(pg)['players'][0]['zones']['hand'])
        land = pg.locator('.me .hand .card.f-land').last
        land.tap(); pg.wait_for_timeout(120); land.tap(); pg.wait_for_timeout(900)
        st = state(pg); check(T('double-tap plays a card from hand'), len(st['players'][0]['zones']['hand']) == before - 1 and len(st['players'][0]['zones']['battlefield']) >= 1)
        check(T('battlefield card is on screen and not microscopic'), inside(pg, '.me .bf .card', w, h)[0] and pg.eval_on_selector('.me .bf .card', 'e=>e.getBoundingClientRect().width') >= 30)
        # ---- long-press opens the card menu inside the viewport ----
        c = pg.locator('.me .bf .card').first; b = c.bounding_box()
        pg.touchscreen.tap(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2)  # select
        pg.evaluate("""([x,y])=>{const el=document.elementFromPoint(x,y); el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:x,clientY:y,pointerType:'touch',pointerId:7,isPrimary:true,button:0}));}""", [b['x'] + b['width'] / 2, b['y'] + b['height'] / 2])
        pg.wait_for_timeout(650)
        pg.evaluate("""([x,y])=>{document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:x,clientY:y,pointerType:'touch',pointerId:7,isPrimary:true,button:0}));}""", [b['x'] + b['width'] / 2, b['y'] + b['height'] / 2])
        pg.wait_for_timeout(200)
        ok, note = inside(pg, '.menu', w, h); check(T('long-press opens the card menu fully inside the viewport'), ok and pg.locator('.menu .mi').count() >= 3, note)
        pg.keyboard.press('Escape'); pg.wait_for_timeout(100)
        # ---- attack flow by touch (give myself a creature) ----
        cid = pg.evaluate("""()=>{const S=__edhState(); const id='tm'+Math.random().toString(36).slice(2,7); const c={id,name:'Test Ogre',cost:'',type:'Creature — Test',pt:'3/3',colors:'R',img:'',big:'',art:'',backImg:'',backBig:'',artist:'',owner:0,controller:0,zone:'battlefield',tapped:false,faceDown:false,flipped:false,p1:0,ctr:0,token:true,x:.5,y:.3,isCmdr:false,casts:0}; __edhMut(st=>{st.cards[id]=c; st.players[0].zones.battlefield.push(id);}); return id;}""")
        pg.wait_for_timeout(200)
        pg.locator(f'.card[data-id="{cid}"]').click(button='right'); pg.wait_for_timeout(150); pg.locator('.menu .mi:has-text("Attack…")').click(); pg.wait_for_timeout(300)
        ok, note = inside(pg, '#prompt', w, h); check(T('targeting prompt sits inside the viewport'), ok, note)
        pg.locator('.seat.targetable').first.tap(); pg.wait_for_timeout(1400)
        st = state(pg); check(T('tapping an opponent declares the attack; bot answers'), len(st['attacks']) == 1 and (st['attacks'][0].get('ok') or st['attacks'][0].get('blockers')))
        check(T('attack arc drawn'), pg.locator('#arrows path.arw').count() >= 1)
        ok, note = inside(pg, '#prompt [data-act=resolveCombat]', w, h); check(T('Resolve combat button on screen'), ok, note)
        pg.locator('#prompt [data-act=resolveCombat]').tap(); pg.wait_for_timeout(1200)
        check(T('combat resolves'), not state(pg)['attacks'])
        # ---- life buttons on my seat ----
        pg.locator('.me [data-act=life][data-d="-1"]').tap(); pg.wait_for_timeout(200); check(T('life minus works by tap'), state(pg)['players'][0]['life'] == 39)
        # ---- turn strip: phases and tools reachable (swipe row) ----
        pg.locator('.ph:has-text("Combat")').tap(); pg.wait_for_timeout(200); check(T('phase pill tap changes phase'), state(pg)['turn']['phase'] == 2)
        pg.evaluate("document.querySelector('.turnbar').scrollLeft = 9999"); pg.wait_for_timeout(100)
        ok, note = inside(pg, '[data-act=d20]', w, h); check(T('tools reachable by swiping the turn strip'), ok, note)
        # ---- side drawer ----
        pg.locator('#sideBtn').tap(); pg.wait_for_timeout(400)
        ok, note = inside(pg, '#side', w, h); check(T('panel opens as a drawer inside the viewport'), ok and pg.locator('#sideLog .logrow').count() >= 1, note)
        pg.touchscreen.tap(20, h / 2); pg.wait_for_timeout(300); check(T('tapping outside closes the drawer'), not pg.locator('#side').is_visible())
        # ---- decks modal + top 100 ----
        pg.locator('#importBtn').tap(); pg.wait_for_timeout(500)
        ok, note = inside(pg, '.mpanel', w, h); check(T('decks modal fits the viewport'), ok, note)
        check(T('modal inputs are tall enough to tap'), *tall_enough(pg, '#impList, #impName', 36))
        pg.locator('#topToggle').tap(); pg.wait_for_timeout(600); check(T('Top 100 list usable in the modal'), pg.locator('.toprow').count() == 40)
        pg.locator('[data-top-seat]').first.tap(); pg.wait_for_timeout(1500)
        check(T('seating a top deck from the phone works'), pg.locator('#modal').is_hidden() and any(c['name'] == 'Krenko, Mob Boss' and c['isCmdr'] for c in state(pg)['cards'].values() if c['owner'] == 0))
        # ---- playmat modal ----
        pg.locator('.me .pname').tap(); pg.wait_for_timeout(200); pg.locator('.mi:has-text("Choose playmat")').tap(); pg.wait_for_timeout(400)
        ok, note = inside(pg, '.mpanel', w, h); check(T('playmat picker fits'), ok and pg.locator('.matopt').count() >= 11, note)
        pg.keyboard.press('Escape')
        # ---- end turn ----
        pg.locator('.endturn').tap(); pg.wait_for_timeout(1500); check(T('End turn passes to the next seat'), state(pg)['turn']['active'] == 1)
        check(T('still no overflow after play'), no_overflow(pg))
        check(T('table: no JS errors'), not errs, str(errs)[:300])
        # ---- landing + sign-in + decks page ----
        pg.goto(BASE + '/'); pg.wait_for_timeout(900)
        check(T('landing: no horizontal overflow'), not pg.evaluate('document.documentElement.scrollWidth > innerWidth + 1'))
        for sel in ['#heroShot', '[data-go="create"]', '[data-go="join"]']:
            check(T(f'landing: {sel} fits the width'), pg.eval_on_selector(sel, 'e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.width>0}') if pg.locator(sel).count() else False)
        pg.locator('[data-go="signin"]').first.tap(); pg.wait_for_timeout(300)
        check(T('landing: sign-in form inputs are tap-sized'), *tall_enough(pg, '#lobby input', 38))
        pg.goto(BASE + '/decks.html'); pg.wait_for_timeout(900)
        check(T('decks page: no overflow, cards stack to fit'), not pg.evaluate('document.documentElement.scrollWidth > innerWidth + 1') and pg.eval_on_selector('.deckcard', 'e=>e.getBoundingClientRect().width') <= w)
        check(T('pages: no JS errors'), not errs, str(errs)[:300])
        ctx.close()
    browser.close()

fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
