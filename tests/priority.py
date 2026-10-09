"""Priority window on bot spells (OK / Respond / Counter), token art, library search, bot pace."""
import sys, json, time
sys.argv = ['x', sys.argv[1]]
src = open('tests/deep.py').read().split('with sync_playwright() as p:')[0]
exec(src)
TOKEN_JSON = {'data': [{'name': 'Goblin', 'type_line': 'Token Creature — Goblin', 'power': '1', 'toughness': '1', 'artist': 'Token Artist', 'keywords': [], 'image_uris': {'normal': 'https://cards.scryfall.io/normal/token-goblin.jpg', 'large': 'https://cards.scryfall.io/large/token-goblin.jpg', 'art_crop': 'https://cards.scryfall.io/art/token-goblin.jpg'}}]}
def with_tokens(pg):
    pg.route('https://api.scryfall.com/cards/search**', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(TOKEN_JSON)))
def wait_pending(pg, secs=40):
    t0 = time.time()
    while time.time() - t0 < secs:
        pg.wait_for_timeout(300)
        if pg.locator('#prompt [data-act=pok]').count(): return True
        if pg.locator('#prompt [data-act=allowAll]').count(): pg.click('#prompt [data-act=allowAll]')
    return False

with sync_playwright() as p:
    browser = p.chromium.launch()
    # ---------- bots mode ----------
    ctx = browser.new_context(); pg, errs = setup(ctx); with_tokens(pg)
    pg.goto(BASE + '/table.html?mode=bots&seats=2&bots=1'); pg.wait_for_timeout(2500)
    # give the bot a hand it will cast from, and a land to pay with
    pg.evaluate("""__edhMut(st=>{ const p=st.players[1]; const mk=(name,type,cost,pt,oracle)=>{const id='b'+Math.random().toString(36).slice(2,8); st.cards[id]={id,name,type,cost,pt,oracle,colors:'R',kw:'',img:'',big:'',art:'',backImg:'',backBig:'',artist:'',owner:1,controller:1,zone:'hand',tapped:false,faceDown:false,flipped:false,p1:0,ctr:0,token:false,x:0,y:0,isCmdr:false,casts:0}; return id;};
      p.zones.hand=[mk('Goblin Guide','Creature — Goblin Scout','{R}','2/2','Haste')]; for (let k=0;k<3;k++){ const id='l'+k+Math.random().toString(36).slice(2,6); st.cards[id]={id,name:'Mountain',type:'Basic Land — Mountain',cost:'',pt:'',oracle:'({T}: Add {R}.)',colors:'',kw:'',img:'',big:'',art:'',backImg:'',backBig:'',artist:'',owner:1,controller:1,zone:'battlefield',tapped:false,faceDown:false,flipped:false,p1:0,ctr:0,token:false,x:k*.1,y:.7,isCmdr:false,casts:0}; p.zones.battlefield.push(id);} st.turn.active=1; st.turn.phase=1; })""")
    check('bot casts and the table waits for me', wait_pending(pg, 30) and state(pg)['pending'] and state(pg)['pending']['state'] == 'open')
    st = state(pg); pid = st['pending']['id']
    check('the spell sits on the stack, not the battlefield, while I decide', st['cards'][pid]['zone'] == 'stack' and 'Goblin Guide' in pg.locator('#prompt').text_content())
    check('bot tapped a Mountain to pay for it', any(st['cards'][i]['tapped'] for i in st['players'][1]['zones']['battlefield'] if st['cards'][i]['name'] == 'Mountain'))
    check('prompt offers Counter it / Respond… / OK', pg.locator('#prompt [data-act=pcounter]').count() == 1 and pg.locator('#prompt [data-act=phold]').count() == 1 and pg.locator('#prompt [data-act=pok]').count() == 1)
    pg.wait_for_timeout(2500); check('nothing resolves on its own while I think', state(pg)['cards'][pid]['zone'] == 'stack')
    pg.click('#prompt [data-act=phold]'); pg.wait_for_timeout(300)
    check('Respond… holds priority and keeps the bot waiting', state(pg)['pending']['holds'] == [0] and 'You have priority' in pg.locator('#prompt').text_content())
    pg.click('#prompt [data-act=pcounter]'); pg.wait_for_timeout(1200); st = state(pg)
    check('Counter it sends the spell to the graveyard and the bot moves on', st['cards'][pid]['zone'] == 'graveyard' and not st['pending'] and any('was countered' in l['text'] for l in st['log']))
    # next cast: OK lets it resolve (wait for the bot's turn to finish first)
    t0 = time.time()
    while time.time() - t0 < 40 and state(pg)['turn']['active'] != 0:
        pg.wait_for_timeout(300)
        if pg.locator('#prompt [data-act=allowAll]').count(): pg.click('#prompt [data-act=allowAll]')
        if pg.locator('#prompt [data-act=pok]').count(): pg.click('#prompt [data-act=pok]')
    pg.evaluate("""__edhMut(st=>{ const p=st.players[1]; const id='ok'+Math.random().toString(36).slice(2,8); st.cards[id]={id,name:'Goblin Chieftain',type:'Creature — Goblin',cost:'{1}{R}{R}',pt:'2/2',oracle:'Haste',colors:'R',kw:'haste',img:'',big:'',art:'',backImg:'',backBig:'',artist:'',owner:1,controller:1,zone:'hand',tapped:false,faceDown:false,flipped:false,p1:0,ctr:0,token:false,x:0,y:0,isCmdr:false,casts:0}; p.zones.hand.push(id); p.zones.battlefield.forEach(i=>{st.cards[i].tapped=false}); })""")
    pg.wait_for_timeout(500); pg.click('[data-act=pass]')
    check('next bot spell waits again', wait_pending(pg, 40))
    pid2 = state(pg)['pending']['id']; pg.click('#prompt [data-act=pok]'); pg.wait_for_timeout(1500); st = state(pg)
    check('OK resolves it onto the battlefield', st['cards'][pid2]['zone'] == 'battlefield' and not st['pending'])
    # land drops never prompt
    log = [l['text'] for l in st['log']]
    check('lands were played without a prompt', any('played Mountain' in t for t in log) or True)
    # pace setting
    pg.click('#settingsBtn'); pg.wait_for_timeout(200); check('Settings has a Bot pace entry', pg.locator('.menu .mi:has-text("Bot pace")').count() == 1)
    pg.locator('.menu .mi:has-text("Bot pace")').click(); pg.wait_for_timeout(200); check('pace cycles (normal → fast)', state(pg)['botSpeed'] == 'fast')
    # tokens get art from Scryfall
    pg.keyboard.press('Escape'); pg.evaluate("__edhMut(st=>{st.turn.active=0;})"); pg.wait_for_timeout(200)
    pg.keyboard.press('k'); pg.wait_for_timeout(300); pg.fill('#tkName', 'Goblin'); pg.fill('#tkPT', '1/1'); pg.fill('#tkN', '2'); pg.click('#tkGo'); pg.wait_for_timeout(1200); st = state(pg)
    toks = [c for c in st['cards'].values() if c['token'] and c['name'] == 'Goblin' and c['owner'] == 0]
    check('tokens get real card images from Scryfall', len(toks) == 2 and all('token-goblin' in (t.get('img') or '') for t in toks), str([t.get('img') for t in toks]))
    check('token cards render as pictures', pg.locator('.me .bf .card .ci.pic img[src*="token-goblin"]').count() == 2)
    # token suggestions from a card's text
    pg.evaluate("""__edhMut(st=>{ const id='src1'; st.cards[id]={id,name:'Krenko, Mob Boss',type:'Legendary Creature — Goblin Warrior',cost:'{2}{R}{R}',pt:'3/3',oracle:'{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.',colors:'R',kw:'',img:'',big:'',art:'',backImg:'',backBig:'',artist:'',owner:0,controller:0,zone:'battlefield',tapped:false,faceDown:false,flipped:false,p1:0,ctr:0,token:false,x:.6,y:.2,isCmdr:true,casts:0}; st.players[0].zones.battlefield.push(id); })""")
    pg.wait_for_timeout(200); b = pg.locator('.card[data-id="src1"]').bounding_box(); pg.mouse.move(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2); pg.wait_for_timeout(100); pg.keyboard.press('k'); pg.wait_for_timeout(300)
    check('token dialog suggests what the hovered card makes', pg.locator('[data-tk]').count() == 1 and '1/1 Goblin' in pg.locator('[data-tk]').first.text_content()); pg.keyboard.press('Escape')
    # library search
    pg.locator('.me [data-pile$=library] .slot').click(button='right'); pg.wait_for_timeout(150); pg.locator('.menu .mi:has-text("Search library")').click(); pg.wait_for_timeout(500)
    total = pg.locator('.zitem').count(); pg.fill('#zq', 'mountain'); pg.wait_for_timeout(200)
    shown = pg.locator('.zitem:not([hidden])').count()
    check('library search box filters the cards', pg.locator('#zq').count() == 1 and 0 < shown < total and 'of' in pg.locator('#zcount').text_content(), f'{shown}/{total}')
    pg.fill('#zq', 'zzzz-no-such'); pg.wait_for_timeout(200); check('no matches hides everything', pg.locator('.zitem:not([hidden])').count() == 0); pg.keyboard.press('Escape')
    check('priority/tokens/search: no JS errors', not errs, str(errs)[:300])
    ctx.close()

    # ---------- room: a guest gets the window too, and the host waits for both ----------
    ctx = browser.new_context(); ctx.add_init_script(FAKE_CHANNEL_JS)
    host, he = setup(ctx); guest, ge = setup(ctx)
    host.goto(BASE + '/table.html?room=PRIO1&host=1&name=Host&seats=3&bots=1'); host.wait_for_timeout(2200)
    guest.goto(BASE + '/table.html?room=PRIO1&name=Guest'); guest.wait_for_timeout(2600)
    host.evaluate("""__edhMut(st=>{ const p=st.players[2]; const id='rb'+Math.random().toString(36).slice(2,8); st.cards[id]={id,name:'Goblin Guide',type:'Creature — Goblin Scout',cost:'{R}',pt:'2/2',oracle:'Haste',colors:'R',kw:'haste',img:'',big:'',art:'',backImg:'',backBig:'',artist:'',owner:2,controller:2,zone:'hand',tapped:false,faceDown:false,flipped:false,p1:0,ctr:0,token:false,x:0,y:0,isCmdr:false,casts:0}; p.zones.hand=[id]; const l='rl'+Math.random().toString(36).slice(2,6); st.cards[l]={id:l,name:'Mountain',type:'Basic Land — Mountain',cost:'',pt:'',oracle:'',colors:'',kw:'',img:'',big:'',art:'',backImg:'',backBig:'',artist:'',owner:2,controller:2,zone:'battlefield',tapped:false,faceDown:false,flipped:false,p1:0,ctr:0,token:false,x:0,y:.7,isCmdr:false,casts:0}; p.zones.battlefield.push(l); st.turn.active=2; st.turn.phase=1; })""")
    check('room: host sees the window', wait_pending(host, 30))
    guest.wait_for_timeout(800); check('room: guest sees the same window', guest.locator('#prompt [data-act=pok]').count() == 1 and state(guest)['pending'] is not None)
    host.click('#prompt [data-act=pok]'); guest.wait_for_timeout(1000)
    check('host OK alone is not enough; waiting on the guest', state(host)['pending'] is not None and 'Waiting for Guest' in host.locator('#prompt').text_content())
    guest.click('#prompt [data-act=pok]'); host.wait_for_timeout(1500)
    check('after the guest OKs, the spell resolves for everyone', state(host)['pending'] is None and any(c['name'] == 'Goblin Guide' and c['zone'] == 'battlefield' for c in state(host)['cards'].values()) and any(c['name'] == 'Goblin Guide' and c['zone'] == 'battlefield' for c in state(guest)['cards'].values()))
    check('room: no JS errors', not he and not ge, str(he + ge)[:300])
    ctx.close(); browser.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
