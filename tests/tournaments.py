"""Tournaments + profile stats pages.
- Tournaments tab in the nav; list shows the placeholder "coming soon" event; Notify me works; non-admins see no admin panel
- Admin (is_admin rpc) sees the admin panel: opens sign-ups, seats free agents, starts the pod round (one table per pod),
  records pod winners, starts the final, records the champion → tournament finished with champion + winning pod
- Players: create a pod (code), join by code, pick a deck, leave; full pods refuse
- Profile page: tiles, seat/method/mulligan bars, deck table (sortable), recent games, All / With people / Practice filter
Run: python3 tests/tournaments.py <port>"""
import sys, json, re, urllib.parse as up
sys.argv = ['x', sys.argv[1]]
src = open('tests/deep.py').read().split('with sync_playwright() as p:')[0]
exec(src)
ME = FAKE_USER['id']; OTHER = '22222222-2222-4222-8222-222222222222'; THIRD = '33333333-3333-4333-8333-333333333333'
DB = {'admin': False, 'tournaments': [{'id': 't1', 'slug': 'open-season-1', 'name': 'EDH Club Open — Season 1', 'description': 'The first EDH Club tournament.', 'status': 'coming_soon', 'starts_at': None, 'pod_size': 4, 'bracket': 3, 'champion_id': None, 'champion_name': None, 'champion_pod_id': None, 'created_at': '2026-10-13T00:00:00Z'}],
      'pods': [], 'members': [], 'matches': [], 'interest': [], 'rooms': [], 'games': [], 'game_players': [], 'seq': 0}
def nid(p): DB['seq'] += 1; return f'{p}{DB["seq"]}'
def filt(rows, url):
    qs = up.parse_qs(up.urlparse(url).query)
    for k, vs in qs.items():
        if k in ('select', 'order', 'limit', 'on_conflict'): continue
        v = vs[0]
        if v.startswith('eq.'): rows = [r for r in rows if str(r.get(k)) == v[3:]]
        elif v.startswith('in.'): vals = v[4:-1].replace('"', '').split(','); rows = [r for r in rows if str(r.get(k)) in vals]
    return rows
def tmock(route):
    url = route.request.url; m = route.request.method; body = json.loads(route.request.post_data) if route.request.post_data and m in ('POST', 'PATCH') else None
    def ok(data, status=200): route.fulfill(status=status, content_type='application/json', body=json.dumps(data))
    tm = re.search(r'/rest/v1/([a-z_]+)', url); tn = tm.group(1) if tm else ''
    def table(name): return tn == name
    if '/rest/v1/rpc/is_admin' in url: ok(DB['admin']); return
    for tname, key in [('tournaments', 'tournaments'), ('tournament_pods', 'pods'), ('tournament_members', 'members'), ('tournament_matches', 'matches'), ('tournament_interest', 'interest'), ('rooms', 'rooms')]:
        if table(tname):
            rows = DB[key]
            if m == 'GET': out = filt(rows, url); single = 'object' in route.request.headers.get('accept', ''); ok((out[0] if out else None) if single else out); return
            if m == 'POST':
                items = body if isinstance(body, list) else [body]; made = []
                for it in items:
                    it = dict(it)
                    if tname == 'tournament_interest': rows[:] = [r for r in rows if not (r['tournament_id'] == it['tournament_id'] and r['user_id'] == it['user_id'])]
                    if tname == 'tournament_members' and 'on_conflict' in url: rows[:] = [r for r in rows if not (r['tournament_id'] == it['tournament_id'] and r['user_id'] == it['user_id'])]
                    if 'id' not in it and tname != 'rooms': it['id'] = nid(tname[0] + 'x')
                    if tname == 'tournament_pods' and 'winner_id' not in it: it['winner_id'] = None
                    if tname == 'tournament_members' and 'pod_id' not in it: it['pod_id'] = None
                    rows.append(it); made.append(it)
                single = 'object' in route.request.headers.get('accept', ''); ok(made[0] if single else made, 201); return
            if m == 'PATCH': tgt = filt(rows, url); [r.update(body) for r in tgt]; ok(tgt, 200); return
            if m == 'DELETE':
                tgt = filt(rows, url); rows[:] = [r for r in rows if r not in tgt]
                if tname == 'tournament_pods': [mm.update({'pod_id': None}) for mm in DB['members'] if mm.get('pod_id') in [t['id'] for t in tgt]]
                route.fulfill(status=204, body=''); return
    if table('game_players'):
        if m == 'GET': ok(filt(DB['game_players'], url)); return
    if table('games') and m == 'GET': ok(filt(DB['games'], url)); return
    supabase_mock(route)
def setupt(ctx):
    pg, errs = setup(ctx); pg.unroute('https://*.supabase.co/**'); pg.route('https://*.supabase.co/**', tmock); return pg, errs
def signin(pg):
    pg.goto(BASE + '/'); pg.wait_for_timeout(500); pg.click('[data-go="signin"]'); pg.wait_for_timeout(200); pg.click('.tab:has-text("guest")'); pg.wait_for_timeout(150); pg.click('#guest'); pg.wait_for_timeout(900)
def go(pg, path): pg.goto(BASE + path); pg.wait_for_timeout(1100)
with sync_playwright() as p:
    browser = p.chromium.launch()
    # ---------- a signed-out visitor ----------
    ctx = browser.new_context(); pg, errs = setupt(ctx)
    go(pg, '/tournaments.html')
    check('tournaments page lists the placeholder event as Coming soon', pg.locator('.tcard').count() == 1 and 'Coming soon' in pg.locator('.tcard .tstatus').text_content() and 'Season 1' in pg.locator('.tcard h2').text_content())
    check('signed-out nav still shows the Tournaments tab', pg.locator('#account a[href="/tournaments.html"]').count() == 1)
    check('no admin panel for a visitor', pg.locator('.panel.admin').count() == 0)
    pg.click('.tcard'); pg.wait_for_timeout(900)
    check('detail: sign-ups closed, asks to sign in to get notified', 'aren\'t open yet' in pg.locator('#tournRoot').text_content() and pg.locator('[data-go=signin]').count() >= 1)
    ctx.close()
    # ---------- a signed-in player before sign-ups open ----------
    ctx = browser.new_context(); pg, errs = setupt(ctx); signin(pg)
    go(pg, '/home.html')
    check('home page has Tournaments and Your stats tiles, nav has Tournaments and the name links to the profile', pg.locator('#tileTournaments').count() == 1 and pg.locator('#tileProfile').count() == 1 and pg.locator('#account a.navlink[href="/tournaments.html"]').count() == 1 and pg.locator('#account a.who[href="/profile.html"]').count() == 1)
    go(pg, '/tournaments.html?t=open-season-1')
    pg.click('#notify'); pg.wait_for_timeout(700)
    check('Notify me records interest and flips the button', DB['interest'] and DB['interest'][0]['user_id'] == ME and 'notified' in pg.locator('#notify').text_content())
    check('player sees no admin panel', pg.locator('.panel.admin').count() == 0)
    ctx.close()
    # ---------- admin opens sign-ups ----------
    DB['admin'] = True
    ctx = browser.new_context(); pg, errs = setupt(ctx); signin(pg)
    go(pg, '/tournaments.html')
    check('admin sees the New tournament form on the list page', pg.locator('#tnCreate').count() == 1)
    go(pg, '/tournaments.html?t=open-season-1')
    check('admin panel on the event with status buttons', pg.locator('.panel.admin').count() == 1 and pg.locator('[data-status=open]').count() == 1)
    pg.click('[data-status=open]'); pg.wait_for_timeout(800)
    check('admin opens sign-ups → status open', DB['tournaments'][0]['status'] == 'open' and 'Sign-ups open' in pg.locator('.thead .tstatus').text_content())
    DB['admin'] = False; ctx.close()
    # ---------- players sign up: create a pod, others join by code, a free agent ----------
    ctx = browser.new_context(); pg, errs = setupt(ctx); signin(pg)
    go(pg, '/tournaments.html?t=open-season-1')
    check('open event shows Create a pod / Join a pod / free agent', pg.locator('#podCreate').count() == 1 and pg.locator('#podJoin').count() == 1 and pg.locator('#soloJoin').count() == 1)
    pg.fill('#podName', 'Tuesday Pod'); pg.select_option('#myDeck', 'd1'); pg.click('#podCreate'); pg.wait_for_timeout(900)
    pod = DB['pods'][0] if DB['pods'] else None
    check('creating a pod makes the pod (with a join code) and signs me up in it with my deck', pod and pod['captain_id'] == ME and len(pod['join_code']) == 6 and DB['members'] and DB['members'][0]['pod_id'] == pod['id'] and DB['members'][0]['deck_id'] == 'd1' and DB['members'][0]['commander'] == 'Krenko, Mob Boss', json.dumps(DB['members']))
    check('my pod card shows the code to share and me as captain', pod['join_code'] in pg.locator('.pod.mine').text_content() and 'captain' in pg.locator('.pod.mine').text_content())
    # two more players join by code / as free agent (seeded directly, as other accounts would)
    DB['members'] += [{'id': nid('m'), 'tournament_id': 't1', 'pod_id': pod['id'], 'user_id': OTHER, 'display_name': 'Mira', 'deck_id': None, 'deck_name': 'Talrand', 'commander': 'Talrand, Sky Summoner'}, {'id': nid('m'), 'tournament_id': 't1', 'pod_id': None, 'user_id': THIRD, 'display_name': 'Owen', 'deck_id': None, 'deck_name': None, 'commander': None}]
    pg.reload(); pg.wait_for_timeout(1000)
    check('pod shows 2/4 with an open seat, and a Free agents card', '2/4' in pg.locator('.pod.mine').text_content() and 'Owen' in pg.locator('.pod.free').text_content())
    pg.click('#leave'); pg.on('dialog', lambda d: d.accept()); pg.wait_for_timeout(300)
    ctx.close()
    # join by code from a fresh session
    ctx = browser.new_context(); pg, errs = setupt(ctx); pg.on('dialog', lambda d: d.accept()); signin(pg)
    if not any(m['user_id'] == ME for m in DB['members']): pass
    DB['members'] = [m for m in DB['members'] if m['user_id'] != ME]
    go(pg, '/tournaments.html?t=open-season-1')
    pg.fill('#podCode', pod['join_code'].lower()); pg.select_option('#myDeck2', 'd1'); pg.click('#podJoin'); pg.wait_for_timeout(900)
    check('joining by code (case-insensitive) seats me in that pod', any(m['user_id'] == ME and m['pod_id'] == pod['id'] for m in DB['members']) and 'You\'re in: Tuesday Pod' in pg.locator('#tournRoot').text_content())
    pg.fill('#podCode', 'ZZZZZZ') if pg.locator('#podCode').count() else None
    ctx.close()
    # ---------- admin: seat free agents, start the pod round, record winners, final, champion ----------
    DB['admin'] = True
    ctx = browser.new_context(); pg, errs = setupt(ctx); pg.on('dialog', lambda d: d.accept()); signin(pg)
    go(pg, '/tournaments.html?t=open-season-1')
    pg.click('#adSeat'); pg.wait_for_timeout(900)
    check('Seat free agents makes a new pod for Owen', len(DB['pods']) == 2 and all(m['pod_id'] for m in DB['members']), json.dumps(DB['pods']))
    pg.click('#adPodRound'); pg.wait_for_timeout(1200)
    podm = [m for m in DB['matches'] if m['kind'] == 'pod']
    check('Start pod round: one private table per pod, status running', len(podm) == 2 and all(m['room_code'] and len(m['room_code']) == 5 for m in podm) and DB['tournaments'][0]['status'] == 'running' and len(DB['rooms']) == 2 and all(r['is_public'] is False and r.get('match_id') for r in DB['rooms']), json.dumps(DB['rooms'])[:300])
    check('bracket lists both pod tables with Go to table for the players in them', pg.locator('.matches .match').count() == 2 and pg.locator('.matches a[href*="room="]').count() >= 1)
    check('final table button is disabled until pods have champions', pg.locator('#adFinal').is_disabled())
    # a finished game at pod 1's table → Auto suggests the winner
    DB['games'].append({'id': 'g9', 'room_code': podm[0]['room_code'], 'winner_id': OTHER, 'winner_name': 'Mira', 'ended_at': '2026-10-13T01:00:00Z', 'turns': 8, 'win_method': 'combat', 'players': []})
    pg.click(f'[data-suggest="{podm[0]["id"]}"]'); pg.wait_for_timeout(500)
    check('Auto reads the recorded game at that table and selects its winner', pg.locator(f'[data-win="{podm[0]["id"]}"]').input_value().startswith(OTHER))
    pg.click(f'[data-record="{podm[0]["id"]}"]'); pg.wait_for_timeout(900)
    check('recording a pod winner marks the match done and crowns the pod champion', DB['matches'][0]['status'] == 'done' and DB['matches'][0]['winner_name'] == 'Mira' and DB['matches'][0]['game_id'] == 'g9' and DB['pods'][0]['winner_id'] == OTHER)
    m2 = podm[1]['id']; pg.select_option(f'[data-win="{m2}"]', f'{THIRD}|Owen'); pg.click(f'[data-record="{m2}"]'); pg.wait_for_timeout(900)
    check('second pod winner recorded by hand; final table button now enabled', DB['pods'][1]['winner_id'] == THIRD and pg.locator('#adFinal').is_enabled())
    pg.click('#adFinal'); pg.wait_for_timeout(1000)
    fin = [m for m in DB['matches'] if m['kind'] == 'final']
    check('final table created with both pod champions', len(fin) == 1 and sorted(p_['name'] for p_ in fin[0]['players']) == ['Mira', 'Owen'] and fin[0]['room_code'])
    pg.select_option(f'[data-win="{fin[0]["id"]}"]', f'{THIRD}|Owen'); pg.click(f'[data-record="{fin[0]["id"]}"]'); pg.wait_for_timeout(1000)
    t = DB['tournaments'][0]
    check('recording the final crowns the champion and their pod and finishes the tournament', t['status'] == 'finished' and t['champion_name'] == 'Owen' and t['champion_id'] == THIRD and t['champion_pod_id'] == DB['pods'][1]['id'])
    check('champion banner shows the winner and the winning pod', 'Owen' in pg.locator('.panel.champion').text_content() and 'Pod 2' in pg.locator('.panel.champion').text_content())
    # create a new event from the list page
    go(pg, '/tournaments.html'); pg.fill('#tnName', 'Winter Clash'); pg.fill('#tnDesc', 'Second season'); pg.click('#tnCreate'); pg.wait_for_timeout(1000)
    check('admin creates a new tournament (coming soon) and lands on it', len(DB['tournaments']) == 2 and DB['tournaments'][1]['status'] == 'coming_soon' and DB['tournaments'][1]['name'] == 'Winter Clash' and 't=winter-clash' in pg.url)
    check('no JS errors (tournaments)', not errs, str(errs)[:300])
    ctx.close(); DB['admin'] = False
    # ---------- profile stats ----------
    G = lambda i, seats, turns, method, bots, ended: {'id': f'pg{i}', 'room_code': f'R{i}', 'mode': 'bots' if bots else 'room', 'seats': seats, 'turns': turns, 'winner_id': None, 'winner_deck_id': None, 'win_method': method, 'started_at': None, 'duration_s': 1800, 'bracket': 3, 'vs_bots': bots, 'ended_at': ended}
    games = [G(1, 4, 9, 'combat', False, '2026-10-10T20:00:00Z'), G(2, 4, 12, 'commander', False, '2026-10-11T20:00:00Z'), G(3, 3, 7, 'combo', True, '2026-10-12T20:00:00Z'), G(4, 4, 11, 'combat', False, '2026-10-13T20:00:00Z')]
    rows = []
    def gp(g, seat, uid, nm, place, deck, cmdr, how=None, by=None, kills=0, mulls=0, turn=None): rows.append({'id': nid('gp'), 'game_id': g['id'], 'user_id': uid, 'name': nm, 'bot': uid is None, 'seat': seat, 'turn_order': seat + 1, 'deck_id': deck, 'deck_name': None, 'commander': cmdr, 'colors': 'R', 'placement': place, 'eliminated_turn': turn, 'eliminated_by_seat': by, 'eliminated_how': how, 'kills': kills, 'mulligans': mulls, 'cmd_dmg_dealt': 0, 'dmg_dealt': 20, 'life_end': 10, 'created_at': g['ended_at'], 'game': g})
    gp(games[0], 0, ME, 'Tester', 1, 'd1', 'Krenko, Mob Boss', kills=2); gp(games[0], 1, OTHER, 'Mira', 2, None, 'Talrand', 'combat', 0); gp(games[0], 2, THIRD, 'Owen', 3, None, 'Meren', 'combat', 0); gp(games[0], 3, None, 'Druid Bot', 4, None, 'Sythis', 'combat', 1)
    gp(games[1], 2, ME, 'Tester', 3, 'd1', 'Krenko, Mob Boss', 'commander', 1, mulls=1, turn=9); gp(games[1], 1, OTHER, 'Mira', 1, None, 'Talrand', kills=3); gp(games[1], 0, THIRD, 'Owen', 2, None, 'Meren', 'combat', 1); gp(games[1], 3, None, 'Druid Bot', 4, None, 'Sythis', 'combat', 1)
    gp(games[2], 0, ME, 'Tester', 1, 'd2', 'Talrand, Sky Summoner', kills=2); gp(games[2], 1, None, 'Sphinx Bot', 2, None, 'X', 'combat', 0); gp(games[2], 2, None, 'Lich Bot', 3, None, 'Y', 'combat', 0)
    gp(games[3], 1, ME, 'Tester', 2, 'd1', 'Krenko, Mob Boss', 'combat', 2, kills=1, turn=11); gp(games[3], 2, OTHER, 'Mira', 1, None, 'Talrand', kills=2); gp(games[3], 0, THIRD, 'Owen', 3, None, 'Meren', 'poison', 1); gp(games[3], 3, None, 'Druid Bot', 4, None, 'Sythis', 'combat', 2)
    DB['games'] = games; DB['game_players'] = rows
    ctx = browser.new_context(); pg, errs = setupt(ctx); signin(pg)
    go(pg, '/profile.html'); pg.wait_for_timeout(600)
    tiles = pg.locator('.stile').all_text_contents()
    check('profile tiles: win rate 50% (2–2 in 4), avg turns to win 8, avg finish 1.8, KOs/game 1.3, streak 0 / best 1', '50%' in tiles[0] and '2–2 in 4 games' in tiles[0] and tiles[1].startswith('8') and '7' in tiles[1] and tiles[2].startswith('1.8') and tiles[3].startswith('1.3') and 'best 1' in tiles[4], json.dumps(tiles))
    bars = pg.locator('.sbar').all_text_contents()
    check('seat bars: seat 1 100% (2/2), seat 2 0% (0/1), seat 3 0% (0/1)', any(b.startswith('Seat 1') and '100%' in b for b in bars) and any(b.startswith('Seat 2') and '0%' in b for b in bars), json.dumps(bars[:6]))
    check('win methods: 1 combat, 1 combo; mulligan bars present; finishes 1st ×2', any('Combat damage' in b and '50%' in b for b in bars) and any('Combo' in b for b in bars) and any(b.startswith('1st') and '50%' in b for b in bars))
    check('rivals: Mira is the nemesis (knocked me out 2×)', 'Mira knocked you out 2' in pg.locator('#statsRoot').text_content())
    trs = pg.locator('#deckStats tbody tr').all_text_contents()
    check('deck table: Krenko 3 games 1 win 33%, Talrand 1 game 100%; deck names from my decks', len(trs) == 2 and 'Krenko Goblins' in trs[0] and '33%' in trs[0] and '100%' in trs[1], json.dumps(trs))
    pg.click('#deckStats th[data-sort="winRate"]'); pg.wait_for_timeout(200)
    check('sorting by Win % puts Talrand first', 'Talrand' in pg.locator('#deckStats tbody tr').first.text_content())
    pg.click('[data-filter="people"]'); pg.wait_for_timeout(300); tiles = pg.locator('.stile').all_text_contents()
    check('With people filter: 3 games, 33% win rate', '33%' in tiles[0] and 'in 3 games' in tiles[0], tiles[0])
    pg.click('[data-filter="bots"]'); pg.wait_for_timeout(300); tiles = pg.locator('.stile').all_text_contents()
    check('Practice filter: 1 game, 100%', '100%' in tiles[0] and 'in 1 game' in tiles[0], tiles[0])
    check('recent games list shows opponents and results', pg.locator('.glist li').count() == 1 and 'Sphinx Bot' in pg.locator('.glist li').first.text_content())
    check('no JS errors (profile)', not errs, str(errs)[:300])
    # empty state
    DB['game_players'] = []; pg.reload(); pg.wait_for_timeout(1200)
    check('empty state explains how stats are earned', 'No games yet' in pg.locator('#statsRoot').text_content())
    browser.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
