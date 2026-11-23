import { api, state, navigate } from '../store.js';
import { el, esc, fmtNum, qs, toast, glyphFor, roleBadge, timeAgo, icon, promptDialog } from '../ui.js';
import { requireAuth } from './auth.js';

export async function renderGame(root, { params }) {
  const id = params[0];
  if (!id) {
    navigate('discover');
    return { title: 'Discover' };
  }

  root.innerHTML = `<div class="page"><div class="empty"><b>Loading world…</b></div></div>`;
  let data;
  try {
    data = await api(`/api/games/${encodeURIComponent(id)}`);
  } catch (err) {
    root.innerHTML = `<div class="page"><div class="empty"><b>World unavailable</b>${esc(err.message)}</div></div>`;
    return { title: 'Not found' };
  }

  const game = data.game;
  const ownerLevel = game.ownerId === state.user?.id ? 3 : 0;
  const capacity = Math.max(1, game.maxPlayers);
  const fill = Math.min(100, Math.round((game.playing / capacity) * 100));

  root.innerHTML = `<div class="page">
    <div class="detail-banner thumb" data-thumb="${esc(game.thumb)}">
      <div class="grid-lines"></div>
      <div class="glyph-big">${glyphFor(game)}</div>
      <div class="inner">
        <div>
          <h1>${esc(game.name)}</h1>
          <div class="byline">
            by <a href="#/discover?q=${encodeURIComponent(game.ownerName)}" style="color:#9ab8ff;font-weight:650">${esc(game.ownerName)}</a>
            ${roleBadge(ownerLevel)}
            <span class="badge">${game.published ? 'Published' : 'Draft'}</span>
            <span class="badge">v${game.version}</span>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${game.canEdit ? `<a class="btn" href="#/studio/${esc(game.id)}">${icon('hammer')} Edit in Studio</a>` : ''}
          <button class="btn btn-primary btn-lg" data-play>${icon('play')} Play</button>
        </div>
      </div>
    </div>

    <div class="stat-strip">
      <div class="stat"><b>${fmtNum(game.visits)}</b><span>visits</span></div>
      <div class="stat"><b>${fmtNum(game.likes)}</b><span>likes</span></div>
      <div class="stat"><b>${game.playing}/${capacity}</b><span>in server</span></div>
      <div class="stat"><b>${fmtNum((game.parts || []).length)}</b><span>parts</span></div>
      <div class="stat"><b>${timeAgo(game.updatedAt)}</b><span>updated</span></div>
      <div class="stat" style="margin-left:auto"><button class="btn btn-sm" data-like>👍 Like</button>
        <button class="btn btn-sm btn-ghost" data-report>Report</button></div>
    </div>

    <div class="detail-grid">
      <div style="display:flex;flex-direction:column;gap:18px">
        <div class="panel">
          <h3>About this world</h3>
          <p class="prose">${esc(game.description || 'No description yet.')}</p>
        </div>
        <div class="panel">
          <h3>Controls</h3>
          <div class="prose" style="display:grid;grid-template-columns:auto 1fr;gap:7px 14px;font-size:13px">
            <kbd>W A S D</kbd><span style="color:#b9c4d8">Move</span>
            <kbd>Space</kbd><span style="color:#b9c4d8">Jump / rise while flying</span>
            <kbd>Shift</kbd><span style="color:#b9c4d8">Descend while flying</span>
            <kbd>Drag</kbd><span style="color:#b9c4d8">Orbit camera, scroll to zoom</span>
            <kbd>Enter</kbd><span style="color:#b9c4d8">Chat</span>
            <kbd>E</kbd><span style="color:#b9c4d8">Play your emote</span>
            <kbd>;</kbd><span style="color:#b9c4d8">Admin command, e.g. <code>;fly</code></span>
          </div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:18px">
        <div class="panel">
          <h3>Servers</h3>
          <div class="server-list">
            <div class="server-row">
              <div><b>${esc(game.name)}</b><div class="hint">Region: local · Tick 30Hz</div></div>
              <div style="display:flex;align-items:center;gap:10px">
                <span class="hint">${game.playing}/${capacity}</span>
                <span class="bar"><i style="width:${fill}%"></i></span>
              </div>
            </div>
          </div>
          <button class="btn btn-primary btn-block" style="margin-top:12px" data-play>${icon('play')} Join server</button>
          <p class="hint" style="margin-top:9px">Every server is authoritative: movement is validated and commands are permission-checked on the server.</p>
        </div>
        <div class="panel">
          <h3>Creator</h3>
          <div style="display:flex;align-items:center;gap:10px">
            <div class="swatch-dot" style="width:38px;height:38px;border-radius:12px;background:linear-gradient(140deg,#5b8cff,#a855f7)"></div>
            <div><b>${esc(game.ownerName)}</b><div class="hint">${game.published ? 'Published creator' : 'Unpublished draft'}</div></div>
          </div>
        </div>
      </div>
    </div>
  </div>`;

  const startPlay = () => {
    if (!requireAuth()) return;
    navigate(`play/${game.id}`);
  };

  root.querySelectorAll('[data-play]').forEach((btn) => btn.addEventListener('click', startPlay));

  qs(root, '[data-like]').addEventListener('click', async () => {
    if (!requireAuth()) return;
    try {
      const res = await api(`/api/games/${game.id}/like`, { method: 'POST' });
      qs(root, '[data-like]').textContent = `👍 ${fmtNum(res.likes)}`;
      toast('Liked. The creator will never know it was you.', 'good');
    } catch (err) {
      toast(err.message, 'bad');
    }
  });

  qs(root, '[data-report]').addEventListener('click', async () => {
    if (!requireAuth()) return;
    const reason = await promptDialog({
      title: 'Report this world',
      label: 'What is wrong with it?',
      placeholder: 'Inappropriate content, broken spawn, …',
      confirm: 'Send report',
    });
    if (!reason) return;
    try {
      await api('/api/reports', { method: 'POST', body: { targetId: game.ownerId, gameId: game.id, reason } });
      toast('Report sent to moderators.', 'good');
    } catch (err) {
      toast(err.message, 'bad');
    }
  });

  return { title: game.name };
}
