"""Bot-vs-bot playtests with real cards: four bots, generated Commander decks, N games. Verifies game-state
invariants every turn, and reports which card texts the interpreter handled, partly handled, or left to the table.
Usage: python3 tests/playtest.py <port> [games=10] [maxTurns=40]"""
import sys, json, time, collections, os, re
PORT = int(sys.argv[1]); GAMES = int(sys.argv[2]) if len(sys.argv) > 2 else 10; MAXT = int(sys.argv[3]) if len(sys.argv) > 3 else 40; GOFF = int(sys.argv[4]) if len(sys.argv) > 4 else 0
sys.argv = ['x', str(PORT)]
src = open('tests/deep.py').read().split('with sync_playwright() as p:')[0]
exec(src)
sys.path.insert(0, 'tests'); import realcards
HERE = os.path.dirname(os.path.abspath(__file__))
INVARIANTS = """()=>{const st=__edhState(); const probs=[]; const seen={};
  for (let k=0;k<st.seats;k++){ const p=st.players[k]; let n=0; for (const z of Object.keys(p.zones)) for (const id of p.zones[z]) { n++; const c=st.cards[id]; if(!c){probs.push(`seat ${k} ${z}: dangling ${id}`); continue;} if (c.zone!==z) probs.push(`${c.name}: listed in ${z} but zone=${c.zone}`); if (seen[id]) probs.push(`${c.name} in two zones`); seen[id]=1; if (z!=='battlefield' && z!=='stack' && (c.tapped||c.dmg||c.p1)) probs.push(`${c.name} in ${z} keeps tapped/dmg/counters`); if (z==='hand' && c.controller!==k) probs.push(`${c.name} in ${p.name}'s hand controlled by ${c.controller}`); }
    const cmdrs=Object.values(st.cards).filter(c=>c.owner===k&&c.isCmdr); if (cmdrs.length<1) probs.push(`seat ${k} has no commander card`);
    if (p.life>200||p.life<-200) probs.push(`seat ${k} life ${p.life}`);
    const total=Object.values(st.cards).filter(c=>c.owner===k&&!c.token).length; if (total!==100 && !p.out) probs.push(`seat ${k} owns ${total} nontoken cards (expected 100)`); }
  for (const id of st.stack) if(!st.cards[id]||st.cards[id].zone!=='stack') probs.push('stack holds a card not on the stack');
  Object.values(st.cards).forEach(c=>{ if (!seen[c.id] && c.zone!=='stack') probs.push(`${c.name} (${c.zone}) is in no zone list`); if (c.zone==='battlefield' && (c.dmg||0) >= 1 && /Creature/.test(c.type) && c.pt && (c.dmg||0) >= (parseInt(c.pt.split('/')[1])||0)+ (c.p1||0) && st.turn.phase!==2) probs.push(`${c.name} survives lethal damage ${c.dmg}`); });
  return {probs, turn: st.turn.number, active: st.turn.active, over: !!st.over, lives: st.players.slice(0,st.seats).map(p=>p.life), outs: st.players.slice(0,st.seats).map(p=>!!p.out), logN: st.log.length ? st.log[0].t : 0, pending: !!st.pending};}"""
report = {'games': [], 'manual': collections.Counter(), 'parsed': collections.Counter(), 'partial': collections.Counter(), 'kw_unknown': collections.Counter(), 'errors': [], 'invariants': collections.Counter(), 'logs': collections.Counter()}
KNOWN_KW = set('flying,reach,first strike,double strike,deathtouch,trample,lifelink,indestructible,menace,vigilance,haste,defender,hexproof,flash'.split(','))
def classify(pg, names):
    """Ask the page's parser what it makes of each card's text."""
    return pg.evaluate("""(names)=>{const a=__edhApi(); const out={}; for (const n of names){ const e=a.cached(n); if(!e) { out[n]={missing:true}; continue; } const abil=a.parseAbilities({...e, zone:'battlefield'}); const lines=(e.oracle||'').split('\\n').map(s=>s.replace(/\\(.*?\\)/g,'').trim()).filter(Boolean);
      const kws=(e.kw||'').split(',').map(s=>s.trim().replace(/ \\d+$/,'')).filter(Boolean);
      out[n]={type:e.type, kws, lines:lines.length, triggers:abil.filter(x=>x.kind==='trigger').map(x=>({ev:x.event, n:x.effects.length, text:x.text.slice(0,90)})), activated:abil.filter(x=>x.kind==='activated').map(x=>({n:x.effects.length, text:x.text.slice(0,90)})), statics:abil.filter(x=>x.kind==='static').length,
        spell:/Instant|Sorcery/.test(e.type)? a.parseEffects(e.oracle||'').length : null, rules: a.rulesFor ? null : null}; }
      return out;}""", names)
with sync_playwright() as p:
    browser = p.chromium.launch()
    for g in range(GAMES):
        ctx = browser.new_context(viewport={'width': 1440, 'height': 900}); pg, errs = setup(ctx); pg.on('console', lambda m: errs.append('console: ' + m.text[:300]) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        pg.unroute('https://api.scryfall.com/**'); pg.route('https://api.scryfall.com/**', realcards.scry_route)
        pg.goto(BASE + '/table.html?mode=bots&seats=4&bots=3'); pg.wait_for_timeout(1500)
        decks = [realcards.build_deck(1000 + (g + GOFF) * 4 + k) for k in range(4)]
        for k, (cmd, txt) in enumerate(decks): pg.evaluate("([k,t])=>__edhApi().loadDeck(k,t,null)", [k, txt])
        pg.evaluate("()=>{ __edhMut(st=>{ st.players[0].bot=true; st.players[0].name='Alpha Bot'; st.botSpeed='instant'; st.reminders=false; }); const a=__edhApi(); a.net.botList=[0,1,2,3]; }")
        pg.evaluate("()=>__edhApi().ensureArt(__edhApi().allNames(), {quiet:true})"); pg.wait_for_timeout(2500)
        names = sorted({c['name'] for c in state(pg)['cards'].values()})
        info = classify(pg, names)
        for n, i in info.items():
            if i.get('missing'): report['manual'][n + ' (no data)'] += 1; continue
            for kw in i['kws']:
                if kw not in KNOWN_KW: report['kw_unknown'][kw] += 1
            for t in i['triggers']:
                if t['n'] == 0: report['manual'][f"{n}: {t['text']}"] += 1
                else: report['parsed'][n] += 1
            for ac in i['activated']:
                if ac['n'] == 0 and not re.search(r'add \{|add one mana|add two', ac['text'].lower()): report['partial'][f"{n}: {ac['text']}"] += 1
                else: report['parsed'][n] += 1
            if i['spell'] == 0 and i['lines'] > 0: report['manual'][f"{n} (spell): no effect understood"] += 1
        pg.evaluate("()=>__edhApi().kick()")
        t0 = time.time(); last_turn = -1; stuck = 0; last_log = 0; prev_probs = set(); game = {'n': g + 1 + GOFF, 'commanders': [d[0] for d in decks], 'turns': 0, 'winner': None, 'problems': [], 'over': False, 'stalled': False}
        while time.time() - t0 < 420:
            pg.wait_for_timeout(700)
            inv = pg.evaluate(INVARIANTS)
            # a problem has to survive two consecutive polls (animations settle zone moves within ~500ms)
            cur = set(inv['probs'])
            for pr in cur & prev_probs: report['invariants'][pr] += 1; game['problems'].append(f"t{inv['turn']}: {pr}")
            prev_probs = cur
            if pg.locator('#prompt [data-act=allowAll]').count(): pg.click('#prompt [data-act=allowAll]')
            if pg.locator('#prompt [data-act=pok]').count(): pg.click('#prompt [data-act=pok]')
            if pg.locator('#payNo').count(): pg.click('#payNo')
            if pg.locator('#pickGo').count(): pg.evaluate("()=>{const b=document.querySelector('[data-pick]'); if (b) b.click(); document.querySelector('#pickGo').click();}")
            if inv['over'] or inv['turn'] > MAXT: game['over'] = inv['over']; break
            if inv['logN'] == last_log: stuck += 1
            else: stuck = 0; last_log = inv['logN']
            if stuck > 40:  # ~28s with nothing happening: a bot is wedged
                game['stalled'] = True; busy = pg.evaluate("()=>[__edhApi().botBusy(), __edhState().botStep, __edhState().turn.active, __edhState().turn.phase, !!__edhState().pending, document.querySelector('#modal')?.hidden, document.querySelector('#prompt')?.textContent?.slice(0,80), __edhState().players.map(p=>p.bot), __edhState().pending, [...document.querySelectorAll('#prompt [data-act]')].map(b=>b.dataset.act)]"); game['problems'].append(f"stalled at turn {inv['turn']}: {busy}"); game['stall_log'] = [l['text'] for l in state(pg)['log'][:10]]; print('STALL', busy, game['stall_log'], pg.evaluate('()=>[__edhState().botError, JSON.stringify(__edhState().turn), Date.now(), __edhState().log.slice(0,3).map(l=>l.t), __edhState().players.map(p=>p.name+(p.out?"(out)":"")), __edhState().attacks.length, __edhState().stack.length]')); break
        st = state(pg); game['turns'] = st['turn']['number']; game['lives'] = [p['life'] for p in st['players'][:4]]
        alive = [k for k in range(4) if not st['players'][k]['out']]
        game['winner'] = st['players'][alive[0]]['name'] if len(alive) == 1 else None
        for l in st['log']:
            t = l['text']
            if 'resolve by hand' in t: report['logs']['manual: ' + t.split(' triggers')[0]] += 1
            if 'triggers:' in t: report['logs']['auto: ' + t.split("'s ")[-1].split(' triggers')[0]] += 1
        game['casts'] = sum(1 for l in st['log'] if ' casts ' in l['text'] or ' cast ' in l['text'])
        game['attacks'] = sum(1 for l in st['log'] if ' attacks ' in l['text'])
        game['errors'] = errs[:5]; report['errors'] += [e for e in errs]
        report['games'].append(game)
        print(f"game {g+1}: turns {game['turns']} casts {game['casts']} attacks {game['attacks']} lives {game['lives']} over={game['over']} stalled={game['stalled']} problems={len(game['problems'])} errors={len(errs)} cmdrs={game['commanders']}")
        ctx.close()
    browser.close()
out = {'games': report['games'], 'invariants': report['invariants'].most_common(), 'manual_triggers': report['manual'].most_common(), 'unparsed_activated': report['partial'].most_common(), 'unknown_keywords': report['kw_unknown'].most_common(), 'errors': collections.Counter(report['errors']).most_common(), 'log_counts': report['logs'].most_common(60), 'parsed_cards': len(report['parsed'])}
os.makedirs(os.path.join(HERE, 'reports'), exist_ok=True)
json.dump(out, open(os.path.join(HERE, 'reports', 'playtest.json'), 'w'), indent=1)
md = ['# Bot playtest report', '', f"{len(out['games'])} four-bot games with generated Commander decks (real oracle text from the card database).", '', '| game | commanders | turns | result | casts | attacks | state problems | JS errors |', '|---|---|---|---|---|---|---|---|']
for g in out['games']: md.append(f"| {g['n']} | {', '.join(g['commanders'])} | {g['turns']} | {'won by ' + g['winner'] if g['winner'] else ('stalled' if g['stalled'] else 'turn limit')} | {g['casts']} | {g['attacks']} | {len(g['problems'])} | {len(g['errors'])} |")
md += ['', f"Cards whose text the interpreter handled: **{out['parsed_cards']}**. Triggers still left to the table (auto vs manual, from the logs):", '']
md += [f"- {k}: {v}" for k, v in out['log_counts'][:40]]
md += ['', '## Trigger text not understood (resolve by hand)', ''] + [f"- {m[0]}" for m in out['manual_triggers'][:80]]
md += ['', '## Activated abilities not understood', ''] + [f"- {m[0]}" for m in out['unparsed_activated'][:40]]
md += ['', '## Keywords seen that the combat engine does not model', ''] + [f"- {k} ({v})" for k, v in out['unknown_keywords'][:40]]
md += ['', '## State invariant problems', ''] + ([f"- {k} ×{v}" for k, v in out['invariants']] or ['- none'])
open(os.path.join(HERE, 'reports', 'playtest.md'), 'w').write('\n'.join(md))
print('\nINVARIANT PROBLEMS:', out['invariants'][:20]); print('\nERRORS:', out['errors'][:10]); print('\nUNKNOWN KEYWORDS:', out['unknown_keywords'][:40]); print('\nMANUAL TRIGGERS (top):'); [print(' ', m) for m in out['manual_triggers'][:60]]; print('\nUNPARSED ACTIVATED (top):'); [print(' ', m) for m in out['unparsed_activated'][:30]]
