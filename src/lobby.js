import { supa, online, currentUser, signInGuest, signInEmail, signInDiscord, signOut, displayNameFor, localName, setLocalName, createRoom, openRooms, myClubs, createClub, joinClub, clubDetail, upsertProfile } from './supa.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
function toast(text, ms = 3200) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = text; $('#toasts').appendChild(t); setTimeout(() => t.remove(), ms); }

let user = null; let name = localName();

async function refreshAccount() {
  user = await currentUser();
  if (user) { name = await displayNameFor(user); setLocalName(name); }
  const nav = $('#account');
  nav.innerHTML = user
    ? `<span class="who">${esc(name)}${user.is_anonymous ? ' (guest)' : ''}</span><button type="button" class="btn ghost sm" data-go="signin">Account</button>`
    : `<button type="button" class="btn ghost" data-go="signin">Sign in</button>`;
  renderClubs();
}

function show(title, html) {
  $('#lobbyTitle').textContent = title; $('#lobbyBody').innerHTML = html; $('#lobby').hidden = false;
  $('#lobby').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
const nameField = () => `<label>Your name at the table<input id="nm" maxlength="24" value="${esc(name)}" placeholder="Planeswalker"></label>`;
const takeName = () => { const v = ($('#nm')?.value || '').trim(); if (v) { name = v; setLocalName(v); } return name || 'Planeswalker'; };

/* ---------- Views ---------- */
function viewSignIn() {
  if (!online) { show('Sign in', '<p>Sign-in needs the online service, which isn’t configured on this build yet. Practice against bots works without it.</p>'); return; }
  if (user) {
    show('Your account', `${nameField()}<div class="row"><button type="button" class="btn" id="saveName">Save name</button><button type="button" class="btn ghost" id="out">Sign out</button></div>${user.is_anonymous ? '<p style="margin-top:12px">You’re playing as a guest. Add an email to keep your clubs and history across devices.</p><label>Email<input id="em" type="email" placeholder="you@example.com"></label><div class="row"><button type="button" class="btn ghost" id="link">Send sign-in link</button></div>' : ''}`);
    $('#saveName').onclick = async () => { const n = takeName(); await upsertProfile(user, n); await refreshAccount(); toast('Name saved'); };
    $('#out').onclick = async () => { await signOut(); await refreshAccount(); go('home'); };
    const link = $('#link'); if (link) link.onclick = async () => { try { await signInEmail($('#em').value.trim(), takeName()); toast('Check your email for the sign-in link'); } catch (e) { toast(e.message); } };
    return;
  }
  show('Sign in', `${nameField()}<div class="grid2"><div><p><b>Quick start.</b> No email needed. Your name and clubs stay in this browser.</p><button type="button" class="btn" id="guest">Continue as guest</button></div>
  <div><p><b>Keep it forever.</b> We email you a sign-in link; no password.</p><label>Email<input id="em" type="email" placeholder="you@example.com"></label><div class="row"><button type="button" class="btn ghost" id="email">Send link</button><button type="button" class="btn ghost" id="discord">Discord</button></div></div></div>`);
  $('#guest').onclick = async () => { try { await signInGuest(takeName()); await refreshAccount(); toast(`Welcome, ${name}`); go('home'); } catch (e) { toast('Guest sign-in is off. ' + e.message, 6000); } };
  $('#email').onclick = async () => { try { await signInEmail($('#em').value.trim(), takeName()); toast('Check your email for the sign-in link'); } catch (e) { toast(e.message); } };
  $('#discord').onclick = async () => { try { await signInDiscord(); } catch (e) { toast('Discord sign-in isn’t enabled yet. ' + e.message, 6000); } };
}

function viewCreate() {
  show('Host a table', `${nameField()}<div class="grid2"><label>Seats<select id="seats"><option value="4">4 players</option><option value="3">3 players</option><option value="2">2 players</option></select></label>
  <label>Fill empty seats with bots<select id="bots"><option value="0">No bots</option><option value="1">1 bot</option><option value="2">2 bots</option><option value="3">3 bots</option></select></label>
  <label>Bracket<select id="bracket"><option value="1">1 · Exhibition</option><option value="2">2 · Core</option><option value="3" selected>3 · Upgraded</option><option value="4">4 · Optimized</option><option value="5">5 · cEDH</option></select></label>
  <label>Listing<select id="pub"><option value="1">Public, anyone can join</option><option value="0">Private, code only</option></select></label></div>
  <p class="muted">${online ? (user ? '' : 'You’ll be seated as a guest. Sign in first to attach the game to a club.') : 'Online tables need the service; this build will seat bots only.'}</p>
  <div class="row"><button type="button" class="btn big" id="go">Open the table</button></div>`);
  $('#go').onclick = async () => {
    const n = takeName(); const seats = +$('#seats').value; let bots = Math.min(+$('#bots').value, seats - 1); const bracket = +$('#bracket').value; const isPublic = $('#pub').value === '1';
    if (!online) { location.href = `/table.html?mode=bots&name=${encodeURIComponent(n)}&seats=${seats}&bots=${Math.max(1, bots)}`; return; }
    try {
      if (!user) { await signInGuest(n); await refreshAccount(); }
      const code = await createRoom({ hostId: user.id, hostName: n, seats, bots, bracket });
      if (!isPublic) await supa.from('rooms').update({ is_public: false }).eq('code', code);
      location.href = `/table.html?room=${code}&host=1&name=${encodeURIComponent(n)}&seats=${seats}&bots=${bots}`;
    } catch (e) { toast('Could not open a table: ' + e.message, 6000); }
  };
}

function viewJoin(prefill = '') {
  show('Join a table', `${nameField()}<label>Table code<input id="code" maxlength="5" value="${esc(prefill)}" placeholder="ABCDE" style="font-family:var(--f-display);letter-spacing:.18em;font-size:22px;text-transform:uppercase"></label>
  <p class="muted">${online ? 'Ask the host for the five-letter code.' : 'Joining needs the online service.'}</p><div class="row"><button type="button" class="btn big" id="go">Sit down</button></div>`);
  $('#code').oninput = (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); };
  $('#go').onclick = () => { const n = takeName(); const code = $('#code').value.trim().toUpperCase(); if (code.length !== 5) { toast('Codes are five letters'); return; } location.href = `/table.html?room=${code}&name=${encodeURIComponent(n)}`; };
}

async function renderClubs() {
  const body = $('#clubsBody');
  if (!online) { body.innerHTML = '<p class="muted">Clubs need the online service.</p>'; return; }
  if (!user) { body.innerHTML = '<p class="muted">Sign in to create or join a club.</p><div class="row"><button type="button" class="btn ghost" data-go="signin">Sign in</button></div>'; return; }
  const clubs = await myClubs(user.id);
  body.innerHTML = `${clubs.length ? `<ul class="list">${clubs.map((c) => `<li><span><b>${esc(c.name)}</b> <small>· code ${esc(c.code)}</small></span><span class="row"><button type="button" class="btn sm" data-club-table="${esc(c.id)}">Host a club table</button><button type="button" class="btn ghost sm" data-club="${esc(c.id)}">Details</button></span></li>`).join('')}</ul>` : '<p class="muted">You’re not in a club yet.</p>'}
  <div class="grid2" style="margin-top:14px"><div><label>Start a club<input id="clubName" maxlength="40" placeholder="Tuesday Night Pod"></label><button type="button" class="btn ghost" id="mkClub">Create</button></div>
  <div><label>Join with a club code<input id="clubCode" maxlength="5" placeholder="ABCDE" style="text-transform:uppercase"></label><button type="button" class="btn ghost" id="jnClub">Join</button></div></div><div id="clubDetail"></div>`;
  $('#mkClub').onclick = async () => { const n = $('#clubName').value.trim(); if (!n) return; try { await createClub(user.id, n); toast('Club created'); renderClubs(); } catch (e) { toast(e.message); } };
  $('#jnClub').onclick = async () => { try { const c = await joinClub(user.id, $('#clubCode').value.trim()); toast(`Joined ${c.name}`); renderClubs(); } catch (e) { toast(e.message); } };
  body.querySelectorAll('[data-club]').forEach((b) => { b.onclick = async () => {
    const d = await clubDetail(b.dataset.club);
    const wins = {}; d.games.forEach((g) => { if (g.winner_name) wins[g.winner_name] = (wins[g.winner_name] || 0) + 1; });
    $('#clubDetail').innerHTML = `<h3 style="font:400 18px var(--f-display);margin:16px 0 6px">Members</h3><p>${d.members.map((m) => esc(m.profile?.display_name || 'Planeswalker') + (m.role === 'owner' ? ' (owner)' : '')).join(', ') || 'Nobody yet'}</p>
    <h3 style="font:400 18px var(--f-display);margin:12px 0 6px">Win board</h3>${Object.keys(wins).length ? `<table class="tbl"><tr><th>Player</th><th>Wins</th></tr>${Object.entries(wins).sort((a, b) => b[1] - a[1]).map(([n, w]) => `<tr><td>${esc(n)}</td><td>${w}</td></tr>`).join('')}</table>` : '<p class="muted">No games recorded yet. Finish a club table and it lands here.</p>'}
    ${d.games.length ? `<h3 style="font:400 18px var(--f-display);margin:12px 0 6px">Recent games</h3><table class="tbl"><tr><th>When</th><th>Winner</th><th>Players</th><th>Rounds</th></tr>${d.games.map((g) => `<tr><td>${new Date(g.ended_at).toLocaleDateString()}</td><td>${esc(g.winner_name)}</td><td>${esc((g.players || []).map((p) => p.name).join(', '))}</td><td>${g.rounds ?? ''}</td></tr>`).join('')}</table>` : ''}`;
  }; });
  body.querySelectorAll('[data-club-table]').forEach((b) => { b.onclick = async () => {
    try { const code = await createRoom({ hostId: user.id, hostName: name, seats: 4, bots: 0, bracket: 3 }); await supa.from('rooms').update({ club_id: b.dataset.clubTable }).eq('code', code); location.href = `/table.html?room=${code}&host=1&name=${encodeURIComponent(name)}&seats=4&bots=0&club=${b.dataset.clubTable}`; } catch (e) { toast(e.message); }
  }; });
}

async function renderOpen() {
  const body = $('#openBody');
  if (!online) { body.innerHTML = '<p class="muted">Open tables appear here once the online service is connected.</p>'; return; }
  const rooms = await openRooms();
  body.innerHTML = rooms.length ? `<ul class="list">${rooms.map((r) => `<li><span><b>${esc(r.host_name || 'A planeswalker')}'s table</b> <small>· ${r.seats} seats · bracket ${r.bracket}${r.bots ? ` · ${r.bots} bot${r.bots > 1 ? 's' : ''}` : ''} · ${timeAgo(r.created_at)}</small></span><button type="button" class="btn sm" data-join="${esc(r.code)}">Join</button></li>`).join('')}</ul>` : '<p class="muted">No open tables right now. Host one and share the code.</p>';
  body.querySelectorAll('[data-join]').forEach((b) => { b.onclick = () => { go('join'); $('#code').value = b.dataset.join; }; });
}
const timeAgo = (iso) => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

function go(where) {
  if (where === 'home') { $('#lobby').hidden = true; return; }
  if (where === 'signin') return viewSignIn();
  if (where === 'create') return viewCreate();
  if (where === 'join') return viewJoin();
  return undefined;
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });

(async function boot() {
  $('#svcNote').textContent = online ? '' : 'This build isn’t connected to the online service yet, so friends can’t join; bots work.';
  if (supa) supa.auth.onAuthStateChange(() => refreshAccount());
  await refreshAccount();
  renderOpen();
  const q = new URLSearchParams(location.search);
  if (q.get('join')) viewJoin(q.get('join').toUpperCase());
})();
