// Profile: the stats tracker. Everything here is computed in the browser from game_players rows (one per seat per
// finished game) joined to their games, so adding a stat is a function of those rows, not a schema change.
import { myGames, gameOpponents, listDecks, localAvatar } from './supa.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const fmt1 = (x) => (x == null ? '—' : (Math.round(x * 10) / 10).toString());
const METHOD = { combat: 'Combat damage', commander: 'Commander damage', combo: 'Combo', poison: 'Poison', alt: 'Alternate win', other: 'Other', concede: 'Concession' };
const ORD = ['1st', '2nd', '3rd', '4th'];
const when = (iso) => { const d = new Date(iso); const days = (Date.now() - d) / 86400000; return days < 1 ? 'today' : days < 2 ? 'yesterday' : days < 7 ? `${Math.floor(days)} days ago` : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };

/* ---------- the numbers ---------- */
export function computeStats(rows) {
  // rows: game_players rows for one player, each with .game
  const games = rows.length; const wins = rows.filter((r) => r.placement === 1);
  const winTurns = wins.map((r) => r.game.turns).filter((t) => t != null && t > 0);
  const sorted = rows.slice().sort((a, b) => new Date(a.game.ended_at) - new Date(b.game.ended_at));
  let streak = 0, best = 0, cur = 0;
  sorted.forEach((r) => { if (r.placement === 1) { cur++; best = Math.max(best, cur); } else cur = 0; }); streak = cur;
  const bySeat = {}; rows.forEach((r) => { const k = r.turn_order || (r.seat != null ? r.seat + 1 : 0); if (!k) return; bySeat[k] = bySeat[k] || { n: 0, w: 0 }; bySeat[k].n++; if (r.placement === 1) bySeat[k].w++; });
  const byMull = {}; rows.forEach((r) => { const k = Math.min(r.mulligans || 0, 3); byMull[k] = byMull[k] || { n: 0, w: 0 }; byMull[k].n++; if (r.placement === 1) byMull[k].w++; });
  const methods = {}; wins.forEach((r) => { const m = r.game.win_method || 'other'; methods[m] = (methods[m] || 0) + 1; });
  const outHow = {}; rows.filter((r) => r.placement !== 1 && r.eliminated_how).forEach((r) => { outHow[r.eliminated_how] = (outHow[r.eliminated_how] || 0) + 1; });
  const places = {}; rows.forEach((r) => { if (r.placement) places[r.placement] = (places[r.placement] || 0) + 1; });
  const byPlayers = {}; rows.forEach((r) => { const k = r.game.seats || 0; if (!k) return; byPlayers[k] = byPlayers[k] || { n: 0, w: 0 }; byPlayers[k].n++; if (r.placement === 1) byPlayers[k].w++; });
  const decks = {};
  rows.forEach((r) => { const key = r.deck_id || `name:${r.deck_name || r.commander || '?'}`; const d = decks[key] = decks[key] || { key, deck_id: r.deck_id, name: r.deck_name || r.commander || 'Unnamed deck', commander: r.commander || '', colors: r.colors || '', n: 0, w: 0, turns: [], places: [], kills: 0, last: null, fastest: null };
    d.n++; if (r.placement === 1) { d.w++; if (r.game.turns) { d.turns.push(r.game.turns); d.fastest = d.fastest == null ? r.game.turns : Math.min(d.fastest, r.game.turns); } } if (r.placement) d.places.push(r.placement); d.kills += r.kills || 0; if (!d.last || new Date(r.game.ended_at) > new Date(d.last)) d.last = r.game.ended_at; if (!d.commander && r.commander) d.commander = r.commander; });
  const deckList = Object.values(decks).map((d) => ({ ...d, winRate: pct(d.w, d.n), avgTurns: avg(d.turns), avgPlace: avg(d.places) })).sort((a, b) => b.n - a.n || b.winRate - a.winRate);
  return {
    games, wins: wins.length, losses: games - wins.length, winRate: pct(wins.length, games),
    avgTurnsToWin: avg(winTurns), fastestWin: winTurns.length ? Math.min(...winTurns) : null, avgTurns: avg(rows.map((r) => r.game.turns).filter(Boolean)),
    avgPlace: avg(rows.map((r) => r.placement).filter(Boolean)), kills: rows.reduce((a, r) => a + (r.kills || 0), 0), killsPerGame: games ? rows.reduce((a, r) => a + (r.kills || 0), 0) / games : 0,
    dmg: rows.reduce((a, r) => a + (r.dmg_dealt || 0), 0), cmdDmg: rows.reduce((a, r) => a + (r.cmd_dmg_dealt || 0), 0), mulls: rows.reduce((a, r) => a + (r.mulligans || 0), 0),
    streak, bestStreak: best, bySeat, byMull, methods, outHow, places, byPlayers, decks: deckList,
    minutes: Math.round(rows.reduce((a, r) => a + (r.game.duration_s || 0), 0) / 60),
    firstOut: rows.filter((r) => r.game.seats > 2 && r.placement === r.game.seats).length,
    mostPlayed: deckList[0] || null, bestDeck: deckList.filter((d) => d.n >= 3).sort((a, b) => b.winRate - a.winRate)[0] || null,
    fastestDeck: deckList.filter((d) => d.fastest != null).sort((a, b) => a.fastest - b.fastest)[0] || null,
  };
}
export function rivalry(rows, others, me) {
  // who eliminated me most, and who I eliminated most, by name (bots count too; they are honest rivals)
  const bySeatInGame = {}; others.forEach((o) => { bySeatInGame[`${o.game_id}:${o.seat}`] = o; });
  const killedMeBy = {}, iKilled = {};
  rows.forEach((r) => { if (r.placement !== 1 && r.eliminated_by_seat != null) { const k = bySeatInGame[`${r.game.id}:${r.eliminated_by_seat}`]; if (k && k.user_id !== me) killedMeBy[k.name] = (killedMeBy[k.name] || 0) + 1; } });
  others.forEach((o) => { if (o.user_id === me) return; const mine = rows.find((r) => r.game.id === o.game_id); if (mine && o.eliminated_by_seat === mine.seat) iKilled[o.name] = (iKilled[o.name] || 0) + 1; });
  const top = (m) => Object.entries(m).sort((a, b) => b[1] - a[1])[0] || null;
  return { nemesis: top(killedMeBy), victim: top(iKilled) };
}

/* ---------- the page ---------- */
let all = []; let filter = 'all'; let sortKey = 'n'; let sortDir = -1; let others = []; let meId = null; let viewing = null;
const bar = (label, w, n, hint) => `<div class="sbar"><span class="sbar-l">${esc(label)}</span><span class="sbar-t"><i style="width:${pct(w, n)}%"></i></span><span class="sbar-v">${n ? `${pct(w, n)}%` : '—'} <small>${hint || `${w}/${n}`}</small></span></div>`;
const tile = (v, l, sub) => `<div class="stile"><b>${v}</b><span>${esc(l)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
function rowsNow() { return all.filter((r) => filter === 'all' || (filter === 'people' ? !r.game.vs_bots : r.game.vs_bots)); }
function renderStats() {
  const root = $('#statsRoot'); const rows = rowsNow(); const st = computeStats(rows); const rv = rivalry(rows, others, meId);
  const chips = [['all', `All games (${all.length})`], ['people', `With people (${all.filter((r) => !r.game.vs_bots).length})`], ['bots', `Practice vs bots (${all.filter((r) => r.game.vs_bots).length})`]].map(([k, l]) => `<button type="button" class="chipbtn ${filter === k ? 'on' : ''}" data-filter="${k}">${l}</button>`).join('');
  if (!all.length) { root.innerHTML = `<div class="panel"><h2>No games yet</h2><p>Finish a game at any table (even practice against the bots) and it lands here: your win rate, how fast you close out games, your best seat and which deck carries you.</p><a class="btn" href="/home.html">Host a table</a></div>`; return; }
  const deckCols = [['name', 'Deck'], ['n', 'Games'], ['w', 'Wins'], ['winRate', 'Win %'], ['avgTurns', 'Avg turns to win'], ['fastest', 'Fastest'], ['avgPlace', 'Avg finish'], ['kills', 'KOs'], ['last', 'Last played']];
  const decks = st.decks.slice().sort((a, b) => { const va = a[sortKey], vb = b[sortKey]; if (va == null) return 1; if (vb == null) return -1; return (va > vb ? 1 : va < vb ? -1 : 0) * sortDir * (typeof va === 'string' ? -1 : 1); });
  root.innerHTML = `
  <div class="filters sfilters">${chips}</div>
  <section class="stiles">
    ${tile(`${st.winRate}%`, 'Win rate', `${st.wins}–${st.losses} in ${st.games} game${st.games === 1 ? '' : 's'}`)}
    ${tile(fmt1(st.avgTurnsToWin), 'Avg turns to win', st.fastestWin ? `fastest: ${st.fastestWin}` : 'no wins yet')}
    ${tile(fmt1(st.avgPlace), 'Avg finish', st.firstOut ? `first out ${st.firstOut}×` : 'never first out')}
    ${tile(fmt1(st.killsPerGame), 'KOs per game', `${st.kills} total`)}
    ${tile(st.streak ? `${st.streak}` : '0', 'Win streak', `best ${st.bestStreak}`)}
    ${tile(fmt1(st.avgTurns), 'Avg game length', `${st.minutes} min at the table`)}
  </section>
  <section class="sgrid">
    <div class="panel"><div class="panel-h"><h2>Win rate by seat</h2><span class="muted small">turn order</span></div>${[1, 2, 3, 4].map((k) => bar(`Seat ${k}`, st.bySeat[k]?.w || 0, st.bySeat[k]?.n || 0)).join('')}</div>
    <div class="panel"><div class="panel-h"><h2>How you win</h2><span class="muted small">${st.wins} win${st.wins === 1 ? '' : 's'}</span></div>${Object.keys(METHOD).filter((m) => st.methods[m]).map((m) => bar(METHOD[m], st.methods[m], st.wins)).join('') || '<p class="muted">No wins recorded yet.</p>'}</div>
    <div class="panel"><div class="panel-h"><h2>Win rate by mulligans</h2></div>${[0, 1, 2, 3].filter((k) => st.byMull[k]).map((k) => bar(k === 3 ? '3+' : `${k}`, st.byMull[k].w, st.byMull[k].n)).join('')}</div>
    <div class="panel"><div class="panel-h"><h2>Finishes</h2></div>${[1, 2, 3, 4].filter((k) => st.places[k]).map((k) => bar(ORD[k - 1], st.places[k], st.games)).join('')}</div>
    <div class="panel"><div class="panel-h"><h2>How you go out</h2></div>${Object.entries(st.outHow).sort((a, b) => b[1] - a[1]).map(([h, n]) => bar({ combat: 'Combat damage', commander: 'Commander damage', poison: 'Poison', burn: 'Burn / drain', life: 'Life loss', concede: 'Concession' }[h] || h, n, st.games - st.wins)).join('') || '<p class="muted">Never eliminated. Keep it up.</p>'}</div>
    <div class="panel"><div class="panel-h"><h2>Rivals</h2></div><p><b>Nemesis:</b> ${rv.nemesis ? `${esc(rv.nemesis[0])} knocked you out ${rv.nemesis[1]}×` : 'nobody yet'}</p><p><b>Favorite target:</b> ${rv.victim ? `you knocked out ${esc(rv.victim[0])} ${rv.victim[1]}×` : 'nobody yet'}</p><p class="muted small">${st.byPlayers[4] ? `4-player pods: ${pct(st.byPlayers[4].w, st.byPlayers[4].n)}% (${st.byPlayers[4].n})` : ''} ${st.byPlayers[3] ? `· 3-player: ${pct(st.byPlayers[3].w, st.byPlayers[3].n)}% (${st.byPlayers[3].n})` : ''} ${st.byPlayers[2] ? `· 1v1: ${pct(st.byPlayers[2].w, st.byPlayers[2].n)}% (${st.byPlayers[2].n})` : ''}</p></div>
  </section>
  <section class="panel"><div class="panel-h"><h2>Decks</h2><span class="muted small">${st.mostPlayed ? `Most played: ${esc(st.mostPlayed.name)}` : ''}${st.bestDeck ? ` · Best: ${esc(st.bestDeck.name)} (${st.bestDeck.winRate}%)` : ''}${st.fastestDeck ? ` · Fastest: ${esc(st.fastestDeck.name)} (${st.fastestDeck.fastest} turns)` : ''}</span></div>
    <div class="tscroll"><table class="stab" id="deckStats"><thead><tr>${deckCols.map(([k, l]) => `<th data-sort="${k}" class="${sortKey === k ? 'on' : ''}">${l}${sortKey === k ? (sortDir < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead>
    <tbody>${decks.map((d) => `<tr><td><b>${esc(d.name)}</b>${d.commander && d.commander !== d.name ? `<br><small class="muted">${esc(d.commander)}</small>` : ''}</td><td>${d.n}</td><td>${d.w}</td><td><span class="wr ${d.winRate >= 50 ? 'hi' : d.winRate >= 25 ? 'mid' : 'lo'}">${d.winRate}%</span></td><td>${fmt1(d.avgTurns)}</td><td>${d.fastest ?? '—'}</td><td>${fmt1(d.avgPlace)}</td><td>${d.kills}</td><td>${d.last ? when(d.last) : '—'}</td></tr>`).join('')}</tbody></table></div></section>
  <section class="panel"><div class="panel-h"><h2>Recent games</h2></div><ul class="glist">${rows.slice(0, 25).map((r) => { const opp = others.filter((o) => o.game_id === r.game.id && o.seat !== r.seat); return `<li class="${r.placement === 1 ? 'won' : ''}"><span class="gpl">${ORD[(r.placement || 4) - 1]}</span><span><b>${esc(r.deck_name || r.commander || 'Unknown deck')}</b> <small class="muted">· ${r.game.seats || opp.length + 1} players · ${r.game.turns || '?'} turns${r.placement === 1 && r.game.win_method ? ` · won by ${METHOD[r.game.win_method] || r.game.win_method}` : ''}${r.placement !== 1 && r.eliminated_how ? ` · out on turn ${r.eliminated_turn ?? '?'}` : ''}${r.game.vs_bots ? ' · practice' : ''}</small><br><small class="muted">vs ${esc(opp.map((o) => o.name).join(', ') || '—')}</small></span><span class="muted small">${when(r.game.ended_at)}</span></li>`; }).join('')}</ul></section>`;
  root.querySelectorAll('[data-filter]').forEach((b) => { b.onclick = () => { filter = b.dataset.filter; renderStats(); }; });
  root.querySelectorAll('[data-sort]').forEach((th) => { th.onclick = () => { const k = th.dataset.sort; if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = -1; } renderStats(); }; });
}
export async function render(user, name) {
  const q = new URLSearchParams(location.search); viewing = q.get('u') || (user && user.id) || null; meId = viewing;
  const head = $('#profName'); const cta = $('#profCta');
  if (!viewing) { head.textContent = 'Your stats'; $('#statsRoot').innerHTML = '<div class="panel"><h2>Sign in to see your stats</h2><p>Your games are recorded against your account, so sign in (a guest account works) and every finished game shows up here.</p><button type="button" class="btn" data-go="signin">Sign in</button></div>'; cta.innerHTML = ''; return; }
  const mine = !q.get('u') || (user && q.get('u') === user.id);
  cta.innerHTML = mine ? `<a class="btn big ghost" href="/home.html?account=1">Edit account</a><a class="btn big ghost" href="/decks.html">My decks</a>` : '';
  const av = mine ? localAvatar() : '';
  all = await myGames(viewing); others = await gameOpponents([...new Set(all.map((r) => r.game.id))]);
  const shown = mine ? name : (all[0]?.name || 'Planeswalker');
  head.innerHTML = `${av ? `<img class="pfp big" src="${esc(av)}" alt="">` : ''}${esc(shown)}`;
  $('#profLead').textContent = mine ? 'Every game you finish at an EDH Club table is recorded here: how you win, how fast, which seat and which deck.' : `${shown}'s record at EDH Club tables.`;
  if (mine && all.length) { try { const decks = await listDecks(); all.forEach((r) => { const d = decks.find((x) => x.id === r.deck_id); if (d) r.deck_name = d.name; }); } catch { /* fine */ } }
  renderStats();
}
