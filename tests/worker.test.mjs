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
console.log(fails ? `\n${fails} failed` : '\nall worker checks passed'); process.exit(fails ? 1 : 0);
