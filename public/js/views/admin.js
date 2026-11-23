import { api, state } from '../store.js';
import { el, esc, fmtNum, qs, qsa, toast, icon, promptDialog, confirmDialog, timeAgo, roleBadge } from '../ui.js';
import { requireAuth } from './auth.js';
import { LEVELS } from './adminLevels.js';

export async function renderAdmin(root) {
  if (!requireAuth()) return { title: 'Admin' };
  if ((state.user.role || 0) < 1) {
    root.innerHTML = `<div class="page"><div class="empty"><b>Staff only</b>Your account does not have moderation permissions.</div></div>`;
    return { title: 'Admin' };
  }

  root.innerHTML = `<div class="page">
    <div class="page-head">
      <div><h1>Admin console</h1><p>Platform-level moderation. In-game commands live in the world's Admin panel.</p></div>
      <button class="btn" data-refresh>Refresh</button>
    </div>
    <div class="stat-strip" data-stats></div>
    <div class="chips" style="margin:18px 0" data-tabs>
      <button class="chip active" data-tab="accounts">Accounts</button>
      <button class="chip" data-tab="online">Online</button>
      <button class="chip" data-tab="reports">Reports</button>
      <button class="chip" data-tab="logs">Command log</button>
    </div>
    <div data-body></div>
  </div>`;

  let data = null;
  let tab = 'accounts';

  const load = async () => {
    data = await api('/api/admin/overview');
    drawStats();
    draw();
  };

  const drawStats = () => {
    qs(root, '[data-stats]').innerHTML = `
      <div class="stat"><b>${fmtNum(data.stats.users)}</b><span>accounts</span></div>
      <div class="stat"><b>${fmtNum(data.stats.games)}</b><span>published worlds</span></div>
      <div class="stat"><b>${fmtNum(data.stats.visits)}</b><span>total visits</span></div>
      <div class="stat"><b>${data.online.length}</b><span>players in servers</span></div>
      <div class="stat"><b>${data.reports.filter((r) => r.status === 'open').length}</b><span>open reports</span></div>
      <div class="stat"><b>${LEVELS[data.level]}</b><span>your level</span></div>`;
  };

  const draw = () => {
    const body = qs(root, '[data-body]');
    if (tab === 'accounts') {
      body.innerHTML = `
        <div class="panel">
          <h3>Accounts</h3>
          <input class="input" data-search placeholder="Search usernames…" style="margin-bottom:12px" />
          <div data-accounts>${accountsTable(data.users)}</div>
        </div>`;
      qs(root, '[data-search]').addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        qs(root, '[data-accounts]').innerHTML = accountsTable(data.users.filter((u) => u.username.toLowerCase().includes(q)));
      });
    }

    if (tab === 'online') {
      body.innerHTML = `<div class="panel"><h3>Online players</h3>
        ${data.online.length ? data.online.map((p) => `<div class="server-row">
          <div><b>${esc(p.name)}</b> <span class="badge">${LEVELS[p.level]}</span>
            <div class="hint">in ${esc(p.gameName)}</div></div>
          <a class="btn btn-sm" href="#/game/${esc(p.gameId)}">Open world</a>
        </div>`).join('') : '<div class="empty">Nobody is playing right now.</div>'}
      </div>`;
    }

    if (tab === 'reports') {
      body.innerHTML = `<div class="panel"><h3>Reports</h3>
        ${data.reports?.length ? data.reports.map((r) => `<div class="server-row" style="align-items:flex-start;flex-direction:column;gap:6px">
          <div style="display:flex;justify-content:space-between;width:100%;gap:10px">
            <b>${esc(r.reason)}</b><span class="badge">${esc(r.status)}</span>
          </div>
          <div class="hint">target ${esc(r.target_id.slice(0, 12))} · ${timeAgo(r.created_at)} · game ${esc(r.game_id || '—')}</div>
        </div>`).join('') : '<div class="empty">No reports. A quiet server is a good server.</div>'}
      </div>`;
    }

    if (tab === 'logs') {
      body.innerHTML = `<div class="panel"><h3>Command log</h3>
        ${data.logs.length ? data.logs.map((l) => `<div class="log-row ${l.ok ? 'ok' : 'fail'}">
          <time>${new Date(l.created_at).toLocaleString()}</time> · <b>${esc(l.actor_name)}</b> · ${esc(l.raw)}
          ${l.message ? ` — ${esc(l.message)}` : ''}
        </div>`).join('') : '<div class="empty">No commands have been run yet.</div>'}
      </div>`;
    }
  };

  const accountsTable = (users) => `
    <div style="display:flex;flex-direction:column;gap:6px">
      ${users.map((u) => `<div class="pl-row">
        <div class="info"><b>${esc(u.username)}</b>
          <span>${fmtNum(u.coins)} Sparks · joined ${timeAgo(u.created_at)}${u.banned_until > Date.now() ? ' · banned' : ''}</span></div>
        ${roleBadge(u.role)}
        <select class="select" style="width:118px" data-role="${esc(u.id)}" ${state.user.role < 3 || u.id === state.user.id ? 'disabled' : ''}>
          ${[0, 1, 2, 3].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${LEVELS[r]}</option>`).join('')}
        </select>
        <button class="btn btn-sm" data-grant="${esc(u.id)}" ${state.user.role < 2 ? 'disabled' : ''}>Give</button>
        ${u.banned_until > Date.now()
          ? `<button class="btn btn-sm btn-good" data-unban="${esc(u.id)}">Unban</button>`
          : `<button class="btn btn-sm btn-danger" data-ban="${esc(u.id)}" ${state.user.role < 2 || u.role >= state.user.role ? 'disabled' : ''}>Ban</button>`}
      </div>`).join('')}
    </div>`;

  qsa(root, '[data-tab]').forEach((btn) => btn.addEventListener('click', () => {
    tab = btn.dataset.tab;
    qsa(root, '[data-tab]').forEach((b) => b.classList.toggle('active', b === btn));
    draw();
  }));

  qs(root, '[data-refresh]').addEventListener('click', () => load().then(() => toast('Refreshed.', 'good')));

  root.addEventListener('change', async (e) => {
    const roleSelect = e.target.closest('[data-role]');
    if (!roleSelect) return;
    try {
      await api('/api/admin/role', { method: 'POST', body: { userId: roleSelect.dataset.role, role: Number(roleSelect.value) } });
      toast('Role updated.', 'good');
      load();
    } catch (err) {
      toast(err.message, 'bad');
      load();
    }
  });

  root.addEventListener('click', async (e) => {
    const ban = e.target.closest('[data-ban]');
    if (ban) {
      const hours = await promptDialog({
        title: 'Ban account',
        label: 'Duration in hours (0 = permanent)',
        value: '24',
        confirm: 'Ban',
        danger: true,
      });
      if (hours === null) return;
      try {
        await api('/api/admin/ban', { method: 'POST', body: { userId: ban.dataset.ban, hours: Number(hours) || 0, reason: 'Platform moderation' } });
        toast('Account banned.', 'good');
        load();
      } catch (err) { toast(err.message, 'bad'); }
      return;
    }

    const unban = e.target.closest('[data-unban]');
    if (unban) {
      try {
        await api('/api/admin/unban', { method: 'POST', body: { userId: unban.dataset.unban } });
        toast('Ban lifted.', 'good');
        load();
      } catch (err) { toast(err.message, 'bad'); }
      return;
    }

    const grant = e.target.closest('[data-grant]');
    if (grant) {
      const itemId = await promptDialog({
        title: 'Grant a catalog item',
        label: 'Item id or name',
        placeholder: 'hat.crown',
        confirm: 'Grant',
      });
      if (!itemId) return;
      try {
        await api('/api/admin/grant', { method: 'POST', body: { userId: grant.dataset.grant, itemId } });
        toast('Item granted.', 'good');
      } catch (err) { toast(err.message, 'bad'); }
    }
  });

  try {
    await load();
  } catch (err) {
    root.innerHTML = `<div class="page"><div class="empty"><b>Access denied</b>${esc(err.message)}</div></div>`;
  }

  return { title: 'Admin' };
}
