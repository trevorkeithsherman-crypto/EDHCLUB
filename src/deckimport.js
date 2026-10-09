// Deck links people paste: Archidekt and Moxfield. The edge worker turns either into importer text.
export function deckLink(text) {
  const t = String(text || '').trim(); if (!/^https?:\/\//i.test(t) && !/^(www\.)?(archidekt|moxfield)\.com/i.test(t)) return null;
  let m = t.match(/archidekt\.com\/decks\/(\d+)/i); if (m) return { site: 'archidekt', id: m[1], api: `/api/deck/${m[1]}` };
  m = t.match(/moxfield\.com\/decks\/([A-Za-z0-9_-]{6,40})/i); if (m) return { site: 'moxfield', id: m[1], api: `/api/moxfield/${m[1]}` };
  return null;
}
/** Fetch a linked deck as {name, text, commander, ...}. Throws with a readable message. */
export async function fetchLinkedDeck(link) {
  const r = await fetch(link.api); let j = null; try { j = await r.json(); } catch { /* not json */ }
  if (!r.ok || !j || j.error) { const e = new Error((j && j.error) || r.statusText || 'Import failed'); e.fallback = j && j.fallback; throw e; }
  return j;
}
