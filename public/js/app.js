import { bus, isServerDown, loadSession, logout, navigate, state } from './store.js';
import { el, esc, toast } from './ui.js';
import { navMarkup, bindNav, refreshNav } from './shell.js';

import { renderHome } from './views/home.js';
import { renderDiscover } from './views/discover.js';
import { renderGame } from './views/game.js';
import { renderPlay } from './views/play.js';
import { renderStudio } from './views/studio.js';
import { renderStudioHome } from './views/studio-home.js';
import { renderAvatar } from './views/avatar.js';
import { renderShop } from './views/shop.js';
import { renderAuth } from './views/auth.js';
import { renderAdmin } from './views/admin.js';
import { renderNearby } from './views/nearby.js';
import { renderOffline } from './views/offline.js';

const VIEWS = {
  home: renderHome,
  discover: renderDiscover,
  game: renderGame,
  play: renderPlay,
  studio: renderStudio,
  create: renderStudioHome,
  avatar: renderAvatar,
  shop: renderShop,
  login: (root) => renderAuth(root, { mode: 'login' }),
  register: (root) => renderAuth(root, { mode: 'register' }),
  admin: renderAdmin,
  nearby: renderNearby,
  offline: renderOffline,
};

const FULLBLEED = new Set(['play', 'studio']);

let active = null;
let lastPath = null;
let booted = false;

function parseRoute() {
  const raw = decodeURIComponent(location.hash.replace(/^#\/?/, '')) || 'home';
  const [pathPart, queryPart] = raw.split('?');
  const [name, ...params] = pathPart.split('/');
  return {
    name: name || 'home',
    params,
    query: new URLSearchParams(queryPart || ''),
    fullbleed: FULLBLEED.has(name || 'home'),
    path: raw,
  };
}

async function render() {
  const route = parseRoute();
  const app = document.getElementById('app');
  let host = document.getElementById('view');

  if (!host) {
    app.innerHTML = '';
    const header = el(`<header class="topbar">${navMarkup()}</header>`);
    app.appendChild(header);
    host = el('<div id="view"></div>');
    app.appendChild(host);
    bindNav(header, {
      onSearch: (term) => navigate(`discover?q=${encodeURIComponent(term)}`),
      onLogout: doLogout,
    });
  } else {
    refreshNav();
  }

  if (active?.destroy) {
    try { active.destroy(); } catch (err) { console.warn('[view] destroy failed', err); }
    active = null;
  }

  document.body.classList.toggle('is-fullbleed', route.fullbleed);
  host.innerHTML = '';

  const view = VIEWS[route.name];
  if (!view) {
    host.innerHTML = `<div class="page"><div class="empty"><b>Page not found</b>That route does not exist. <a href="#/home" style="color:#9ab8ff">Go home</a></div></div>`;
    document.title = 'Not found — Blockforge';
    return;
  }

  try {
    const instance = await view(host, { params: route.params, query: route.query, route });
    active = instance || null;
    document.title = instance?.title ? `${instance.title} — Blockforge` : 'Blockforge — build worlds, play together';
  } catch (err) {
    console.error('[view]', err);
    if (state.offline || isServerDown(err)) {
      host.innerHTML = `<div class="page"><div class="empty"><b>Offline</b>This page needs the server, but your saved worlds still work.<div style="margin-top:14px"><a class="btn btn-primary" href="#/offline">Open saved worlds</a></div></div></div>`;
      document.title = 'Offline — Blockforge';
      return;
    }
    host.innerHTML = `<div class="page"><div class="empty"><b>Something broke</b>${esc(err.message)}</div></div>`;
    toast(err.message, 'bad');
  }

  if (lastPath !== route.path) {
    window.scrollTo({ top: 0 });
    lastPath = route.path;
  }
}

async function doLogout() {
  await logout();
  navigate('home');
  toast('Signed out. See you soon.', 'good');
}

async function boot() {
  await loadSession();
  bus.addEventListener('session', refreshNav);

  window.addEventListener('offline', () => {
    state.offline = true;
    toast('Offline. Saved worlds still play on this device.', 'warn');
  });
  window.addEventListener('online', async () => {
    toast('Back online.', 'good');
    try { await loadSession(); } catch { /* ignore */ }
  });

  const app = document.getElementById('app');
  app.hidden = false;
  app.innerHTML = '';
  document.getElementById('boot')?.remove();

  window.addEventListener('hashchange', render);
  await render();

  // Offline support only works on HTTPS or localhost; failures are harmless.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('[sw]', err));
  }
  // Ask the browser not to evict saved worlds when storage runs low.
  if (navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {});
  }
}

boot().catch((err) => {
  console.error(err);
  const bootEl = document.getElementById('boot');
  if (bootEl) bootEl.innerHTML = `<p style="color:#fca5a5">Failed to start: ${esc(err.message)}</p>`;
});
