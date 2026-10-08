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

export async function upsertProfile(user, name) {
  if (!supa || !user) return;
  const display = name || user.user_metadata?.display_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Planeswalker';
  await supa.from('profiles').upsert({ id: user.id, display_name: display }, { onConflict: 'id' });
  setLocalName(display);
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
