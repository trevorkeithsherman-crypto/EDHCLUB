"""Combat rules + bot judgment. Keywords (flying/reach, first & double strike, deathtouch, trample, lifelink,
indestructible, menace, vigilance, haste/summoning sickness, defender), block math, the defender's response
window, and whether the bots attack, block and chump like a sensible player."""
import sys, json, time
sys.argv = ['x', sys.argv[1]]
src = open('tests/deep.py').read().split('with sync_playwright() as p:')[0]
exec(src)

def mk(pg, seat, name, pt, kw='', sick=False, tapped=False, dmg=0):
    return pg.evaluate("""([seat,name,pt,kw,sick,tapped,dmg])=>{const id='t'+Math.random().toString(36).slice(2,8);
      const c={id,name,cost:'',type:'Creature — Test',pt,kw,colors:'R',img:'',big:'',art:'',backImg:'',backBig:'',artist:'',owner:seat,controller:seat,zone:'battlefield',tapped,sick,dmg,faceDown:false,flipped:false,p1:0,ctr:0,token:true,x:0,y:.25,isCmdr:false,casts:0};
      __edhMut(st=>{c.x=(st.players[seat].zones.battlefield.length%5)*0.18; st.cards[id]=c; st.players[seat].zones.battlefield.push(id);}); return id;}""", [seat, name, pt, kw, sick, tapped, dmg])
def gone(st, cid): return cid not in st['cards'] or st['cards'][cid]['zone'] != 'battlefield'
def alive(st, cid): return cid in st['cards'] and st['cards'][cid]['zone'] == 'battlefield'
def attack_with(pg, cid, target_name='Mira'):
    pg.locator(f'.card[data-id="{cid}"]').click(button='right'); pg.wait_for_timeout(150)
    it = pg.locator(f'.menu .mi:has-text("Attack {target_name}")'); ok = it.count() > 0
    if ok: it.click(force=True)
    else: pg.keyboard.press('Escape')
    pg.wait_for_timeout(300); return ok
def block_with(pg, blockers):
    pg.click('#prompt [data-act=block]'); pg.wait_for_timeout(150)
    for b in blockers: pg.click(f'.card[data-id="{b}"]'); pg.wait_for_timeout(120)
    disabled = pg.locator('#prompt [data-act=doneBlock]').is_disabled()
    pg.click('#prompt [data-act=doneBlock]'); pg.wait_for_timeout(250); return not disabled
def resolve(pg):
    pg.click('#prompt [data-act=resolveCombat]'); pg.wait_for_timeout(1300); return state(pg)
def fresh(pg):
    pg.goto(BASE + '/table.html'); pg.evaluate('localStorage.clear()'); pg.reload(); pg.wait_for_timeout(1500)
    pg.evaluate("__edhMut(st=>{st.turn.phase=1;})")

with sync_playwright() as p:
    browser = p.chromium.launch(); ctx = browser.new_context(); pg, errs = setup(ctx)
    fresh(pg)
    # ---- summoning sickness / haste / defender / vigilance ----
    sick = mk(pg, 0, 'Fresh Bear', '2/2', sick=True); hasty = mk(pg, 0, 'Raging Goblin', '1/1', kw='haste', sick=True); wall = mk(pg, 0, 'Wall of Stone', '0/8', kw='defender'); vig = mk(pg, 0, 'Serra Angel', '4/4', kw='flying,vigilance')
    pg.wait_for_timeout(200)
    pg.locator(f'.card[data-id="{sick}"]').click(button='right'); pg.wait_for_timeout(150)
    check('summoning-sick creature: no direct Attack option, only "Attack anyway"', pg.locator('.menu .mi:has-text("Attack Mira")').count() == 0 and pg.locator('.menu .mi:has-text("Attack anyway (summoning sick)")').count() == 1); pg.keyboard.press('Escape')
    check('sick creature shows the zz badge', pg.locator(f'.card[data-id="{sick}"] .zz').count() == 1)
    check('haste ignores summoning sickness', attack_with(pg, hasty))
    pg.locator(f'.card[data-id="{wall}"]').click(button='right'); pg.wait_for_timeout(150)
    check('defender cannot attack', pg.locator('.menu .mi:has-text("Attack Mira")').count() == 0 and pg.locator('.menu .mi:has-text("Attack anyway (defender)")').count() == 1); pg.keyboard.press('Escape')
    check('vigilance attacker stays untapped', attack_with(pg, vig) and not state(pg)['cards'][vig]['tapped'])
    check('non-vigilance attacker taps', state(pg)['cards'][hasty]['tapped'])
    pg.click('#prompt [data-act=allowAll]'); pg.wait_for_timeout(200)
    # ---- the defender has time: attacker can't resolve until an answer; then it clears on the next turn ----
    pg.click('[data-act=pass]'); pg.wait_for_timeout(600); pg.click('[data-act=pass]'); pg.wait_for_timeout(600); pg.click('[data-act=pass]'); pg.wait_for_timeout(600); pg.click('[data-act=pass]'); pg.wait_for_timeout(900)
    check('summoning sickness clears on the controller\'s next turn', state(pg)['turn']['active'] == 0 and not state(pg)['cards'][sick]['sick'])

    # ---- flying vs reach ----
    fresh(pg)
    fly = mk(pg, 0, 'Wind Drake', '2/2', kw='flying'); ground = mk(pg, 1, 'Grizzly Bears', '2/2'); spider = mk(pg, 1, 'Giant Spider', '2/4', kw='reach'); pg.wait_for_timeout(200)
    attack_with(pg, fly); pg.click('#prompt [data-act=block]'); pg.wait_for_timeout(200)
    check('flying: only the reach creature is a legal blocker', pg.locator('.card.canblock').count() == 1 and pg.locator(f'.card.canblock[data-id="{spider}"]').count() == 1)
    pg.click(f'.card[data-id="{ground}"]'); pg.wait_for_timeout(150); check('clicking an illegal blocker is refused', state(pg)['attacks'][0]['blockers'] == [] and 'flying or reach' in pg.locator('#toasts').text_content())
    pg.click(f'.card[data-id="{spider}"]'); pg.wait_for_timeout(150); check('block preview shows the math', 'Wind Drake dies' in pg.locator('#prompt').text_content() and 'Giant Spider survives' in pg.locator('#prompt').text_content())
    pg.click('#prompt [data-act=doneBlock]'); pg.wait_for_timeout(200); st = resolve(pg)
    check('2/2 flyer into a 2/4 reach: drake dies, spider lives with 2 marked, no life lost', gone(st, fly) and alive(st, spider) and st['cards'][spider]['dmg'] == 2 and st['players'][1]['life'] == 40)

    # ---- first strike ----
    fresh(pg)
    fs = mk(pg, 0, 'White Knight', '2/2', kw='first strike'); bear = mk(pg, 1, 'Grizzly Bears', '2/2'); pg.wait_for_timeout(200)
    attack_with(pg, fs); block_with(pg, [bear]); st = resolve(pg)
    check('first strike kills a 2/2 before it can hit back', gone(st, bear) and alive(st, fs) and not st['cards'][fs].get('dmg'))
    fresh(pg)
    fs2 = mk(pg, 0, 'White Knight', '2/2', kw='first strike'); big = mk(pg, 1, 'Hill Giant', '3/3'); pg.wait_for_timeout(200)
    attack_with(pg, fs2); block_with(pg, [big]); st = resolve(pg)
    check('first strike that is not lethal still eats the hit back', alive(st, big) and gone(st, fs2) and st['cards'][big]['dmg'] == 2)
    # ---- double strike ----
    fresh(pg)
    ds = mk(pg, 0, 'Fencing Ace', '1/1', kw='double strike'); b2 = mk(pg, 1, 'Grizzly Bears', '2/2'); pg.wait_for_timeout(200)
    attack_with(pg, ds); block_with(pg, [b2]); st = resolve(pg)
    check('double strike 1/1 vs 2/2: first hit leaves it at 1, bear strikes back, second hit finishes it; both die', gone(st, b2) and gone(st, ds))
    fresh(pg)
    ds2 = mk(pg, 0, 'Boros Swiftblade', '2/1', kw='double strike'); b3 = mk(pg, 1, 'Grizzly Bears', '2/2'); pg.wait_for_timeout(200)
    attack_with(pg, ds2); block_with(pg, [b3]); st = resolve(pg)
    check('double strike 2/1 kills the 2/2 in the first-strike step and takes nothing back', gone(st, b3) and alive(st, ds2) and not st['cards'][ds2].get('dmg'))
    # ---- deathtouch ----
    fresh(pg)
    dt = mk(pg, 0, 'Typhoid Rats', '1/1', kw='deathtouch'); fat = mk(pg, 1, 'Craw Wurm', '6/4'); pg.wait_for_timeout(200)
    attack_with(pg, dt); block_with(pg, [fat]); st = resolve(pg)
    check('deathtouch: the 1/1 kills the 6/4 and dies', gone(st, fat) and gone(st, dt))
    # ---- deathtouch + first strike: survives ----
    fresh(pg)
    dtfs = mk(pg, 0, 'Glissa', '3/3', kw='first strike,deathtouch'); fat2 = mk(pg, 1, 'Craw Wurm', '6/4'); pg.wait_for_timeout(200)
    attack_with(pg, dtfs); block_with(pg, [fat2]); st = resolve(pg)
    check('deathtouch + first strike kills first and takes nothing back', gone(st, fat2) and alive(st, dtfs) and not st['cards'][dtfs].get('dmg'))
    # ---- trample ----
    fresh(pg)
    tr = mk(pg, 0, 'Charging Rhino', '5/5', kw='trample'); chump = mk(pg, 1, 'Goblin', '1/1'); pg.wait_for_timeout(200)
    attack_with(pg, tr); block_with(pg, [chump]); st = resolve(pg)
    check('trample: 1 to the chump, 4 to the player', gone(st, chump) and st['players'][1]['life'] == 36)
    fresh(pg)
    trdt = mk(pg, 0, 'Deathtouch Trampler', '5/5', kw='trample,deathtouch'); c3 = mk(pg, 1, 'Hill Giant', '3/3'); pg.wait_for_timeout(200)
    attack_with(pg, trdt); block_with(pg, [c3]); st = resolve(pg)
    check('trample + deathtouch: 1 to the blocker, 4 through', gone(st, c3) and st['players'][1]['life'] == 36)
    # ---- lifelink ----
    fresh(pg)
    pg.evaluate("__edhMut(st=>{st.players[0].life=30})")
    ll = mk(pg, 0, 'Vampire Nighthawk', '2/3', kw='flying,deathtouch,lifelink'); pg.wait_for_timeout(200)
    attack_with(pg, ll); pg.click('#prompt [data-act=allowAll]'); pg.wait_for_timeout(200); st = resolve(pg)
    check('lifelink unblocked: 2 damage, controller gains 2', st['players'][1]['life'] == 38 and st['players'][0]['life'] == 32)
    fresh(pg); pg.evaluate("__edhMut(st=>{st.players[0].life=30})")
    ll2 = mk(pg, 0, 'Lifelinker', '3/3', kw='lifelink'); bl2 = mk(pg, 1, 'Wall', '0/6'); pg.wait_for_timeout(200)
    attack_with(pg, ll2); block_with(pg, [bl2]); st = resolve(pg)
    check('lifelink while blocked still gains life', st['players'][0]['life'] == 33 and st['cards'][bl2]['dmg'] == 3)
    # ---- indestructible ----
    fresh(pg)
    ind = mk(pg, 1, 'Darksteel Myr', '0/1', kw='indestructible'); hit = mk(pg, 0, 'Hill Giant', '3/3'); pg.wait_for_timeout(200)
    attack_with(pg, hit); block_with(pg, [ind]); st = resolve(pg)
    check('indestructible blocker survives lethal damage', alive(st, ind) and st['cards'][ind]['dmg'] == 3)
    fresh(pg)
    ind2 = mk(pg, 1, 'Darksteel Sentinel', '3/3', kw='indestructible'); dtk = mk(pg, 0, 'Typhoid Rats', '1/1', kw='deathtouch'); pg.wait_for_timeout(200)
    attack_with(pg, dtk); block_with(pg, [ind2]); st = resolve(pg)
    check('indestructible shrugs off deathtouch too', alive(st, ind2) and gone(st, dtk))
    # ---- menace / gang blocks ----
    fresh(pg)
    mn = mk(pg, 0, 'Menace Ogre', '4/4', kw='menace'); g1 = mk(pg, 1, 'Grizzly Bears', '2/2'); g2 = mk(pg, 1, 'Hill Giant', '3/3'); pg.wait_for_timeout(200)
    attack_with(pg, mn); pg.click('#prompt [data-act=block]'); pg.wait_for_timeout(150); pg.click(f'.card[data-id="{g1}"]'); pg.wait_for_timeout(150)
    pg.click('#prompt [data-act=doneBlock]'); pg.wait_for_timeout(200)
    check('menace: a single blocker is refused', 'Menace' in pg.locator('#toasts').text_content() and pg.locator('#prompt [data-act=doneBlock]').count() == 1)
    pg.click(f'.card[data-id="{g2}"]'); pg.wait_for_timeout(150); pg.click('#prompt [data-act=doneBlock]'); pg.wait_for_timeout(200)
    check('two blockers accepted; preview says the ogre dies', sorted(state(pg)['attacks'][0]['blockers']) == sorted([g1, g2]) and 'Menace Ogre dies' in pg.locator('#prompt').text_content())
    st = resolve(pg)
    check('gang block math: 4 damage kills the 2/2 first and the 2 left over marks the 3/3; ogre takes 5 and dies', gone(st, g1) and alive(st, g2) and st['cards'][g2]['dmg'] == 2 and gone(st, mn))
    # ---- marked damage counts toward later lethal in the same turn ----
    fresh(pg)
    a1 = mk(pg, 0, 'Bear A', '2/2'); a2 = mk(pg, 0, 'Bear B', '2/2'); tough = mk(pg, 1, 'Hill Giant', '3/3'); pg.wait_for_timeout(200)
    attack_with(pg, a1); block_with(pg, [tough]); st = resolve(pg)
    check('first block: giant takes 2 and lives', alive(st, tough) and st['cards'][tough]['dmg'] == 2)
    pg.evaluate(f"__edhMut(st=>{{st.cards['{tough}'].tapped=false}})")
    attack_with(pg, a2); block_with(pg, [tough]); st = resolve(pg)
    check('second block the same turn finishes it (2 + 2 >= 3)', gone(st, tough))
    # ---- things that become creatures: stationed spacecraft, crewed vehicles ----
    fresh(pg)
    ship = pg.evaluate("""()=>{const id='ship1'; const c={id,name:'Hearthhull, the Worldseed',cost:'{1}{B}{R}{G}',type:'Legendary Artifact — Spacecraft',pt:'6/7',kw:'flying,vigilance,haste',oracle:"Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 8+.)",colors:'BRG',img:'',big:'',art:'',backImg:'',backBig:'',artist:'',owner:0,controller:0,zone:'battlefield',tapped:false,sick:false,faceDown:false,flipped:false,p1:0,ctr:7,token:false,x:.1,y:.3,isCmdr:false,casts:0}; __edhMut(st=>{st.cards[id]=c; st.players[0].zones.battlefield.push(id);}); return id;}""")
    pg.wait_for_timeout(200)
    pg.locator(f'.card[data-id="{ship}"]').click(button='right'); pg.wait_for_timeout(150)
    check('spacecraft at 7 counters: not a creature, offers "It\'s stationed"', pg.locator('.menu .mi:has-text("Attack")').count() == 0 and pg.locator('.menu .mi:has-text("stationed")').count() == 1); pg.keyboard.press('Escape')
    pg.evaluate(f"__edhMut(st=>{{st.cards['{ship}'].ctr=8}})"); pg.wait_for_timeout(150)
    check('spacecraft at 8 counters is a creature automatically and can attack', attack_with(pg, ship))
    pg.click('#prompt [data-act=allowAll]'); pg.wait_for_timeout(150)
    car = pg.evaluate("""()=>{const id='car1'; const c={id,name:'Smugglers Copter',cost:'{2}',type:'Artifact — Vehicle',pt:'3/3',kw:'flying,crew 1',oracle:'Flying. Crew 1',colors:'',img:'',big:'',art:'',backImg:'',backBig:'',artist:'',owner:0,controller:0,zone:'battlefield',tapped:false,sick:false,faceDown:false,flipped:false,p1:0,ctr:0,token:false,x:.4,y:.3,isCmdr:false,casts:0}; __edhMut(st=>{st.cards[id]=c; st.players[0].zones.battlefield.push(id);}); return id;}""")
    pg.wait_for_timeout(200)
    pg.locator(f'.card[data-id="{car}"]').click(button='right'); pg.wait_for_timeout(150)
    check('vehicle offers Crew it', pg.locator('.menu .mi:has-text("Crew it")').count() == 1); pg.locator('.menu .mi:has-text("Crew it")').click(); pg.wait_for_timeout(200)
    check('crewed vehicle can attack', attack_with(pg, car) and state(pg)['cards'][car]['anim'] is True)
    pg.click('#prompt [data-act=allowAll]'); pg.wait_for_timeout(150)
    check('rules: no JS errors', not errs, str(errs)[:300])
    ctx.close()

    # ---- bots: does it play like a person? ----
    ctx = browser.new_context(); pg, errs = setup(ctx)
    pg.goto(BASE + '/table.html?mode=bots&seats=2&bots=1'); pg.wait_for_timeout(2000)
    # 1. a bot won't suicide a 2/2 into my untapped 4/4, but swings a flyer freely
    pg.evaluate("__edhMut(st=>{st.turn.active=1; st.turn.phase=1; st.players[1].zones.hand=[]; })")
    bearb = mk(pg, 1, 'Bot Bear', '2/2'); flyer = mk(pg, 1, 'Bot Drake', '2/2', kw='flying'); mywall = mk(pg, 0, 'My Giant', '4/4')
    t0 = time.time()
    while time.time() - t0 < 25 and state(pg)['turn']['active'] == 1:
        pg.wait_for_timeout(500)
        if pg.locator('#prompt [data-act=allowAll]').count(): pg.click('#prompt [data-act=allowAll]')
    log = ' '.join(l['text'] for l in state(pg)['log'])
    check('bot attacks with the evasive drake', 'Bot Drake attacks' in log, log[:300])
    check('bot keeps the 2/2 home instead of running into a 4/4', 'Bot Bear attacks Planeswalker' not in log, log[:300])
    # 2. bot blocks when it wins the fight, takes it when it would just lose a creature
    pg.evaluate("__edhMut(st=>{st.turn.active=0; st.turn.phase=1;})"); pg.wait_for_timeout(300)
    pg.evaluate("__edhMut(st=>{ st.players[1].zones.battlefield=[]; Object.keys(st.cards).forEach(id=>{ if (st.cards[id].owner===1 && st.cards[id].zone==='battlefield') delete st.cards[id]; }); })")
    botwall = mk(pg, 1, 'Bot Wall', '2/6'); mybear = mk(pg, 0, 'My Bear', '2/2'); pg.wait_for_timeout(200)
    attack_with(pg, mybear, 'Sphinx Bot'); pg.wait_for_timeout(1800); st = state(pg)
    check('bot blocks a 2/2 with its 2/6 (kills it, survives)', st['attacks'] and st['attacks'][0]['blockers'] == [botwall], str(st['attacks']))
    pg.click('#prompt [data-act=resolveCombat]'); pg.wait_for_timeout(1200)
    pg.evaluate("__edhMut(st=>{ st.players[1].zones.battlefield=[]; Object.keys(st.cards).forEach(id=>{ if (st.cards[id].owner===1 && st.cards[id].zone==='battlefield') delete st.cards[id]; }); })")
    smallb = mk(pg, 1, 'Bot Goblin', '1/1'); mygiant = mk(pg, 0, 'My Giant 2', '4/4'); pg.wait_for_timeout(200)
    attack_with(pg, mygiant, 'Sphinx Bot'); pg.wait_for_timeout(1800); st = state(pg)
    check('bot at 40 life takes 4 rather than chump with its 1/1', st['attacks'] and st['attacks'][0].get('ok') is True and not st['attacks'][0]['blockers'], str(st['attacks']))
    pg.click('#prompt [data-act=resolveCombat]'); pg.wait_for_timeout(1200)
    # 3. ...but chumps when the hit would be lethal
    pg.evaluate("__edhMut(st=>{ st.players[1].life=3; })"); pg.evaluate(f"__edhMut(st=>{{st.cards['{mygiant}'].tapped=false}})")
    smallb2 = mk(pg, 1, 'Bot Goblin 2', '1/1'); pg.wait_for_timeout(200)
    attack_with(pg, mygiant, 'Sphinx Bot'); pg.wait_for_timeout(1800); st = state(pg)
    check('bot at 3 life chump-blocks the 4/4 with a 1/1', st['attacks'] and len(st['attacks'][0]['blockers']) == 1 and st['cards'][st['attacks'][0]['blockers'][0]]['pt'] == '1/1', str(st['attacks']))
    pg.click('#prompt [data-act=resolveCombat]'); pg.wait_for_timeout(1000)
    # 4. bot goes for lethal when it has it
    pg.evaluate("__edhMut(st=>{ st.players[0].life=5; st.players[0].zones.battlefield=[]; Object.keys(st.cards).forEach(id=>{ if (st.cards[id].owner===0 && st.cards[id].zone==='battlefield') delete st.cards[id]; }); })")
    k1 = mk(pg, 1, 'Bot Knight', '3/3'); k2 = mk(pg, 1, 'Bot Ogre', '3/3'); pg.evaluate("__edhMut(st=>{st.turn.active=1; st.turn.phase=1; st.players[1].zones.hand=[];})")
    t0 = time.time(); seen = False
    while time.time() - t0 < 25 and not seen:
        pg.wait_for_timeout(400)
        if pg.locator('#prompt [data-act=allow]').count() >= 2: seen = True
    check('bot with lethal on board sends everything at the 5-life player', seen and all(a['target'] == 0 for a in state(pg)['attacks']) and len(state(pg)['attacks']) >= 2, str(state(pg)['attacks']))
    check('human defender is prompted and nothing resolves until they answer', pg.locator('#prompt [data-act=allow]').count() >= 2 and state(pg)['players'][0]['life'] == 5)
    pg.wait_for_timeout(3000); check('…even three seconds later', state(pg)['players'][0]['life'] == 5)
    pg.click('#prompt [data-act=allowAll]'); pg.wait_for_timeout(2500)
    check('after Take all the bot resolves and the player is out', state(pg)['players'][0]['life'] <= 0 or state(pg)['players'][0]['out'])
    check('bots: no JS errors', not errs, str(errs)[:300])
    ctx.close(); browser.close()

# ---- commander choice, click-to-tap, bots tapping mana ----
with sync_playwright() as p:
    browser = p.chromium.launch(); ctx = browser.new_context(); pg, errs = setup(ctx); fresh(pg)
    cm = next(c for c in state(pg)['cards'].values() if c['isCmdr'] and c['owner'] == 0)
    pg.locator('.me [data-zone$=command] .card').first.dblclick(); pg.wait_for_timeout(1200)
    check('commander cast to the battlefield', state(pg)['cards'][cm['id']]['zone'] == 'battlefield')
    el = pg.locator(f'.card[data-id="{cm["id"]}"]')
    el.click(); pg.wait_for_timeout(250); check('desktop: one left click taps', state(pg)['cards'][cm['id']]['tapped'])
    el.click(); pg.wait_for_timeout(250); check('…and clicking again untaps', not state(pg)['cards'][cm['id']]['tapped'])
    menu(pg, el, 'graveyard'); pg.wait_for_timeout(400)
    check('commander dying asks: command zone or graveyard', not pg.locator('#modal').is_hidden() and pg.locator('#cmdHome').count() == 1 and pg.locator('#cmdStay').count() == 1 and 'died' in pg.locator('#modal').text_content())
    pg.click('#cmdStay'); pg.wait_for_timeout(400); check('"Leave it" keeps it in the graveyard', state(pg)['cards'][cm['id']]['zone'] == 'graveyard')
    pg.evaluate(f"__edhMut(st=>{{ const c=st.cards['{cm['id']}']; st.players[0].zones.graveyard=st.players[0].zones.graveyard.filter(x=>x!==c.id); c.zone='battlefield'; st.players[0].zones.battlefield.push(c.id); }})"); pg.wait_for_timeout(200)
    menu(pg, pg.locator(f'.card[data-id="{cm["id"]}"]'), 'Exile'); pg.wait_for_timeout(400)
    check('exiling it asks too', pg.locator('#cmdHome').count() == 1 and 'exiled' in pg.locator('#modal').text_content())
    pg.click('#cmdHome'); pg.wait_for_timeout(500); check('"Command zone" sends it home', state(pg)['cards'][cm['id']]['zone'] == 'command' and cm['id'] in state(pg)['players'][0]['zones']['command'])
    # a bot's commander goes home automatically
    pg.goto(BASE + '/table.html?mode=bots&seats=2&bots=1'); pg.wait_for_timeout(2500)
    bc = next(c for c in state(pg)['cards'].values() if c['isCmdr'] and c['owner'] == 1)
    pg.evaluate(f"__edhMut(st=>{{ const c=st.cards['{bc['id']}']; st.players[1].zones.command=[]; c.zone='battlefield'; st.players[1].zones.battlefield.push(c.id); }})"); pg.wait_for_timeout(200)
    pg.evaluate(f"__edhMut(st=>{{}})"); pg.locator(f'.card[data-id="{bc['id']}"]').click(button='right'); pg.wait_for_timeout(150)
    # host controls the bot's cards in a bots game; use the menu to kill it
    it = pg.locator('.menu .mi:has-text("graveyard")').first
    if it.count(): it.click()
    pg.wait_for_timeout(600)
    check('a bot\'s commander returns to the command zone on its own', state(pg)['cards'][bc['id']]['zone'] == 'command' and pg.locator('#modal').is_hidden())
    # bots tap mana when they cast
    pg.evaluate("__edhMut(st=>{st.turn.active=1; st.turn.phase=1;})")
    t0 = time.time(); tapped_seen = False
    while time.time() - t0 < 30 and state(pg)['turn']['active'] == 1:
        pg.wait_for_timeout(400); st = state(pg)
        if any(st['cards'][i]['tapped'] and 'Land' in st['cards'][i]['type'] for i in st['players'][1]['zones']['battlefield']) and any('cast' in l['text'] for l in st['log'][:6]): tapped_seen = True
        if pg.locator('#prompt [data-act=allowAll]').count(): pg.click('#prompt [data-act=allowAll]')
    log = ' '.join(l['text'] for l in state(pg)['log'])
    check('bot taps lands when it casts a spell', tapped_seen or 'cast' not in log, log[:200])
    check('commander/tap/bots: no JS errors', not errs, str(errs)[:300])
    browser.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
