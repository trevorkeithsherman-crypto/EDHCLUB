"""Bots pay with the right colors at the table: colorless lands can't cast green spells, duals and Command Tower
work, Treasures get sacrificed, summoning-sick dorks don't tap, Phyrexian pips cost life."""
import sys, json, time
sys.argv = ['x', sys.argv[1]]
exec(open('tests/cards.py').read().split('with sync_playwright() as p:\n')[0].replace("sys.argv = ['x', sys.argv[1]]", ''))
def hand_only(pg, seat, name): pg.evaluate(f"__edhMut(st=>{{ st.players[{seat}].zones.hand=st.players[{seat}].zones.hand.filter(id=>st.cards[id].name==='{name}'); }})")
with sync_playwright() as p:
    browser = p.chromium.launch(); ctx = browser.new_context(); pg, errs = setup(ctx)
    pg.unroute('https://api.scryfall.com/**'); pg.route('https://api.scryfall.com/**', realcards.scry_route)
    pg.goto(BASE + '/table.html?mode=bots&seats=2&bots=1'); pg.wait_for_timeout(2500)
    pg.evaluate("__edhMut(st=>{ st.botSpeed='fast'; st.reminders=false; })")
    # 1. the bug: {G} creature with only a colorless land
    fresh(pg); real(pg, 1, 'Reliquary Tower'); real(pg, 1, 'Llanowar Elves', 'hand'); hand_only(pg, 1, 'Llanowar Elves'); bot_turn(pg)
    check("Reliquary Tower alone can't cast Llanowar Elves ({G})", card(pg, 1, 'Llanowar Elves')['zone'] == 'hand' and not any('casts Llanowar Elves' in t for t in logs(pg)), str(logs(pg)[-4:]))
    fresh(pg); real(pg, 1, 'Forest'); real(pg, 1, 'Llanowar Elves', 'hand'); hand_only(pg, 1, 'Llanowar Elves'); bot_turn(pg)
    check('a Forest casts it', card(pg, 1, 'Llanowar Elves')['zone'] == 'battlefield')
    # 2. Sol Ring pays generic only
    fresh(pg); real(pg, 1, 'Sol Ring'); real(pg, 1, 'Forest'); real(pg, 1, 'Grizzly Bears', 'hand'); real(pg, 1, 'Leatherback Baloth', 'hand')
    pg.evaluate("__edhMut(st=>{ st.players[1].zones.hand=st.players[1].zones.hand.filter(id=>['Grizzly Bears','Leatherback Baloth'].includes(st.cards[id].name)); })"); bot_turn(pg); st = state(pg)
    check('Sol Ring + Forest: Grizzly Bears ({1}{G}) yes, Leatherback Baloth ({G}{G}{G}) no', card(pg, 1, 'Grizzly Bears')['zone'] == 'battlefield' and card(pg, 1, 'Leatherback Baloth')['zone'] == 'hand', str(logs(pg)[-5:]))
    check('…and it tapped the Sol Ring for the generic, the Forest for the G', card(pg, 1, 'Sol Ring')['tapped'] and card(pg, 1, 'Forest')['tapped'])
    # 3. keeps colored sources for colored spells: Mountain + Forest + Tower, casting Elves ({G}) then Goblin Piker ({1}{R})
    fresh(pg); real(pg, 1, 'Reliquary Tower'); real(pg, 1, 'Forest'); real(pg, 1, 'Mountain'); real(pg, 1, 'Llanowar Elves', 'hand'); real(pg, 1, 'Goblin Piker', 'hand')
    pg.evaluate("__edhMut(st=>{ st.players[1].zones.hand=st.players[1].zones.hand.filter(id=>['Llanowar Elves','Goblin Piker'].includes(st.cards[id].name)); })"); bot_turn(pg)
    check('with Tower + Forest + Mountain the bot casts both the {G} and the {1}{R} spell (generic from the Tower)', card(pg, 1, 'Llanowar Elves')['zone'] == 'battlefield' and card(pg, 1, 'Goblin Piker')['zone'] == 'battlefield', str(logs(pg)[-5:]))
    # 4. dual land by type line
    fresh(pg); real(pg, 1, 'Breeding Pool'); real(pg, 1, 'Forest'); real(pg, 1, 'Merfolk Branchwalker', 'hand'); hand_only(pg, 1, 'Merfolk Branchwalker'); pg.evaluate("__edhMut(st=>{ st.players[1].zones.library=[]; })")
    bot_turn(pg); check('Breeding Pool pays {U} for Merfolk Branchwalker ({1}{U})', card(pg, 1, 'Merfolk Branchwalker')['zone'] == 'battlefield', str(logs(pg)[-4:]))
    # 5. Command Tower follows the commander's colors
    fresh(pg); pg.evaluate("__edhMut(st=>{ const p=st.players[1]; p.zones.command.forEach(id=>delete st.cards[id]); p.zones.command=[]; })")
    real(pg, 1, 'Krenko, Mob Boss', 'command', extra={'isCmdr': True}); real(pg, 1, 'Command Tower'); real(pg, 1, 'Reliquary Tower'); real(pg, 1, 'Goblin Piker', 'hand'); real(pg, 1, 'Llanowar Elves', 'hand')
    pg.evaluate("__edhMut(st=>{ st.players[1].zones.hand=st.players[1].zones.hand.filter(id=>['Goblin Piker','Llanowar Elves'].includes(st.cards[id].name)); st.turn.number=1; })"); bot_turn(pg)
    check("Command Tower (red commander) casts Goblin Piker but can't make G for the Elves", card(pg, 1, 'Goblin Piker')['zone'] == 'battlefield' and card(pg, 1, 'Llanowar Elves')['zone'] == 'hand', str(logs(pg)[-4:]))
    # 6. Treasure is sacrificed when used
    fresh(pg); real(pg, 1, 'Forest'); put(pg, 1, 'Treasure', 'Token Artifact — Treasure', '', '', '{T}, Sacrifice this artifact: Add one mana of any color.', extra={'token': True}); real(pg, 1, 'Grizzly Bears', 'hand'); hand_only(pg, 1, 'Grizzly Bears'); bot_turn(pg); st = state(pg)
    check('Grizzly Bears cast with Forest + Treasure; the Treasure is gone', card(pg, 1, 'Grizzly Bears')['zone'] == 'battlefield' and not any(c['name'] == 'Treasure' for c in st['cards'].values() if c['owner'] == 1) and any('sacrifices Treasure for mana' in t for t in logs(pg)), str(logs(pg)[-5:]))
    # 7. summoning-sick dork doesn't tap; next turn it does
    fresh(pg); e = real(pg, 1, 'Llanowar Elves', extra={'sick': True}); real(pg, 1, 'Forest'); real(pg, 1, 'Grizzly Bears', 'hand'); hand_only(pg, 1, 'Grizzly Bears'); bot_turn(pg)
    check("summoning-sick Llanowar Elves can't help cast the Bears", card(pg, 1, 'Grizzly Bears')['zone'] == 'hand' and not state(pg)['cards'][e]['tapped'], str(logs(pg)[-4:]))
    pg.evaluate("__edhMut(st=>{ st.players[1].zones.battlefield.forEach(id=>{ st.cards[id].tapped=false; }); })"); pg.click('[data-act=pass]'); run_bot_turn(pg)
    check('next turn the Elves tap for G and the Bears come down', card(pg, 1, 'Grizzly Bears')['zone'] == 'battlefield' and state(pg)['cards'][e]['tapped'], str(logs(pg)[-5:]))
    # 8. Phyrexian mana: Vault Skirge {1}{B/P} with two Mountains costs 2 life
    fresh(pg); real(pg, 1, 'Mountain'); real(pg, 1, 'Mountain'); real(pg, 1, 'Vault Skirge', 'hand'); hand_only(pg, 1, 'Vault Skirge'); pg.evaluate("__edhMut(st=>{ st.players[1].life=40; })"); bot_turn(pg); st = state(pg)
    check('Vault Skirge cast off two Mountains by paying 2 life for {B/P}', card(pg, 1, 'Vault Skirge')['zone'] == 'battlefield' and st['players'][1]['life'] == 38 and any('pays 2 life (Phyrexian mana)' in t for t in logs(pg)), f"{st['players'][1]['life']} {logs(pg)[-5:]}")
    # 9. hybrid
    fresh(pg); real(pg, 1, 'Plains'); real(pg, 1, 'Plains'); real(pg, 1, 'Plains'); real(pg, 1, 'Kitchen Finks', 'hand'); hand_only(pg, 1, 'Kitchen Finks'); bot_turn(pg)
    check('Kitchen Finks ({1}{G/W}{G/W}) is cast off three Plains', card(pg, 1, 'Kitchen Finks')['zone'] == 'battlefield', str(logs(pg)[-4:]))
    check('no mana violations and no JS errors', not state(pg).get('manaViolations') and not errs, str(errs)[:300])
    browser.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
