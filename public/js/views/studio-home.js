import { api, state, setSession, navigate } from '../store.js';
import { el, esc, fmtNum, glyphFor, qs, toast, thumb, timeAgo, icon, modal } from '../ui.js';
import { requireAuth } from './auth.js';

export async function renderStudioHome(root) {
  if (!requireAuth()) return { title: 'Studio' };

  root.innerHTML = `<div class="page">
    <div class="page-head">
      <div><h1>Studio</h1><p>Every place here is editable, publishable, and joins the same multiplayer servers.</p></div>
      <button class="btn btn-primary" data-new>${icon('plus')} New place</button>
    </div>
    <div data-list class="grid-games"></div>
  </div>`;

  const list = qs(root, '[data-list]');

  const draw = (games) => {
    if (!games.length) {
      list.innerHTML = `<div class="empty" style="grid-column:1/-1"><b>No places yet</b>Start from a template — baseplate, obby, tower, or a house — then shape it into anything.<br/><br/>
        <button class="btn btn-primary" data-new>${icon('plus')} Create your first place</button></div>`;
      return;
    }
    list.innerHTML = games.map((g) => `
      <div class="game-card" data-card="${esc(g.id)}">
        ${thumb(g.thumb, glyphFor(g))}
        <div class="meta">
          <h3>${esc(g.name)}</h3>
          <span class="badge ${g.published ? 'badge-good' : ''}">${g.published ? 'Live' : 'Draft'}</span>
        </div>
        <div class="sub"><span>v${g.version}</span><i class="dot"></i><span>${fmtNum(g.parts ?? 0)} parts</span><i class="dot"></i><span>${timeAgo(g.updatedAt)}</span></div>
        <div style="display:flex;gap:6px">
          <a class="btn btn-sm btn-primary" href="#/studio/${esc(g.id)}">${icon('hammer')} Edit</a>
          <a class="btn btn-sm" href="#/play/${esc(g.id)}">${icon('play')} Test</a>
          <a class="btn btn-sm btn-ghost" href="#/game/${esc(g.id)}">Page</a>
        </div>
      </div>`).join('');
  };

  let games = [];
  try {
    const me = await api('/api/me');
    setSession(me);
    games = me.games || [];
  } catch (err) {
    toast(err.message, 'bad');
  }
  draw(games);

  const openCreate = async () => {
    let templates = [];
    try {
      templates = (await api('/api/games')).templates || [];
    } catch { /* ignore */ }

    const m = modal(`
      <h2>New place</h2>
      <p class="modal-sub">Pick a starting point. You can edit every part afterwards.</p>
      <div class="field"><label>Place name</label><input class="input" data-name placeholder="My awesome world" maxlength="48" /></div>
      <div class="option-grid" data-templates></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-cancel>Cancel</button>
        <button class="btn btn-primary" data-create>Create & open</button>
      </div>
    `);

    let chosen = templates[0]?.id || 'baseplate';
    const grid = m.card.querySelector('[data-templates]');
    grid.innerHTML = templates.map((t) => `
      <button class="option ${t.id === chosen ? 'active' : ''}" data-template="${esc(t.id)}">
        <span style="font-size:20px">${glyphFor({ name: t.name })}</span>
        <span>${esc(t.name)}</span>
        <small>${esc(t.blurb)}</small>
      </button>`).join('');

    grid.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-template]');
      if (!btn) return;
      chosen = btn.dataset.template;
      grid.querySelectorAll('[data-template]').forEach((b) => b.classList.toggle('active', b === btn));
    });

    m.card.querySelector('[data-cancel]').onclick = m.close;
    m.card.querySelector('[data-create]').onclick = async () => {
      const name = m.card.querySelector('[data-name]').value.trim() || 'Untitled place';
      const btn = m.card.querySelector('[data-create]');
      btn.disabled = true;
      try {
        const res = await api('/api/games', { method: 'POST', body: { name, template: chosen } });
        m.close();
        toast('Place created. Opening Studio…', 'good');
        navigate(`studio/${res.game.id}`);
      } catch (err) {
        toast(err.message, 'bad');
        btn.disabled = false;
      }
    };
    m.card.querySelector('[data-name]').focus();
  };

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-new]')) openCreate();
  });

  return { title: 'Studio' };
}
