// Decks page: "My decks" (the account's library, up to 20) and the Top 100 from Archidekt.
import { online, currentUser, saveDeck, getDeck, listDecks, deleteDeck, updateDeckMeta, setDefaultDeck, defaultDeckId, lastDeckId, setLastDeckId, localAvatar, displayNameFor, DECK_LIMIT } from './supa.js';
import { fetchCards, cached } from './scryfall.js';
import { parseList, deckStats, deckText } from './decklist.js';

const $ = (s, r = document) => r.querySelector(s); const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n));
const pips = (cols) => `<span class="pips">${(cols || 'C').split('').map((k) => `<i class="ms ms-${k.toLowerCase()} ms-cost"></i>`).join('')}</span>`;
const ago = (iso) => { if (!iso) return 'never'; const d = (Date.now() - new Date(iso)) / 864e5; return d < 1 ? 'today' : d < 2 ? 'yesterday' : d < 30 ? `${Math.floor(d)} days ago` : new Date(iso).toLocaleDateString(); };
function toast(msg, ms = 3200) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; $('#toasts').appendChild(t); setTimeout(() => t.remove(), ms); }
const typeOf = (n) => (cached(n) || {}).type || '';

let user = null, mine = [], defaultId = '';

/* ---------- modal ---------- */
function openModal(html, cls = '') { const m = $('#modal'); m.innerHTML = `<div class="scrim" data-close="1"></div><div class="mpanel ${cls}" role="dialog" aria-modal="true">${html}</div>`; m.hidden = false; const f = m.querySelector('[data-autofocus]'); if (f) setTimeout(() => f.focus(), 30); }
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }
document.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target.closest('#modal [data-act=close]')) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

/* ---------- My decks ---------- */
async function loadMine() {
  const box = $('#mine');
  if (!online) { box.innerHTML = '<p class="muted">Deck storage needs the online service.</p>'; return; }
  if (!user) { box.innerHTML = '<p class="muted">Sign in on the <a href="/">lobby</a> to keep decks on your account. You can still play any Top 100 deck as a guest.</p>'; $('#deckCount').textContent = ''; return; }
  mine = await listDecks(); defaultId = await defaultDeckId();
  $('#deckCount').textContent = ` ${mine.length}/${DECK_LIMIT}`;
  $('#newDeck').disabled = mine.length >= DECK_LIMIT; $('#importUrl').disabled = mine.length >= DECK_LIMIT;
  renderMine();
  const cmds = [...new Set(mine.flatMap((d) => (d.commander || '').split(' + ')).filter(Boolean))];
  if (cmds.some((n) => !cached(n))) { try { await fetchCards(cmds); } catch { /* offline */ } renderMine(); }
}
function renderMine() {
  const box = $('#mine');
  if (!mine.length) { box.innerHTML = `<div class="empty-decks"><h3>No decks yet</h3><p>Paste a list from Moxfield or Archidekt, import an Archidekt link, or save one of the Top 100.</p><div class="row"><button type="button" class="btn" data-mine="new">New deck</button><button type="button" class="btn ghost" data-view="top">Browse the Top 100</button></div></div>`; return; }
  box.innerHTML = mine.map((d) => {
    const first = (d.commander || '').split(' + ')[0]; const art = (cached(first) || {}).art || '';
    const isDefault = d.id === defaultId; const okCount = d.card_count === 100;
    return `<article class="deckcard ${isDefault ? 'is-default' : ''}" data-id="${d.id}">
      <div class="deckart" style="${art ? `background-image:url(${esc(art)})` : ''}">${d.favorite ? '<span class="fav" title="Favorite">★</span>' : ''}${isDefault ? '<span class="rank">Default</span>' : ''}${pips(d.colors)}</div>
      <div class="deckbody"><h3>${esc(d.name)}</h3><p class="muted">${esc(d.commander || 'No commander')}</p>
      <p class="muted small">${d.card_count} cards${okCount ? '' : ' <span class="bad">· not 100</span>'} · ${d.plays ? `${d.plays} game${d.plays > 1 ? 's' : ''}, last ${ago(d.last_played_at)}` : 'not played yet'} · edited ${ago(d.updated_at)}</p>
      <div class="row"><a class="btn sm" href="/table.html?mode=bots&deck=${d.id}">Play vs bots</a><button type="button" class="btn ghost sm" data-mine="edit" data-id="${d.id}">Edit</button><button type="button" class="btn ghost sm" data-mine="menu" data-id="${d.id}">More…</button></div></div>
    </article>`;
  }).join('');
}
function deckMenu(d, anchor) {
  const items = [
    { k: 'default', l: d.id === defaultId ? 'Default deck (seated for you)' : 'Make this my default deck' },
    { k: 'fav', l: d.favorite ? 'Remove from favorites' : 'Add to favorites' },
    { k: 'dup', l: 'Duplicate' }, { k: 'export', l: 'Export .txt' }, { k: 'copy', l: 'Copy list' }, { k: 'del', l: 'Delete', danger: true },
  ];
  openModal(`<h2>${esc(d.name)}</h2><p>${esc(d.commander || '')} · ${d.card_count} cards</p><div class="menu-list">${items.map((i) => `<button type="button" class="mi ${i.danger ? 'danger' : ''}" data-dk="${i.k}">${i.l}</button>`).join('')}</div><div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-act="close">Close</button></div>`, 'narrow');
  $$('[data-dk]').forEach((b) => { b.onclick = async () => {
    const k = b.dataset.dk; closeModal();
    if (k === 'default') { await setDefaultDeck(d.id); defaultId = d.id; renderMine(); toast(`${d.name} will be seated for you at your next table`); }
    else if (k === 'fav') { await updateDeckMeta(d.id, { favorite: !d.favorite }); await loadMine(); }
    else if (k === 'dup') { if (mine.length >= DECK_LIMIT) { toast(`You already have ${DECK_LIMIT} decks`); return; } const full = await getDeck(d.id); try { await saveDeck({ name: `${d.name} (copy)`, commander: d.commander, colors: d.colors, cardCount: d.card_count, list: full.list, mat: d.mat }); await loadMine(); toast('Duplicated'); } catch (e) { toast(e.message, 5000); } }
    else if (k === 'export') { const full = await getDeck(d.id); const blob = new Blob([full.list], { type: 'text/plain' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${d.name.replace(/[^\w\- ]+/g, '')}.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
    else if (k === 'copy') { const full = await getDeck(d.id); try { await navigator.clipboard.writeText(full.list); toast('Decklist copied'); } catch { toast('Copy failed; use Export instead'); } }
    else if (k === 'del') { openModal(`<h2>Delete ${esc(d.name)}?</h2><p>This can’t be undone.</p><div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-act="close">Keep it</button><button type="button" class="btn danger" id="delGo">Delete</button></div>`, 'narrow'); $('#delGo').onclick = async () => { await deleteDeck(d.id); if (defaultId === d.id) { await setDefaultDeck(''); defaultId = ''; } closeModal(); await loadMine(); toast('Deck deleted'); }; }
  }; });
}
/* Editor: name, commander (auto), list with live validation. */
async function editor(d) {
  const full = d ? await getDeck(d.id) : { name: '', commander: '', list: '', mat: 'auto' };
  openModal(`<h2>${d ? 'Edit deck' : 'New deck'}</h2>
  <div class="grid2"><label>Deck name<input id="edName" maxlength="40" value="${esc(full.name)}" placeholder="Krenko goblins" data-autofocus></label><label>Commander (optional)<input id="edCmd" placeholder="Taken from the list if left blank"></label></div>
  <label>Decklist<textarea id="edList" rows="14" spellcheck="false" placeholder="Paste a Moxfield or Archidekt export, one card per line: 1 Sol Ring">${esc(full.list)}</textarea></label>
  <div class="summary" id="edSum"></div>
  <div class="row" style="justify-content:space-between"><span class="muted small" id="edHint">${d ? '' : `${mine.length}/${DECK_LIMIT} decks used`}</span><span class="row"><button type="button" class="btn ghost" data-act="close">Cancel</button><button type="button" class="btn" id="edSave">${d ? 'Save changes' : 'Save deck'}</button></span></div>`, 'wide');
  const ta = $('#edList'); let names = [];
  const sum = async () => {
    const p = parseList(ta.value, $('#edCmd').value, typeOf); const st = deckStats(p, typeOf);
    const unknown = [...new Set([...p.cmd, ...p.main.map((e) => e.name)])].filter((n) => !cached(n));
    $('#edSum').innerHTML = `${p.cmd.length ? `Commander: <b>${esc(p.cmd.join(' + '))}</b>` : '<span class="bad">No commander marked</span> — add a "Commander" heading or type it above'} · ${st.total} cards · ${st.lands} lands${st.issues.filter((i) => !i.startsWith('No commander')).map((i) => ` · <span class="bad">${esc(i)}</span>`).join('')}${st.ok ? ' · <span class="good">Commander legal count ✓</span>' : ''}`;
    if (unknown.length && unknown.length <= 150 && JSON.stringify(unknown) !== JSON.stringify(names)) { names = unknown; try { await fetchCards(unknown.slice(0, 150)); sum(); } catch { /* offline */ } }
  };
  ta.oninput = sum; $('#edCmd').oninput = sum; sum();
  $('#edSave').onclick = async () => {
    const p = parseList(ta.value, $('#edCmd').value, typeOf); const st = deckStats(p, typeOf);
    if (!p.count && !p.cmd.length) { toast('Paste a decklist first'); return; }
    if (!p.cmd.length) { toast('Pick a commander first'); $('#edCmd').focus(); return; }
    const name = $('#edName').value.trim() || p.cmd[0] || 'Untitled deck';
    const colors = [...new Set(p.cmd.flatMap((n) => ((cached(n) || {}).colors || '').split('')))].filter(Boolean).join('');
    try { const row = await saveDeck({ id: d ? d.id : undefined, name, commander: p.cmd.join(' + '), colors, cardCount: st.total, list: deckText(p), mat: full.mat }); closeModal(); await loadMine(); toast(d ? 'Saved' : `${name} saved${!defaultId ? ' and set as your default' : ''}`); if (!defaultId) { await setDefaultDeck(row.id); defaultId = row.id; renderMine(); } }
    catch (e) { toast(e.message, 6000); }
  };
}
async function importFromUrl() {
  openModal(`<h2>Import from Archidekt</h2><p>Paste a deck link like <code>https://archidekt.com/decks/1234567/name</code>. Moxfield doesn’t allow this; use its Export → copy and paste into a new deck.</p><label>Link<input id="impUrl" placeholder="https://archidekt.com/decks/…" data-autofocus></label><div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-act="close">Cancel</button><button type="button" class="btn" id="impGo">Import</button></div>`, 'narrow');
  $('#impGo').onclick = async () => {
    const m = $('#impUrl').value.match(/archidekt\.com\/decks\/(\d+)/); if (!m) { toast('That doesn’t look like an Archidekt deck link'); return; }
    $('#impGo').disabled = true; $('#impGo').textContent = 'Importing…';
    try { const r = await fetch(`/api/deck/${m[1]}`); const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || r.statusText); closeModal(); await editor(null); $('#edName').value = j.name; $('#edList').value = j.text; $('#edList').dispatchEvent(new Event('input')); }
    catch (e) { toast('Import failed: ' + e.message, 6000); $('#impGo').disabled = false; $('#impGo').textContent = 'Import'; }
  };
}

/* ---------- Top 100 ---------- */
let decks = []; const filter = { q: '', colors: new Set(), sort: 'views' };
async function loadTop() {
  try { const r = await fetch('/api/top-decks'); const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || r.statusText); decks = j.decks || []; }
  catch (e) { $('#grid').innerHTML = `<p class="muted">Couldn't reach the deck list (${esc(e.message)}). Try again in a minute.</p>`; return; }
  renderTop();
}
function visible() {
  const q = filter.q.toLowerCase();
  let out = decks.filter((d) => (!q || `${d.name} ${d.owner} ${d.tags.join(' ')}`.toLowerCase().includes(q)) && [...filter.colors].every((c) => d.colors.includes(c)));
  if (filter.sort === 'updated') out = out.slice().sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  else if (filter.sort === 'name') out = out.slice().sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
function renderTop() {
  const list = visible();
  $('#grid').innerHTML = list.length ? list.map((d) => `<article class="deckcard" data-id="${d.id}">
    <div class="deckart" style="${d.featured ? `background-image:url(${esc(d.featured)})` : ''}"><span class="rank">#${decks.indexOf(d) + 1}</span>${pips(d.colors)}</div>
    <div class="deckbody"><h3>${esc(d.name)}</h3><p class="muted">by ${esc(d.owner)} · ${fmt(d.views)} views${d.bracket ? ` · Bracket ${d.bracket}` : ''}</p>
    <div class="row"><button type="button" class="btn sm" data-play="${d.id}">Play vs bots</button><button type="button" class="btn ghost sm" data-save="${d.id}">${user ? 'Save to my decks' : 'Sign in to save'}</button><a class="btn ghost sm" href="https://archidekt.com/decks/${d.id}" target="_blank" rel="noopener" title="Open on Archidekt">↗</a></div></div>
  </article>`).join('') : '<p class="muted">No decks match that filter.</p>';
}
async function fetchDeck(id) { const r = await fetch(`/api/deck/${id}`); const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || r.statusText); return j; }

/* ---------- wiring ---------- */
function showView(v) { $('#viewMine').hidden = v !== 'mine'; $('#viewTop').hidden = v !== 'top'; $$('.big-tabs .tab').forEach((t) => t.classList.toggle('on', t.dataset.view === v)); history.replaceState(null, '', v === 'top' ? '#top' : '#mine'); if (v === 'top' && !decks.length) loadTop(); }
document.addEventListener('click', async (e) => {
  const tv = e.target.closest('[data-view]'); if (tv) { showView(tv.dataset.view); return; }
  const mn = e.target.closest('[data-mine]');
  if (mn) { const d = mine.find((x) => x.id === mn.dataset.id); if (mn.dataset.mine === 'new') editor(null); else if (mn.dataset.mine === 'edit' && d) editor(d); else if (mn.dataset.mine === 'menu' && d) deckMenu(d, mn); return; }
  const play = e.target.closest('[data-play]'); if (play) { location.href = `/table.html?mode=bots&deck=top:${play.dataset.play}`; return; }
  const sv = e.target.closest('[data-save]');
  if (sv) {
    if (!user) { location.href = '/#signin'; return; }
    if (mine.length >= DECK_LIMIT) { toast(`You already have ${DECK_LIMIT} decks. Delete one first.`, 5000); return; }
    sv.disabled = true; sv.textContent = 'Saving…';
    try { const d = await fetchDeck(sv.dataset.save); const meta = decks.find((x) => String(x.id) === sv.dataset.save) || {}; const row = await saveDeck({ name: d.name, commander: d.commander, colors: meta.colors || '', cardCount: d.count, list: d.text }); if (!defaultId) { await setDefaultDeck(row.id); defaultId = row.id; } sv.textContent = 'Saved ✓'; toast(`${d.name} saved to your decks.`, 5000); await loadMine(); }
    catch (err) { sv.disabled = false; sv.textContent = 'Save to my decks'; toast('Could not save: ' + err.message, 5000); }
    return;
  }
  const cb = e.target.closest('#colors button'); if (cb) { const c = cb.dataset.c; filter.colors.has(c) ? filter.colors.delete(c) : filter.colors.add(c); cb.classList.toggle('on'); renderTop(); }
});
$('#q').oninput = (e) => { filter.q = e.target.value.trim(); renderTop(); };
$('#sort').onchange = (e) => { filter.sort = e.target.value; renderTop(); };
$('#newDeck').onclick = () => editor(null); $('#importUrl').onclick = importFromUrl;

(async () => {
  if (online) {
    user = await currentUser();
    if (user) { const name = await displayNameFor(user); const av = localAvatar(); $('#account').innerHTML = `<span class="who">${av ? `<img class="pfp" src="${esc(av)}" alt="">` : `<span class="pfp init">${esc(name[0] || '?')}</span>`}${esc(name)}</span><a class="btn ghost sm" href="/">Lobby</a>`; }
  }
  showView(location.hash === '#top' || !user ? 'top' : 'mine');
  loadMine();
})();
