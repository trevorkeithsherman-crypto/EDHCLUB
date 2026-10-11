"""Right panel (log / chat / card preview) across desktop sizes, including scaled displays (1920 at 150% = 1280 CSS px)
and going full screen. The panel must be on screen at every laptop/desktop size, nothing in it may spill past the window,
the chat keeps real room next to a hovered card preview, and crossing the toggle breakpoint never leaves it stuck hidden.
Run: python3 tests/panel.py <port>"""
import sys, json
sys.argv = ['x', sys.argv[1]]
src = open('tests/deep.py').read().split('with sync_playwright() as p:')[0]
exec(src)
MEASURE = """() => { const q = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom, d: getComputedStyle(e).display }; };
  const over = [...document.querySelectorAll('#side, #side *')].filter((e) => !e.closest('.fan')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + .5 || r.left < 0); }).map((e) => e.className || e.id || e.tagName).slice(0, 5);
  return { inner: [innerWidth, innerHeight], side: q('#side'), list: q('#chatList'), input: q('#chatInput'), send: q('#chatForm button'), img: q('.side-card img, .side-card .zimg'), turnbar: q('.turnbar'), phases: q('.phases'), tools: q('.midtools'), app: document.getElementById('app').className, over, scrollW: document.documentElement.scrollWidth }; }"""
SIZES = [('1920 at 150% (1280×720)', 1280, 720), ('1366×768 laptop', 1366, 768), ('1440×900', 1440, 900), ('1920 at 125% (1536×864)', 1536, 864), ('1600×900', 1600, 900), ('1920×1080', 1920, 1080), ('2560×1440', 2560, 1440), ('1280×1024', 1280, 1024), ('ultrawide 3440×1440', 3440, 1440)]
with sync_playwright() as p:
    browser = p.chromium.launch()
    for name, w, h in SIZES:
        ctx = browser.new_context(); pg, errs = setup(ctx); pg.set_viewport_size({'width': w, 'height': h})
        pg.goto(BASE + '/table.html?mode=bots&name=Trevor'); pg.wait_for_timeout(1800)
        m = pg.evaluate(MEASURE)
        check(f'{name}: panel is on screen without pressing anything', m['side'] and m['side']['d'] == 'grid' and m['side']['w'] >= 240 and abs(m['side']['r'] - w) < 1, json.dumps(m['side']))
        pg.click('.side-tabs .tab[data-tab=chat]'); pg.wait_for_timeout(150)
        for i in range(5): pg.fill('#chatInput', f'message {i} that is long enough to wrap onto a second line'); pg.keyboard.press('Enter'); pg.wait_for_timeout(420)
        pg.hover('.hand .card >> nth=2', force=True); pg.wait_for_timeout(400)
        m = pg.evaluate(MEASURE)
        check(f'{name}: chat, Send button and card preview all fit inside the panel (nothing cut off)', not m['over'] and m['scrollW'] <= w and m['send']['r'] <= w and m['input']['w'] >= 120, json.dumps({'over': m['over'], 'send': m['send'], 'input': m['input']}))
        check(f'{name}: with a card previewed the chat still gets at least a third of the panel', m['list']['h'] >= h / 3, f"list {m['list']['h']} of {h}")
        check(f'{name}: card preview is still a readable size', m['img'] and m['img']['h'] >= 150 and m['img']['b'] <= h, json.dumps(m['img']))
        check(f'{name}: turn strip fits on one line', m['turnbar']['h'] < 50 and abs(m['phases']['y'] - m['tools']['y']) < 4, json.dumps({'tb': m['turnbar']['h'], 'ph': m['phases']['y'], 'tools': m['tools']['y']}))
        if errs: check(f'{name}: no JS errors', False, str(errs)[:200])
        ctx.close()
    # ---- going full screen / resizing across the breakpoint never strands the panel ----
    ctx = browser.new_context(); pg, errs = setup(ctx); pg.set_viewport_size({'width': 1000, 'height': 700})
    pg.goto(BASE + '/table.html?mode=bots&name=Trevor'); pg.wait_for_timeout(1500)
    check('narrow window (1000px): panel starts hidden and the rail Panel button shows it', pg.evaluate("getComputedStyle(document.getElementById('side')).display") == 'none')
    pg.click('#sideBtn'); pg.wait_for_timeout(200)
    check('…shown, and the Panel button hides it again', pg.evaluate("getComputedStyle(document.getElementById('side')).display") == 'grid' and pg.evaluate("document.getElementById('app').className") == 'show-side')
    pg.set_viewport_size({'width': 1366, 'height': 768}); pg.wait_for_timeout(300)
    check('maximise / full screen from a narrow window: panel is simply there (toggle state reset)', pg.evaluate("getComputedStyle(document.getElementById('side')).display") == 'grid' and pg.evaluate("document.getElementById('app').className") == '')
    pg.click('#sideBtn'); pg.wait_for_timeout(200)
    check('wide: Panel hides it (no-side)', pg.evaluate("getComputedStyle(document.getElementById('side')).display") == 'none' and pg.evaluate("document.getElementById('app').className") == 'no-side')
    pg.set_viewport_size({'width': 1000, 'height': 700}); pg.wait_for_timeout(300); pg.click('#sideBtn'); pg.wait_for_timeout(200)
    check('back to narrow with the panel hidden: one press shows it (classes were reset on the way down)', pg.evaluate("getComputedStyle(document.getElementById('side')).display") == 'grid')
    pg.set_viewport_size({'width': 1920, 'height': 1080}); pg.wait_for_timeout(300)
    check('full screen at 1920×1080: panel visible, 300px wide', pg.evaluate("()=>{const r=document.getElementById('side').getBoundingClientRect(); return [getComputedStyle(document.getElementById('side')).display, r.width, r.right]}") == ['grid', 300, 1920])
    check('no JS errors', not errs, str(errs)[:300])
    browser.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
