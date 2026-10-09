"""Keyboard shortcuts, full screen, and the install-as-app plumbing."""
import sys, json
sys.argv = ['x', sys.argv[1]]
src = open('tests/deep.py').read().split('with sync_playwright() as p:')[0]
exec(src)
def hover(pg, sel):
    b = pg.locator(sel).first.bounding_box(); pg.mouse.move(b['x'] + b['width'] * .55, b['y'] + b['height'] * .55); pg.mouse.move(b['x'] + b['width'] * .56, b['y'] + b['height'] * .56); pg.wait_for_timeout(250)
def mk(pg, seat, name, pt, kw=''):
    return pg.evaluate("""([seat,name,pt,kw])=>{const id='t'+Math.random().toString(36).slice(2,8); const c={id,name,cost:'',type:'Creature — Test',pt,kw,colors:'R',img:'',big:'',art:'',backImg:'',backBig:'',artist:'',owner:seat,controller:seat,zone:'battlefield',tapped:false,sick:false,dmg:0,faceDown:false,flipped:false,p1:0,ctr:0,token:true,x:0,y:.25,isCmdr:false,casts:0}; __edhMut(st=>{c.x=(st.players[seat].zones.battlefield.length%5)*0.18; st.cards[id]=c; st.players[seat].zones.battlefield.push(id);}); return id;}""", [seat, name, pt, kw])

with sync_playwright() as p:
    browser = p.chromium.launch(); ctx = browser.new_context(); pg, errs = setup(ctx)
    pg.goto(BASE + '/table.html'); pg.evaluate('localStorage.clear()'); pg.reload(); pg.wait_for_timeout(1500); pg.evaluate("__edhMut(st=>{st.turn.phase=1;})")
    # overlay
    pg.keyboard.press('?'); pg.wait_for_timeout(300)
    check('? opens the shortcuts overlay with every key listed', pg.locator('.kgrid kbd').count() >= 20 and 'Tap / untap' in pg.locator('#modal').text_content())
    pg.keyboard.press('Escape'); pg.wait_for_timeout(150); check('Escape closes it', pg.locator('#modal').is_hidden())
    # D draws, S shuffles, U untaps all, - / = life
    h0 = len(state(pg)['players'][0]['zones']['hand']); pg.keyboard.press('d'); pg.wait_for_timeout(300); check('D draws a card', len(state(pg)['players'][0]['zones']['hand']) == h0 + 1)
    pg.keyboard.press('-'); pg.keyboard.press('Shift+_'); pg.wait_for_timeout(200); check('- and Shift+- take 1 then 5 life', state(pg)['players'][0]['life'] == 34)
    pg.keyboard.press('='); pg.wait_for_timeout(200); check('= gives 1 life back', state(pg)['players'][0]['life'] == 35)
    # card-focused keys: hover a creature on the battlefield
    cid = mk(pg, 0, 'Key Ogre', '3/3'); pg.wait_for_timeout(200)
    hover(pg, f'.card[data-id="{cid}"]'); pg.keyboard.press('t'); pg.wait_for_timeout(200); check('T taps the hovered card', state(pg)['cards'][cid]['tapped'])
    pg.keyboard.press('u'); pg.wait_for_timeout(200); check('U untaps everything', not state(pg)['cards'][cid]['tapped'])
    hover(pg, f'.card[data-id="{cid}"]'); pg.keyboard.press('1'); pg.keyboard.press('1'); pg.keyboard.press('2'); pg.wait_for_timeout(200); check('1/2 add and remove +1/+1 counters', state(pg)['cards'][cid]['p1'] == 1)
    pg.keyboard.press('c'); pg.wait_for_timeout(150); check('C adds a generic counter', state(pg)['cards'][cid]['ctr'] == 1)
    pg.keyboard.press('a'); pg.wait_for_timeout(200); check('A starts targeting for an attack', pg.locator('#prompt').is_visible() and pg.locator('.seat.targetable').count() == 3); pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    pg.keyboard.press('l'); pg.wait_for_timeout(300); check('L opens Look closer', not pg.locator('#modal').is_hidden() and 'Key Ogre' in pg.locator('#modal').text_content()); pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    hover(pg, f'.card[data-id="{cid}"]'); pg.keyboard.press('g'); pg.wait_for_timeout(300); check('G sends the card to the graveyard (a token just vanishes)', cid not in state(pg)['cards'] or state(pg)['cards'][cid]['zone'] == 'graveyard')
    # selection fallback: click a hand card once, move the mouse away, press B to play it
    land = pg.locator('.me .hand .card.f-land').last; land.click(); pg.mouse.move(5, 5); pg.wait_for_timeout(300)
    bf0 = len(state(pg)['players'][0]['zones']['battlefield']); pg.keyboard.press('b'); pg.wait_for_timeout(600)
    check('B plays the selected card when nothing is hovered', len(state(pg)['players'][0]['zones']['battlefield']) == bf0 + 1)
    hand_card = pg.locator('.me .hand .card').first; hover(pg, '.me .hand .card >> nth=0'); hid = hand_card.get_attribute('data-id'); pg.keyboard.press('x'); pg.wait_for_timeout(300)
    check('X exiles the hovered card', hid in state(pg)['players'][0]['zones']['exile'])
    # turn keys
    pg.keyboard.press(' '); pg.wait_for_timeout(200); check('Space advances the phase', state(pg)['turn']['phase'] == 2)
    pg.keyboard.press('e'); pg.wait_for_timeout(800); check('E ends the turn', state(pg)['turn']['active'] == 1)
    pg.keyboard.press('k'); pg.wait_for_timeout(300); check('K opens the token dialog', not pg.locator('#modal').is_hidden() and 'oken' in pg.locator('#modal').text_content()); pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    # typing never triggers shortcuts
    pg.click('#importBtn'); pg.wait_for_timeout(300); l0 = state(pg)['players'][1]['life']; pg.locator('#impList').type('dddd-=te'); pg.wait_for_timeout(200)
    check('typing in the deck box does not draw, change life or end the turn', state(pg)['players'][1]['life'] == l0 and state(pg)['turn']['active'] == 1); pg.keyboard.press('Escape')
    # fullscreen + install plumbing
    check('rail has a Full screen button and Settings lists it', pg.locator('#fsBtn').count() == 1)
    pg.click('#settingsBtn'); pg.wait_for_timeout(200); check('Settings menu: shortcuts and full screen entries', pg.locator('.menu .mi:has-text("Keyboard shortcuts")').count() == 1 and pg.locator('.menu .mi:has-text("Full screen")').count() == 1); pg.keyboard.press('Escape')
    check('manifest + apple meta present', pg.locator('link[rel=manifest]').count() == 1 and pg.locator('meta[name=apple-mobile-web-app-capable]').count() == 1)
    m = json.loads(pg.evaluate("fetch('/manifest.webmanifest').then(r=>r.text())"))
    check('manifest is valid with icons and fullscreen display', m['name'] == 'EDH Club' and m['display'] == 'fullscreen' and any(i['sizes'] == '512x512' for i in m['icons']) and any(i.get('purpose') == 'maskable' for i in m['icons']))
    sw = pg.evaluate("fetch('/sw.js').then(r=>r.text())"); check('service worker is served and caches card art, never Supabase', 'cards.scryfall.io' in sw and 'supabase.co' in sw)
    check('icons exist', pg.evaluate("fetch('/icons/icon-512.png').then(r=>r.ok)") and pg.evaluate("fetch('/icons/apple-touch-icon.png').then(r=>r.ok)"))
    check('shortcuts: no JS errors', not errs, str(errs)[:300])
    # landing: install button appears when the browser fires beforeinstallprompt
    pg.goto(BASE + '/'); pg.wait_for_timeout(800)
    pg.evaluate("window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), {prompt(){ this.p=true; }, userChoice: Promise.resolve({outcome:'accepted'})}))"); pg.wait_for_timeout(200)
    check('landing shows Install app once the browser offers it', pg.locator('#installBtn').count() == 1)
    pg.click('#installBtn'); pg.wait_for_timeout(300); check('clicking it runs the install prompt', 'Installed' in pg.locator('#toasts').text_content())
    check('landing: no JS errors', not errs, str(errs)[:300])
    browser.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
