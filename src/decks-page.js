// Decks page: "My decks" (the account's library, up to 20) and the Top 100 from Archidekt.
import { online, currentUser, saveDeck, getDeck, listDecks, deleteDeck, updateDeckMeta, setDefaultDeck, defaultDeckId, lastDeckId, setLastDeckId, localAvatar, displayNameFor, DECK_LIMIT } from './supa.js';
import { fetchCards, fetchPrintings, cached } from './scryfall.js';
import { parseList, deckStats, deckText } from './decklist.js';
import { deckLink, fetchLinkedDeck } from './deckimport.js';

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
document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; const m2 = $('#modal2'), em = $('#edMenu'); if (em && !em.hidden) { em.hidden = true; return; } if (m2 && !m2.hidden) { m2.hidden = true; m2.innerHTML = ''; return; } if (!$('#modal').hidden) closeModal(); });

/* ---------- My decks ---------- */
async function loadMine() {
  const box = $('#mine');
  if (!online) { box.innerHTML = '<p class="muted">Deck storage needs the online service.</p>'; return; }
  if (!user) { box.innerHTML = '<p class="muted"><a href="/home.html">Sign in</a> to keep decks on your account. You can still play any Top 100 deck as a guest.</p>'; $('#deckCount').textContent = ''; return; }
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
async function editor(d, keep = null, openTab = 'auto') {
  const full = keep ? { name: keep.name, commander: '', list: keep.list, mat: d ? (await getDeck(d.id)).mat : 'auto' } : d ? await getDeck(d.id) : { name: '', commander: '', list: '', mat: 'auto' };
  openModal(`<h2>${d ? 'Edit deck' : 'New deck'}</h2>
  <div class="grid2"><label>Deck name<input id="edName" maxlength="40" value="${esc(full.name)}" placeholder="Krenko goblins" data-autofocus></label><label>Commander (optional)<input id="edCmd" value="${esc(keep ? keep.cmd : '')}" placeholder="Taken from the list if left blank"></label></div>
  <div class="tabs"><button type="button" class="tab" data-ed="art">Cards</button><button type="button" class="tab on" data-ed="list">List</button></div>
  <div id="edListWrap"><label>Decklist<textarea id="edList" rows="14" spellcheck="false" placeholder="Paste a Moxfield or Archidekt export, one card per line: 1 Sol Ring">${esc(full.list)}</textarea></label>
  <div class="summary" id="edSum"></div></div>
  <div id="edArt" hidden><p class="muted small">Right-click a card (or tap ⋯) to change its artwork, foil, or count. Choices are written into the list as <code>(set) number</code> and <code>*F*</code>, so Moxfield and Archidekt read them too.</p><input type="search" id="edArtQ" class="zsearch" placeholder="Filter cards…" autocomplete="off"><div id="edArtCards"></div></div>
  <div class="row" style="justify-content:space-between"><span class="muted small" id="edHint">${d ? '' : `${mine.length}/${DECK_LIMIT} decks used`}</span><span class="row"><button type="button" class="btn ghost" data-act="close">Cancel</button><button type="button" class="btn" id="edSave">${d ? 'Save changes' : 'Save deck'}</button></span></div>`, 'wide');
  const ta = $('#edList'); let names = [];
  const sum = async () => {
    const p = parseList(ta.value, $('#edCmd').value, typeOf); const st = deckStats(p, typeOf);
    const unknown = [...new Set([...p.cmd, ...p.main.map((e) => e.name)])].filter((n) => !cached(n));
    $('#edSum').innerHTML = `${p.cmd.length ? `Commander: <b>${esc(p.cmd.join(' + '))}</b>` : '<span class="bad">No commander marked</span> — add a "Commander" heading or type it above'} · ${st.total} cards · ${st.lands} lands${st.issues.filter((i) => !i.startsWith('No commander')).map((i) => ` · <span class="bad">${esc(i)}</span>`).join('')}${st.ok ? ' · <span class="good">Commander legal count ✓</span>' : ''}`;
    if (unknown.length && unknown.length <= 150 && JSON.stringify(unknown) !== JSON.stringify(names)) { names = unknown; try { await fetchCards(unknown.slice(0, 150)); sum(); } catch { /* offline */ } }
  };
  ta.oninput = () => { if (deckLink(ta.value)) { linkInTextarea(ta, (j) => { if (!$('#edName').value) $('#edName').value = j.name; }); return; } sum(); }; $('#edCmd').oninput = sum; sum();
  // ---- cards view: every card as art. Right-click (or the ⋯ menu) changes the printing in place. ----
  let entries = [];
  const artCards = async () => {
    const p = parseList(ta.value, $('#edCmd').value, typeOf);
    entries = [...p.cmd.map((n) => ({ name: n, n: 1, ...(p.cmdPrints[n] || {}), cmdr: true })), ...p.main];
    const q = ($('#edArtQ').value || '').toLowerCase();
    const want = entries.map((e) => (e.set && e.num ? { name: e.name, set: e.set, num: e.num, sfid: e.sfid || '' } : e.name));
    const need = want.filter((w) => !cached(typeof w === 'string' ? w : w.name, w.set, w.num));
    if (need.length) { try { await fetchCards(need.slice(0, 150)); } catch { /* offline */ } }
    const groups = [['Commander', entries.filter((e) => e.cmdr)], ['Deck', entries.filter((e) => !e.cmdr)]];
    $('#edArtCards').innerHTML = groups.map(([title, list]) => { const rows = list.filter((e) => !q || e.name.toLowerCase().includes(q)); if (!rows.length) return ''; return `<div class="artgroup"><div class="eyebrow">${title} · ${rows.reduce((n, e) => n + e.n, 0)}</div><div class="artcards">${rows.map((e) => { const c = cached(e.name, e.set, e.num) || {}; const idx = entries.indexOf(e);
      return `<div class="artcard ${e.foil ? 'foil' : ''} ${e.cmdr ? 'cmdr' : ''}" data-ai="${idx}" tabindex="0" title="Right-click to change the artwork">${c.img ? `<img src="${esc(c.img)}" alt="" loading="lazy" draggable="false">` : `<span class="ph">${esc(e.name)}</span>`}${e.n > 1 ? `<span class="qty">×${e.n}</span>` : ''}<button type="button" class="more" data-more="${idx}" aria-label="Card options">⋯</button><span class="cap">${esc(e.name)}<small>${e.set ? esc(e.set.toUpperCase()) + ' #' + esc(e.num) : 'default printing'}${e.foil ? ' · foil' : ''}</small></span></div>`; }).join('')}</div></div>`; }).join('') || '<p class="muted">No cards yet. Paste a list, or a deck link, in the List tab.</p>';
    $$('[data-ai]').forEach((b) => {
      b.oncontextmenu = (ev) => { ev.preventDefault(); pickArt(entries[+b.dataset.ai]); };
      b.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); cardOptions(entries[+b.dataset.ai], b); } };
      b.ondblclick = () => pickArt(entries[+b.dataset.ai]);
    });
    $$('[data-more]').forEach((b) => { b.onclick = (ev) => { ev.stopPropagation(); cardOptions(entries[+b.dataset.more], b.closest('.artcard')); }; });
  };
  const applyPrintText = (text, e, pr, foil) => text.split(/\r?\n/).map((line) => { const m = line.match(/^(\d+x?\s+)?(.+?)(\s+\([A-Za-z0-9]{2,6}\)\s+[\w★-]+)?(\s+\*[A-Za-z]\*)?\s*$/); if (!m) return line; const base = m[2].replace(/\s*\*[A-Za-z]+\*\s*/g, '').replace(/\s*\[[^\]]*\]\s*/g, ' ').trim(); if (base.toLowerCase() !== e.name.toLowerCase()) return line; return `${m[1] || ''}${base}${pr ? ` (${pr.set}) ${pr.num}` : ''}${foil ? ' *F*' : ''}`; }).join('\n');
  const setText = (text) => { ta.value = text; sum(); artCards(); };
  const changeQty = (e, d) => { const lines = ta.value.split(/\r?\n/); let done = false; const out = []; for (const line of lines) { const m = line.match(/^(\d+)x?\s+(.+)$/); const base = m ? m[2].replace(/\s*\([A-Za-z0-9]{2,6}\)\s+[\w★-]+/, '').replace(/\s*\*[A-Za-z]\*/g, '').trim() : ''; if (!done && m && base.toLowerCase() === e.name.toLowerCase()) { done = true; const n = +m[1] + d; if (n > 0) out.push(`${n} ${m[2]}`); } else out.push(line); } setText(out.join('\n')); };
  function cardOptions(e, anchor) {
    const r = anchor.getBoundingClientRect();
    const items = [{ label: 'Change artwork…', fn: () => pickArt(e) }, { label: e.foil ? 'Make it non-foil' : 'Make it foil', fn: () => setText(applyPrintText(ta.value, e, e.set ? { set: e.set, num: e.num } : null, !e.foil)) }, { sep: true }];
    if (!e.cmdr) items.push({ label: 'Add a copy', fn: () => changeQty(e, 1) }, { label: e.n > 1 ? 'Remove one copy' : 'Remove from deck', fn: () => changeQty(e, -1), danger: e.n <= 1 }, { label: 'Make it the commander', fn: () => { $('#edCmd').value = e.name; sum(); artCards(); } });
    const m = $('#edMenu'); m.innerHTML = `<div class="menu-list">${items.map((it, k) => it.sep ? '<hr>' : `<button type="button" class="mi ${it.danger ? 'danger' : ''}" data-mi="${k}">${esc(it.label)}</button>`).join('')}</div>`; m.hidden = false;
    const mw = 220; m.style.left = Math.max(8, Math.min(innerWidth - mw - 8, r.left)) + 'px'; m.style.top = Math.min(innerHeight - 220, r.bottom + 4) + 'px';
    m.onclick = (ev) => { const b = ev.target.closest('[data-mi]'); if (!b) return; m.hidden = true; items[+b.dataset.mi].fn(); };
    setTimeout(() => document.addEventListener('pointerdown', (ev) => { if (!ev.target.closest('#edMenu')) m.hidden = true; }, { once: true }), 0);
  }
  // The printing picker opens on top of the editor and writes the choice straight into the list.
  async function pickArt(e) {
    $('#edMenu').hidden = true;
    const pop = $('#modal2'); const show = (html) => { pop.innerHTML = `<div class="scrim" data-close2="1"></div><div class="mpanel wide" role="dialog" aria-modal="true">${html}</div>`; pop.hidden = false; };
    const close = () => { pop.hidden = true; pop.innerHTML = ''; };
    show(`<h2>Artwork for ${esc(e.name)}</h2><p>Loading printings from Scryfall…</p>`);
    let prints = []; try { prints = await fetchPrintings(e.name); } catch { /* offline */ }
    const cur = `${e.set}|${e.num}`;
    show(`<h2>Artwork for ${esc(e.name)}</h2><p>${prints.length} printing${prints.length === 1 ? '' : 's'} on Scryfall. Click one to use it.</p>
    <div class="artgrid">${prints.map((x, k) => `<button type="button" class="artopt ${`${x.set}|${x.num}` === cur ? 'on' : ''}" data-pr="${k}"><img src="${esc(x.img)}" alt="" loading="lazy"><span><b>${esc(x.setName)}</b><small>${esc(x.set.toUpperCase())} #${esc(x.num)} · ${esc(x.year)}${x.fullArt ? ' · full art' : ''}${x.finishes && !/nonfoil/.test(x.finishes) ? ' · foil only' : ''}</small><em>${esc(x.artist)}</em></span></button>`).join('') || '<p class="muted">Nothing found (offline?).</p>'}</div>
    <div class="row" style="justify-content:space-between"><label class="chk"><input type="checkbox" id="artFoil" ${e.foil ? 'checked' : ''}> Foil</label><span class="row"><button type="button" class="btn ghost" id="artReset">Default printing</button><button type="button" class="btn" id="artBack">Done</button></span></div>`);
    pop.querySelector('[data-close2]').onclick = close; $('#artBack').onclick = close;
    $('#artReset').onclick = () => { setText(applyPrintText(ta.value, e, null, $('#artFoil').checked)); close(); };
    $('#artFoil').onchange = (ev) => { setText(applyPrintText(ta.value, e, e.set ? { set: e.set, num: e.num } : null, ev.target.checked)); e.foil = ev.target.checked; };
    $$('[data-pr]').forEach((b) => { b.onclick = () => { const x = prints[+b.dataset.pr]; const foil = $('#artFoil').checked || !!(x.finishes && !/nonfoil/.test(x.finishes)); setText(applyPrintText(ta.value, e, { set: x.set, num: x.num }, foil)); toast(`${e.name}: ${x.setName}`); close(); }; });
  }
  $$('[data-ed]').forEach((t) => { t.onclick = () => { const v = t.dataset.ed; $$('[data-ed]').forEach((x) => x.classList.toggle('on', x === t)); $('#edListWrap').hidden = v !== 'list'; $('#edArt').hidden = v !== 'art'; if (v === 'art') artCards(); }; });
  $('#edArtQ').oninput = artCards;
  if (openTab === 'art' || (openTab === 'auto' && full.list.trim())) $('[data-ed=art]').click();
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
async function importFromUrl(prefill = '') {
  openModal(`<h2>Import from a link</h2><p>Paste an Archidekt or Moxfield deck link, like <code>https://archidekt.com/decks/1234567</code> or <code>https://moxfield.com/decks/abc123</code>. Printings and foils marked on the site come along.</p><label>Link<input id="impUrl" value="${esc(prefill)}" placeholder="https://archidekt.com/decks/… or https://moxfield.com/decks/…" data-autofocus></label><div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-act="close">Cancel</button><button type="button" class="btn" id="impGo">Import</button></div>`, 'narrow');
  $('#impGo').onclick = async () => {
    const link = deckLink($('#impUrl').value); if (!link) { toast('That doesn’t look like an Archidekt or Moxfield deck link'); return; }
    $('#impGo').disabled = true; $('#impGo').textContent = 'Importing…';
    try { const j = await fetchLinkedDeck(link); closeModal(); await editor(null); $('#edName').value = j.name; $('#edList').value = j.text; $('#edList').dispatchEvent(new Event('input')); toast(`Imported ${j.name} from ${link.site === 'moxfield' ? 'Moxfield' : 'Archidekt'}`); }
    catch (e) {
      if (e.fallback === 'paste') { closeModal(); await editor(null); $('#edName').focus(); toast(e.message, 9000); }
      else { toast('Import failed: ' + e.message, 6000); $('#impGo').disabled = false; $('#impGo').textContent = 'Import'; }
    }
  };
}
// Pasting a deck link straight into the list box imports it too.
async function linkInTextarea(ta, onDone) {
  const link = deckLink(ta.value); if (!link) return false;
  ta.disabled = true; const was = ta.value; ta.value = `Importing from ${link.site === 'moxfield' ? 'Moxfield' : 'Archidekt'}…`;
  try { const j = await fetchLinkedDeck(link); ta.value = j.text; onDone && onDone(j); }
  catch (e) { ta.value = e.fallback === 'paste' ? '' : was; toast(e.fallback === 'paste' ? e.message : 'Import failed: ' + e.message, e.fallback ? 9000 : 6000); }
  ta.disabled = false; ta.dispatchEvent(new Event('input')); return true;
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
$('#newDeck').onclick = () => editor(null); $('#importUrl').onclick = () => importFromUrl();

(async () => {
  if (online) {
    user = await currentUser();
    if (user) { const name = await displayNameFor(user); const av = localAvatar(); $('#account').innerHTML = `<a class="navlink" href="/home.html">Home</a><a class="navlink" href="/tables.html">Tables</a><a class="navlink on" href="/decks.html">Decks</a><span class="who">${av ? `<img class="pfp" src="${esc(av)}" alt="">` : `<span class="pfp init">${esc(name[0] || '?')}</span>`}${esc(name)}</span><a class="btn ghost sm" href="/home.html?account=1">Account</a>`; }
  }
  showView(location.hash === '#top' || !user ? 'top' : 'mine');
  loadMine();
})();
