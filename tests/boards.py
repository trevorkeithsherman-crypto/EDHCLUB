"""The table reshapes to who is actually playing. 1v1 is a split board (opponent's half as tall and their cards as big
as mine), 1v2 a wide pair, 1v3 the classic strip. Before a game starts every seat shows (open ones say Waiting…);
once it has started, empty seats and players who left or were knocked out stop taking space, and someone who sits
down mid-game gets their space back. Desktop, phone portrait, phone landscape and tablet. Run: python3 tests/boards.py <port>"""
import sys, json, time
sys.argv = ['x', sys.argv[1]]
src = open('tests/deep.py').read().split('with sync_playwright() as p:')[0]
exec(src)
MK = """const mk=(st,seat,name,zone,pt)=>{const id='b'+seat+Math.random().toString(36).slice(2,7); st.cards[id]={id,name,type:pt?'Creature — Beast':'Basic Land — Forest',cost:'{2}',pt:pt||'',oracle:'',colors:'G',kw:'',img:'',big:'',art:'',backImg:'',backBig:'',artist:'',owner:seat,controller:seat,zone,tapped:false,faceDown:false,flipped:false,p1:0,ctr:0,token:false,x:Math.random()*.7,y:Math.random()*.6,isCmdr:false,casts:0,sick:false}; st.players[seat].zones[zone].push(id);};"""
FILL = "__edhMut(ST=>{" + MK + "for (let s=0;s<ST.seats;s++){ for(let i=0;i<4;i++) mk(ST,s,'Beast '+i,'battlefield','3/3'); for(let i=0;i<3;i++) mk(ST,s,'Forest','battlefield',''); } })"
LAYOUT = """()=>{const t=document.getElementById('table'); const tr=t.getBoundingClientRect(); const o=document.getElementById('opps').getBoundingClientRect(); const cw=(s)=>parseFloat(getComputedStyle(document.querySelector(s)||document.body).getPropertyValue('--cw'))||0;
  const seats=[...document.querySelectorAll('.opps .seat')].map(s=>({seat:+s.dataset.seat, w:Math.round(s.getBoundingClientRect().width), h:Math.round(s.getBoundingClientRect().height), out:s.classList.contains('out')}));
  return { opps:+t.dataset.opps, share:Math.round(o.height/tr.height*100), oppCw:cw('.opps .bf'), myCw:cw('.me .bf'), seats, cols:getComputedStyle(document.getElementById('opps')).gridTemplateColumns.split(' ').length, myBf:Math.round((document.querySelector('.me .bf')||{getBoundingClientRect:()=>({height:0})}).getBoundingClientRect().height) }; }"""
def layout(pg): return pg.evaluate(LAYOUT)
with sync_playwright() as p:
    browser = p.chromium.launch()
    # ---------- shapes per player count, per environment ----------
    ENVS = [('desktop 1440×900', 1440, 900, False), ('laptop 1366×768', 1366, 768, False), ('tablet 1024×768', 1024, 768, True), ('phone portrait 390×844', 390, 844, True), ('phone landscape 844×390', 844, 390, True)]
    for name, w, h, mob in ENVS:
        for seats in (2, 3, 4):
            ctx = browser.new_context(viewport={'width': w, 'height': h}, is_mobile=mob, has_touch=mob); pg, errs = setup(ctx); pg.set_viewport_size({'width': w, 'height': h})
            pg.goto(BASE + f'/table.html?mode=bots&name=Trevor&seats={seats}&bots={seats - 1}'); pg.wait_for_timeout(1400)
            pg.evaluate(FILL); pg.wait_for_timeout(500)
            L = layout(pg); n = seats - 1
            check(f'{name}, 1v{n}: {n} opponent seat(s), {n} column(s), each the full width share', L['opps'] == n and len(L['seats']) == n and L['cols'] == n and all(abs(s['w'] - L['seats'][0]['w']) < 2 for s in L['seats']), json.dumps(L))
            if n == 1:
                check(f'{name}, 1v1: split board — opponent gets a big half ({L["share"]}%) and their cards are my size', (L['share'] >= 28 if h > 520 else L['share'] >= 22) and abs(L['oppCw'] - L['myCw']) <= 2, json.dumps(L))
            if n == 2:
                check(f'{name}, 1v2: taller than the 3-player strip, cards near my size on desktop', L['share'] >= 18 and (mob or abs(L['oppCw'] - L['myCw']) <= 10), json.dumps(L))
            check(f'{name}, 1v{n}: my battlefield keeps room', L['myBf'] >= (44 if h <= 520 else 120), json.dumps(L))
            clip = pg.evaluate("()=>{const W=innerWidth,H=innerHeight; return [...document.querySelectorAll('#table .card')].filter(el=>{const r=el.getBoundingClientRect(); return r.width>2 && (r.right>W+1||r.bottom>H+1||r.left<-1||r.top<-1)}).length}")
            check(f'{name}, 1v{n}: no card is cut off', clip == 0, str(clip))
            if errs: check(f'{name}: no JS errors', False, str(errs)[:200])
            ctx.close()
    # ---------- mid-game: knocked out / kicked seats collapse, with a short linger for the crack ----------
    ctx = browser.new_context(); pg, errs = setup(ctx)
    pg.goto(BASE + '/table.html?mode=bots&name=Trevor&seats=4&bots=3'); pg.wait_for_timeout(1400); pg.evaluate(FILL); pg.wait_for_timeout(400)
    check('4-pod starts as 1v3', layout(pg)['opps'] == 3)
    pg.evaluate("__edhMut(st=>{ st.players[2].out = true; st.players[2].outAt = Date.now(); })"); pg.wait_for_timeout(300)
    L = layout(pg); check('a knocked-out player keeps their seat for a moment (crack plays)', L['opps'] == 3 and any(s['seat'] == 2 and s['out'] for s in L['seats']), json.dumps(L))
    pg.wait_for_timeout(2900)
    L = layout(pg); check('…then the table becomes 1v2: two wider seats, no dead space', L['opps'] == 2 and len(L['seats']) == 2 and all(s['seat'] != 2 for s in L['seats']) and L['share'] >= 30, json.dumps(L))
    pg.click('#tableBtn'); pg.wait_for_timeout(300); pg.locator('.tm-row:has-text("Druid Bot") [data-tm=kick]').first.click(); pg.wait_for_timeout(500); pg.keyboard.press('Escape'); pg.wait_for_timeout(3000)
    L = layout(pg); check('kicking a bot from the Table dialog collapses the board to a 1v1 split', L['opps'] == 1 and L['share'] >= 36 and abs(L['oppCw'] - L['myCw']) <= 2, json.dumps(L))
    pg.click('#tableBtn'); pg.wait_for_timeout(300); pg.locator('[data-tm=add]').first.click(); pg.wait_for_timeout(500); pg.keyboard.press('Escape'); pg.wait_for_timeout(400)
    L = layout(pg); check('adding a bot back opens a seat again (1v2)', L['opps'] == 2, json.dumps(L))
    check('no JS errors (bots)', not errs, str(errs)[:300])
    ctx.close()
    # ---------- rooms: open seats show until the game starts, then only people playing get space ----------
    ctx = browser.new_context(); ctx.add_init_script(FAKE_CHANNEL_JS); ctx.add_init_script("window.__edhSkipOpening = true;")
    host, he = setup(ctx); guest, ge = setup(ctx)
    host.goto(BASE + '/table.html?room=BRD01&host=1&name=Host&seats=4&bots=0'); host.wait_for_timeout(1800)
    guest.goto(BASE + '/table.html?room=BRD01&name=Guest'); guest.wait_for_timeout(2400)
    L = layout(host); check('before the game starts the host sees all 3 other seats: the guest and two "Waiting…" seats', L['opps'] == 3 and host.locator('.opps .seat:has-text("Waiting")').count() == 2, json.dumps(L))
    host.evaluate("__edhMut(st=>{" + MK + "mk(st,0,'Forest','battlefield','');})"); host.wait_for_timeout(2800)
    L = layout(host); check('the first land played starts the game: open seats stop taking space, it is a 1v1 split board', L['opps'] == 1 and host.locator('.opps .seat:has-text("Waiting")').count() == 0 and L['share'] >= 36, json.dumps(L))
    Lg = layout(guest); check('the guest sees the same 1v1 split from their side', Lg['opps'] == 1 and Lg['share'] >= 36, json.dumps(Lg))
    late, le = setup(ctx); late.goto(BASE + '/table.html?room=BRD01&name=Late'); late.wait_for_timeout(2800)
    L = layout(host); check('someone sitting down mid-game gets a seat back: 1v2 for the host', L['opps'] == 2 and host.locator('.opps .seat:has-text("Late")').count() == 1, json.dumps(L))
    check('…and the late player sees host + guest as a 1v2', layout(late)['opps'] == 2, json.dumps(layout(late)))
    check('no JS errors (room)', not he and not ge and not le, str(he + ge + le)[:300])
    browser.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
