// Supabase client and account helpers. The URL and publishable key are public by design;
// row-level security on the database is what protects data.
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
export const online = Boolean(SUPABASE_URL && SUPABASE_KEY);

export const supa = online ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

const NAME_KEY = 'edhclub-name';
export function localName() { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } }
export function setLocalName(n) { try { localStorage.setItem(NAME_KEY, n); } catch { /* ignore */ } }

/** Current session user, or null. */
export async function currentUser() {
  if (!supa) return null;
  const { data } = await supa.auth.getUser();
  return data.user || null;
}

/** Sign in as a guest (anonymous user). Needs "Anonymous sign-ins" enabled in Supabase Auth settings. */
export async function signInGuest(name) {
  if (!supa) throw new Error('offline');
  const { data, error } = await supa.auth.signInAnonymously({ options: { data: { display_name: name } } });
  if (error) throw error;
  await upsertProfile(data.user, name);
  return data.user;
}

/** Email magic link. */
export async function signInEmail(email, name) {
  if (!supa) throw new Error('offline');
  const { error } = await supa.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + '/', data: { display_name: name } } });
  if (error) throw error;
}

export async function signInDiscord() {
  if (!supa) throw new Error('offline');
  const { error } = await supa.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: location.origin + '/' } });
  if (error) throw error;
}

export async function signOut() { if (supa) await supa.auth.signOut(); }

const AVATAR_KEY = 'edhclub-avatar';
export function localAvatar() { try { return localStorage.getItem(AVATAR_KEY) || ''; } catch { return ''; } }
export function setLocalAvatar(u) { try { if (u) localStorage.setItem(AVATAR_KEY, u); else localStorage.removeItem(AVATAR_KEY); } catch { /* ignore */ } }
export async function upsertProfile(user, name) {
  if (!supa || !user) return;
  const display = name || user.user_metadata?.display_name || user.user_metadata?.full_name || user.email?.split('@')[0] || localName() || 'Planeswalker';
  // Create or rename first; the avatar is a separate, best-effort step so a missing column or policy can never block the profile itself.
  const { error } = await supa.from('profiles').upsert({ id: user.id, display_name: display }, { onConflict: 'id' });
  if (error) console.warn('profile upsert failed', error.message);
  setLocalName(display);
  try {
    const { data: cur } = await supa.from('profiles').select('avatar_url').eq('id', user.id).maybeSingle();
    // A Discord sign-in brings its avatar along; use it unless the player already uploaded their own.
    const social = user.user_metadata?.avatar_url || user.user_metadata?.picture || '';
    if (!cur?.avatar_url && social) await supa.from('profiles').update({ avatar_url: social }).eq('id', user.id);
    const av = cur?.avatar_url || social; if (av) setLocalAvatar(av);
  } catch { /* avatar is optional */ }
}
export async function myProfile() {
  const user = await currentUser(); if (!user) return null;
  let { data } = await supa.from('profiles').select('display_name, avatar_url').eq('id', user.id).maybeSingle();
  if (!data) { await upsertProfile(user); ({ data } = await supa.from('profiles').select('display_name, avatar_url').eq('id', user.id).maybeSingle()); }
  setLocalAvatar(data?.avatar_url || '');
  return data;
}
// Shrink to a 256px square JPEG in the browser, then store it under the user's own folder.
async function squareJpeg(file, size = 256) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height); const cv = document.createElement('canvas'); cv.width = cv.height = size;
  cv.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  return new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.86));
}
export async function uploadAvatar(file) {
  const user = await currentUser(); if (!user) throw new Error('Sign in first');
  if (!/^image\//.test(file.type)) throw new Error('Choose an image file');
  const blob = await squareJpeg(file);
  const path = `${user.id}/avatar.jpg`;
  const { error } = await supa.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '60' });
  if (error) throw error;
  const url = supa.storage.from('avatars').getPublicUrl(path).data.publicUrl + '?v=' + Date.now();
  const { error: e2 } = await supa.from('profiles').upsert({ id: user.id, display_name: localName() || 'Planeswalker', avatar_url: url }, { onConflict: 'id' }); if (e2) throw e2;
  setLocalAvatar(url); return url;
}
export async function removeAvatar() {
  const user = await currentUser(); if (!user) return;
  await supa.storage.from('avatars').remove([`${user.id}/avatar.jpg`]);
  const social = user.user_metadata?.avatar_url || user.user_metadata?.picture || null;
  await supa.from('profiles').upsert({ id: user.id, display_name: localName() || 'Planeswalker', avatar_url: social }, { onConflict: 'id' });
  setLocalAvatar(social || '');
}

export async function displayNameFor(user) {
  if (!user) return localName() || 'Guest';
  const { data } = await supa.from('profiles').select('display_name').eq('id', user.id).maybeSingle();
  return data?.display_name || user.user_metadata?.display_name || localName() || 'Planeswalker';
}

export const roomCode = () => Array.from({ length: 5 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join('');

/* ---------- Rooms ---------- */
export async function createRoom({ hostId, hostName, seats, bots, bracket }) {
  const code = roomCode();
  if (supa && hostId) {
    const { error } = await supa.from('rooms').insert({ code, host_id: hostId, host_name: hostName, seats, bots, bracket, status: 'open' });
    if (error) throw error;
  }
  return code;
}
export async function getRoom(code) {
  if (!supa) return null;
  const { data } = await supa.from('rooms').select('*').eq('code', code).maybeSingle();
  return data;
}
export async function openRooms() {
  if (!supa) return [];
  const since = new Date(Date.now() - 1000 * 60 * 90).toISOString();
  const { data } = await supa.from('rooms').select('*').eq('status', 'open').eq('is_public', true).gt('created_at', since).order('created_at', { ascending: false }).limit(20);
  return data || [];
}
export async function setRoomStatus(code, status) { if (supa) await supa.from('rooms').update({ status }).eq('code', code); }

/* ---------- Clubs ---------- */
export async function myClubs(userId) {
  if (!supa || !userId) return [];
  const { data } = await supa.from('club_members').select('club:clubs(id, name, code, created_at)').eq('user_id', userId);
  return (data || []).map((r) => r.club).filter(Boolean);
}
export async function createClub(userId, name) {
  const code = roomCode();
  const { data, error } = await supa.from('clubs').insert({ name, code, owner_id: userId }).select().single();
  if (error) throw error;
  await supa.from('club_members').insert({ club_id: data.id, user_id: userId, role: 'owner' });
  return data;
}
export async function joinClub(userId, code) {
  const { data: club } = await supa.from('clubs').select('*').eq('code', code.toUpperCase()).maybeSingle();
  if (!club) throw new Error('No club has that code');
  const { error } = await supa.from('club_members').upsert({ club_id: club.id, user_id: userId, role: 'member' }, { onConflict: 'club_id,user_id' });
  if (error) throw error;
  return club;
}
export async function clubDetail(clubId) {
  const [{ data: members }, { data: games }] = await Promise.all([
    supa.from('club_members').select('role, profile:profiles(display_name)').eq('club_id', clubId),
    supa.from('games').select('*').eq('club_id', clubId).order('ended_at', { ascending: false }).limit(20),
  ]);
  return { members: members || [], games: games || [] };
}
export async function recordGame({ code, clubId, winnerName, players, rounds }) {
  if (!supa) return;
  await supa.from('games').insert({ room_code: code, club_id: clubId || null, winner_name: winnerName, players, rounds });
}

/* ---------- Saved decks ---------- */
const LAST_DECK_KEY = 'edhclub-last-deck';
export function lastDeckId() { try { return localStorage.getItem(LAST_DECK_KEY) || ''; } catch { return ''; } }
export function setLastDeckId(id) { try { if (id) localStorage.setItem(LAST_DECK_KEY, id); else localStorage.removeItem(LAST_DECK_KEY); } catch { /* ignore */ } }
export async function listDecks() {
  const user = await currentUser(); if (!supa || !user) return [];
  const { data } = await supa.from('decks').select('id, name, commander, colors, card_count, mat, updated_at').eq('user_id', user.id).order('updated_at', { ascending: false });
  return data || [];
}
export async function getDeck(id) {
  if (!supa || !id) return null;
  const { data } = await supa.from('decks').select('*').eq('id', id).maybeSingle();
  return data;
}
export async function saveDeck({ id, name, commander, colors, cardCount, list, mat }) {
  const user = await currentUser(); if (!supa || !user) throw new Error('Sign in to save decks');
  const row = { user_id: user.id, name, commander, colors, card_count: cardCount, list, mat: mat || 'auto', updated_at: new Date().toISOString() };
  if (id) row.id = id;
  const { data, error } = await supa.from('decks').upsert(row, { onConflict: 'id' }).select().single();
  if (error) throw error;
  return data;
}
export async function deleteDeck(id) { if (supa && id) await supa.from('decks').delete().eq('id', id); if (lastDeckId() === id) setLastDeckId(''); }

/* ---------- Email + password accounts ---------- */
export async function signUpEmail(email, password, name) {
  if (!supa) throw new Error('offline');
  const { data, error } = await supa.auth.signUp({ email, password, options: { data: { display_name: name }, emailRedirectTo: location.origin + '/' } });
  if (error) throw error;
  if (data.session) await upsertProfile(data.user, name);
  return data; // data.session is null when email confirmation is required
}
export async function signInPassword(email, password) {
  if (!supa) throw new Error('offline');
  const { data, error } = await supa.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}
export async function resetPassword(email) {
  if (!supa) throw new Error('offline');
  const { error } = await supa.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/?reset=1' });
  if (error) throw error;
}
export async function updatePassword(password) {
  if (!supa) throw new Error('offline');
  const { error } = await supa.auth.updateUser({ password });
  if (error) throw error;
}
/** Turn a guest (anonymous) account into a permanent one, keeping its decks and clubs. */
export async function upgradeGuest(email, password, name) {
  if (!supa) throw new Error('offline');
  const { data, error } = await supa.auth.updateUser({ email, password, data: { display_name: name } });
  if (error) throw error;
  await upsertProfile(data.user, name);
  return data.user;
}
