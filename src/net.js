// Room sync over Supabase Realtime.
//
// Model: every client owns one seat. It is the only writer for that seat's player record and for
// every card that seat owns, and it broadcasts a compact snapshot of them whenever they change.
// Shared state (turn, stack order, attacks, log) is broadcast by whoever changed it. Anything you
// want to do to another player's seat (deal damage, poison) goes out as a request that the owning
// client applies. Bots are seats owned by the host's client. Nothing here knows the rules of Magic.
import { supa } from './supa.js';

// A stable identity per browser tab so a reload re-takes the same presence slot and seat.
const clientId = (() => { try { const k = sessionStorage.getItem('edhclub-client'); if (k) return k; const n = Math.random().toString(36).slice(2, 10); sessionStorage.setItem('edhclub-client', n); return n; } catch { return Math.random().toString(36).slice(2, 10); } })();
const memKey = (code) => 'edhclub-room-' + code;
// Seat memory lives in localStorage so a closed tab or a phone that slept can come back to the same seat; the
// big board snapshot stays in sessionStorage (fast reloads) and the server copy covers everything else.
export function rememberRoom(code, data) { try { sessionStorage.setItem(memKey(code), JSON.stringify(data)); localStorage.setItem(memKey(code) + '-seat', JSON.stringify({ seat: data.seat, clientId: data.clientId, rank: data.rank, t: Date.now() })); } catch { /* ignore */ } }
export function recallRoom(code) { try { const s = JSON.parse(sessionStorage.getItem(memKey(code)) || 'null'); if (s) return s; const l = JSON.parse(localStorage.getItem(memKey(code) + '-seat') || 'null'); return l && Date.now() - l.t < 7 * 864e5 ? l : null; } catch { return null; } }
// Host rank: the room's creator is 0; everyone else ranks by first arrival. When the host leaves, the lowest rank
// present takes over the bots and the saving. Kept per tab so a reload keeps your place in line.
function hostRank(code, isCreator) { try { const k = memKey(code) + '-rank'; const v = sessionStorage.getItem(k); if (v != null) return +v; const r = isCreator ? 0 : Date.now(); sessionStorage.setItem(k, String(r)); return r; } catch { return isCreator ? 0 : Date.now(); } }

export const net = {
  code: null, seat: null, name: '', isHost: false, spectator: false, channel: null, peers: {}, ready: false,
  handlers: {}, lastSentSeat: '', lastSentShared: '', lastGotShared: '', syncT: 0, hostId: null, seats: 4, botList: [], rank: 0, clientId,
  get bots() { return this.botList.length; },
  on(type, fn) { this.handlers[type] = fn; },
  get active() { return Boolean(this.channel); },
  isMine(seat) { if (this.spectator) return false; return !this.active || seat === this.seat || (this.isHost && this.botSeats().includes(seat)); },
  /** Connected viewers who have no seat. */
  spectators() { return Object.values(this.peers).filter((p) => p.spectator); },
  botSeats() { return this.botList.filter((k) => k < this.seats); },
  humanSeats() { return Array.from({ length: this.seats }, (_, k) => k).filter((k) => !this.botList.includes(k)); },
  /** Seats occupied by connected humans (other than me). */
  takenSeats() { return new Set(Object.entries(this.peers).filter(([k]) => k !== clientId).map(([, p]) => p.seat).filter((s) => s != null)); },
  /** Host only: publish a new seat layout. Guests pick it up from presence. */
  async setLayout({ seats, botList }) {
    if (!this.isHost) return;
    if (seats) this.seats = seats; if (botList) this.botList = botList.filter((k) => k < this.seats);
    await this.track();
  },
  async track() { if (this.channel && this.ready && !this.spectator) await this.channel.track({ seat: this.seat, name: this.name, isHost: this.isHost, clientId, rank: this.rank, uid: this.uid || null, seats: this.seats, botList: this.botList, ts: Date.now() }); },
  /** Who should be hosting right now: the lowest-ranked seated peer (the creator while present, else first arrival). */
  leader() {
    const seated = Object.values(this.peers).filter((p) => !p.spectator && p.seat != null && p.rank != null);
    if (!seated.length) return null;
    return seated.sort((a, b) => a.rank - b.rank || String(a.clientId).localeCompare(String(b.clientId)))[0];
  },
  /** Re-evaluate hosting after presence changes. Returns 'took' | 'gave' | null. */
  electHost() {
    if (this.spectator || !this.ready) return null;
    const lead = this.leader(); const me = lead && lead.clientId === clientId;
    if (me && !this.isHost) { this.isHost = true; this.track(); return 'took'; }
    if (!me && this.isHost && lead && lead.rank < this.rank) { this.isHost = false; this.track(); return 'gave'; }
    return null;
  },
  /** Join a room. Resolves once presence has settled and a seat is chosen. */
  async join({ code, name, isHost, seats, bots, botList, spectate = false, claimSeat = null, reserved = [] }) {
    if (!supa && !window.__edhChannel) throw new Error('Rooms need the online service. Practice against bots works offline.');
    this.code = code; this.name = name; this.isHost = isHost && !spectate; this.spectator = !!spectate; this.seats = seats || 4; this.rank = spectate ? null : hostRank(code, !!isHost);
    this.botList = botList || Array.from({ length: bots || 0 }, (_, k) => this.seats - 1 - k).sort();
    // Tests can swap the transport for an in-browser bus (window.__edhChannel); production uses Supabase.
    const make = window.__edhChannel || ((name, opts) => supa.channel(name, opts));
    const ch = make('room:' + code, { config: { broadcast: { self: false, ack: false }, presence: { key: clientId } } });
    this.channel = ch;
    ch.on('broadcast', { event: 'seat' }, ({ payload }) => this.handlers.seat && this.handlers.seat(payload));
    ch.on('broadcast', { event: 'shared' }, ({ payload }) => { this.lastGotShared = payload.hash; this.handlers.shared && this.handlers.shared(payload); });
    ch.on('broadcast', { event: 'req' }, ({ payload }) => { if (payload.to === this.seat || (this.isHost && this.botSeats().includes(payload.to))) this.handlers.req && this.handlers.req(payload); });
    ch.on('broadcast', { event: 'all' }, ({ payload }) => this.handlers.all && this.handlers.all(payload));
    ch.on('broadcast', { event: 'hello' }, () => this.resendAll());
    ch.on('broadcast', { event: 'chat' }, ({ payload }) => this.handlers.chat && this.handlers.chat(payload));
    ch.on('presence', { event: 'sync' }, () => { this.peers = flatten(ch.presenceState()); this.handlers.peers && this.handlers.peers(this.peers); });
    await new Promise((resolve, reject) => {
      ch.subscribe((status) => { if (status === 'SUBSCRIBED') resolve(); else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error('Could not reach the room')); });
    });
    // Let presence settle, then pick a seat.
    await new Promise((r) => setTimeout(r, 700));
    this.peers = flatten(ch.presenceState());
    const hostPeer = Object.values(this.peers).find((p) => p.isHost && p.seats);
    if (!isHost && hostPeer) { this.seats = hostPeer.seats; this.botList = hostPeer.botList || Array.from({ length: hostPeer.bots || 0 }, (_, k) => this.seats - 1 - k).sort(); }
    const taken = new Set(Object.entries(this.peers).filter(([k]) => k !== clientId).map(([, p]) => p.seat).filter((s) => s != null));
    const human = this.humanSeats();
    let seat = null;
    const prior = recallRoom(code);
    if (spectate) {
      if (!hostPeer) throw new Error('Nobody is at that table right now');
      await ch.track({ seat: null, name, isHost: false, spectator: true, clientId, ts: Date.now() });
      this.ready = true; this.send('hello', { clientId }); return null;
    }
    // A table with nobody at it: the first one back becomes host, whatever their URL says.
    const alone = !Object.keys(this.peers).some((k) => k !== clientId);
    if (alone && !isHost && !this.isHost) { this.isHost = true; }
    const want = claimSeat != null && human.includes(claimSeat) && !taken.has(claimSeat) ? claimSeat : null;
    if (want != null) seat = want;
    else if (isHost && !taken.has(0)) seat = 0;
    else if (prior && prior.seat != null && human.includes(prior.seat) && !taken.has(prior.seat)) seat = prior.seat;
    else { for (const k of human) if (!taken.has(k) && !reserved.includes(k)) { seat = k; break; } if (seat == null) for (const k of human) if (!taken.has(k)) { seat = k; break; } }
    if (seat == null) throw new Error('This table is full');
    this.seat = seat;
    await ch.track({ seat, name, isHost: this.isHost, clientId, rank: this.rank, seats: this.seats, botList: this.botList, ts: Date.now() });
    rememberRoom(code, { ...(prior || {}), seat, clientId, rank: this.rank });
    this.ready = true;
    this.send('hello', { clientId });
    return seat;
  },
  send(event, payload) { if (this.channel) this.channel.send({ type: 'broadcast', event, payload }); },
  /** Broadcast my seat and the shared state if they changed. Debounced. */
  queueSync(getSeatSnap, getShared) {
    if (!this.active || !this.ready || this.spectator) return;
    clearTimeout(this.syncT);
    this.syncT = setTimeout(() => {
      for (const s of this.ownedSeats()) {
        const snap = getSeatSnap(s); const str = JSON.stringify(snap);
        if (this.lastSentSeatBy?.[s] !== str) { (this.lastSentSeatBy ||= {})[s] = str; this.send('seat', snap); }
      }
      const shared = getShared(); const hash = JSON.stringify(shared);
      if (hash !== this.lastSentShared && hash !== this.lastGotShared) { this.lastSentShared = hash; this.send('shared', { ...shared, hash }); }
    }, 120);
  },
  ownedSeats() { return this.spectator ? [] : this.isHost ? [this.seat, ...this.botSeats()] : [this.seat]; },
  resendAll() { this.lastSentSeatBy = {}; this.lastSentShared = ''; this.handlers.resend && this.handlers.resend(); },
  leave() { if (this.channel) { if (this.channel.close) this.channel.close(); else supa.removeChannel(this.channel); this.channel = null; } },
};

function flatten(state) {
  const out = {};
  for (const [key, arr] of Object.entries(state)) if (arr && arr[0]) out[key] = arr[0];
  return out;
}
