"""Combat pass: the defender is prompted before damage — block with a creature or take it — in hotseat and across a room."""
import sys, json
sys.argv = ['x', sys.argv[1]]
src = open('tests/deep.py').read().split('with sync_playwright() as p:')[0]
exec(src)

def put_creature(pg, seat, name, pt):
    """Drop a known creature straight onto a seat's battlefield via the state hook (test-only)."""
    return pg.evaluate("""([seat,name,pt])=>{const S=__edhState(); const id='t'+Math.random().toString(36).slice(2,8);
      const c={id,name,cost:'',type:'Creature — Test',pt,colors:'',img:'',big:'',art:'',backImg:'',backBig:'',artist:'',owner:seat,controller:seat,zone:'battlefield',tapped:false,faceDown:false,flipped:false,p1:0,ctr:0,token:true,x:0,y:.25,isCmdr:false,casts:0};
      __edhMut(st=>{c.x=(st.players[seat].zones.battlefield.length%5)*0.18; st.cards[id]=c; st.players[seat].zones.battlefield.push(id);}); return id;}""", [seat, name, pt])

with sync_playwright() as p:
    browser = p.chromium.launch()
    # ---- hotseat ----
    ctx = browser.new_context(); pg, errs = setup(ctx)
    pg.goto(BASE + '/table.html'); pg.evaluate('localStorage.clear()'); pg.reload(); pg.wait_for_timeout(1800)
    has_mut = pg.evaluate('typeof __edhMut === "function"')
    check('test hook __edhMut present', has_mut)
    atk = put_creature(pg, 0, 'Test Ogre', '3/3'); wall = put_creature(pg, 1, 'Test Wall', '0/5'); bear = put_creature(pg, 1, 'Test Bear', '2/2'); pg.wait_for_timeout(300)
    card = pg.locator(f'.card[data-id="{atk}"]')
    check('attack via menu puts the attack in a pending state', menu(pg, card, 'Attack Mira') and state(pg)['attacks'][0].get('ok') is False)
    check('defender prompt appears with Block / Take it', pg.is_visible('#prompt') and pg.locator('#prompt [data-act=block]').count() == 1 and pg.locator('#prompt [data-act=allow]').count() == 1)
    check('attacker cannot deal damage before the answer', not menu(pg, card, 'Deal 3 combat damage') and state(pg)['players'][1]['life'] == 40)
    # block with the wall
    pg.click('#prompt [data-act=block]'); pg.wait_for_timeout(200)
    check('block mode highlights untapped creatures of the defender', pg.locator('.card.canblock').count() == 2)
    pg.click(f'.card.canblock[data-id="{wall}"]'); pg.wait_for_timeout(200); pg.click('#prompt [data-act=doneBlock]'); pg.wait_for_timeout(300)
    st = state(pg); check('blocker recorded on the attack', st['attacks'][0]['blockers'] == [wall])
    check('attacker sees "Resolve combat"', pg.locator('#prompt [data-act=resolveCombat]').count() == 1)
    pg.click('#prompt [data-act=resolveCombat]'); pg.wait_for_timeout(1200); st = state(pg)
    check('block resolved: wall takes 3 damage, survives; no life lost', st['cards'][wall]['dmg'] == 3 and st['cards'][wall]['zone'] == 'battlefield' and st['players'][1]['life'] == 40 and not st['attacks'])
    check('attacker took 0 back from a 0-power wall', not st['cards'][atk].get('dmg'))
    # second attack: block with the bear -> bear dies, ogre takes 2
    pg.evaluate(f"__edhMut(st=>{{st.cards['{atk}'].tapped=false}})"); pg.wait_for_timeout(200)
    menu(pg, pg.locator(f'.card[data-id="{atk}"]'), 'Attack Mira'); pg.click('#prompt [data-act=block]'); pg.wait_for_timeout(150); pg.click(f'.card.canblock[data-id="{bear}"]'); pg.wait_for_timeout(150); pg.click('#prompt [data-act=doneBlock]'); pg.wait_for_timeout(200)
    menu(pg, pg.locator(f'.card[data-id="{atk}"]'), 'Resolve block'); pg.wait_for_timeout(1200); st = state(pg)
    check('lethal block damage removes the blocker from the battlefield', bear not in st['players'][1]['zones']['battlefield'] and (bear not in st['cards'] or st['cards'][bear]['zone'] == 'graveyard'))
    check('attacker is marked with the blocker\'s power', st['cards'][atk]['dmg'] == 2)
    # third: take it
    pg.evaluate(f"__edhMut(st=>{{st.cards['{atk}'].tapped=false}})"); pg.wait_for_timeout(200)
    menu(pg, pg.locator(f'.card[data-id="{atk}"]'), 'Attack Mira'); pg.click('#prompt [data-act=allow]'); pg.wait_for_timeout(300)
    check('"Take it" marks the attack as allowed', state(pg)['attacks'][0]['ok'] is True)
    check('allowed attack offers combat damage', menu(pg, pg.locator(f'.card[data-id="{atk}"]'), 'Deal 3 combat damage'))
    pg.wait_for_timeout(500); check('damage lands after the defender allowed it', state(pg)['players'][1]['life'] == 37)
    # damage clears at the next turn
    pg.click('[data-act=pass]'); pg.wait_for_timeout(900)
    check('marked damage clears when the turn passes', not state(pg)['cards'][atk].get('dmg'))
    check('hotseat combat: no JS errors', not errs, str(errs)[:300])
    ctx.close()

    # ---- room: host attacks guest ----
    ctx = browser.new_context(); ctx.add_init_script(FAKE_CHANNEL_JS)
    host, he = setup(ctx); guest, ge = setup(ctx)
    host.goto(BASE + '/table.html?room=CMBT1&host=1&name=Host&seats=2&bots=0'); host.wait_for_timeout(2200)
    guest.goto(BASE + '/table.html?room=CMBT1&name=Guest'); guest.wait_for_timeout(2600)
    a = put_creature(host, 0, 'Host Ogre', '4/4'); b = put_creature(guest, 1, 'Guest Knight', '2/5'); host.wait_for_timeout(1200)
    check('room: both see the two creatures', guest.locator(f'.card[data-id="{a}"]').count() == 1 and host.locator(f'.card[data-id="{b}"]').count() == 1)
    menu(host, host.locator(f'.card[data-id="{a}"]'), 'Attack Guest'); guest.wait_for_timeout(1500)
    check('room: guest is prompted to block or take it', guest.is_visible('#prompt') and guest.locator('#prompt [data-act=block]').count() == 1)
    check('room: host sees the waiting state', 'Waiting for' in host.locator('#prompt').text_content())
    check('room: host cannot push damage through early', not menu(host, host.locator(f'.card[data-id="{a}"]'), 'Deal 4 combat damage') and state(guest)['players'][1]['life'] == 40)
    guest.click('#prompt [data-act=block]'); guest.wait_for_timeout(150); guest.click(f'.card.canblock[data-id="{b}"]'); guest.wait_for_timeout(150); guest.click('#prompt [data-act=doneBlock]'); host.wait_for_timeout(1500)
    check('room: host sees the block and can resolve', host.locator('#prompt [data-act=resolveCombat]').count() == 1 and state(host)['attacks'][0]['blockers'] == [b])
    host.click('#prompt [data-act=resolveCombat]'); host.wait_for_timeout(2000)
    sg, sh = state(guest), state(host)
    check('room: blocker damage applied by its owner and mirrored to the host', sg['cards'][b]['dmg'] == 4 and sh['cards'][b]['dmg'] == 4 and sg['cards'][b]['zone'] == 'battlefield')
    check('room: attacker takes the knight\'s 2 back', sh['cards'][a]['dmg'] == 2 and sg['cards'][a]['dmg'] == 2)
    check('room: no life lost on a block', sg['players'][1]['life'] == 40)
    # take it path
    host.evaluate(f"__edhMut(st=>{{st.cards['{a}'].tapped=false}})"); host.wait_for_timeout(200)
    menu(host, host.locator(f'.card[data-id="{a}"]'), 'Attack Guest'); guest.wait_for_timeout(1500)
    guest.click('#prompt [data-act=allowAll]'); host.wait_for_timeout(1500)
    check('room: "Take all" clears the wait on the host', host.locator('#prompt [data-act=resolveCombat]').count() == 1)
    host.click('#prompt [data-act=resolveCombat]'); guest.wait_for_timeout(2000)
    check('room: damage lands on both screens', state(guest)['players'][1]['life'] == 36 and state(host)['players'][1]['life'] == 36)
    check('room combat: no JS errors', not he and not ge, str(he + ge)[:300])
    ctx.close()
    browser.close()

fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
