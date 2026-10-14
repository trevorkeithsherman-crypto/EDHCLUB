"""Stats recording: when a game ends, the host (or the player vs bots) writes one games row and one game_players row per
seat: placement, turn order, deck, commander, who eliminated whom and how, kills, mulligans, damage dealt, win method
(auto-detected, host can correct it in the recap). Run: python3 tests/stats.py <port>"""
import sys, json, time
sys.argv = ['x', sys.argv[1]]
src = open('tests/deep.py').read().split('with sync_playwright() as p:')[0]
exec(src)
MK = """const mk=(st,seat,name,pt,cmdr)=>{const id='s'+seat+Math.random().toString(36).slice(2,7); st.cards[id]={id,name,type:'Legendary Creature — Test',cost:'{2}',pt:pt||'5/5',oracle:'',colors:'R',kw:'',img:'',big:'',art:'',backImg:'',backBig:'',artist:'',owner:seat,controller:seat,zone:'battlefield',tapped:false,faceDown:false,flipped:false,p1:0,ctr:0,token:false,x:.3,y:.5,isCmdr:!!cmdr,casts:0,sick:false}; st.players[seat].zones.battlefield.push(id); return id;};"""
with sync_playwright() as p:
    browser = p.chromium.launch(); ctx = browser.new_context(); pg, errs = setup(ctx)
    pg.goto(BASE + '/'); pg.wait_for_timeout(600); pg.click('[data-go="signin"]'); pg.wait_for_timeout(200); pg.click('.tab:has-text("guest")'); pg.wait_for_timeout(150); pg.click('#guest'); pg.wait_for_timeout(1000)
    pg.goto(BASE + '/table.html?mode=bots&name=Trevor&seats=3&bots=2'); pg.wait_for_timeout(1800)
    # seat 0 (me) kills seat 1 with commander damage, seat 2 with combat; seat 2 took a mulligan
    pg.evaluate("__edhMut(st => { st.players[0].deckId = 'd1'; st.players[0].deckName = 'Krenko Goblins'; st.players[2].mulls = 1; st.turn.number = 7; })")
    cm = pg.evaluate("(()=>{let out; __edhMut(st=>{ const id = st.players[0].zones.command[0]; const c = st.cards[id]; c.zone='battlefield'; st.players[0].zones.command = []; st.players[0].zones.battlefield.push(id); c.pt = '21/21'; out = id; }); return out;})()")
    pg.evaluate(f"__edhMut(st => {{ st.players[1].cmdDmg = {{}}; }}); __edhApi().req.cmdDmg(1, '{cm}', 21)"); pg.wait_for_timeout(1600)
    check('seat 1 is out to 21 commander damage, credited to seat 0', pg.evaluate("()=>{const q=__edhState().players[1]; return [q.out, q.outBy, q.outHow, q.outTurn]}") == [True, 0, 'commander', 7])
    big = pg.evaluate("(()=>{let out; __edhMut(st=>{" + MK + "out = mk(st,0,'Big Guy','40/40',false);}); return out;})()")
    pg.evaluate(f"__edhApi().req.combat(2, '{big}')"); pg.wait_for_timeout(2500)
    g = STORE['games']; gp = STORE['game_players']
    check('the game is recorded once it ends: one games row with turns, mode, seats, win method and the winner', len(g) == 1 and g[0]['mode'] == 'bots' and g[0]['seats'] == 3 and g[0]['turns'] == 7 and g[0]['vs_bots'] is True and g[0]['winner_id'] == FAKE_USER['id'] and g[0]['winner_deck_id'] == 'd1' and g[0]['recorded_by'] == FAKE_USER['id'] and g[0]['duration_s'] is not None, json.dumps(g)[:400])
    check('win method auto-detected (combat finished the last player) ', g[0]['win_method'] == 'combat', g[0]['win_method'])
    me = next((r for r in gp if r['seat'] == 0), None); s1 = next((r for r in gp if r['seat'] == 1), None); s2 = next((r for r in gp if r['seat'] == 2), None)
    check('three game_players rows, bots flagged with no user id', len(gp) == 3 and me and s1 and s2 and s1['bot'] and s1['user_id'] is None and me['user_id'] == FAKE_USER['id'], json.dumps(gp)[:300])
    check('my row: placement 1, deck and commander, 2 kills, damage dealt summed from the victims\' books', me['placement'] == 1 and me['deck_id'] == 'd1' and me['commander'] == 'Krenko, Mob Boss' and me['kills'] == 2 and me['dmg_dealt'] == 61 and me['cmd_dmg_dealt'] == 21 and me['turn_order'] == 1, json.dumps(me))
    check('seat 1: placement 3 (first out), eliminated by seat 0 via commander damage on turn 7', s1['placement'] == 3 and s1['eliminated_by_seat'] == 0 and s1['eliminated_how'] == 'commander' and s1['eliminated_turn'] == 7, json.dumps(s1))
    check('seat 2: placement 2, combat, one mulligan', s2['placement'] == 2 and s2['eliminated_how'] == 'combat' and s2['mulligans'] == 1 and s2['turn_order'] == 3, json.dumps(s2))
    check('recap offers a win-method picker preselected to the detected method', pg.locator('#winHow').count() == 1 and pg.locator('#winHow').input_value() == 'combat', pg.evaluate("[document.querySelectorAll('#winHow').length, document.querySelector('#winHow') && document.querySelector('#winHow').value, __edhState().winMethod]"))
    pg.select_option('#winHow', 'combo'); pg.wait_for_timeout(600)
    check('changing it patches the recorded game', g[0]['win_method'] == 'combo', g[0]['win_method'])
    check('no JS errors', not errs, str(errs)[:300])
    browser.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
