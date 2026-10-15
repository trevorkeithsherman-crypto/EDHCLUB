"""Player feedback round: one-tap Play from the deck picker; chosen artwork shows for everyone at the table and is
saved to the deck; no response window on people's spells unless the table turns it on (bots still give it);
the Counters panel adds exactly one per press no matter how often it has been opened. Run: python3 tests/feedback.py <port>"""
import sys, json, re
sys.argv = ['x', sys.argv[1]]
src = open('tests/deep.py').read().split('with sync_playwright() as p:')[0]
exec(src)
PRINTS = {'data': [
  {'name': 'Krenko, Mob Boss', 'set': 'm19', 'collector_number': '110', 'set_name': 'Core Set 2019', 'released_at': '2018-07-13', 'artist': 'Karl Kopinski', 'finishes': ['nonfoil', 'foil'], 'type_line': 'Legendary Creature — Goblin Warrior', 'mana_cost': '{2}{R}{R}', 'oracle_text': '', 'colors': ['R'], 'color_identity': ['R'], 'image_uris': {'normal': 'https://cards.scryfall.io/normal/m19-krenko.jpg', 'large': 'https://cards.scryfall.io/large/m19-krenko.jpg', 'art_crop': 'https://cards.scryfall.io/art/m19-krenko.jpg'}},
  {'name': 'Krenko, Mob Boss', 'set': 'mb2', 'collector_number': '83', 'set_name': 'Mystery Booster 2', 'released_at': '2024-08-02', 'artist': 'Ilse Gort', 'finishes': ['nonfoil', 'foil'], 'type_line': 'Legendary Creature — Goblin Warrior', 'mana_cost': '{2}{R}{R}', 'oracle_text': '', 'colors': ['R'], 'color_identity': ['R'], 'image_uris': {'normal': 'https://cards.scryfall.io/normal/mb2-krenko.jpg', 'large': 'https://cards.scryfall.io/large/mb2-krenko.jpg', 'art_crop': 'https://cards.scryfall.io/art/mb2-krenko.jpg'}},
], 'has_more': False}
def scry(route):
    u = route.request.url
    if '/cards/search' in u and 'unique=prints' in u: route.fulfill(status=200, content_type='application/json', body=json.dumps(PRINTS)); return
    if route.request.method != 'POST': route.fulfill(status=404, content_type='application/json', body=json.dumps({'object': 'error', 'code': 'not_found', 'data': []})); return
    body = json.loads(route.request.post_data or '{}'); ids = body.get('identifiers', [])
    if any('name' not in i for i in ids):
        data = [next((c for c in PRINTS['data'] if c['set'] == i.get('set') and c['collector_number'] == i.get('collector_number')), None) for i in ids]
        route.fulfill(status=200, content_type='application/json', body=json.dumps({'data': [d for d in data if d], 'not_found': [i for i, d in zip(ids, data) if not d]})); return
    collection(route)
def rclick(pg, cid): pg.evaluate("(id)=>{const el=document.querySelector(`.card[data-id='${id}']`); const r=el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2,button:2}));}", cid)
with sync_playwright() as p:
    browser = p.chromium.launch()
    # ---------- one-tap Play ----------
    ctx = browser.new_context(); pg, errs = setup(ctx)
    pg.goto(BASE + '/'); pg.wait_for_timeout(500); pg.click('[data-go="signin"]'); pg.wait_for_timeout(200); pg.click('.tab:has-text("guest")'); pg.wait_for_timeout(150); pg.click('#guest'); pg.wait_for_timeout(900)
    pg.goto(BASE + '/table.html?mode=bots&name=Trevor&seats=2&bots=1'); pg.wait_for_timeout(1800)
    pg.evaluate("__edhMut(st => { st.players[0].deckId = ''; st.players[0].deckName = ''; })")
    pg.click('#importBtn'); pg.wait_for_timeout(900)
    check('deck picker lists saved decks with Play (primary), Edit and Delete', pg.locator('[data-deck-play="d1"]').count() == 1 and pg.locator('[data-deck-load="d1"]').text_content().strip() == 'Edit')
    pg.click('[data-deck-play="d1"]'); pg.wait_for_timeout(1200)
    st = state(pg)
    check('Play seats the deck in one tap: modal closed, Krenko in the command zone, deck id and name on the seat', pg.locator('#modal').is_hidden() and st['players'][0]['deckId'] == 'd1' and st['players'][0]['deckName'] == 'Krenko Goblins' and any(st['cards'][i]['name'] == 'Krenko, Mob Boss' for i in st['players'][0]['zones']['command']) and len(st['players'][0]['zones']['hand']) == 7, json.dumps([st['players'][0]['deckId'], st['players'][0]['deckName']]))
    # ---------- counters add exactly one, however many times the panel was opened ----------
    cid = st['players'][0]['zones']['command'][0]
    pg.evaluate(f"__edhApi().moveCard('{cid}', 0, 'battlefield')"); pg.wait_for_timeout(300)
    for _ in range(3):
        rclick(pg, cid); pg.wait_for_timeout(200); pg.locator('#menu .mi:has-text("Counters")').click(); pg.wait_for_timeout(250); pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    rclick(pg, cid); pg.wait_for_timeout(200); pg.locator('#menu .mi:has-text("Counters")').click(); pg.wait_for_timeout(250)
    pg.click('#cpBody [data-cp="pt"][data-d="1"]'); pg.wait_for_timeout(150)
    check('after opening the Counters panel four times, one press adds exactly one counter', state(pg)['cards'][cid]['p1'] == 1, str(state(pg)['cards'][cid]['p1']))
    pg.click('#cpBody [data-cp="pt"][data-d="1"]'); pg.wait_for_timeout(150)
    check('…and a second press makes two', state(pg)['cards'][cid]['p1'] == 2)
    pg.keyboard.press('Escape')
    # sound check panel had the same listener pile-up: opening it twice and clicking play fires one sound
    pg.click('#settingsBtn'); pg.wait_for_timeout(200); pg.locator('.menu .mi:has-text("Sound check")').click(); pg.wait_for_timeout(300); pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    pg.click('#settingsBtn'); pg.wait_for_timeout(200); pg.locator('.menu .mi:has-text("Sound check")').click(); pg.wait_for_timeout(300)
    n = pg.evaluate("() => { const a = __edhSfx(); let k = 0; const o = a.play.bind(a); a.play = (...x) => { k++; return o(...x); }; document.querySelector('[data-snd=\"hit\"]').click(); return k; }")
    check('sound check: one click, one play', n == 1, str(n))
    check('no JS errors (solo)', not errs, str(errs)[:200])
    ctx.close()
    # ---------- room: art for everyone + saved to the deck; no response window by default ----------
    ctx = browser.new_context(); ctx.add_init_script(FAKE_CHANNEL_JS); ctx.add_init_script("window.__edhSkipOpening = true;")
    host, he = setup(ctx); guest, ge = setup(ctx)
    for pg in (host, guest): pg.unroute('https://api.scryfall.com/**'); pg.route('https://api.scryfall.com/**', scry)
    host.goto(BASE + '/table.html?room=FB001&host=1&name=Host&seats=2&bots=0'); host.wait_for_timeout(2000)
    guest.goto(BASE + '/table.html?room=FB001&name=Guest'); guest.wait_for_timeout(2600)
    host.evaluate("__edhMut(st => { st.players[0].deckId = 'd1'; })")
    cm = next(c for c in state(host)['cards'].values() if c['isCmdr'] and c['owner'] == 0)
    rclick(host, cm['id']); host.wait_for_timeout(200); host.locator('.menu .mi:has-text("Choose artwork")').click(); host.wait_for_timeout(900)
    host.locator('.artopt').nth(1).click(); host.wait_for_timeout(1500)
    c = state(host)['cards'][cm['id']]
    check('host picks a printing: set/number and image change locally', c['set'] == 'mb2' and 'mb2-krenko' in c['img'] and c['printed'] is True)
    gc = guest.evaluate(f"__edhState().cards['{cm['id']}']")
    check('the guest sees the same artwork (image synced with the card, flagged as a chosen printing)', gc and 'mb2-krenko' in (gc.get('img') or '') and gc.get('printed') is True, json.dumps({k: gc.get(k) for k in ('set', 'num', 'img', 'printed')}) if gc else 'no card')
    guest.evaluate("(() => { __edhApi().ensureArt(__edhApi().allNames(), { quiet: true }); return 1; })()"); guest.wait_for_timeout(1200)
    check('…and a later art refresh on the guest does not swap it back', 'mb2-krenko' in guest.evaluate(f"__edhState().cards['{cm['id']}'].img"))
    check('the printing is saved to the deck (list updated with (mb2) 83)', STORE['deck_patches'] and STORE['deck_patches'][-1][0] == 'd1' and re.search(r'Krenko, Mob Boss \(mb2\) 83', STORE['deck_patches'][-1][1].get('list', '')) is not None, json.dumps(STORE['deck_patches'])[:200])
    host.keyboard.press('Escape'); host.wait_for_timeout(200)
    # response window off by default: a human's creature spell goes straight to the battlefield, nobody gets OK/Respond
    hid = host.evaluate("()=>{const st=__edhState(); return st.players[0].zones.hand.find(id => /Creature/.test(st.cards[id].type) && !/Land/.test(st.cards[id].type)) || st.players[0].zones.hand[0]; }")
    host.evaluate(f"__edhApi().cast('{hid}')"); host.wait_for_timeout(1200)
    hc = state(host)['cards'][hid]
    check('by default a person\'s spell resolves right away (no stack wait, no pending prompt for the guest)', hc['zone'] in ('battlefield', 'graveyard') and not state(host).get('pending') and guest.locator('#prompt [data-act=pok]').count() == 0, f"{hc['zone']} {state(host).get('pending')}")
    host.click('#tableBtn'); host.wait_for_timeout(300)
    check('Table dialog offers the response-window toggle, off', host.locator('#tmRespond').count() == 1 and not host.locator('#tmRespond').is_checked())
    host.check('#tmRespond'); host.wait_for_timeout(500); host.keyboard.press('Escape'); host.wait_for_timeout(300)
    check('the guest learns the table turned it on', guest.evaluate("__edhState().respondWindow") is True)
    hid2 = host.evaluate("()=>{let out; __edhMut(st=>{ const id='fbc'+Math.random().toString(36).slice(2,6); st.cards[id]={id,name:'Test Bear',type:'Creature — Bear',cost:'{1}{G}',pt:'2/2',oracle:'',colors:'G',kw:'',img:'',big:'',art:'',backImg:'',backBig:'',artist:'',owner:0,controller:0,zone:'hand',tapped:false,faceDown:false,flipped:false,p1:0,ctr:0,token:false,x:.3,y:.5,isCmdr:false,casts:0,sick:false}; st.players[0].zones.hand.push(id); out=id; }); return out; }")
    host.evaluate(f"__edhApi().cast('{hid2}')"); host.wait_for_timeout(1200)
    check('with it on, the spell waits on the stack and the guest gets OK / Respond / Counter', state(host)['cards'][hid2]['zone'] == 'stack' and guest.locator('#prompt [data-act=pok]').count() == 1, state(host)['cards'][hid2]['zone'])
    guest.click('#prompt [data-act=pok]'); host.wait_for_timeout(1200)
    check('OK lets it resolve', state(host)['cards'][hid2]['zone'] in ('battlefield', 'graveyard'))
    check('no JS errors (room)', not he and not ge, str(he + ge)[:300])
    browser.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
