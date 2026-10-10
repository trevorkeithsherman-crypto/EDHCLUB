"""Live table, humans only: a priority window on every spell (OK / Respond / Counter / Resolve now), a Respond option on
incoming attacks, and cascade for human casts."""
import sys, json, time
sys.argv = ['x', sys.argv[1]]
src = open('tests/deep.py').read().split('with sync_playwright() as p:')[0]
exec(src)
MK = """const mk=(st,seat,name,type,cost,pt,oracle,zone,kw)=>{const id=name.replace(/[^a-z]/gi,'').slice(0,6).toLowerCase()+Math.random().toString(36).slice(2,6); st.cards[id]={id,name,type,cost,pt,oracle,colors:'R',kw:kw||'',img:'',big:'',art:'',backImg:'',backBig:'',artist:'',owner:seat,controller:seat,zone,tapped:false,faceDown:false,flipped:false,p1:0,ctr:0,token:false,x:.3,y:.6,isCmdr:false,casts:0,sick:false}; st.players[seat].zones[zone].push(id); return id;};"""
def give(pg, seat, name, type_, cost, pt='', oracle='', zone='hand', kw=''):
    return pg.evaluate("([seat,name,type,cost,pt,oracle,zone,kw])=>{let out;__edhMut(st=>{" + MK + "out=mk(st,seat,name,type,cost,pt,oracle,zone,kw);});return out;}", [seat, name, type_, cost, pt, oracle, zone, kw])
def zone(pg, cid): return (state(pg)['cards'].get(cid) or {}).get('zone')
def wait_for(pg, sel, secs=6):
    t0 = time.time()
    while time.time() - t0 < secs:
        if pg.locator(sel).count(): return True
        pg.wait_for_timeout(150)
    return False

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(); ctx.add_init_script(FAKE_CHANNEL_JS)
    host, he = setup(ctx); guest, ge = setup(ctx)
    host.goto(BASE + '/table.html?room=PVP01&host=1&name=Host&seats=2&bots=0'); host.wait_for_timeout(2000)
    guest.goto(BASE + '/table.html?room=PVP01&name=Guest'); guest.wait_for_timeout(2600)
    host.evaluate("__edhMut(st=>{ st.turn.active=0; st.turn.phase=1; st.turn.number=3; })"); host.wait_for_timeout(600)
    # ---- 1. instant: waits on the stack for the guest ----
    bolt = give(host, 0, 'Lightning Bolt', 'Instant', '{R}', '', 'Lightning Bolt deals 3 damage to any target.')
    host.evaluate(f"__edhApi().cast('{bolt}')"); host.wait_for_timeout(700)
    check('human spell at a live table goes to the stack, not the graveyard', zone(host, bolt) == 'stack' and state(host)['pending'] and state(host)['pending']['state'] == 'open')
    check('caster sees who it is waiting on and a Resolve now button', 'Waiting for Guest' in host.locator('#prompt').text_content() and host.locator('#prompt [data-act=presolve]').count() == 1 and host.locator('#prompt [data-act=pok]').count() == 0)
    check('guest gets OK / Respond… / Counter it', wait_for(guest, '#prompt [data-act=pok]') and guest.locator('#prompt [data-act=phold]').count() == 1 and guest.locator('#prompt [data-act=pcounter]').count() == 1 and 'Host' in guest.locator('#prompt').text_content() and 'Lightning Bolt' in guest.locator('#prompt').text_content())
    host.wait_for_timeout(2500); check('nothing resolves on its own while the guest thinks', zone(host, bolt) == 'stack' and zone(guest, bolt) == 'stack')
    guest.click('#prompt [data-act=phold]'); guest.wait_for_timeout(900)
    check('Respond… holds: guest has priority, host sees Guest is responding', 'You have priority' in guest.locator('#prompt').text_content() and 'Guest' in host.locator('#prompt').text_content() and 'responding' in host.locator('#prompt').text_content() and zone(host, bolt) == 'stack')
    host.wait_for_timeout(1500); check('held spell stays on the stack (no auto graveyard)', zone(host, bolt) == 'stack')
    guest.click('#prompt [data-act=pok]'); guest.wait_for_timeout(1200)
    check('Let it resolve: the instant goes to the graveyard on both sides, prompt clears', zone(host, bolt) == 'graveyard' and zone(guest, bolt) == 'graveyard' and not state(host)['pending'] and not state(guest)['pending'])
    # ---- 2. creature: resolves to the battlefield after OK ----
    bear = give(host, 0, 'Grizzly Bears', 'Creature — Bear', '{1}{G}', '2/2', '')
    host.evaluate(f"__edhApi().cast('{bear}')"); host.wait_for_timeout(600)
    check('a permanent also waits on the stack', zone(host, bear) == 'stack' and wait_for(guest, '#prompt [data-act=pok]'))
    guest.click('#prompt [data-act=pok]'); guest.wait_for_timeout(1200)
    check('OK puts the creature onto the battlefield', zone(host, bear) == 'battlefield' and zone(guest, bear) == 'battlefield')
    # ---- 3. counter ----
    shock = give(host, 0, 'Shock', 'Instant', '{R}', '', 'Shock deals 2 damage to any target.')
    host.evaluate(f"__edhApi().cast('{shock}')"); host.wait_for_timeout(600); wait_for(guest, '#prompt [data-act=pcounter]')
    guest.click('#prompt [data-act=pcounter]'); guest.wait_for_timeout(1200)
    check('Counter it: spell to the graveyard, logged as countered', zone(host, shock) == 'graveyard' and any('was countered' in l['text'] for l in state(host)['log']))
    # ---- 4. caster resolves by hand while the guest is responding ----
    sh2 = give(host, 0, 'Shock', 'Instant', '{R}', '', 'Shock deals 2 damage to any target.')
    host.evaluate(f"__edhApi().cast('{sh2}')"); host.wait_for_timeout(600); wait_for(guest, '#prompt [data-act=phold]'); guest.click('#prompt [data-act=phold]'); guest.wait_for_timeout(700)
    host.click('#prompt [data-act=presolve]'); host.wait_for_timeout(1000)
    check('Resolve now lets the caster finish it by hand', zone(host, sh2) == 'graveyard' and not state(host)['pending'] and wait_for(guest, '#prompt[hidden]', 3))
    # ---- 5. combat: Respond… on an incoming attack ----
    host.evaluate(f"__edhMut(st=>{{ st.cards['{bear}'].sick=false; }})")
    ok = menu(host, host.locator(f'.card[data-id="{bear}"]').first, 'Attack Guest'); host.wait_for_timeout(900)
    check('Attack Guest is offered for an untapped, unsick creature', ok)
    check('attack declared; guest is asked', len(state(host)['attacks']) == 1 and wait_for(guest, '#prompt [data-act=allow]') and guest.locator('#prompt [data-act=respond]').count() == 1)
    life0 = state(guest)['players'][1]['life']; 
    guest.click('#prompt [data-act=respond]'); guest.wait_for_timeout(900)
    check('Respond… holds the attack: guest keeps Block / Take it, host sees (responding)', 'responding' in guest.locator('#prompt').text_content() and guest.locator('#prompt [data-act=allow]').count() == 1 and guest.locator('#prompt [data-act=respond]').count() == 0 and '(responding)' in host.locator('#prompt').text_content())
    host.evaluate("__edhApi().resolveCombat(0)"); host.wait_for_timeout(800)
    check('attacker cannot push damage through while the defender is responding', state(guest)['players'][1]['life'] == life0 and len(state(host)['attacks']) == 1)
    guest.click('#prompt [data-act=allow]'); guest.wait_for_timeout(900)
    check('Take it: host can now resolve combat', wait_for(host, '#prompt [data-act=resolveCombat]'))
    host.click('#prompt [data-act=resolveCombat]'); host.wait_for_timeout(1500)
    gp = guest.evaluate(f"__edhApi().Rules.powerOf(window.__edhState().cards['{bear}'])")
    check('combat damage lands only after the defender let it through', state(guest)['players'][1]['life'] == life0 - gp and gp > 0, f"guest life {state(guest)['players'][1]['life']} expected {life0 - gp}")
    # ---- 6. cascade for a human ----
    host.evaluate("__edhMut(st=>{ st.players[0].zones.library=[]; })")
    f1 = give(host, 0, 'Forest', 'Basic Land — Forest', '', '', '', 'library'); gg = give(host, 0, 'Giant Growth', 'Instant', '{G}', '', 'Target creature gets +3/+3 until end of turn.', 'library'); f2 = give(host, 0, 'Forest', 'Basic Land — Forest', '', '', '', 'library')
    elf = give(host, 0, 'Bloodbraid Elf', 'Creature — Elf Berserker', '{2}{R}{G}', '3/2', 'Cascade\nHaste', 'hand', 'Cascade, Haste')
    host.evaluate(f"__edhApi().cast('{elf}')"); host.wait_for_timeout(600); wait_for(guest, '#prompt [data-act=pok]'); guest.click('#prompt [data-act=pok]'); guest.wait_for_timeout(1300)
    check('after the creature resolves, cascade digs: Forest skipped, Giant Growth found, modal offers to cast it free', zone(host, elf) == 'battlefield' and host.locator('#modal #cascCast').count() == 1 and 'Giant Growth' in host.locator('#modal').text_content())
    lib = state(host)['players'][0]['zones']['library']
    check('skipped card went to the bottom; the hit is in exile pending the choice', lib == [f2, f1] and zone(host, gg) == 'exile')
    host.click('#modal #cascCast'); host.wait_for_timeout(700)
    check('casting the cascaded card opens the same priority window for the guest', zone(host, gg) == 'stack' and wait_for(guest, '#prompt [data-act=pok]') and 'Giant Growth' in guest.locator('#prompt').text_content())
    guest.click('#prompt [data-act=pok]'); guest.wait_for_timeout(1200)
    check('cascaded instant resolves to the graveyard', zone(host, gg) == 'graveyard')
    # bottom path
    host.evaluate("__edhMut(st=>{ st.players[0].zones.library=[]; })")
    sh3 = give(host, 0, 'Shock', 'Instant', '{R}', '', 'Shock deals 2 damage to any target.', 'library')
    elf2 = give(host, 0, 'Bloodbraid Elf', 'Creature — Elf Berserker', '{2}{R}{G}', '3/2', 'Cascade\nHaste', 'hand', 'Cascade, Haste')
    host.evaluate(f"__edhApi().cast('{elf2}')"); host.wait_for_timeout(600); wait_for(guest, '#prompt [data-act=pok]'); guest.click('#prompt [data-act=pok]'); guest.wait_for_timeout(1300)
    host.click('#modal #cascBottom'); host.wait_for_timeout(500)
    check('Put it on the bottom returns the hit to the bottom of the library', zone(host, sh3) == 'library' and state(host)['players'][0]['zones']['library'][-1] == sh3)
    check('no JS errors (host, guest)', not he and not ge, str(he + ge)[:300])
    ctx.close()
    # ---- 7. bots only: no window, casts resolve at once ----
    ctx = browser.new_context(); pg, errs = setup(ctx); pg.goto(BASE + '/table.html?mode=bots&seats=2&bots=1'); pg.wait_for_timeout(1800)
    pg.evaluate("__edhMut(st=>{ st.turn.active=0; st.turn.phase=1; })")
    b2 = give(pg, 0, 'Lightning Bolt', 'Instant', '{R}', '', 'Lightning Bolt deals 3 damage to any target.')
    pg.evaluate(f"__edhApi().cast('{b2}')"); pg.wait_for_timeout(500)
    check('against bots only, my spells resolve immediately as before', zone(pg, b2) == 'graveyard' and not state(pg).get('pending'))
    elf3 = give(pg, 0, 'Bloodbraid Elf', 'Creature — Elf Berserker', '{2}{R}{G}', '3/2', 'Cascade\nHaste', 'hand', 'Cascade, Haste')
    pg.evaluate("__edhMut(st=>{ st.players[0].zones.library=[]; })"); sh4 = give(pg, 0, 'Shock', 'Instant', '{R}', '', 'Shock deals 2 damage to any target.', 'library')
    pg.evaluate(f"__edhApi().cast('{elf3}')"); pg.wait_for_timeout(700)
    check('cascade also fires for my casts against bots', pg.locator('#modal #cascCast').count() == 1 and zone(pg, elf3) == 'battlefield')
    pg.click('#modal #cascCast'); pg.wait_for_timeout(500); check('cascaded spell cast free', zone(pg, sh4) == 'graveyard' and not errs, str(errs)[:200])
    browser.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
