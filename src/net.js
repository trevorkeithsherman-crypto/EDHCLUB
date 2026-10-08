// Room sync over Supabase Realtime.
//
// Model: every client owns one seat. It is the only writer for that seat's player record and for
// every card that seat owns, and it broadcasts a compact snapshot of them whenever they change.
// Shared state (turn, stack order, attacks, log) is broadcast by whoever changed it. Anything you
// want to do to another player's seat (deal damage, poison) goes out as a request that the owning
// client applies. Bots are seats owned by the host's client. Nothing here knows the rules of Magic.
import { supa } from './supa.js';

const clientId = Math.random().toString(36).slice(2, 10);

export const net = {
  code: null, seat: null, name: '', isHost: false, channel: null, peers: {}, ready: false,
  handlers: {}, lastSentSeat: '', lastSentShared: '', lastGotShared: '', syncT: 0, hostId: null, seats: 4, bots: 0,
  on(type, fn) { this.handlers[type] = fn; },
  get active() { return Boolean(this.channel); },
  isMine(seat) { return !this.active || seat === this.seat || (this.isHost && this.botSeats().includes(seat)); },
  botSeats() { const out = []; for (let k = 0; k < this.seats; k++) if (k >= this.seats - this.bots) out.push(k); return out; },
  /** Join a room. Resolves once presence has settled and a seat is chosen. */
  async join({ code, name, isHost, seats, bots }) {
    if (!supa && !window.__edhChannel) throw new Error('Rooms need the online service. Practice against bots works offline.');
    this.code = code; this.name = name; this.isHost = isHost; this.seats = seats || 4; this.bots = bots || 0;
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
    const taken = new Set(Object.values(this.peers).map((p) => p.seat).filter((s) => s != null));
    const human = this.seats - this.bots;
    let seat = null;
    if (isHost) seat = 0;
    else for (let k = 0; k < human; k++) if (!taken.has(k)) { seat = k; break; }
    if (seat == null) throw new Error('This table is full');
    this.seat = seat;
    await ch.track({ seat, name, isHost, clientId, ts: Date.now() });
    this.ready = true;
    this.send('hello', { clientId });
    return seat;
  },
  send(event, payload) { if (this.channel) this.channel.send({ type: 'broadcast', event, payload }); },
  /** Broadcast my seat and the shared state if they changed. Debounced. */
  queueSync(getSeatSnap, getShared) {
    if (!this.active || !this.ready) return;
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
  ownedSeats() { return this.isHost ? [this.seat, ...this.botSeats()] : [this.seat]; },
  resendAll() { this.lastSentSeatBy = {}; this.lastSentShared = ''; this.handlers.resend && this.handlers.resend(); },
  leave() { if (this.channel) { if (this.channel.close) this.channel.close(); else supa.removeChannel(this.channel); this.channel = null; } },
};

function flatten(state) {
  const out = {};
  for (const [key, arr] of Object.entries(state)) if (arr && arr[0]) out[key] = arr[0];
  return out;
}
