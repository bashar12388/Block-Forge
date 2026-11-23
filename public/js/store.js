// Tiny app-wide store + API client.

export const state = {
  user: null,
  inventory: [],
  items: [],
  myGames: [],
  ready: false,
  online: 0,
  stats: null,
  offline: false,
};

const SESSION_CACHE = 'bf:session-cache';

function cacheSession(payload) {
  if (!payload?.user) return;
  try {
    localStorage.setItem(SESSION_CACHE, JSON.stringify({
      user: payload.user,
      inventory: payload.inventory || [],
      items: payload.items || [],
      games: payload.games || [],
      at: Date.now(),
    }));
  } catch { /* storage may be full or blocked */ }
}

function readCachedSession() {
  try {
    const raw = localStorage.getItem(SESSION_CACHE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function isNetworkError(err) {
  return err instanceof TypeError || /fetch|network|load failed/i.test(String(err?.message || ''));
}

// "Cannot reach the server" covers two different real situations: the device
// has no internet, or the host machine (desktop/LAN server) is asleep. The
// browser only reports the first one through navigator.onLine, so also treat
// our service worker's offline reply and gateway errors as unreachable.
export function isServerDown(err) {
  if (isNetworkError(err) || !navigator.onLine) return true;
  if ([502, 503, 504].includes(err?.status)) return true;
  return /needs the server/i.test(String(err?.message || ''));
}

export const bus = new EventTarget();

export class ApiError extends Error {
  constructor(status, message, payload) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

export async function api(path, { method = 'GET', body, raw = false } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const payload = isJson ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    const message = isJson ? payload.error || res.statusText : String(payload || res.statusText);
    throw new ApiError(res.status, message, payload);
  }
  return payload;
}

export function setSession(payload) {
  state.user = payload.user || null;
  state.inventory = payload.inventory || state.inventory || [];
  if (payload.items) state.items = payload.items;
  if (payload.games) state.myGames = payload.games;
  cacheSession(payload);
  bus.dispatchEvent(new Event('session'));
}

export async function loadSession() {
  try {
    const payload = await api('/api/me');
    state.offline = false;
    setSession(payload);
  } catch (err) {
    if (isServerDown(err)) {
      // Offline boot: restore the last account snapshot so avatars, coins, and
      // saved worlds still work. Nothing is written back to the server.
      state.offline = true;
      const cached = readCachedSession();
      if (cached) setSession({
        user: cached.user,
        inventory: cached.inventory,
        items: cached.items,
        games: cached.games,
      });
      console.warn('[session] offline mode', err.message);
    } else {
      // A real HTTP error (401, 500, ...) means the server is reachable.
      state.offline = false;
      console.warn('[session]', err);
    }
  }
  state.ready = true;
  bus.dispatchEvent(new Event('session'));
}

export async function refreshMe() {
  const payload = await api('/api/me');
  setSession(payload);
  return payload;
}

export async function logout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* already offline */ }
  state.user = null;
  state.inventory = [];
  state.myGames = [];
  state.offline = false;
  try { localStorage.removeItem(SESSION_CACHE); } catch { /* ignore */ }
  bus.dispatchEvent(new Event('session'));
}

export function isStaff(user = state.user) {
  return !!user && user.role >= 1;
}

export function owns(itemId) {
  return state.inventory.includes(itemId);
}

export function navigate(path) {
  const clean = String(path || 'home').replace(/^#?\/?/, '');
  if (location.hash === `#/${clean}`) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return;
  }
  location.hash = `#/${clean}`;
}

export function currentRoute() {
  const raw = location.hash.replace(/^#\/?/, '') || 'home';
  const [name, ...rest] = raw.split('/');
  return { name: name || 'home', params: rest, raw };
}

export function coins() {
  return state.user?.coins ?? 0;
}

export function spendLocal(amount) {
  if (state.user) state.user.coins = Math.max(0, state.user.coins - amount);
  bus.dispatchEvent(new Event('session'));
}
