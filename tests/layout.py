"""Sizing: no card is ever cut off at any viewport (desktop, laptop, tablet, phone both ways), the hand fan stays inside
its box, hover/tilt never oscillates, and performance mode (auto / full / lite) works."""
import sys, json, time
sys.argv = ['x', sys.argv[1]]
src = open('tests/deep.py').read().split('with sync_playwright() as p:')[0]
exec(src)
SETUP = """__edhMut(st=>{ const mk=(seat,name,zone,pt,i)=>{const id='s'+seat+zone+i+Math.random().toString(36).slice(2,5); st.cards[id]={id,name,type:pt?'Creature — Beast':'Basic Land — Mountain',cost:'{2}{R}',pt:pt||'',oracle:'',colors:'R',kw:'',img:'',big:'',art:'',backImg:'',backBig:'',artist:'',owner:seat,controller:seat,zone,tapped:zone==='battlefield'&&i%3===0,sick:false,faceDown:false,flipped:false,p1:0,ctr:0,token:false,x:[0,0.5,1,0.97,0.3,0.6,0,0.2,0.4][i%9],y:i<6?0:1,isCmdr:false,casts:0}; st.players[seat].zones[zone].push(id);};
  for (let s=0;s<4;s++){ for (let i=0;i<9;i++) mk(s,'Beast '+i,'battlefield','3/3',i); for (let i=0;i<3;i++) mk(s,'Mountain','battlefield','',i+9); }
  st.players[0].zones.hand.forEach(id=>delete st.cards[id]); st.players[0].zones.hand=[]; for (let i=0;i<NHAND;i++) mk(0,'Hand card '+i,'hand','2/2',i); })"""
CLIP = """()=>{const W=innerWidth,H=innerHeight; const out=[]; for (const el of document.querySelectorAll('#table .card')) { const r=el.getBoundingClientRect(); if (r.width<2) continue; const lane=el.closest('.bf, .hand'); const L=lane?lane.getBoundingClientRect():{left:0,top:0,right:W,bottom:H}; const tol=lane&&lane.classList.contains('bf')?2:22; if (r.left<-1||r.top<-1||r.right>W+1||r.bottom>H+1||r.left<L.left-tol||r.right>L.right+tol) out.push([el.title||el.dataset.id, Math.round(r.left),Math.round(r.top),Math.round(r.right),Math.round(r.bottom), Math.round(L.left), Math.round(L.right)]); } return {out:out.slice(0,5), n:out.length, scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight, W, H};}"""
STRONG = ""
SIZES = [('desktop 1440×900', 1440, 900, False), ('laptop 1280×720', 1280, 720, False), ('small window 1024×640', 1024, 640, False), ('tablet 1024×768', 1024, 768, True), ('phone portrait 390×844', 390, 844, True), ('phone landscape 844×390', 844, 390, True), ('small phone landscape 667×375', 667, 375, True), ('tiny phone 360×640', 360, 640, True)]
with sync_playwright() as p:
    browser = p.chromium.launch()
    for name, w, h, mob in SIZES:
        for nh in (7, 14):
            ctx = browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1, is_mobile=mob, has_touch=mob); ctx.add_init_script(STRONG)
            pg, errs = setup(ctx); pg.set_viewport_size({'width': w, 'height': h})
            pg.goto(BASE + '/table.html?mode=bots&seats=4&bots=3'); pg.wait_for_timeout(1500)
            pg.evaluate(SETUP.replace('NHAND', str(nh))); pg.wait_for_timeout(700)
            r = pg.evaluate(CLIP)
            check(f'{name}, {nh} in hand: no card cut off or outside its lane', r['n'] == 0 and r['scrollW'] <= w and r['scrollH'] <= h, json.dumps(r))
            cov = pg.evaluate("()=>{const cs=[...document.querySelectorAll('.me .hand .card')]; return cs.filter(c=>{const r=c.getBoundingClientRect(); const el=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2); return !el||el.closest('.card')!==c;}).map(c=>c.dataset.id);}")
            if nh == 7 and w >= 390: check(f'{name}, {nh} in hand: every hand card can be grabbed by its middle', not cov, str(cov))
            if not mob and nh == 7:
                # hover at the very bottom edge of a hand card: the face lifts and stays lifted (no bounce)
                b = pg.locator('.me .hand .card').last.bounding_box(); x, y = b['x'] + b['width'] / 2, b['y'] + b['height'] - 14
                pg.mouse.move(x, y); pg.wait_for_timeout(350)
                states = []
                for k in range(12): pg.mouse.move(x + (k % 2), y); pg.wait_for_timeout(40); states.append(pg.evaluate("()=>{const c=[...document.querySelectorAll('.me .hand .card')].pop(); return [c.classList.contains('tilt'), c.matches(':hover')]}"))
                check(f'{name}: hovering the bottom edge of a hand card is stable (no bounce)', all(s[0] and s[1] for s in states), str(states))
                # moving the pointer down through where the card used to be keeps it lifted; leaving below drops it
                pg.mouse.move(x, y + 10); pg.wait_for_timeout(120); still = pg.evaluate("()=>[...document.querySelectorAll('.me .hand .card')].pop().matches(':hover')")
                pg.mouse.move(x - 400, y + 90); pg.wait_for_timeout(250); gone = pg.evaluate("()=>[...document.querySelectorAll('.me .hand .card')].pop().matches(':hover')")
                check(f'{name}: the lifted card keeps hover over its old spot and drops only when the pointer leaves', still and not gone, f'{still} {gone}')
                # same at the bottom edge of a battlefield card
                bb = pg.locator('.me .bf .card:not(.tapped)').first.bounding_box(); x, y = bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] - 2
                pg.mouse.move(x, y); pg.wait_for_timeout(300); st2 = []
                for k in range(10): pg.mouse.move(x + (k % 2), y); pg.wait_for_timeout(40); st2.append(pg.evaluate("()=>document.querySelector('.me .bf .card:not(.tapped)').classList.contains('tilt')"))
                check(f'{name}: battlefield tilt at the card edge is stable', all(st2), str(st2))
                pg.mouse.move(5, 5)
            if errs: check(f'{name}: no JS errors', False, str(errs)[:200])
            ctx.close()
    # ---- performance mode ----
    ctx = browser.new_context(viewport={'width': 1280, 'height': 800}); ctx.add_init_script(STRONG); pg, errs = setup(ctx)
    pg.goto(BASE + '/table.html?mode=bots&seats=2&bots=1'); pg.wait_for_timeout(1500)
    a = pg.evaluate("()=>{const a=__edhApi(); return [a.perf.mode, a.liteOn(), document.body.classList.contains('lite'), document.querySelectorAll('.seat canvas.amb').length]}")
    check('desktop defaults to auto / full effects with playmat canvases', a[0] == 'auto' and a[1] is False and a[2] is False and a[3] >= 2, str(a))
    pg.click('#settingsBtn'); pg.wait_for_timeout(200)
    check('Settings shows the Performance entry', pg.locator('.menu .mi:has-text("Performance: auto (full)")').count() == 1)
    pg.locator('.menu .mi:has-text("Performance")').click(); pg.wait_for_timeout(200); pg.click('#settingsBtn'); pg.wait_for_timeout(150); pg.locator('.menu .mi:has-text("Performance")').click(); pg.wait_for_timeout(300)
    a = pg.evaluate("()=>{const a=__edhApi(); return [a.perf.mode, a.liteOn(), document.body.classList.contains('lite'), getComputedStyle(document.querySelector('.seat canvas.amb')).display, localStorage.getItem('edhclub-perf')]}")
    check('two clicks: auto → full → lite; lite class on, playmat canvases hidden, choice saved', a[0] == 'lite' and a[1] is True and a[2] is True and a[3] == 'none' and a[4] == 'lite', str(a))
    pg.evaluate("__edhMut(st=>{ const id=st.players[0].zones.hand[0]; st.cards[id].foil=true; })"); pg.wait_for_timeout(200)
    fx = pg.evaluate("()=>{const c=document.querySelector('.me .hand .card.foil .ci'); return getComputedStyle(c,'::before').display}")
    check('lite: foil shader is off', fx == 'none', fx)
    b = pg.locator('.me .hand .card').nth(2).bounding_box(); pg.mouse.move(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2); pg.wait_for_timeout(300)
    check('lite: no 3D tilt on hover', pg.evaluate("()=>!document.querySelector('.card.tilt')"))
    pg.reload(); pg.wait_for_timeout(1500)
    check('performance choice survives a reload', pg.evaluate("()=>__edhApi().perf.mode") == 'lite' and pg.evaluate("()=>document.body.classList.contains('lite')"))
    ctx.close()
    # auto-detect: a 4-core / 4 GB device goes lite by itself
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    ctx.add_init_script("window.__edhDeviceSet = true; Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 }); Object.defineProperty(navigator, 'deviceMemory', { get: () => 4 });")
    pg, errs = setup(ctx); pg.goto(BASE + '/table.html?mode=bots&seats=2&bots=1'); pg.wait_for_timeout(1500)
    a = pg.evaluate("()=>{const a=__edhApi(); return [a.perf.mode, a.perf.autoLite, a.liteOn(), a.perf.reason]}")
    check('weak device: auto picks lite on its own', a[0] == 'auto' and a[1] is True and a[2] is True and a[3] == 'device', str(a))
    pg.click('#settingsBtn'); pg.wait_for_timeout(200)
    check('…and Settings says so: auto (lite)', pg.locator('.menu .mi:has-text("Performance: auto (lite)")').count() == 1)
    pg.locator('.menu .mi:has-text("Performance")').click(); pg.wait_for_timeout(300)
    check('the player can still force full effects on a weak device', pg.evaluate("()=>[__edhApi().perf.mode, __edhApi().liteOn()]") == ['full', False])
    check('perf: no JS errors', not errs, str(errs)[:300])
    ctx.close(); browser.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
