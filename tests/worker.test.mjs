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
globalThis.fetch = async (url) => { const u = String(url); const body = u.includes('/decks/v3/') ? list(+u.match(/page=(\d)/)[1]) : u.includes('/decks/1585124/') ? deck : null; return new Response(JSON.stringify(body), { status: body ? 200 : 404, headers: { 'content-type': 'application/json' } }); };
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
r = await worker.fetch(new Request('https://edhclub.com/api/nope'), env); check('unknown api 404', r.status === 404);
r = await worker.fetch(new Request('https://edhclub.com/table.html'), env); check('everything else goes to assets', await r.text() === 'asset');
console.log(fails ? `\n${fails} failed` : '\nall worker checks passed'); process.exit(fails ? 1 : 0);
