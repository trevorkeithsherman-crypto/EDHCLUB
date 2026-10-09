import { online, currentUser, saveDeck, setLastDeckId, localAvatar, displayNameFor } from './supa.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n));
const pips = (cols) => `<span class="pips">${(cols || 'C').split('').map((k) => `<i class="ms ms-${k.toLowerCase()} ms-cost"></i>`).join('')}</span>`;
function toast(msg, ms = 3000) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; $('#toasts').appendChild(t); setTimeout(() => t.remove(), ms); }

let decks = [], user = null; const filter = { q: '', colors: new Set(), sort: 'views' };

async function load() {
  try {
    const r = await fetch('/api/top-decks'); const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || r.statusText);
    decks = j.decks || [];
  } catch (e) { $('#grid').innerHTML = `<p class="muted">Couldn't reach the deck list (${esc(e.message)}). Try again in a minute.</p>`; return; }
  render();
}
function visible() {
  const q = filter.q.toLowerCase();
  let out = decks.filter((d) => (!q || `${d.name} ${d.owner} ${d.tags.join(' ')}`.toLowerCase().includes(q)) && [...filter.colors].every((c) => d.colors.includes(c)));
  if (filter.sort === 'updated') out = out.slice().sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  else if (filter.sort === 'name') out = out.slice().sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
function render() {
  const list = visible();
  $('#grid').innerHTML = list.length ? list.map((d, i) => `<article class="deckcard" data-id="${d.id}">
    <div class="deckart" style="${d.featured ? `background-image:url(${esc(d.featured)})` : ''}"><span class="rank">#${decks.indexOf(d) + 1}</span>${pips(d.colors)}</div>
    <div class="deckbody"><h3>${esc(d.name)}</h3><p class="muted">by ${esc(d.owner)} · ${fmt(d.views)} views${d.bracket ? ` · Bracket ${d.bracket}` : ''}</p>
    <div class="row"><button type="button" class="btn sm" data-play="${d.id}">Play vs bots</button><button type="button" class="btn ghost sm" data-save="${d.id}">${user ? 'Save to my decks' : 'Sign in to save'}</button><a class="btn ghost sm" href="https://archidekt.com/decks/${d.id}" target="_blank" rel="noopener" title="Open on Archidekt">↗</a></div></div>
  </article>`).join('') : '<p class="muted">No decks match that filter.</p>';
}
async function fetchDeck(id) {
  const r = await fetch(`/api/deck/${id}`); const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || r.statusText);
  return j;
}
document.addEventListener('click', async (e) => {
  const play = e.target.closest('[data-play]'); if (play) { location.href = `/table.html?mode=bots&deck=top:${play.dataset.play}`; return; }
  const sv = e.target.closest('[data-save]');
  if (sv) {
    if (!user) { location.href = '/#signin'; return; }
    sv.disabled = true; sv.textContent = 'Saving…';
    try {
      const d = await fetchDeck(sv.dataset.save); const meta = decks.find((x) => String(x.id) === sv.dataset.save) || {};
      const row = await saveDeck({ name: d.name, commander: d.commander, colors: meta.colors || '', cardCount: d.count, list: d.text });
      setLastDeckId(row.id); sv.textContent = 'Saved ✓'; toast(`${d.name} saved. It'll be seated for you at your next table.`, 5000);
    } catch (err) { sv.disabled = false; sv.textContent = 'Save to my decks'; toast('Could not save: ' + err.message, 5000); }
    return;
  }
  const cb = e.target.closest('#colors button'); if (cb) { const c = cb.dataset.c; filter.colors.has(c) ? filter.colors.delete(c) : filter.colors.add(c); cb.classList.toggle('on'); render(); }
});
$('#q').oninput = (e) => { filter.q = e.target.value.trim(); render(); };
$('#sort').onchange = (e) => { filter.sort = e.target.value; render(); };

(async () => {
  if (online) {
    user = await currentUser();
    if (user) { const name = await displayNameFor(user); const av = localAvatar(); $('#account').innerHTML = `<span class="who">${av ? `<img class="pfp" src="${esc(av)}" alt="">` : `<span class="pfp init">${esc(name[0] || '?')}</span>`}${esc(name)}</span><a class="btn ghost sm" href="/">Lobby</a>`; }
  }
  load();
})();
