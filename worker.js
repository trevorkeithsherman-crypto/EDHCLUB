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
// Printing as "(SET) number", foil flag, and Moxfield's Scryfall id when it has one: set codes and collector numbers
// don't always match Scryfall's, and the id is what makes the right art load first time.
const moxPrint = (e) => (e?.card?.set && e?.card?.cn ? ` (${String(e.card.set).toUpperCase()}) ${e.card.cn}` : '') + (e?.finish && /foil/i.test(e.finish) && !/non/i.test(e.finish) ? ' *F*' : '') + (/^[0-9a-f-]{36}$/i.test(e?.card?.scryfall_id || '') ? ` [sf=${e.card.scryfall_id.toLowerCase()}]` : '');
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
      return reply({ id, name: d.name || 'Moxfield deck', owner: d.createdByUser?.userName || d.createdByUser?.displayName || '', commander: cmd.map((n) => n.replace(/ \[sf=[0-9a-f-]+\]$/, '').replace(/ \([A-Z0-9]+\) \S+( \*F\*)?$/, '')).join(' + '), count, text, url: `https://www.moxfield.com/decks/${id}`, source: 'moxfield' }, 200, 24 * 3600);
    } catch (e) { return reply({ error: e.message }, 502); }
  });
}

/* ---------- Discord: announce open tables ----------
   Secrets (wrangler secret put …): SUPABASE_URL, SUPABASE_SERVICE_KEY, DISCORD_WEBHOOK_URL (optional global channel).
   Clubs can add their own webhook (clubs.discord_webhook); a club table is posted there too. */
async function sb(env, path, init = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) throw new Error('Supabase service credentials are not configured');
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'content-type': 'application/json', Prefer: 'return=representation', ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? null : r.json();
}
const BRACKETS = { 1: 'Exhibition', 2: 'Core', 3: 'Upgraded', 4: 'Optimized', 5: 'cEDH' };
function tableEmbed(room, origin) {
  const open = room.open_seats ?? Math.max(0, room.seats - (room.bots || 0) - (room.seated || 0));
  return {
    username: 'EDH Club', avatar_url: `${origin}/icons/icon-192.png`,
    embeds: [{ title: room.title || `${room.host_name || 'A planeswalker'}'s table is open`, url: `${origin}/?join=${room.code}`, color: 0x4fc3ff,
      description: `**${open} seat${open === 1 ? '' : 's'} open** · ${room.seats} players · bracket ${room.bracket} (${BRACKETS[room.bracket] || ''})${room.bots ? ` · ${room.bots} bot${room.bots > 1 ? 's' : ''}` : ''}${room.has_voice ? ' · 🔊 voice linked' : ''}`,
      fields: [{ name: 'Join', value: `[Sit down](${origin}/?join=${room.code}) · code **${room.code}**`, inline: true }, { name: 'Watch', value: `[Spectate](${origin}/?watch=${room.code})`, inline: true }],
      footer: { text: 'EDH Club · free Commander in your browser' }, timestamp: room.created_at }],
  };
}
async function postWebhook(url, payload) { if (!url) return false; const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }); return r.ok; }
async function announceRoom(env, room, origin) {
  const payload = tableEmbed(room, origin); let posted = 0;
  if (env.DISCORD_WEBHOOK_URL && (await postWebhook(env.DISCORD_WEBHOOK_URL, payload))) posted++;
  if (room.club_id) { try { const [club] = await sb(env, `clubs?id=eq.${room.club_id}&select=discord_webhook`); if (club && club.discord_webhook && (await postWebhook(club.discord_webhook, payload))) posted++; } catch { /* no club webhook */ } }
  await sb(env, `rooms?code=eq.${encodeURIComponent(room.code)}`, { method: 'PATCH', body: JSON.stringify({ announced_at: new Date().toISOString() }) });
  return posted;
}
async function announce(request, env, code) {
  if (!/^[A-Z0-9]{5}$/.test(code)) return reply({ error: 'bad code' }, 400);
  try {
    const [room] = await sb(env, `rooms?code=eq.${code}&select=*`);
    if (!room) return reply({ error: 'no such table' }, 404);
    if (room.status !== 'open' || !room.is_public || room.locked) return reply({ error: 'Only open, public, unlocked tables can be announced' }, 400);
    if (room.announced_at && Date.now() - new Date(room.announced_at).getTime() < 10 * 60 * 1000) return reply({ ok: true, posted: 0, note: 'already announced in the last 10 minutes' });
    const posted = await announceRoom(env, room, new URL(request.url).origin);
    return reply({ ok: true, posted, note: posted ? '' : 'No Discord channel is connected yet (set DISCORD_WEBHOOK_URL, or add a webhook to your club).' });
  } catch (e) { return reply({ error: e.message }, 502); }
}
async function sweep(env, origin) {
  const since = new Date(Date.now() - 90 * 60 * 1000).toISOString();
  const rooms = await sb(env, `rooms?status=eq.open&is_public=eq.true&locked=eq.false&announced_at=is.null&created_at=gt.${since}&select=*`);
  let n = 0; for (const room of rooms || []) { try { n += await announceRoom(env, room, origin); } catch (e) { console.warn('announce failed', room.code, e.message); } }
  return n;
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(sweep(env, 'https://edhclub.com').catch((e) => console.warn('sweep', e.message))); },
  async fetch(request, env) {
    const url = new URL(request.url);
    const an = url.pathname.match(/^\/api\/announce\/([A-Z0-9]{5})$/i); if (an && request.method === 'POST') return announce(request, env, an[1].toUpperCase());
    if (url.pathname === '/api/top-decks') return topDecks(request);
    const m = url.pathname.match(/^\/api\/deck\/(\d+)$/); if (m) return deckText(request, m[1]);
    const mx = url.pathname.match(/^\/api\/moxfield\/([A-Za-z0-9_-]+)$/); if (mx) return moxfieldText(request, mx[1]);
    if (url.pathname.startsWith('/api/')) return reply({ error: 'not found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
