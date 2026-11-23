// Worlds saved on this device. Exists so a tablet can open Blockforge on a bus
// with no internet and still play the places it has already visited.
import { state } from '../store.js';
import { esc, icon, toast } from '../ui.js';

function readSaved() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('bf:world:')) continue;
      let data;
      try { data = JSON.parse(localStorage.getItem(key)); } catch { continue; }
      const game = data?.game;
      if (!game?.id || !Array.isArray(game.parts) || !game.parts.length) continue;
      out.push({
        id: game.id,
        name: game.name || 'Untitled place',
        parts: game.parts.length,
        version: game.version || 1,
        at: Number(data.at) || 0,
      });
    }
  } catch { /* storage blocked */ }
  return out.sort((a, b) => b.at - a.at);
}

const when = (ms) => {
  if (!ms) return 'saved';
  const mins = Math.round((Date.now() - ms) / 60_000);
  if (mins < 1) return 'saved just now';
  if (mins < 60) return `saved ${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `saved ${hours} h ago`;
  return `saved ${Math.round(hours / 24)} d ago`;
};

export async function renderOffline(root) {
  let saved = readSaved();

  const draw = () => {
    root.innerHTML = `<div class="page saved-page">
      <header class="saved-head">
        <span class="hero-eyebrow"><i></i> ${state.offline || !navigator.onLine ? 'Offline right now' : 'On this device'}</span>
        <h1>Worlds saved on this ${/iPad|Tablet/i.test(navigator.userAgent) ? 'tablet' : 'device'}</h1>
        <p>
          Open a world once while online and a copy is kept here. Later, with no internet at all,
          open it from this page and keep playing solo. Progress is stored on this device.
        </p>
      </header>

      ${saved.length ? `<div class="saved-grid" data-saved-grid>
        ${saved.map((w) => `<article class="saved-card" data-saved="${esc(w.id)}">
          <a class="saved-open" href="#/play/${esc(w.id)}">
            <span class="saved-thumb">${icon('cube')}</span>
            <span class="saved-body">
              <b>${esc(w.name)}</b>
              <span class="hint">${w.parts} parts · v${w.version} · ${when(w.at)}</span>
            </span>
            <span class="saved-play">${icon('play')} Play</span>
          </a>
          <button class="saved-forget" data-forget="${esc(w.id)}" title="Remove this saved copy">Remove</button>
        </article>`).join('')}
      </div>` : `<div class="empty saved-empty">
        <b>No worlds saved yet</b>
        Join any published world while you have internet once. After that it shows up here and
        can be played on the bus, in the car, or anywhere without a signal.
        <div style="margin-top:14px"><a class="btn btn-primary" href="#/discover">Find a world</a></div>
      </div>`}

      <div class="nearby-tip" style="margin-top:18px">
        <b>${icon('wifi')} How saving works</b>
        Each visited world keeps its parts and your last position on this device only.
        No internet means no shared server: you play alone, and nothing syncs until you are
        back online. The same world can still be played with friends once a server is reachable.
      </div>

      <p class="nearby-note">
        Tip: install Blockforge from the browser menu (“Add to Home Screen”) so it opens
        fullscreen and works offline like an app.
      </p>
    </div>`;
  };

  draw();

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-forget]');
    if (!btn) return;
    const id = btn.dataset.forget;
    try {
      localStorage.removeItem(`bf:world:${id}`);
      localStorage.removeItem(`bf:progress:${id}`);
    } catch { /* ignore */ }
    saved = readSaved();
    draw();
    toast('Saved copy removed.', 'warn');
  });

  return { title: 'Saved worlds' };
}
