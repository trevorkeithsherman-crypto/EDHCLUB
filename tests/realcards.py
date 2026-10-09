"""Real card data for playtests: a Scryfall mock backed by tests/data/cards.jsonl (magic-search-engine index),
plus a deterministic deck generator that builds Commander decks from cards printed in Commander products."""
import json, os, random, re, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(HERE, 'data', 'cards.jsonl')
DB_URL = 'https://raw.githubusercontent.com/taw/magic-search-engine/master/index/cards.jsonl'
CARDS = {}
def load():
    if CARDS: return CARDS
    if not os.path.exists(DB_PATH):
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True); urllib.request.urlretrieve(DB_URL, DB_PATH)
    with open(DB_PATH, encoding='utf-8') as f:
        for line in f:
            name, d = json.loads(line)
            if d.get('l') not in ('normal', 'leveler', 'saga', 'class', 'case', 'mutate', 'prototype', 'host', 'augment'): continue
            if d.get('fu') or not d.get('t'): continue
            CARDS[name] = d
    return CARDS
def type_line(d):
    sup = ' '.join(d.get('tp', [])); t = ' '.join(d.get('t', [])); sub = ' '.join(d.get('tb', []))
    return ' '.join(x for x in [sup, t] if x) + (' — ' + sub if sub else '')
def to_scry(name, d, set_code='pt', num='1'):
    cost = (d.get('m') or '').upper()
    cost = re.sub(r'\{([wubrgc])\}', lambda m: '{' + m.group(1).upper() + '}', cost)
    o = {'object': 'card', 'name': name, 'mana_cost': cost, 'type_line': type_line(d), 'oracle_text': d.get('o', ''), 'colors': [c.upper() for c in d.get('c', '')], 'color_identity': [c.upper() for c in d.get('ci', '')],
         'keywords': [k.title() for k in d.get('k', [])], 'artist': 'Playtest', 'set': set_code, 'set_name': 'Playtest', 'collector_number': num, 'released_at': '2026-01-01', 'finishes': ['nonfoil', 'foil'], 'cmc': d.get('v', 0),
         'image_uris': {'normal': f'https://cards.scryfall.io/normal/{slug(name)}.jpg', 'large': f'https://cards.scryfall.io/large/{slug(name)}.jpg', 'art_crop': f'https://cards.scryfall.io/art/{slug(name)}.jpg'}}
    if d.get('p') is not None: o['power'] = str(d['p']); o['toughness'] = str(d.get('to', 0))
    if d.get('ly') is not None: o['loyalty'] = str(d['ly'])
    return o
def slug(n): return re.sub(r'[^a-z0-9]+', '-', n.lower()).strip('-')
TOKENS = {'goblin': ('Goblin', '1/1', 'R'), 'soldier': ('Soldier', '1/1', 'W'), 'treasure': ('Treasure', '', ''), 'zombie': ('Zombie', '2/2', 'B'), 'spirit': ('Spirit', '1/1', 'W'), 'elf': ('Elf Warrior', '1/1', 'G'), 'saproling': ('Saproling', '1/1', 'G'), 'thopter': ('Thopter', '1/1', ''), 'beast': ('Beast', '3/3', 'G'), 'clue': ('Clue', '', ''), 'food': ('Food', '', '')}
def scry_route(route):
    """Playwright route handler for https://api.scryfall.com/**."""
    db = load(); req = route.request; u = req.url
    if req.method == 'POST' and req.post_data:
        body = json.loads(req.post_data); data = []; nf = []
        for i in body.get('identifiers', []):
            n = i.get('name'); d = db.get(n) if n else None
            if not d and n:  # try the front face name
                d = next((v for k, v in db.items() if k.split(' // ')[0] == n), None)
            if d: data.append(to_scry(n, d, i.get('set', 'pt'), i.get('collector_number', '1')))
            else: nf.append(i)
        route.fulfill(status=200, content_type='application/json', body=json.dumps({'data': data, 'not_found': nf})); return
    if '/cards/search' in u:
        if 'unique=prints' in u or 'unique%3Dprints' in u:
            m = re.search(r'!%22([^%]+)%22', u) or re.search(r'!"([^"]+)"', u); n = urllib.parse.unquote(m.group(1)) if m else ''
            d = db.get(n); route.fulfill(status=200, content_type='application/json', body=json.dumps({'data': [to_scry(n, d, 'pt', '1'), to_scry(n, d, 'alt', '2')] if d else []})); return
        m = re.search(r't%3Atoken', u) or re.search(r't:token', u)
        q = urllib.parse.unquote(u).lower(); hit = next((v for k, v in TOKENS.items() if k in q), ('Token', '1/1', ''))
        route.fulfill(status=200, content_type='application/json', body=json.dumps({'data': [{'name': hit[0], 'type_line': ('Token Creature — ' + hit[0]) if hit[1] else 'Token Artifact — ' + hit[0], 'power': hit[1].split('/')[0] if hit[1] else None, 'toughness': hit[1].split('/')[1] if hit[1] else None, 'artist': 'Playtest', 'keywords': [], 'colors': [hit[2]] if hit[2] else [], 'image_uris': {'normal': f'https://cards.scryfall.io/normal/token-{slug(hit[0])}.jpg', 'large': f'https://cards.scryfall.io/large/token-{slug(hit[0])}.jpg', 'art_crop': f'https://cards.scryfall.io/art/token-{slug(hit[0])}.jpg'}}]})); return
    route.fulfill(status=404, content_type='application/json', body=json.dumps({'object': 'error', 'code': 'not_found', 'data': []}))
import urllib.parse

# ---------- deck generation ----------
COMMANDER_SETS = re.compile(r'^(c1[3-9]|c2[0-1]|cm[12a-z]|cmr|cmm|clb|ltc|moc|mkc|otc|blc|dsc|fdc|tdc|woc|lcc|onc|brc|dmc|ncc|snc|40k|afc|mic|khc|znc|voc|40c|pip|acr|m3c|j25|drc|eoc|fic|spc|tla|tlc|ecc|eoe|ecl|om1|sld)$')
BASIC = {'W': 'Plains', 'U': 'Island', 'B': 'Swamp', 'R': 'Mountain', 'G': 'Forest'}
def pool():
    db = load(); out = []
    for n, d in db.items():
        if '//' in n or not d.get('o') and 'Land' not in d.get('t', []): continue
        if 'Conspiracy' in d.get('t', []) or 'Scheme' in d.get('t', []) or 'Plane' in d.get('t', []) or 'Vanguard' in d.get('t', []) or 'Phenomenon' in d.get('t', []): continue
        if 'Basic' in d.get('tp', []): continue
        sets = [p[0] for p in d.get('*', [])]
        if not any(COMMANDER_SETS.match(s) for s in sets): continue
        if len(d.get('o', '')) > 1300: continue
        out.append(n)
    return out
def commanders():
    db = load(); return [n for n in pool() if db[n].get('cm') and 'Creature' in db[n].get('t', []) and 'Legendary' in db[n].get('tp', [])]
def build_deck(seed, size=100):
    db = load(); rnd = random.Random(seed); cands = commanders()
    while True:
        cmd = rnd.choice(cands); ci = set(db[cmd].get('ci', '').upper())
        if 1 <= len(ci) <= 2: break
    ok = [n for n in pool() if set(db[n].get('ci', '').upper()) <= ci and n != cmd]
    lands = [n for n in ok if 'Land' in db[n]['t']]
    creatures = [n for n in ok if 'Creature' in db[n]['t']]
    others = [n for n in ok if 'Creature' not in db[n]['t'] and 'Land' not in db[n]['t']]
    rnd.shuffle(lands); rnd.shuffle(creatures); rnd.shuffle(others)
    picks = lands[:6] + creatures[:30] + others[:27]
    basics_needed = size - 1 - len(picks)
    cols = sorted(ci); basics = [BASIC[cols[i % len(cols)]] for i in range(basics_needed)]
    counts = {}
    for b in basics: counts[b] = counts.get(b, 0) + 1
    text = 'Commander\n1 ' + cmd + '\n\nDeck\n' + '\n'.join('1 ' + n for n in picks) + '\n' + '\n'.join(f'{k} {b}' for b, k in counts.items())
    return cmd, text
if __name__ == '__main__':
    import sys
    for s in range(int(sys.argv[1]) if len(sys.argv) > 1 else 4):
        cmd, txt = build_deck(100 + s); print('==', cmd); print(txt[:400])
