// Card data and images from Scryfall (https://scryfall.com/docs/api).
// Lookups go through /cards/collection, 75 names per request, with a short pause
// between requests to stay inside Scryfall's rate guidance. Results are cached in
// localStorage so a deck only hits the network the first time it is seated.

const CACHE_KEY = 'edhclub-scryfall-v1';
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
export const cardKey = (name) => String(name).toLowerCase().split(' // ')[0].trim();

export function cached(name) {
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
  const want = [...new Set(names.map((n) => String(n).trim()).filter(Boolean))].filter((n) => !cache[cardKey(n)]);
  const missing = [];
  for (let i = 0; i < want.length; i += 75) {
    const chunk = want.slice(i, i + 75);
    if (i > 0) await sleep(120);
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ identifiers: chunk.map((n) => ({ name: n.split(' // ')[0].trim() })) }),
    });
    if (!res.ok) throw new Error(`Scryfall returned ${res.status}`);
    const json = await res.json();
    for (const card of json.data || []) {
      const entry = toEntry(card);
      cache[cardKey(card.name)] = entry;
      if (card.card_faces) for (const f of card.card_faces) cache[cardKey(f.name)] = entry;
    }
    for (const nf of json.not_found || []) if (nf.name) missing.push(nf.name);
    onProgress && onProgress(Math.min(want.length, i + 75), want.length);
  }
  if (want.length) persist();
  return { missing, fetched: want.length };
}
