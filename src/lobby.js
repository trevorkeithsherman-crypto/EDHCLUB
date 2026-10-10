import { supa, online, currentUser, signInGuest, signInEmail, signInDiscord, signOut, displayNameFor, localName, setLocalName, createRoom, openRooms, myClubs, createClub, joinClub, clubDetail, upsertProfile, listDecks, deleteDeck, lastDeckId, setLastDeckId, signUpEmail, signInPassword, resetPassword, updatePassword, upgradeGuest, myProfile, uploadAvatar, removeAvatar, localAvatar } from './supa.js';
import { startHero } from './hero.js';
import { fetchCards, cached } from './scryfall.js';
import { registerSW, install, onInstallable, isIOS } from './pwa.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
function toast(text, ms = 3200) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = text; $('#toasts').appendChild(t); setTimeout(() => t.remove(), ms); }

let user = null; let name = localName();
const PAGE = document.body.dataset.page || 'landing';
const navLinks = () => `<a class="navlink ${PAGE === 'home' ? 'on' : ''}" href="/home.html">Home</a><a class="navlink ${PAGE === 'tables' ? 'on' : ''}" href="/tables.html">Tables</a><a class="navlink" href="/decks.html">Decks</a>`;

async function refreshAccount() {
  user = await currentUser();
  if (user) { name = await displayNameFor(user); setLocalName(name); await myProfile(); }
  const nav = $('#account'); const av = localAvatar();
  nav.innerHTML = user
    ? `${navLinks()}<span class="who">${av ? `<img class="pfp" src="${esc(av)}" alt="">` : `<span class="pfp init">${esc(name[0] || '?')}</span>`}${esc(name)}${user.is_anonymous ? ' (guest)' : ''}</span><button type="button" class="btn ghost sm" data-go="signin">Account</button>`
    : `<button type="button" class="btn ghost" data-go="signin">Sign in</button><button type="button" class="btn" data-go="signup">Create account</button>`;
  renderClubs(); renderDecks(); renderPage();
}
// Page-specific chrome: the landing swaps its CTAs once you're signed in; the home page greets you.
function renderPage() {
  if (PAGE === 'landing') {
    const inn = $('#ctaIn'), out = $('#ctaOut'), note = $('#ctaNote');
    if (inn && out) { inn.hidden = !user; out.hidden = !!user; }
    if (note) note.hidden = !!user;
  }
  if (PAGE === 'home') {
    const t = $('#greetTitle'), l = $('#greetLead');
    if (t) t.textContent = user ? `Welcome back, ${name}.` : 'Welcome to EDH Club.';
    if (l) l.textContent = user ? 'Host a table, grab a seat at an open one, or work on your decks.' : 'Sign in to see your decks and clubs here. You can still host, join or practice as a guest.';
  }
}
// After signing in from the marketing page, land on the home page; elsewhere just close the panel.
function afterAuth() { if (PAGE === 'landing') { location.href = '/home.html'; return; } go('home'); }
async function renderDecks() {
  const body = $('#decksBody'); if (!body || !online) return;
  if (!user) { body.innerHTML = '<p class="muted">Sign in to keep decks on your account. Save them from the Decks button at any table; the last one you used is seated automatically next time.</p>'; return; }
  const decks = await listDecks(); const last = lastDeckId();
  body.innerHTML = decks.length ? `<ul class="list">${decks.map((d) => `<li><span><b>${esc(d.name)}</b> <small>· ${esc(d.commander || '')}${d.card_count ? ` · ${d.card_count} cards` : ''}${d.id === last ? ' · seated automatically' : ''}</small></span><span class="row">${d.id !== last ? `<button type="button" class="btn ghost sm" data-deck-use="${esc(d.id)}">Use next</button>` : ''}<button type="button" class="btn ghost sm" data-deck-del="${esc(d.id)}">Delete</button></span></li>`).join('')}</ul><p class="muted">Edit, favorite and export on the <a href="/decks.html">My decks</a> page, or load one from the Decks button at any table.</p>` : '<p class="muted">No saved decks yet. <a href="/decks.html">Create one</a>, paste a list at a table, or save one of the Top 100.</p>';
  body.querySelectorAll('[data-deck-del]').forEach((b) => { b.onclick = async () => { await deleteDeck(b.dataset.deckDel); renderDecks(); }; });
  body.querySelectorAll('[data-deck-use]').forEach((b) => { b.onclick = () => { setLastDeckId(b.dataset.deckUse); renderDecks(); }; });
}

function show(title, html) {
  $('#lobbyTitle').textContent = title; $('#lobbyBody').innerHTML = html; $('#lobby').hidden = false;
  $('#lobby').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
const nameField = () => `<label>Your name at the table<input id="nm" maxlength="24" value="${esc(name)}" placeholder="Planeswalker"></label>`;
const takeName = () => { const v = ($('#nm')?.value || '').trim(); if (v) { name = v; setLocalName(v); } return name || 'Planeswalker'; };

/* ---------- Views ---------- */
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
function viewSignIn(tab = 'signin') {
  if (!online) { show('Sign in', '<p>Accounts need the online service, which isn\u2019t configured on this build yet. Practice against bots works without it.</p>'); return; }
  if (user) return viewAccount();
  const tabs = `<div class="tabs"><button type="button" class="tab ${tab === 'signup' ? 'on' : ''}" data-tab="signup">Create account</button><button type="button" class="tab ${tab === 'signin' ? 'on' : ''}" data-tab="signin">Sign in</button><button type="button" class="tab ${tab === 'guest' ? 'on' : ''}" data-tab="guest">Play as guest</button></div>`;
  let body = '';
  if (tab === 'signup') body = `${nameField()}<div class="grid2"><label>Email<input id="em" type="email" autocomplete="email" placeholder="you@example.com"></label><label>Password<input id="pw" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters"></label></div>
    <div class="row"><button type="button" class="btn big" id="signup">Create my account</button><button type="button" class="btn ghost" id="discord">Continue with Discord</button></div>
    <p class="muted" style="margin-top:10px">Your decks, clubs and game history stay on your account across devices.</p>`;
  else if (tab === 'signin') body = `<div class="grid2"><label>Email<input id="em" type="email" autocomplete="email" placeholder="you@example.com"></label><label>Password<input id="pw" type="password" autocomplete="current-password"></label></div>
    <div class="row"><button type="button" class="btn big" id="login">Sign in</button><button type="button" class="btn ghost" id="discord">Continue with Discord</button><button type="button" class="link" id="forgot">Forgot password?</button><button type="button" class="link" id="magic">Email me a sign-in link instead</button></div>`;
  else body = `${nameField()}<p>No email needed. Your name and decks stay on this browser until you create an account; you can upgrade any time without losing them.</p><div class="row"><button type="button" class="btn big" id="guest">Continue as guest</button></div>`;
  show(tab === 'signup' ? 'Create your account' : tab === 'signin' ? 'Sign in' : 'Play as a guest', tabs + body);
  $('#lobbyBody').querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => viewSignIn(b.dataset.tab); });
  const em = () => ($('#em')?.value || '').trim().toLowerCase(); const pw = () => $('#pw')?.value || '';
  const busy = (id, on) => { const b = $('#' + id); if (b) { b.disabled = on; b.style.opacity = on ? .6 : 1; } };
  const onEnter = (id) => { $('#lobbyBody').querySelectorAll('input').forEach((i) => { i.onkeydown = (e) => { if (e.key === 'Enter') $('#' + id)?.click(); }; }); };
  if (tab === 'signup') {
    onEnter('signup');
    $('#signup').onclick = async () => {
      const n = takeName(); if (!emailOk(em())) { toast('Enter a valid email address'); $('#em').focus(); return; } if (pw().length < 8) { toast('Passwords need at least 8 characters'); $('#pw').focus(); return; }
      busy('signup', true);
      try {
        const data = await signUpEmail(em(), pw(), n);
        if (data.session) { await refreshAccount(); toast(`Welcome to EDH Club, ${n}`); afterAuth(); }
        else show('Check your email', `<p>We sent a confirmation link to <b>${esc(em())}</b>. Open it to finish creating your account, then come back and sign in.</p><div class="row"><button type="button" class="btn" data-go="signin">Sign in</button></div>`);
      } catch (e) { toast(friendlyAuthError(e), 6000); }
      busy('signup', false);
    };
  } else if (tab === 'signin') {
    onEnter('login');
    $('#login').onclick = async () => {
      if (!emailOk(em())) { toast('Enter a valid email address'); return; } if (!pw()) { toast('Enter your password'); return; }
      busy('login', true);
      try { await signInPassword(em(), pw()); await refreshAccount(); toast(`Welcome back, ${name}`); afterAuth(); } catch (e) { toast(friendlyAuthError(e), 6000); }
      busy('login', false);
    };
    $('#forgot').onclick = async () => { if (!emailOk(em())) { toast('Enter your email first, then press Forgot password'); $('#em').focus(); return; } try { await resetPassword(em()); toast('Password reset email sent'); } catch (e) { toast(friendlyAuthError(e), 6000); } };
    $('#magic').onclick = async () => { if (!emailOk(em())) { toast('Enter your email first'); $('#em').focus(); return; } try { await signInEmail(em(), name); toast('Check your email for the sign-in link'); } catch (e) { toast(friendlyAuthError(e), 6000); } };
  } else {
    $('#guest').onclick = async () => { try { await signInGuest(takeName()); await refreshAccount(); toast(`Welcome, ${name}`); afterAuth(); } catch (e) { toast('Guest sign-in is off. ' + friendlyAuthError(e), 6000); } };
  }
  const dc = $('#discord'); if (dc) dc.onclick = async () => { try { await signInDiscord(); } catch (e) { toast('Discord sign-in isn\u2019t enabled yet. ' + friendlyAuthError(e), 6000); } };
}
function friendlyAuthError(e) {
  const m = (e && e.message) || String(e);
  if (/already registered|already exists/i.test(m)) return 'That email already has an account. Try signing in, or use Forgot password.';
  if (/invalid login credentials/i.test(m)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(m)) return 'Confirm your email first; check your inbox for the link.';
  if (/anonymous sign-ins are disabled/i.test(m)) return 'Guest play is turned off right now. Create an account instead.';
  if (/rate limit/i.test(m)) return 'Too many attempts; wait a minute and try again.';
  return m;
}
function viewAccount() {
  const guest = user.is_anonymous;
  const av = localAvatar(); const discordPic = user.user_metadata?.avatar_url || user.user_metadata?.picture || '';
  show('Your account', `<div class="pfp-row">${av ? `<img class="pfp big" src="${esc(av)}" alt="Your profile picture">` : `<span class="pfp big init">${esc(name[0] || '?')}</span>`}<div><b>Profile picture</b><p class="muted">Shows on your seat at every table. ${discordPic ? 'Your Discord avatar is used until you upload one.' : 'Square images look best; we resize to 256px.'}</p><div class="row"><button type="button" class="btn ghost sm" id="pfpUp">${av ? 'Change photo' : 'Upload a photo'}</button>${av ? '<button type="button" class="btn ghost sm" id="pfpRm">Remove</button>' : ''}<input type="file" id="pfpFile" accept="image/*" hidden></div></div></div>
  ${nameField()}<div class="row"><button type="button" class="btn" id="saveName">Save name</button><button type="button" class="btn ghost" id="out">Sign out</button></div>
  ${guest ? `<hr style="border:0;border-top:1px solid rgba(36,28,18,.25);margin:18px 0"><h3 style="font:400 20px var(--f-display);margin:0 0 6px">Make this account permanent</h3><p>You\u2019re playing as a guest. Add an email and password to keep your decks, clubs and history on any device.</p>
  <div class="grid2"><label>Email<input id="em" type="email" autocomplete="email" placeholder="you@example.com"></label><label>Password<input id="pw" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters"></label></div>
  <div class="row"><button type="button" class="btn" id="upgrade">Create my account</button></div>` : `<hr style="border:0;border-top:1px solid rgba(36,28,18,.25);margin:18px 0"><h3 style="font:400 20px var(--f-display);margin:0 0 6px">Change password</h3><div class="grid2"><label>New password<input id="pw" type="password" autocomplete="new-password" minlength="8"></label></div><div class="row"><button type="button" class="btn ghost" id="chpw">Update password</button></div>`}`);
  $('#saveName').onclick = async () => { const n = takeName(); await upsertProfile(user, n); await refreshAccount(); toast('Name saved'); };
  $('#pfpUp').onclick = () => $('#pfpFile').click();
  $('#pfpFile').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; if (f.size > 8 * 1024 * 1024) { toast('That image is over 8 MB; pick a smaller one'); return; } try { await uploadAvatar(f); await refreshAccount(); viewAccount(); toast('Profile picture updated'); } catch (err) { toast(friendlyAuthError(err), 6000); } };
  const rm = $('#pfpRm'); if (rm) rm.onclick = async () => { try { await removeAvatar(); await refreshAccount(); viewAccount(); toast('Profile picture removed'); } catch (err) { toast(friendlyAuthError(err), 6000); } };
  $('#out').onclick = async () => { await signOut(); user = null; name = ''; if (PAGE !== 'landing') { location.href = '/'; return; } await refreshAccount(); go('home'); toast('Signed out'); };
  const up = $('#upgrade'); if (up) up.onclick = async () => {
    const e = $('#em').value.trim().toLowerCase(), p = $('#pw').value;
    if (!emailOk(e)) { toast('Enter a valid email address'); return; } if (p.length < 8) { toast('Passwords need at least 8 characters'); return; }
    try { await upgradeGuest(e, p, takeName()); await refreshAccount(); toast('Account created. If we sent a confirmation email, open it to finish.', 6000); go('home'); } catch (err) { toast(friendlyAuthError(err), 6000); }
  };
  const ch = $('#chpw'); if (ch) ch.onclick = async () => { const p = $('#pw').value; if (p.length < 8) { toast('Passwords need at least 8 characters'); return; } try { await updatePassword(p); toast('Password updated'); } catch (err) { toast(friendlyAuthError(err), 6000); } };
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
  <p class="muted">${online ? 'Ask the host for the five-letter code. Watching needs no seat: you see the board and the log, hands stay hidden.' : 'Joining needs the online service.'}</p><div class="row"><button type="button" class="btn big" id="go">Sit down</button><button type="button" class="btn ghost big" id="watch">Watch</button></div>`);
  $('#code').oninput = (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); };
  $('#go').onclick = () => { const n = takeName(); const code = $('#code').value.trim().toUpperCase(); if (code.length !== 5) { toast('Codes are five letters'); return; } location.href = `/table.html?room=${code}&name=${encodeURIComponent(n)}`; };
  $('#watch').onclick = () => { const n = takeName(); const code = $('#code').value.trim().toUpperCase(); if (code.length !== 5) { toast('Codes are five letters'); return; } location.href = `/table.html?room=${code}&spectate=1&name=${encodeURIComponent(n)}`; };
}

async function renderClubs() {
  const body = $('#clubsBody'); if (!body) return;
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
  const body = $('#openBody'); if (!body) return;
  if (!online) { body.innerHTML = '<p class="muted">Open tables appear here once the online service is connected.</p>'; return; }
  const all = await openRooms(); const rooms = PAGE === 'home' ? all.slice(0, 4) : all;
  const meta = $('#openMeta'); if (meta) meta.textContent = all.length ? `${all.length} table${all.length > 1 ? 's' : ''} · refreshes every 20 s` : '';
  body.innerHTML = rooms.length ? `<ul class="list">${rooms.map((r) => `<li><span><b>${esc(r.host_name || 'A planeswalker')}'s table</b> <small>· ${r.seats} seats · bracket ${r.bracket}${r.bots ? ` · ${r.bots} bot${r.bots > 1 ? 's' : ''}` : ''} · ${timeAgo(r.created_at)}</small></span><span class="row"><button type="button" class="btn ghost sm" data-watch="${esc(r.code)}">Watch</button><button type="button" class="btn sm" data-join="${esc(r.code)}">Join</button></span></li>`).join('')}</ul>` : `<p class="muted">No open tables right now. <button type="button" class="link" data-go="create">Host one</button> and share the code.</p>`;
  if (PAGE === 'home' && all.length > rooms.length) body.insertAdjacentHTML('beforeend', `<p class="muted" style="margin-top:10px"><a href="/tables.html">See all ${all.length} open tables →</a></p>`);
  body.querySelectorAll('[data-join]').forEach((b) => { b.onclick = () => { go('join'); $('#code').value = b.dataset.join; }; });
  body.querySelectorAll('[data-watch]').forEach((b) => { b.onclick = () => { const n = takeName(); location.href = `/table.html?room=${b.dataset.watch}&spectate=1&name=${encodeURIComponent(n)}`; }; });
}
const timeAgo = (iso) => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

function go(where) {
  if (where === 'home') { $('#lobby').hidden = true; return; }
  if (where === 'signin') return viewSignIn('signin');
  if (where === 'signup') return viewSignIn('signup');
  if (where === 'create') return viewCreate();
  if (where === 'join') return viewJoin();
  return undefined;
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });

(async function boot() {
  const sn = $('#svcNote'); if (sn) sn.textContent = online ? '' : 'This build isn’t connected to the online service yet, so friends can’t join; bots work.';
  if (supa) supa.auth.onAuthStateChange(() => refreshAccount());
  await refreshAccount();
  renderOpen(); if (PAGE === 'tables') setInterval(renderOpen, 20000);
  if (PAGE === 'landing' && user && new URLSearchParams(location.search).get('source') === 'pwa') { location.replace('/home.html'); return; }
  if (PAGE === 'home' && !user && online) viewSignIn('signin');
  const q = new URLSearchParams(location.search);
  if (q.get('join')) viewJoin(q.get('join').toUpperCase());
  if (q.get('watch')) { viewJoin(q.get('watch').toUpperCase()); setTimeout(() => { const b = document.getElementById('watch'); if (b) b.focus(); }, 50); }
  if (q.get('reset')) { setTimeout(async () => { await refreshAccount(); if (user) { viewAccount(); toast('Set your new password below'); } }, 800); }
  if (!user && q.get('signup') != null) viewSignIn('signup');
  if (user && q.get('account') != null) viewAccount();
})();

if (document.getElementById('heroShot')) startHero(document.getElementById('heroShot'));

// Feature cards: real art on each face, and a flip the moment a card scrolls into view (staggered by --i).
(async function featureCards() {
  const cards = [...document.querySelectorAll('.mcard')]; if (!cards.length) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const flip = (el) => { el.classList.add('flipped'); };
  if ('IntersectionObserver' in window && !reduce) {
    const io = new IntersectionObserver((es) => { es.forEach((e) => { if (e.isIntersecting) { flip(e.target); io.unobserve(e.target); } }); }, { threshold: 0.35, rootMargin: '0px 0px -8% 0px' });
    cards.forEach((c) => io.observe(c));
  } else cards.forEach(flip);
  const names = cards.map((c) => c.dataset.art).filter(Boolean);
  try { await fetchCards(names); } catch { /* placeholders stay */ }
  cards.forEach((c) => { const e = cached(c.dataset.art); const art = c.querySelector('.mc-art'); if (e && e.art) { art.style.backgroundImage = `url("${e.art}")`; const who = c.querySelector('.mc-artist'); if (who && e.artist) who.textContent = `${e.artist} (${c.dataset.art})`; } else art.classList.add('ph'); });
})();

registerSW();
// "Install app" appears only when the browser can actually do it (or on iOS, where we explain Add to Home Screen).
onInstallable((ok) => {
  let b = document.getElementById('installBtn');
  if (!ok) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('button'); b.type = 'button'; b.id = 'installBtn'; b.className = 'btn ghost sm'; b.textContent = 'Install app'; document.getElementById('account').prepend(b); }
  b.onclick = async () => { const r = await install(); if (r === 'ios') toast('In Safari: tap Share, then "Add to Home Screen" for a full-screen EDH Club.', 7000); else if (r === 'installed') toast('Installed. Find EDH Club on your home screen or in your apps.', 6000); };
});
