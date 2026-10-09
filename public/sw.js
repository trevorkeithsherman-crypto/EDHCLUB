// EDH Club service worker: app shell + card art cache so the table opens fast (and offline for practice games).
const VERSION = 'edhclub-v1';
const SHELL = ['/', '/index.html', '/table.html', '/decks.html', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png'];
const CARD_HOSTS = ['cards.scryfall.io', 'backs.scryfall.io'];
const MAX_CARDS = 1500;

self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== VERSION + '-cards').map((k) => caches.delete(k)))).then(() => self.clients.claim())); });

async function trim(name, max) { const c = await caches.open(name); const keys = await c.keys(); if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map((k) => c.delete(k))); }

self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Live data: never cache (Supabase, Scryfall API, our deck API).
  if (url.hostname.endsWith('supabase.co') || url.hostname === 'api.scryfall.com' || url.pathname.startsWith('/api/')) return;
  // Card images and backs: cache first, bounded.
  if (CARD_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.open(VERSION + '-cards').then(async (c) => { const hit = await c.match(req); if (hit) return hit; const res = await fetch(req); if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); trim(VERSION + '-cards', MAX_CARDS); } return res; }).catch(() => fetch(req)));
    return;
  }
  // Pages: network first so deploys show up; fall back to the cached shell.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => { caches.open(VERSION).then((c) => c.put(req, res.clone())); return res; }).catch(() => caches.match(req).then((hit) => hit || caches.match('/index.html'))));
    return;
  }
  // Same-origin assets (hashed JS/CSS, mats, fonts CSS): stale-while-revalidate.
  if (url.origin === location.origin || url.hostname.includes('fonts.g') || url.hostname.includes('jsdelivr')) {
    e.respondWith(caches.open(VERSION).then(async (c) => { const hit = await c.match(req); const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit); return hit || net; }));
  }
});
