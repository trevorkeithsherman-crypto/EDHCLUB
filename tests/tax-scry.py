"""Commander tax: auto on casts only, adjustable by hand; Scry and Surveil from the library menu."""
import sys, json
sys.argv = ['x', sys.argv[1]]
src = open('tests/deep.py').read().split('with sync_playwright() as p:')[0]
exec(src)
MK = """const mk=(seat,name,type,zone,extra={})=>{const id=name.replace(/[^a-z]/gi,'').slice(0,8)+Math.random().toString(36).slice(2,6); st.cards[id]={id,name,type,cost:'{2}{R}',pt:'2/2',oracle:'',colors:'R',kw:'',img:'',big:'',art:'',backImg:'',backBig:'',artist:'',owner:seat,controller:seat,zone,tapped:false,sick:false,faceDown:false,flipped:false,p1:0,ctr:0,token:false,x:.2,y:.3,isCmdr:false,casts:0,...extra}; st.players[seat].zones[zone].push(id); return id;};"""
def lib_names(pg, seat=0): st = state(pg); return [st['cards'][i]['name'] for i in st['players'][seat]['zones']['library']]
with sync_playwright() as p:
    browser = p.chromium.launch(); ctx = browser.new_context(); pg, errs = setup(ctx)
    pg.goto(BASE + '/table.html?mode=bots&seats=2&bots=1'); pg.wait_for_timeout(2200)
    # two partner commanders in the command zone
    ids = pg.evaluate("()=>{let a,b; __edhMut(st=>{" + MK + " const p=st.players[0]; p.zones.command.forEach(id=>delete st.cards[id]); p.zones.command=[]; a=mk(0,'Thrasios, Triton Hero','Legendary Creature — Merfolk Wizard','command',{isCmdr:true}); b=mk(0,'Tymna the Weaver','Legendary Creature — Human Cleric','command',{isCmdr:true}); }); return [a,b];}")
    a, b = ids
    pg.locator('.me [data-pile$=command] .slot').click(button='right'); pg.wait_for_timeout(200)
    check('command zone menu lists both partners with their own tax', pg.locator('.menu .mi:has-text("Cast Thrasios")').count() == 1 and pg.locator('.menu .mi:has-text("Cast Tymna")').count() == 1 and pg.locator('.menu .mi:has-text("Put Tymna the Weaver onto battlefield (no tax)")').count() == 1)
    pg.locator('.menu .mi:has-text("Put Tymna the Weaver onto battlefield (no tax)")').click(); pg.wait_for_timeout(600); st = state(pg)
    check('putting a commander onto the battlefield by hand does not add tax', st['cards'][b]['zone'] == 'battlefield' and st['cards'][b]['casts'] == 0)
    pg.locator(f'.card[data-id="{b}"]').click(button='right'); pg.wait_for_timeout(150); pg.locator('.menu .mi:has-text("Command zone")').first.click(); pg.wait_for_timeout(600); st = state(pg)
    check('and moving it back keeps tax at 0', st['cards'][b]['zone'] == 'command' and st['cards'][b]['casts'] == 0)
    pg.locator('.me [data-pile$=command] .slot').click(button='right'); pg.wait_for_timeout(200); pg.locator('.menu .mi:has-text("Cast Thrasios")').click(); pg.wait_for_timeout(800); st = state(pg)
    check('casting from the command zone counts once (tax +2 next time)', st['cards'][a]['zone'] == 'battlefield' and st['cards'][a]['casts'] == 1 and st['cards'][b]['casts'] == 0)
    # ± on the pile chip
    check('command pile shows ± tax buttons for my seat', pg.locator('.me .tax .taxbtn[data-d="1"]').count() >= 1)
    pg.locator(f'.me .taxbtn[data-id="{b}"][data-d="1"]').click(); pg.wait_for_timeout(300); st = state(pg)
    check('+ raises Tymna\'s tax by {2}', st['cards'][b]['casts'] == 1 and any("set Tymna the Weaver's commander tax to {2}" in l['text'] for l in st['log']))
    pg.locator(f'.me .taxbtn[data-id="{b}"][data-d="-1"]').click(); pg.wait_for_timeout(300); st = state(pg)
    check('− lowers it again', st['cards'][b]['casts'] == 0)
    check('− is disabled at zero', pg.locator(f'.me .taxbtn[data-id="{b}"][data-d="-1"]').is_disabled())
    pg.locator(f'.card[data-id="{a}"]').click(button='right'); pg.wait_for_timeout(150)
    check('card menu on a commander offers raise/lower tax', pg.locator('.menu .mi:has-text("Commander tax: {2} — raise")').count() == 1 and pg.locator('.menu .mi:has-text("Commander tax — lower")').count() == 1)
    pg.locator('.menu .mi:has-text("Commander tax — lower")').click(); pg.wait_for_timeout(300); check('lower from the card menu works', state(pg)['cards'][a]['casts'] == 0)
    # ---- scry ----
    pg.evaluate("__edhMut(st=>{" + MK + " const p=st.players[0]; p.zones.library.forEach(id=>delete st.cards[id]); p.zones.library=[]; ['Alpha','Beta','Gamma','Delta','Epsilon'].forEach(n=>mk(0,n,'Sorcery','library')); })")
    pg.locator('.me [data-pile$=library] .slot').click(button='right'); pg.wait_for_timeout(200)
    check('library menu has Scry… and Surveil…', pg.locator('.menu .mi:has-text("Scry…")').count() == 1 and pg.locator('.menu .mi:has-text("Surveil…")').count() == 1)
    pg.locator('.menu .mi:has-text("Scry…")').click(); pg.wait_for_timeout(200); check('asks how many (1–5)', pg.locator('#peekN [data-n]').count() == 5)
    pg.click('#peekN [data-n="3"]'); pg.wait_for_timeout(400)
    check('shows the top 3 face up, all on top by default', pg.locator('.peek').count() == 3 and pg.locator('.peek.away').count() == 0 and 'Alpha' in pg.locator('.peek').first.text_content())
    names = lambda: [e.strip().split('\n')[0] for e in pg.locator('.peek .cn').all_text_contents()]
    beta = pg.evaluate("()=>[...document.querySelectorAll('.peek')].find(e=>e.textContent.includes('Beta')).dataset.pid")
    pg.locator(f'.peek[data-pid="{beta}"] [data-pk=toggle]').click(); pg.wait_for_timeout(200)
    check('Bottom marks a card to go under the library', pg.locator('.peek.away').count() == 1 and 'bottom' in pg.locator(f'.peek[data-pid="{beta}"] .peekpos').text_content())
    gamma = pg.evaluate("()=>[...document.querySelectorAll('.peek')].find(e=>e.textContent.includes('Gamma')).dataset.pid")
    pg.locator(f'.peek[data-pid="{gamma}"] [data-pk=left]').click(); pg.wait_for_timeout(200)
    check('◀ moves a kept card closer to the top (skipping bottomed ones)', 'top' == pg.locator(f'.peek[data-pid="{gamma}"] .peekpos').text_content().strip())
    pg.click('#peekGo'); pg.wait_for_timeout(400); l = lib_names(pg)
    check('library order: Gamma, Alpha on top; Delta, Epsilon untouched; Beta on the bottom', l == ['Gamma', 'Alpha', 'Delta', 'Epsilon', 'Beta'], str(l))
    check('scry is logged', any('scried 3 (1 to the bottom)' in x['text'] for x in state(pg)['log']))
    # ---- surveil ----
    pg.locator('.me [data-pile$=library] .slot').click(button='right'); pg.wait_for_timeout(200); pg.locator('.menu .mi:has-text("Surveil…")').click(); pg.wait_for_timeout(200); pg.click('#peekN [data-n="2"]'); pg.wait_for_timeout(400)
    check('surveil offers Graveyard instead of Bottom', pg.locator('.peek [data-pk=toggle]:has-text("Graveyard")').count() == 2)
    g = pg.evaluate("()=>[...document.querySelectorAll('.peek')].find(e=>e.textContent.includes('Gamma')).dataset.pid"); pg.locator(f'.peek[data-pid="{g}"] [data-pk=toggle]').click(); pg.click('#peekGo'); pg.wait_for_timeout(400); st = state(pg)
    check('surveil: Gamma went to the graveyard, Alpha stays on top', lib_names(pg) == ['Alpha', 'Delta', 'Epsilon', 'Beta'] and st['cards'][g]['zone'] == 'graveyard' and g in st['players'][0]['zones']['graveyard'])
    check('surveil is logged', any('surveiled 2 (1 to the graveyard)' in x['text'] for x in state(pg)['log']))
    check('no JS errors', not errs, str(errs)[:300])
    browser.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
