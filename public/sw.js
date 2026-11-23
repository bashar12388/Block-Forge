// Blockforge service worker.
//
// Goals:
//  - the app shell opens with no network (bus, airplane mode)
//  - recently visited worlds are cached so they can be played solo
//  - never cache private endpoints (sessions, accounts, writes)
//
// Bump VERSION whenever the UI changes so old shells are dropped.

const VERSION = 'bf-v7';

const CORE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/css/app.css',
  '/js/app.js',
  '/js/shell.js',
  '/js/store.js',
  '/js/ui.js',
  '/js/gamepad.js',
  '/js/touch.js',
  '/js/three/world3d.js',
  '/js/three/avatar3d.js',
  '/js/views/home.js',
  '/js/views/discover.js',
  '/js/views/game.js',
  '/js/views/play.js',
  '/js/views/studio.js',
  '/js/views/studio-home.js',
  '/js/views/avatar.js',
  '/js/views/shop.js',
  '/js/views/auth.js',
  '/js/views/admin.js',
  '/js/views/adminLevels.js',
  '/js/views/adminPanel.js',
  '/js/views/nearby.js',
  '/js/views/offline.js',
  '/shared/catalog.js',
  '/shared/physics.js',
  '/shared/avatar.js',
  '/vendor/three/build/three.module.js',
  '/vendor/three/build/three.core.js',
  '/vendor/three/addons/controls/OrbitControls.js',
  '/vendor/three/addons/controls/TransformControls.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // addAll is atomic; add individually so one missing addon cannot break
    // the whole offline install.
    await Promise.all(CORE.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

const isCacheableApi = (pathname) =>
  pathname === '/api/games' ||
  pathname === '/api/network' ||
  /^\/api\/games\/[^/]+$/.test(pathname);

async function putInCache(request, response) {
  try {
    const cache = await caches.open(VERSION);
    await cache.put(request, response);
  } catch { /* quota or opaque response */ }
}

async function apiFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok && isCacheableApi(new URL(request.url).pathname)) {
      putInCache(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'Offline — this needs the server.' }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
}

async function navigationFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) putInCache(request, response.clone());
    return response;
  } catch {
    return (await caches.match(request)) || (await caches.match('/index.html'));
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) putInCache(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) return cached;
  return (await network) || new Response('Offline', { status: 504 });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/ws') return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(apiFirst(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(navigationFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
