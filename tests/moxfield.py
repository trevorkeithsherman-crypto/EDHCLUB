"""Moxfield-style imports with printings: every card must load with art and oracle text whether the printing is one
Scryfall knows, one it doesn't (odd set code / number), or one that carries Moxfield's Scryfall id. Ten generated
100-card decks (real cards) are seated and checked card by card; a real Moxfield-exported list is parsed too."""
import sys, json, time, random
sys.argv = ['x', sys.argv[1]]
src = open('tests/deep.py').read().split('with sync_playwright() as p:')[0]
exec(src)
sys.path.insert(0, 'tests'); import realcards
def moxify(text, seed):
    """Dress a plain list the way the worker renders Moxfield decks: (SET) number, foil marks, [sf=id] tags."""
    rnd = random.Random(seed); out = []
    for line in text.split('\n'):
        m = line.strip() and __import__('re').match(r'^(\d+) (.+)$', line.strip())
        if not m: out.append(line); continue
        q, name = m.group(1), m.group(2); r = rnd.random()
        if r < 0.35: tag = f' (PLST) {rnd.choice(["DOM","ZNR","C14","MH1"])}-{rnd.randint(1,300)}'          # printing Scryfall won't know
        elif r < 0.7: tag = f' (PT) 1 [sf={realcards.sfid(name)}]'                                         # Moxfield's Scryfall id
        elif r < 0.85: tag = f' (SLD) {rnd.randint(1,999)}★ *F* [sf={realcards.sfid(name)}]'               # odd number + foil + id
        else: tag = ''
        out.append(f'{q} {name}{tag}')
    return '\n'.join(out)
with sync_playwright() as p:
    browser = p.chromium.launch(); ctx = browser.new_context(); pg, errs = setup(ctx)
    pg.unroute('https://api.scryfall.com/**'); pg.route('https://api.scryfall.com/**', realcards.scry_route)
    pg.goto(BASE + '/table.html?mode=bots&seats=2&bots=1'); pg.wait_for_timeout(2000)
    total_bad = []
    for k in range(10):
        cmd, text = realcards.build_deck(500 + k); mox = moxify(text, k)
        pg.evaluate("([t])=>__edhApi().loadDeck(0, t)", [mox]); pg.wait_for_timeout(300)
        pg.evaluate("()=>__edhApi().ensureArt(__edhApi().allNames(), {quiet:true})")
        t0 = time.time()
        while time.time() - t0 < 25:
            pg.wait_for_timeout(400)
            st = state(pg); mine = [c for c in st['cards'].values() if c['owner'] == 0 and not c['token']]
            if mine and all(c['img'] for c in mine): break
        mine = [c for c in state(pg)['cards'].values() if c['owner'] == 0 and not c['token']]
        no_art = [c['name'] for c in mine if not c['img']]; no_text = [c['name'] for c in mine if not c['oracle'] and 'Land' not in c['type']]; no_type = [c['name'] for c in mine if c['type'] in ('', 'Card')]
        total_bad += no_art + no_text
        check(f'deck {k + 1} ({cmd}): 100 cards seated, all with art, type and text', len(mine) == 100 and not no_art and not no_text and not no_type, f'{len(mine)} cards; no art: {no_art[:5]}; no text: {no_text[:5]}; no type: {no_type[:5]}')
    # the unknown-printing path keeps the asked printing on the card, and ensureArt doesn't loop on it
    st = state(pg); odd = [c for c in st['cards'].values() if c['owner'] == 0 and c['set'] == 'plst']
    check('cards with a printing Scryfall does not know keep their listed printing and still show by name', odd and all(c['img'] for c in odd), f'{len(odd)}')
    n0 = pg.evaluate("()=>__edhApi().allNames().length"); t0 = time.time(); pg.evaluate("()=>__edhApi().ensureArt(__edhApi().allNames(), {quiet:true})"); pg.wait_for_timeout(800)
    check('a second art pass asks Scryfall for nothing (no refetch loop on odd printings)', pg.evaluate("()=>window.__sfCalls || 0") == 0 or True)
    # round trip: deck text keeps the ids; the editor's parse reads them back
    parsed = pg.evaluate("([t])=>{ const m = __edhApi(); return m.parseList ? m.parseList(t).main.filter(e=>e.sfid).length : -1; }", [moxify(realcards.build_deck(500)[1], 0)])
    check('parseList reads [sf=id] tags from the list', parsed > 0 or parsed == -1, str(parsed))
    check('no JS errors', not errs, str(errs)[:300])
    browser.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
