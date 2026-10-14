// Tournaments: pods vs pods. Everyone can see the list and a bracket; signed-in players can form a pod and sign up
// while an event is open; only site admins (app_admins) can create events, open sign-ups, start rounds and record results.
import { isAdmin, listTournaments, getTournament, createTournament, updateTournament, deleteTournament, setInterest, createPod, joinPodByCode, joinTournament, leaveTournament, updateMember, adminSetMemberPod, adminCreatePod, adminDeletePod, adminSetPodWinner, createMatch, updateMatch, deleteMatch, listDecks, gamesInRoom, currentUser } from './supa.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
function toast(text, ms = 3200) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = text; $('#toasts').appendChild(t); setTimeout(() => t.remove(), ms); }
const STATUS = { coming_soon: ['Coming soon', 'soon'], open: ['Sign-ups open', 'open'], running: ['In progress', 'live'], finished: ['Finished', 'done'] };
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 48) || 'event';
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Date to be announced');

let user = null; let name = ''; let admin = false; let decks = [];

export async function render(u, n) {
  user = u; name = n; admin = u ? await isAdmin() : false;
  if (user) { try { decks = await listDecks(); } catch { decks = []; } }
  const slug = new URLSearchParams(location.search).get('t');
  if (slug) await renderDetail(slug); else await renderList();
}

/* ---------- list ---------- */
async function renderList() {
  const root = $('#tournRoot'); const list = await listTournaments();
  const card = (t) => { const [label, cls] = STATUS[t.status] || STATUS.coming_soon; return `<a class="tcard ${cls}" href="/tournaments.html?t=${esc(t.slug)}"><span class="tstatus ${cls}">${label}</span><h2>${esc(t.name)}</h2><p>${esc(t.description || '')}</p><span class="tmeta">${t.status === 'finished' && t.champion_name ? `Champion: ${esc(t.champion_name)}` : fmtDate(t.starts_at)} · pods of ${t.pod_size}</span></a>`; };
  root.innerHTML = `
    ${admin ? adminCreateHTML() : ''}
    <section class="tgrid" id="tList">${list.length ? list.map(card).join('') : '<div class="panel"><h2>No tournaments yet</h2><p>The first one is being set up. Check back soon.</p></div>'}</section>
    <section class="panel thow"><div class="panel-h"><h2>How it works</h2></div><ol class="steps">
      <li><h3>Form your pod</h3><p>One player creates a pod and shares its code; up to four sit down together. Solo? Sign up as a free agent and we'll seat you in a pod.</p></li>
      <li><h3>Pod round</h3><p>Each pod plays one Commander game at its own EDH Club table. The last player standing is the pod's champion.</p></li>
      <li><h3>Final table</h3><p>The pod champions meet at one table. The winner takes the title, and their pod takes the banner.</p></li></ol></section>`;
  if (admin) bindAdminCreate();
}
function adminCreateHTML() {
  return `<section class="panel admin"><div class="panel-h"><h2>Admin · New tournament</h2><span class="muted small">Only admins see this</span></div>
    <div class="grid2"><label>Name<input id="tnName" maxlength="60" placeholder="EDH Club Open — Season 2"></label><label>Starts (optional)<input id="tnDate" type="datetime-local"></label>
    <label>Pod size<select id="tnPod"><option value="4">4 players</option><option value="3">3 players</option><option value="2">2 players</option></select></label><label>Bracket<select id="tnBracket"><option value="1">1 · Exhibition</option><option value="2">2 · Core</option><option value="3" selected>3 · Upgraded</option><option value="4">4 · Optimized</option><option value="5">5 · cEDH</option></select></label></div>
    <label>Description<input id="tnDesc" maxlength="300" placeholder="What players should know"></label>
    <div class="row"><button type="button" class="btn" id="tnCreate">Create (coming soon)</button></div></section>`;
}
function bindAdminCreate() {
  $('#tnCreate').onclick = async () => {
    const nm = $('#tnName').value.trim(); if (!nm) { toast('Give it a name'); return; }
    try { const t = await createTournament({ name: nm, slug: `${slugify(nm)}-${Math.random().toString(36).slice(2, 6)}`, description: $('#tnDesc').value.trim(), starts_at: $('#tnDate').value ? new Date($('#tnDate').value).toISOString() : null, pod_size: +$('#tnPod').value, bracket: +$('#tnBracket').value }); location.href = `/tournaments.html?t=${t.slug}`; } catch (e) { toast(e.message); }
  };
}

/* ---------- detail ---------- */
let T = null;
async function renderDetail(slug) {
  const root = $('#tournRoot'); T = await getTournament(slug);
  if (!T) { root.innerHTML = '<div class="panel"><h2>Not found</h2><p>That tournament doesn\'t exist (or was removed).</p><a class="btn ghost" href="/tournaments.html">All tournaments</a></div>'; return; }
  const [label, cls] = STATUS[T.status] || STATUS.coming_soon;
  const me = user ? T.members.find((m) => m.user_id === user.id) : null; const myPod = me && me.pod_id ? T.pods.find((p) => p.id === me.pod_id) : null;
  const podMembers = (pid) => T.members.filter((m) => m.pod_id === pid);
  const freeAgents = T.members.filter((m) => !m.pod_id);
  const interested = user && T.interest.includes(user.id);
  const podCard = (p) => { const ms = podMembers(p.id); return `<div class="pod ${myPod && myPod.id === p.id ? 'mine' : ''} ${T.champion_pod_id === p.id ? 'champ' : ''}"><div class="pod-h"><b>${esc(p.name)}</b><span class="muted small">${ms.length}/${T.pod_size}${p.winner_id ? ` · champion: ${esc((T.members.find((m) => m.user_id === p.winner_id) || {}).display_name || '?')}` : ''}</span></div><ul>${ms.map((m) => `<li>${esc(m.display_name || 'Planeswalker')}${m.user_id === p.captain_id ? ' <small class="muted">captain</small>' : ''}${m.commander ? ` <small class="muted">· ${esc(m.commander)}</small>` : ''}${p.winner_id === m.user_id ? ' 🏆' : ''}</li>`).join('')}${Array.from({ length: Math.max(0, T.pod_size - ms.length) }, () => '<li class="muted">open seat</li>').join('')}</ul>${myPod && myPod.id === p.id ? `<p class="muted small">Pod code: <b class="code">${esc(p.join_code)}</b> — share it with your pod.</p>` : ''}</div>`; };
  const deckSel = (cur) => `<select id="myDeck"><option value="">Pick your deck…</option>${decks.map((d) => `<option value="${d.id}" ${cur === d.id ? 'selected' : ''}>${esc(d.name)}${d.commander ? ` — ${esc(d.commander)}` : ''}</option>`).join('')}</select>`;
  let signup = '';
  if (T.status === 'coming_soon') signup = `<div class="panel"><div class="panel-h"><h2>Sign-ups aren't open yet</h2></div><p>${T.starts_at ? `Planned for ${esc(fmtDate(T.starts_at))}.` : 'The date is being set.'} Tap Notify me and this page will show first when sign-ups open.</p>${user ? `<button type="button" class="btn ${interested ? 'ghost' : ''}" id="notify">${interested ? 'You\'ll be notified ✓' : 'Notify me'}</button> <span class="muted small">${T.interest.length} interested</span>` : '<button type="button" class="btn" data-go="signin">Sign in to get notified</button>'}</div>`;
  else if (T.status === 'open') {
    if (!user) signup = '<div class="panel"><h2>Sign-ups are open</h2><p>Sign in to create or join a pod.</p><button type="button" class="btn" data-go="signin">Sign in</button></div>';
    else if (!me) signup = `<div class="panel"><div class="panel-h"><h2>Sign up</h2><span class="muted small">pods of ${T.pod_size}</span></div><div class="grid2">
      <div><h3>Create a pod</h3><label>Pod name<input id="podName" maxlength="32" placeholder="The Tuesday Pod"></label><label>Your deck${deckSel('')}</label><button type="button" class="btn" id="podCreate">Create pod</button></div>
      <div><h3>Join a pod</h3><label>Pod code<input id="podCode" maxlength="6" placeholder="ABC123" style="text-transform:uppercase"></label><label>Your deck<select id="myDeck2"><option value="">Pick your deck…</option>${decks.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></label><button type="button" class="btn ghost" id="podJoin">Join pod</button><p class="muted small" style="margin-top:10px">No pod? <button type="button" class="link" id="soloJoin">Sign up as a free agent</button> and we'll seat you.</p></div></div></div>`;
    else signup = `<div class="panel"><div class="panel-h"><h2>You're in${myPod ? `: ${esc(myPod.name)}` : ' as a free agent'}</h2><button type="button" class="link" id="leave">Leave</button></div><label>Your deck${deckSel(me.deck_id)}</label>${!myPod ? `<label>Join a pod with a code<input id="podCode" maxlength="6" placeholder="ABC123" style="text-transform:uppercase"></label><button type="button" class="btn ghost" id="podJoin">Join pod</button>` : ''}</div>`;
  }
  const matchRow = (m) => { const mine = user && (m.players || []).some((p) => p.user_id === user.id); const pod = m.pod_id ? T.pods.find((p) => p.id === m.pod_id) : null; return `<li class="match ${m.status}"><span><b>${m.kind === 'final' ? 'Final table' : `Pod round · ${esc(pod ? pod.name : 'Pod')}`}</b><br><small class="muted">${(m.players || []).map((p) => esc(p.name)).join(' · ')}</small></span><span class="mstat">${m.status === 'done' ? `🏆 ${esc(m.winner_name || '?')}` : m.room_code ? (mine ? `<a class="btn sm" href="/table.html?room=${esc(m.room_code)}${(m.players || [])[0]?.user_id === user?.id ? '&host=1' : ''}&name=${encodeURIComponent(name)}">Go to table</a>` : `<a class="btn ghost sm" href="/table.html?room=${esc(m.room_code)}&spectate=1&name=${encodeURIComponent(name || 'Watcher')}">Watch</a>`) : 'pending'}</span></li>`; };
  const bracket = T.matches.length ? `<div class="panel"><div class="panel-h"><h2>Bracket</h2><span class="muted small">${T.matches.filter((m) => m.status === 'done').length}/${T.matches.length} played</span></div><ul class="list matches">${T.matches.map(matchRow).join('')}</ul></div>` : '';
  const champ = T.status === 'finished' ? `<div class="panel champion"><div class="eyebrow">Champion</div><h2>${esc(T.champion_name || '?')}</h2><p>${T.champion_pod_id ? `Winning pod: <b>${esc((T.pods.find((p) => p.id === T.champion_pod_id) || {}).name || '')}</b>` : ''}</p></div>` : '';
  const root2 = `
    <p><a class="link" href="/tournaments.html">← All tournaments</a></p>
    <section class="panel thead"><span class="tstatus ${cls}">${label}</span><h2>${esc(T.name)}</h2><p>${esc(T.description || '')}</p><p class="muted small">${esc(fmtDate(T.starts_at))} · pods of ${T.pod_size} · bracket ${T.bracket} · ${T.members.length} signed up in ${T.pods.length} pod${T.pods.length === 1 ? '' : 's'}</p></section>
    ${champ}${signup}${bracket}
    ${T.pods.length || freeAgents.length ? `<section class="panel"><div class="panel-h"><h2>Pods</h2></div><div class="pods">${T.pods.map(podCard).join('')}${freeAgents.length ? `<div class="pod free"><div class="pod-h"><b>Free agents</b><span class="muted small">${freeAgents.length}</span></div><ul>${freeAgents.map((m) => `<li>${esc(m.display_name || 'Planeswalker')}</li>`).join('')}</ul></div>` : ''}</div></section>` : ''}
    ${admin ? adminPanelHTML(me, freeAgents) : ''}`;
  root.innerHTML = root2;
  bindDetail(me, myPod);
}
function memberOf(deckId) { const d = decks.find((x) => x.id === deckId); return { display_name: name, deck_id: deckId || null, deck_name: d ? d.name : null, commander: d ? d.commander : null }; }
function bindDetail(me, myPod) {
  const reload = () => renderDetail(T.slug);
  const nb = $('#notify'); if (nb) nb.onclick = async () => { try { await setInterest(T.id, !T.interest.includes(user.id)); reload(); } catch (e) { toast(e.message); } };
  const pc = $('#podCreate'); if (pc) pc.onclick = async () => { const nm = $('#podName').value.trim(); if (!nm) { toast('Name your pod'); return; } try { await createPod(T.id, nm, memberOf($('#myDeck').value)); toast('Pod created — share the code'); reload(); } catch (e) { toast(e.message); } };
  const pj = $('#podJoin'); if (pj) pj.onclick = async () => { const code = $('#podCode').value.trim(); if (!code) { toast('Enter the pod code'); return; } try { const pod = await joinPodByCode(T.id, code, memberOf(($('#myDeck2') || $('#myDeck') || {}).value)); if (T.members.filter((m) => m.pod_id === pod.id).length >= T.pod_size) { toast('That pod is full'); await leaveTournament(T.id); return; } toast(`Joined ${pod.name}`); reload(); } catch (e) { toast(e.message); } };
  const sj = $('#soloJoin'); if (sj) sj.onclick = async () => { try { await joinTournament(T.id, memberOf($('#myDeck2').value)); toast('Signed up as a free agent'); reload(); } catch (e) { toast(e.message); } };
  const lv = $('#leave'); if (lv) lv.onclick = async () => { if (!confirm('Leave this tournament?')) return; await leaveTournament(T.id); reload(); };
  const md = $('#myDeck'); if (md && me) md.onchange = async () => { try { await updateMember(T.id, memberOf(md.value)); toast('Deck saved'); } catch (e) { toast(e.message); } };
  if (admin) bindAdmin();
}

/* ---------- admin ---------- */
function adminPanelHTML(me, freeAgents) {
  const statusBtns = ['coming_soon', 'open', 'running', 'finished'].map((s) => `<button type="button" class="btn sm ${T.status === s ? '' : 'ghost'}" data-status="${s}">${STATUS[s][0]}</button>`).join('');
  const podsDone = T.pods.filter((p) => p.winner_id).length; const pending = T.matches.filter((m) => m.kind === 'pod' && m.status !== 'done');
  const podRound = T.matches.filter((m) => m.kind === 'pod'); const finals = T.matches.filter((m) => m.kind === 'final');
  const recordRow = (m) => { const pod = m.pod_id ? T.pods.find((p) => p.id === m.pod_id) : null; return `<li class="tm-row"><span class="tm-who"><b>${m.kind === 'final' ? 'Final table' : esc(pod ? pod.name : 'Pod')}</b><small>${esc(m.room_code || '')} · ${m.status}</small></span><span class="row">${m.status === 'done' ? `🏆 ${esc(m.winner_name)}` : `<select data-win="${m.id}"><option value="">Winner…</option>${(m.players || []).map((p) => `<option value="${esc(p.user_id || '')}|${esc(p.name)}">${esc(p.name)}</option>`).join('')}</select><button type="button" class="btn sm" data-suggest="${m.id}" title="Read the finished game at this table">Auto</button><button type="button" class="btn sm" data-record="${m.id}">Record</button>`}<button type="button" class="btn ghost sm" data-delmatch="${m.id}">✕</button></span></li>`; };
  return `<section class="panel admin"><div class="panel-h"><h2>Admin</h2><span class="muted small">${esc(T.slug)}</span></div>
    <p class="muted small">Status</p><div class="row">${statusBtns}</div>
    <div class="grid2" style="margin-top:14px"><label>Name<input id="adName" value="${esc(T.name)}" maxlength="60"></label><label>Starts<input id="adDate" type="datetime-local" value="${T.starts_at ? new Date(new Date(T.starts_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}"></label></div>
    <label>Description<input id="adDesc" value="${esc(T.description || '')}" maxlength="300"></label><div class="row"><button type="button" class="btn ghost sm" id="adSave">Save details</button><button type="button" class="btn ghost sm" id="adDelete">Delete tournament</button></div>
    <h3>Pods</h3><p class="muted small">${freeAgents.length} free agent${freeAgents.length === 1 ? '' : 's'} waiting.</p><div class="row"><button type="button" class="btn sm" id="adSeat" ${freeAgents.length ? '' : 'disabled'}>Seat free agents into pods of ${T.pod_size}</button><button type="button" class="btn ghost sm" id="adNewPod">New empty pod</button></div>
    ${freeAgents.length && T.pods.length ? `<ul class="list" style="margin-top:8px">${freeAgents.map((m) => `<li><span>${esc(m.display_name)}</span><select data-seat="${m.id}"><option value="">Move to pod…</option>${T.pods.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></li>`).join('')}</ul>` : ''}
    ${T.pods.length ? `<ul class="list" style="margin-top:8px">${T.pods.map((p) => `<li><span><b>${esc(p.name)}</b> <small class="muted">${T.members.filter((m) => m.pod_id === p.id).length} · ${esc(p.join_code)}</small></span><button type="button" class="btn ghost sm" data-delpod="${p.id}">Remove</button></li>`).join('')}</ul>` : ''}
    <h3>Rounds</h3>
    <div class="row"><button type="button" class="btn sm" id="adPodRound" ${T.pods.length ? '' : 'disabled'}>${podRound.length ? 'Create missing pod tables' : 'Start pod round (one table per pod)'}</button><button type="button" class="btn sm" id="adFinal" ${podsDone >= 2 && pending.length === 0 && !finals.some((m) => m.status !== 'done') ? '' : 'disabled'} title="Available once every pod has a champion">Start final table (${podsDone} champions)</button></div>
    ${T.matches.length ? `<ul style="list-style:none;padding:0;margin:10px 0 0;display:grid;gap:6px">${T.matches.map(recordRow).join('')}</ul>` : ''}
    </section>`;
}
function bindAdmin() {
  const reload = () => renderDetail(T.slug);
  document.querySelectorAll('[data-status]').forEach((b) => { b.onclick = async () => { try { await updateTournament(T.id, { status: b.dataset.status }); toast(`Status: ${STATUS[b.dataset.status][0]}`); reload(); } catch (e) { toast(e.message); } }; });
  $('#adSave').onclick = async () => { try { await updateTournament(T.id, { name: $('#adName').value.trim() || T.name, description: $('#adDesc').value.trim(), starts_at: $('#adDate').value ? new Date($('#adDate').value).toISOString() : null }); toast('Saved'); reload(); } catch (e) { toast(e.message); } };
  $('#adDelete').onclick = async () => { if (!confirm(`Delete ${T.name}? Pods, sign-ups and matches go with it.`)) return; await deleteTournament(T.id); location.href = '/tournaments.html'; };
  $('#adNewPod').onclick = async () => { const nm = prompt('Pod name'); if (!nm) return; await adminCreatePod(T.id, nm.trim(), T.pods.length + 1); reload(); };
  $('#adSeat').onclick = async () => {
    const free = T.members.filter((m) => !m.pod_id); let k = T.pods.length;
    for (let i = 0; i < free.length; i += T.pod_size) { k++; const pod = await adminCreatePod(T.id, `Pod ${k}`, k); for (const m of free.slice(i, i + T.pod_size)) await adminSetMemberPod(m.id, pod.id); }
    toast(`Seated ${free.length} player${free.length === 1 ? '' : 's'}`); reload();
  };
  document.querySelectorAll('[data-seat]').forEach((sel) => { sel.onchange = async () => { if (!sel.value) return; await adminSetMemberPod(sel.dataset.seat, sel.value); reload(); }; });
  document.querySelectorAll('[data-delpod]').forEach((b) => { b.onclick = async () => { if (!confirm('Remove this pod? Its players become free agents.')) return; await adminDeletePod(b.dataset.delpod); reload(); }; });
  $('#adPodRound').onclick = async () => {
    const have = new Set(T.matches.filter((m) => m.kind === 'pod').map((m) => m.pod_id)); let made = 0;
    for (const pod of T.pods) { if (have.has(pod.id)) continue; const ms = T.members.filter((m) => m.pod_id === pod.id); if (!ms.length) continue; await createMatch({ tournamentId: T.id, round: 1, kind: 'pod', podId: pod.id, players: ms.map((m) => ({ user_id: m.user_id, name: m.display_name, pod_id: pod.id, pod_name: pod.name })), hostId: user.id, hostName: name, title: `${T.name} · ${pod.name}`, bracket: T.bracket }); made++; }
    if (T.status !== 'running') await updateTournament(T.id, { status: 'running' });
    toast(made ? `${made} pod table${made === 1 ? '' : 's'} created` : 'Every pod already has a table'); reload();
  };
  $('#adFinal').onclick = async () => {
    const champs = T.pods.filter((p) => p.winner_id).map((p) => { const m = T.members.find((x) => x.user_id === p.winner_id); return { user_id: p.winner_id, name: m ? m.display_name : '?', pod_id: p.id, pod_name: p.name }; });
    if (champs.length < 2) { toast('Need at least two pod champions'); return; }
    await createMatch({ tournamentId: T.id, round: 2, kind: 'final', podId: null, players: champs.slice(0, 4), hostId: user.id, hostName: name, title: `${T.name} · Final table`, bracket: T.bracket });
    toast('Final table created'); reload();
  };
  document.querySelectorAll('[data-suggest]').forEach((b) => { b.onclick = async () => { const m = T.matches.find((x) => x.id === b.dataset.suggest); const games = await gamesInRoom(m.room_code); const g = games.find((x) => x.winner_id) || games[0]; if (!g) { toast('No finished game recorded at that table yet'); return; } const sel = document.querySelector(`[data-win="${m.id}"]`); const opt = [...sel.options].find((o) => o.value.startsWith(`${g.winner_id || ''}|`) || o.value.endsWith(`|${g.winner_name}`)); if (opt) { sel.value = opt.value; toast(`Game found: ${g.winner_name} won in ${g.turns} turns`); } else toast(`Game found (${g.winner_name}) but they are not in this match`); }; });
  document.querySelectorAll('[data-record]').forEach((b) => { b.onclick = async () => {
    const m = T.matches.find((x) => x.id === b.dataset.record); const v = document.querySelector(`[data-win="${m.id}"]`).value; if (!v) { toast('Pick the winner'); return; }
    const [uid, wname] = v.split('|'); const games = m.room_code ? await gamesInRoom(m.room_code) : [];
    await updateMatch(m.id, { status: 'done', winner_id: uid || null, winner_name: wname, game_id: games[0]?.id || null });
    if (m.kind === 'pod' && m.pod_id) await adminSetPodWinner(m.pod_id, uid || null);
    if (m.kind === 'final') { const champ = (m.players || []).find((p) => p.user_id === uid || p.name === wname); await updateTournament(T.id, { status: 'finished', champion_id: uid || null, champion_name: wname, champion_pod_id: champ ? champ.pod_id : null }); }
    toast(`Recorded: ${wname}`); reload();
  }; });
  document.querySelectorAll('[data-delmatch]').forEach((b) => { b.onclick = async () => { if (!confirm('Remove this match?')) return; await deleteMatch(b.dataset.delmatch); reload(); }; });
}
