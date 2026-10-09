// EDH Club edge worker: serves the built site and a tiny API that proxies Archidekt's public
// deck API with caching, so the "Top 100" page works without CORS trouble or a scrape job.
const UA = 'EDHClub/1.0 (+https://edhclub.com; commander tabletop)';
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' };

const reply = (body, status = 200, ttl = 0) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...(ttl ? { 'cache-control': `public, max-age=${ttl}` } : {}) } });

async function cached(request, ttl, make) {
  const cache = caches.default; const key = new Request(new URL(request.url).toString(), { method: 'GET' });
  const hit = await cache.match(key); if (hit) return hit;
  const res = await make();
  if (res.ok) { const copy = new Response(res.body, res); copy.headers.set('cache-control', `public, max-age=${ttl}`); await cache.put(key, copy.clone()); return copy; }
  return res;
}

async function archidekt(path) {
  const r = await fetch('https://archidekt.com/api/' + path, { headers: { 'user-agent': UA, accept: 'application/json' } });
  if (!r.ok) throw new Error(`Archidekt ${r.status}`);
  return r.json();
}

const colorKey = (c) => ['W', 'U', 'B', 'R', 'G'].filter((k) => c && c[k] > 0).join('');
const slim = (d) => ({ id: d.id, name: d.name, views: d.viewCount, owner: d.owner?.username || '', featured: d.featured || '', colors: colorKey(d.colors), bracket: d.edhBracket || null, size: d.size || 0, updated: d.updatedAt || '', tags: (d.tags || []).map((t) => t.name || t.tag).filter(Boolean).slice(0, 4) });

// Top 100 most-viewed public Commander decks, two pages of 50. Cached for six hours.
async function topDecks(request) {
  return cached(request, 6 * 3600, async () => {
    try {
      const pages = await Promise.all([1, 2].map((p) => archidekt(`decks/v3/?orderBy=-viewCount&formats=3&pageSize=50&page=${p}`)));
      const list = pages.flatMap((p) => p.results || []).filter((d) => !d.private).map(slim).slice(0, 100);
      return reply({ decks: list, fetched: new Date().toISOString(), source: 'archidekt' }, 200, 6 * 3600);
    } catch (e) { return reply({ error: e.message }, 502); }
  });
}

// One deck converted to the plain text our importer reads. Cached for a day.
const cardName = (c) => c.card?.oracleCard?.name || c.card?.name || c.name || '';
async function deckText(request, id) {
  if (!/^\d+$/.test(id)) return reply({ error: 'bad id' }, 400);
  return cached(request, 24 * 3600, async () => {
    try {
      const d = await archidekt(`decks/${id}/`);
      const cats = Object.fromEntries((d.categories || []).map((c) => [c.name, c]));
      const premier = (d.categories || []).find((c) => c.isPremier)?.name || 'Commander';
      const cmd = [], main = [];
      for (const c of d.cards || []) {
        const name = cardName(c); if (!name) continue;
        const names = (c.categories || []).map((x) => (typeof x === 'string' ? x : x.name));
        if (names.some((n) => cats[n] && cats[n].includedInDeck === false)) continue; // maybeboard / sideboard
        const q = c.quantity || 1;
        if (names.includes(premier) || names.includes('Commander')) cmd.push(name);
        else main.push({ q, name, cat: names[0] || 'Deck' });
      }
      const text = `Commander\n${cmd.map((n) => '1 ' + n).join('\n')}\n\nDeck\n${main.map((e) => `${e.q} ${e.name}`).join('\n')}`;
      const count = main.reduce((s, e) => s + e.q, 0) + cmd.length;
      return reply({ id: d.id, name: d.name, owner: d.owner?.username || '', commander: cmd.join(' + '), commanders: cmd, count, text, url: `https://archidekt.com/decks/${d.id}` }, 200, 24 * 3600);
    } catch (e) { return reply({ error: e.message }, 502); }
  });
}

// Moxfield: public deck → importer text. Moxfield's API sits behind bot protection and only answers approved
// user agents; when it refuses we say so, and the client falls back to "Export → copy → paste".
const moxName = (e) => e?.card?.name || e?.name || '';
const moxPrint = (e) => (e?.card?.set && e?.card?.cn ? ` (${String(e.card.set).toUpperCase()}) ${e.card.cn}` : '') + (e?.finish && /foil/i.test(e.finish) && !/non/i.test(e.finish) ? ' *F*' : '');
const moxBoard = (d, key) => { const b = d.boards?.[key]?.cards || d[key] || {}; return Object.values(b).filter((e) => e && typeof e === 'object' && moxName(e)); };
async function moxfieldText(request, id) {
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) return reply({ error: 'bad id' }, 400);
  return cached(request, 24 * 3600, async () => {
    try {
      const r = await fetch(`https://api2.moxfield.com/v2/decks/all/${id}`, { headers: { 'user-agent': UA, accept: 'application/json', referer: 'https://www.moxfield.com/' } });
      if (r.status === 403 || r.status === 401 || r.status === 429) return reply({ error: 'Moxfield blocked the request. Open the deck on Moxfield, use Export → Copy, and paste the list here instead.', fallback: 'paste' }, 502);
      if (r.status === 404) return reply({ error: 'That Moxfield deck is private or does not exist' }, 404);
      if (!r.ok) throw new Error(`Moxfield ${r.status}`);
      const d = await r.json();
      const cmd = moxBoard(d, 'commanders').map((e) => moxName(e) + moxPrint(e));
      const main = moxBoard(d, 'mainboard').map((e) => ({ q: e.quantity || 1, line: moxName(e) + moxPrint(e) }));
      if (!cmd.length && !main.length) throw new Error('Moxfield returned an empty deck');
      const text = `Commander\n${cmd.map((n) => '1 ' + n).join('\n')}\n\nDeck\n${main.map((e) => `${e.q} ${e.line}`).join('\n')}`;
      const count = main.reduce((s, e) => s + e.q, 0) + cmd.length;
      return reply({ id, name: d.name || 'Moxfield deck', owner: d.createdByUser?.userName || d.createdByUser?.displayName || '', commander: cmd.map((n) => n.replace(/ \([A-Z0-9]+\) \S+( \*F\*)?$/, '')).join(' + '), count, text, url: `https://www.moxfield.com/decks/${id}`, source: 'moxfield' }, 200, 24 * 3600);
    } catch (e) { return reply({ error: e.message }, 502); }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/top-decks') return topDecks(request);
    const m = url.pathname.match(/^\/api\/deck\/(\d+)$/); if (m) return deckText(request, m[1]);
    const mx = url.pathname.match(/^\/api\/moxfield\/([A-Za-z0-9_-]+)$/); if (mx) return moxfieldText(request, mx[1]);
    if (url.pathname.startsWith('/api/')) return reply({ error: 'not found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
