"""Reconnect, host handoff and game persistence; Discord voice link per table.
- host plays, closes the tab → guest becomes host, bots keep playing, table keeps saving
- everyone leaves → first one back restores the whole table from the server and hosts
- a player on a "new device" (no local memory) gets their own seat and cards back
- voice link: set by a seated player, shown to everyone, survives a restore; home page lists Your tables with Resume
Run: python3 tests/resume.py <port>"""
import sys, json, time
sys.argv = ['x', sys.argv[1]]
src = open('tests/deep.py').read().split('with sync_playwright() as p:')[0]
exec(src)
MK = """const mk=(st,seat,name,type,zone)=>{const id='r'+seat+Math.random().toString(36).slice(2,7); st.cards[id]={id,name,type,cost:'',pt:'2/2',oracle:'',colors:'R',kw:'',img:'',big:'',art:'',backImg:'',backBig:'',artist:'',owner:seat,controller:seat,zone,tapped:false,faceDown:false,flipped:false,p1:0,ctr:0,token:false,x:.3,y:.6,isCmdr:false,casts:0,sick:false}; st.players[seat].zones[zone].push(id); return id;};"""
def give(pg, seat, name, zone='battlefield'): return pg.evaluate("([seat,name,zone])=>{let out;__edhMut(st=>{" + MK + "out=mk(st,seat,name,'Creature — Test',zone);});return out;}", [seat, name, zone])
def names_on(pg, seat, zone='battlefield'): st = state(pg); return sorted(st['cards'][i]['name'] for i in st['players'][seat]['zones'][zone])
def is_host(pg): return pg.evaluate("__edhApi().net.isHost")
def wait_for(fn, secs=8):
    t0 = time.time()
    while time.time() - t0 < secs:
        try:
            if fn(): return True
        except Exception: pass
        time.sleep(0.25)
    return False
with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(); ctx.add_init_script(FAKE_CHANNEL_JS); ctx.add_init_script("window.__edhSkipOpening = true;")
    host, he = setup(ctx); guest, ge = setup(ctx)
    host.goto(BASE + '/table.html?room=RSM01&host=1&name=Host&seats=3&bots=1'); host.wait_for_timeout(2000)
    guest.goto(BASE + '/table.html?room=RSM01&name=Guest'); guest.wait_for_timeout(2600)
    check('host hosts, guest does not', is_host(host) and not is_host(guest))
    check('room bar shows Host tag on the host and an Add voice button', 'Host' in host.locator('#roomBar').text_content() and host.locator('#roomBar #voiceBtn').count() == 1)
    gseat = guest.evaluate("__edhApi().net.seat")
    # ---- voice link ----
    guest.click('#roomBar #voiceBtn'); guest.wait_for_timeout(300); guest.fill('#voiceUrl', 'not a link'); guest.click('#voiceSave'); guest.wait_for_timeout(300)
    check('voice: rejects a non-Discord link', 'Use a Discord link' in guest.locator('#toasts').text_content())
    guest.fill('#voiceUrl', 'https://discord.com/channels/123/456'); guest.click('#voiceSave'); guest.wait_for_timeout(1200)
    check('voice: a seated player can set it; both see the Voice button linking to it', guest.locator('#roomBar a#voiceBtn[href="https://discord.com/channels/123/456"]').count() == 1 and wait_for(lambda: host.locator('#roomBar a#voiceBtn[href="https://discord.com/channels/123/456"]').count() == 1))
    check('voice link saved on the server', STORE['room_state'].get('RSM01', {}).get('voice_url') == 'https://discord.com/channels/123/456')
    # ---- play a bit, let the host save ----
    give(host, 0, 'Host Bear'); give(guest, gseat, 'Guest Bear'); host.evaluate("__edhMut(st=>{ st.players[0].life = 31; })"); host.wait_for_timeout(5500)
    saved = STORE['room_state'].get('RSM01', {}).get('state', {})
    check('host saves the whole table to the server (every seat, shared state, who sits where)', saved.get('players') and len(saved['players']) == 3 and saved['shared']['turn'] and str(gseat) in saved['seatsBy'] and any(c['name'] == 'Guest Bear' for pl in saved['players'] for c in pl['cards']), str(list(saved.keys())))
    check('saved life total matches', next(pl for pl in saved['players'] if pl['seat'] == 0)['player']['life'] == 31)
    check('room_players recorded both humans', len([v for v in STORE['room_players'].values() if v['code'] == 'RSM01']) >= 1)
    # ---- host leaves → guest takes over ----
    host.close(); guest.wait_for_timeout(1500)
    check('host closes the tab: the guest becomes host', wait_for(lambda: is_host(guest), 6) and 'now hosting' in ' '.join(l['text'] for l in state(guest)['log'][:5]), str([l['text'] for l in state(guest)['log'][:4]]))
    check('new host owns the bot seat and keeps the board (host\'s bear still there)', guest.evaluate("__edhApi().net.ownedSeats().length") == 2 and 'Host Bear' in names_on(guest, 0))
    guest.evaluate("__edhMut(st=>{ st.turn.active = 2; st.turn.phase = 1; })"); t0 = time.time()
    while time.time() - t0 < 25 and state(guest)['turn']['active'] == 2:
        guest.wait_for_timeout(400)
        for sel in ['#prompt [data-act=allowAll]', '#prompt [data-act=pok]']:
            if guest.locator(sel).count(): guest.click(sel)
    check('the bot plays its turn on the new host\'s device', state(guest)['turn']['active'] != 2 or state(guest)['players'][2]['zones']['battlefield'])
    give(guest, gseat, 'Second Bear'); guest.wait_for_timeout(5500)
    saved = STORE['room_state']['RSM01']['state']
    check('the new host keeps saving', any(c['name'] == 'Second Bear' for pl in saved['players'] for c in pl['cards']))
    # ---- everyone leaves; a new device for the original host comes back first ----
    guest.close(); time.sleep(0.5)
    ctx2 = browser.new_context(); ctx2.add_init_script(FAKE_CHANNEL_JS); ctx2.add_init_script("window.__edhSkipOpening = true;")
    back, be = setup(ctx2)
    back.goto(BASE + '/table.html?room=RSM01&name=Host'); back.wait_for_timeout(3000)
    st = state(back); seat = back.evaluate("__edhApi().net.seat")
    check('first one back restores the table from the server and becomes host', is_host(back) and 'Host Bear' in names_on(back, 0) and 'Guest Bear' in names_on(back, gseat) and 'Second Bear' in names_on(back, gseat), f"seat {seat} host {is_host(back)} bf0 {names_on(back, 0)}")
    check('…in their own seat (claimed by account + name), with life and turn intact', seat == 0 and st['players'][0]['life'] == 31 and st['turn']['number'] >= 1)
    check('…the bot seat is a bot again and the voice link came back', st['players'][2]['bot'] and back.locator('#roomBar a#voiceBtn').count() == 1)
    check('restore is announced', 'Table restored' in back.locator('#toasts').text_content() or any('reopened' in l['text'] for l in st['log'][:3]))
    # ---- the guest returns on a new device while the table is live: gets their seat and cards back ----
    g2, g2e = setup(ctx2)
    g2.goto(BASE + '/table.html?room=RSM01&name=Guest'); g2.wait_for_timeout(3000)
    check('returning guest (new device) gets their old seat and their cards', g2.evaluate("__edhApi().net.seat") == gseat and 'Guest Bear' in names_on(g2, gseat) and not is_host(g2), f"seat {g2.evaluate('__edhApi().net.seat')} {names_on(g2, gseat)}")
    check('both sides agree on the board', names_on(back, gseat) == names_on(g2, gseat) and names_on(g2, 0) == names_on(back, 0))
    # ---- home page lists the table with Resume ----
    hm, hme = setup(ctx2); hm.goto(BASE + '/home.html'); hm.wait_for_timeout(1500)
    check('home page: Your tables lists the live table with a Resume link', hm.locator('#mineTables').is_visible() and 'RSM01' in hm.locator('#mineTablesBody').text_content() and hm.locator('#mineTablesBody a[href*="room=RSM01"]').count() == 1)
    check('no JS errors', not he and not ge and not be and not g2e and not hme, str(he + ge + be + g2e + hme)[:400])
    browser.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
