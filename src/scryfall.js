// Card data and images from Scryfall (https://scryfall.com/docs/api).
// Lookups go through /cards/collection, 75 names per request, with a short pause
// between requests to stay inside Scryfall's rate guidance. Results are cached in
// localStorage so a deck only hits the network the first time it is seated.

const CACHE_KEY = 'edhclub-scryfall-v2';
// The standard Magic card back, as hosted by Scryfall (card_back_id 0aeebaf5-8c7d-4636-9e82-8c27447861f7).
export const CARD_BACK = 'https://backs.scryfall.io/normal/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg';
const API = 'https://api.scryfall.com/cards/collection';

let cache = load();

function load() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; }
}
function persist() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* storage full or blocked */ }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Entries cached before art crops were stored are refetched once; the old key is cleared.
try { localStorage.removeItem('edhclub-scryfall-v1'); } catch { /* ignore */ }
export const cardKey = (name, set, num) => String(name).toLowerCase().split(' // ')[0].trim() + (set ? `|${String(set).toLowerCase()}|${String(num || '').toLowerCase()}` : '');
export const printKey = (set, num) => `${String(set).toLowerCase()}|${String(num).toLowerCase()}`;

/** Cached entry for a name, or for a specific printing (set + collector number) when one is asked for and known. */
export function cached(name, set, num) {
  if (set && num) { const hit = cache[cardKey(name, set, num)] || cache['p|' + printKey(set, num)]; if (hit) return hit; }
  return cache[cardKey(name)] || null;
}

function toEntry(card) {
  const faces = card.card_faces || null;
  const front = faces ? faces[0] : card;
  const imgs = card.image_uris || (faces && faces[0].image_uris) || {};
  const backImgs = faces && faces[1] && faces[1].image_uris ? faces[1].image_uris : null;
  const power = front.power ?? card.power;
  const toughness = front.toughness ?? card.toughness;
  return {
    name: card.name,
    set: card.set || '', num: card.collector_number || '', setName: card.set_name || '',
    finishes: (card.finishes || []).join(','), fullArt: !!card.full_art, frame: (card.frame_effects || []).join(','), promo: !!card.promo, year: (card.released_at || '').slice(0, 4),
    cost: card.mana_cost || front.mana_cost || '',
    type: card.type_line || front.type_line || '',
    pt: power != null ? `${power}/${toughness}` : '',
    colors: (card.colors || front.colors || card.color_identity || []).join(''),
    img: imgs.normal || '',
    art: imgs.art_crop || (backImgs && backImgs.art_crop) || '',
    big: imgs.large || imgs.normal || '',
    backImg: backImgs ? backImgs.normal : '',
    backBig: backImgs ? (backImgs.large || backImgs.normal) : '',
    artist: card.artist || front.artist || '',
    kw: (card.keywords || []).join(',').toLowerCase(),
    loyalty: card.loyalty || front.loyalty || '',
    oracle: (card.oracle_text || front.oracle_text || (faces ? faces.map((f) => f.oracle_text || '').join('\n') : '')).slice(0, 1400),
    uri: card.scryfall_uri || '',
  };
}

/**
 * Fetch any names not already cached.
 * @param {string[]} names
 * @param {(done:number,total:number)=>void} [onProgress]
 * @returns {Promise<{missing:string[], fetched:number}>}
 */
export async function fetchCards(names, onProgress) {
  // Items are names, or { name, set, num } for a specific printing.
  const items = names.map((n) => (typeof n === 'string' ? { name: n.trim() } : n)).filter((x) => x && x.name);
  const seen = new Set(); const want = items.filter((x) => { const k = x.set && x.num ? 'p|' + printKey(x.set, x.num) : cardKey(x.name); if (seen.has(k)) return false; seen.add(k); return !cache[k]; });
  const missing = [];
  for (let i = 0; i < want.length; i += 75) {
    const chunk = want.slice(i, i + 75);
    if (i > 0) await sleep(120);
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ identifiers: chunk.map((x) => (x.set && x.num ? { set: x.set.toLowerCase(), collector_number: String(x.num) } : { name: x.name.split(' // ')[0].trim() })) }),
    });
    if (!res.ok) throw new Error(`Scryfall returned ${res.status}`);
    const json = await res.json();
    for (const card of json.data || []) {
      const entry = toEntry(card);
      const asked = chunk.find((x) => x.set && x.num && x.set.toLowerCase() === card.set && String(x.num).toLowerCase() === String(card.collector_number).toLowerCase());
      if (asked) { cache['p|' + printKey(card.set, card.collector_number)] = entry; cache[cardKey(card.name, card.set, card.collector_number)] = entry; }
      if (!cache[cardKey(card.name)] || !asked) cache[cardKey(card.name)] = cache[cardKey(card.name)] || entry;
      if (card.card_faces) for (const f of card.card_faces) cache[cardKey(f.name)] = cache[cardKey(f.name)] || entry;
    }
    for (const nf of json.not_found || []) if (nf.name) missing.push(nf.name); else if (nf.set) missing.push(`${nf.set} ${nf.collector_number}`);
    onProgress && onProgress(Math.min(want.length, i + 75), want.length);
  }
  if (want.length) persist();
  return { missing, fetched: want.length };
}

/* Token art: Scryfall prints every token as its own card (set type "token"). Look one up by name and P/T,
   preferring the most recent printing; cached in memory for the session. */
const tokenCache = {};
export async function fetchToken(name, pt, colors) {
  const key = `${name}|${pt}|${colors || ''}`.toLowerCase(); if (tokenCache[key] !== undefined) return tokenCache[key];
  const q = [`t:token`, `!"${name}"`]; if (pt && /^\d+\/\d+$/.test(pt)) { const [pw, tg] = pt.split('/'); q.push(`pow=${pw}`, `tou=${tg}`); }
  if (colors) q.push(`c=${colors.toLowerCase()}`); else if (colors === '') q.push('c=c');
  try {
    let res = await fetch(`https://api.scryfall.com/cards/search?order=released&unique=art&q=${encodeURIComponent(q.join(' '))}`);
    if (!res.ok && q.length > 2) res = await fetch(`https://api.scryfall.com/cards/search?order=released&unique=art&q=${encodeURIComponent(`t:token !"${name}"`)}`);
    if (!res.ok) { tokenCache[key] = null; return null; }
    const json = await res.json(); const card = (json.data || []).find((c) => c.image_uris || (c.card_faces && c.card_faces[0].image_uris));
    if (!card) { tokenCache[key] = null; return null; }
    const face = card.card_faces && !card.image_uris ? card.card_faces[0] : card; const imgs = face.image_uris || card.image_uris || {};
    tokenCache[key] = { img: imgs.normal || '', big: imgs.large || imgs.normal || '', art: imgs.art_crop || '', artist: card.artist || face.artist || '', kw: (card.keywords || []).join(',').toLowerCase(), oracle: (face.oracle_text || card.oracle_text || '').slice(0, 400), type: face.type_line || card.type_line || '' };
    return tokenCache[key];
  } catch { tokenCache[key] = null; return null; }
}

/* Every printing of a card, newest first: for the artwork picker. Cached in memory for the session. */
const printsCache = {};
export async function fetchPrintings(name) {
  const key = cardKey(name); if (printsCache[key]) return printsCache[key];
  const out = [];
  try {
    let url = `https://api.scryfall.com/cards/search?order=released&dir=desc&unique=prints&q=${encodeURIComponent(`!"${name.split(' // ')[0]}" game:paper`)}`;
    for (let page = 0; url && page < 4; page++) {
      const res = await fetch(url); if (!res.ok) break; const json = await res.json();
      for (const card of json.data || []) { const e = toEntry(card); if (e.img) { out.push(e); cache['p|' + printKey(e.set, e.num)] = cache['p|' + printKey(e.set, e.num)] || e; } }
      url = json.has_more ? json.next_page : null; if (url) await sleep(100);
    }
  } catch { /* offline */ }
  if (out.length) persist();
  printsCache[key] = out; return out;
}
