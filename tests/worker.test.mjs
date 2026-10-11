// Unit test for the edge worker's Archidekt conversion, with fetch and the cache mocked.
import worker from '../worker.js';
const list = (page) => ({ count: 1000, results: Array.from({ length: 50 }, (_, i) => ({ id: page * 100 + i, name: `Deck ${page}-${i}`, viewCount: 10000 - i, owner: { username: 'hans' }, featured: 'https://img/x.jpg', colors: { W: 0, U: 3, B: 0, R: 5, G: 0 }, edhBracket: 3, size: 100, updatedAt: '2026-10-01', private: false, tags: [{ name: 'Goblins' }] })) });
const deck = { id: 1585124, name: 'Baby Lasagna', owner: { username: 'hans' },
  categories: [{ name: 'Commander', isPremier: true, includedInDeck: true }, { name: 'Creature', includedInDeck: true }, { name: 'Maybeboard', includedInDeck: false }, { name: 'Sideboard', includedInDeck: false }],
  cards: [
    { quantity: 1, categories: ['Commander'], card: { oracleCard: { name: 'Krenko, Mob Boss' } } },
    { quantity: 1, categories: ['Creature'], card: { oracleCard: { name: 'Goblin Chieftain' } } },
    { quantity: 30, categories: ['Land'], card: { oracleCard: { name: 'Mountain' } } },
    { quantity: 1, categories: ['Maybeboard'], card: { oracleCard: { name: 'Should Not Appear' } } },
    { quantity: 1, categories: ['Sideboard', 'Creature'], card: { oracleCard: { name: 'Nor This' } } },
  ] };
const moxV3 = { name: 'Mox Goblins', createdByUser: { userName: 'mox_hans' }, boards: { commanders: { cards: { a: { quantity: 1, finish: 'foil', card: { name: 'Krenko, Mob Boss', set: 'm19', cn: '110', scryfall_id: 'A3B4C5D6-1111-2222-3333-444455556666' } } } }, mainboard: { cards: { b: { quantity: 1, card: { name: 'Goblin Chieftain', set: 'm10', cn: '140' } }, c: { quantity: 30, card: { name: 'Mountain' } } } }, sideboard: { cards: { d: { quantity: 1, card: { name: 'Not In Deck' } } } } } };
const moxV2 = { name: 'Old Shape', commanders: { 'Krenko, Mob Boss': { quantity: 1, card: { name: 'Krenko, Mob Boss' } } }, mainboard: { 'Mountain': { quantity: 99, card: { name: 'Mountain' } } } };
globalThis.fetch = async (url, init) => { const u = String(url);
  if (u.includes('api2.moxfield.com')) { const id = u.split('/').pop(); if (id === 'blocked1') return new Response('<html>Just a moment…</html>', { status: 403 }); if (id === 'private1') return new Response('{}', { status: 404 }); const body = id === 'oldshape' ? moxV2 : moxV3; return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }); }
  const body = u.includes('/decks/v3/') ? list(+u.match(/page=(\d)/)[1]) : u.includes('/decks/1585124/') ? deck : null; return new Response(JSON.stringify(body), { status: body ? 200 : 404, headers: { 'content-type': 'application/json' } }); };
const store = new Map(); globalThis.caches = { default: { match: async (k) => store.get(k.url)?.clone(), put: async (k, r) => store.set(k.url, r) } };
const env = { ASSETS: { fetch: async () => new Response('asset') } };
let fails = 0; const check = (n, ok, note = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n, ok ? '' : note); if (!ok) fails++; };

let r = await worker.fetch(new Request('https://edhclub.com/api/top-decks'), env); let j = await r.json();
check('top-decks returns 100 slim rows', r.status === 200 && j.decks.length === 100 && j.decks[0].colors === 'UR' && j.decks[0].owner === 'hans' && j.decks[0].tags[0] === 'Goblins');
r = await worker.fetch(new Request('https://edhclub.com/api/top-decks'), env); check('second call is served from cache', (await r.json()).fetched === j.fetched);
r = await worker.fetch(new Request('https://edhclub.com/api/deck/1585124'), env); j = await r.json();
check('deck converts to importer text with commander heading', j.commander === 'Krenko, Mob Boss' && j.text.startsWith('Commander\n1 Krenko, Mob Boss\n\nDeck\n'));
check('maybeboard and sideboard cards are dropped', !j.text.includes('Should Not') && !j.text.includes('Nor This'));
check('quantities kept and counted', j.text.includes('30 Mountain') && j.count === 32);
r = await worker.fetch(new Request('https://edhclub.com/api/deck/abc'), env); check('bad id rejected', r.status === 404);
r = await worker.fetch(new Request('https://edhclub.com/api/moxfield/7wFqK4tZbE6j'), env); j = await r.json();
check('moxfield (boards shape) converts with commander, printings, foil and Scryfall id', r.status === 200 && j.name === 'Mox Goblins' && j.commander === 'Krenko, Mob Boss' && j.text.startsWith('Commander\n1 Krenko, Mob Boss (M19) 110 *F* [sf=a3b4c5d6-1111-2222-3333-444455556666]\n\nDeck\n') && j.text.includes('1 Goblin Chieftain (M10) 140') && j.text.includes('30 Mountain'), j.text);
check('moxfield sideboard is dropped and count is right', !j.text.includes('Not In Deck') && j.count === 32 && j.source === 'moxfield');
r = await worker.fetch(new Request('https://edhclub.com/api/moxfield/oldshape'), env); j = await r.json();
check('moxfield (flat v2 shape) also converts', r.status === 200 && j.commander === 'Krenko, Mob Boss' && j.text.includes('99 Mountain'));
r = await worker.fetch(new Request('https://edhclub.com/api/moxfield/blocked1'), env); j = await r.json();
check('moxfield bot-wall → readable error with paste fallback', r.status === 502 && j.fallback === 'paste' && /Export/.test(j.error));
r = await worker.fetch(new Request('https://edhclub.com/api/moxfield/private1'), env); check('private moxfield deck → 404', r.status === 404);
r = await worker.fetch(new Request('https://edhclub.com/api/moxfield/bad id!'), env); check('bad moxfield id rejected', r.status === 404 || r.status === 400);
r = await worker.fetch(new Request('https://edhclub.com/api/nope'), env); check('unknown api 404', r.status === 404);
r = await worker.fetch(new Request('https://edhclub.com/table.html'), env); check('everything else goes to assets', await r.text() === 'asset');

// ---- Discord announcements ----
{
  const posts = []; const patches = [];
  const envD = { ...env, SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_KEY: 'svc', DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/x' };
  const room = { code: 'ABCDE', host_name: 'Mira', seats: 4, bots: 1, seated: 1, open_seats: 2, bracket: 3, status: 'open', is_public: true, locked: false, announced_at: null, club_id: 'c1', created_at: '2026-10-11T12:00:00Z', has_voice: true };
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { const u = String(url);
    if (u.startsWith('https://discord.com/api/webhooks')) { posts.push([u, JSON.parse(init.body)]); return new Response(null, { status: 204 }); }
    if (u.includes('/rest/v1/rooms') && init && init.method === 'PATCH') { patches.push(JSON.parse(init.body)); return new Response('[]', { status: 200 }); }
    if (u.includes('/rest/v1/rooms')) return new Response(JSON.stringify([room]), { status: 200 });
    if (u.includes('/rest/v1/clubs')) return new Response(JSON.stringify([{ discord_webhook: 'https://discord.com/api/webhooks/2/club' }]), { status: 200 });
    return prevFetch(url, init); };
  let r = await worker.fetch(new Request('https://edhclub.com/api/announce/ABCDE', { method: 'POST' }), envD); let j = await r.json();
  check('announce posts to the global webhook and the club webhook, then stamps announced_at', r.status === 200 && j.posted === 2 && posts.length === 2 && patches.length === 1 && patches[0].announced_at, JSON.stringify(j));
  const e = posts[0][1].embeds[0];
  check('embed: title, open seats, bracket, bots, voice, join and watch links with the code', /Mira/.test(e.title) && /2 seats open/.test(e.description) && /bracket 3/.test(e.description) && /1 bot/.test(e.description) && /voice/.test(e.description) && e.url.includes('join=ABCDE') && e.fields[1].value.includes('watch=ABCDE'));
  room.announced_at = new Date().toISOString();
  r = await worker.fetch(new Request('https://edhclub.com/api/announce/ABCDE', { method: 'POST' }), envD); j = await r.json();
  check('announcing again within 10 minutes is a no-op', j.posted === 0 && /already/.test(j.note));
  r = await worker.fetch(new Request('https://edhclub.com/api/announce/ABCDE', { method: 'POST' }), env); j = await r.json();
  check('without service credentials the endpoint fails clearly', r.status === 502 && /not configured/.test(j.error));
  room.announced_at = null; posts.length = 0;
  await worker.scheduled({}, envD, { waitUntil: (p) => p });
  await new Promise((res) => setTimeout(res, 50));
  check('the 5-minute sweep announces unannounced open tables', posts.length >= 1);
  globalThis.fetch = prevFetch;
}
console.log(fails ? `\n${fails} failed` : '\nall worker checks passed'); process.exit(fails ? 1 : 0);
