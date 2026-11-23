// In-world staff panel. It is a client for the command engine — every action
// below turns into a `;command` string that the server re-validates.

import { api, state } from '../store.js';
import { el, esc, icon, qs, qsa, toast, promptDialog, roleBadge, avatarChip } from '../ui.js';
import { LEVELS } from './adminLevels.js';

const TABS = ['players', 'commands', 'permissions', 'history'];

export function createAdminPanel({ level, gameId, worldName, getPlayers, sendCommand }) {
  const root = el(`<aside class="admin-panel hidden" aria-label="Admin panel"></aside>`);
  let tab = 'players';
  let commandFilter = '';
  let users = [];
  let logs = [];
  let usersLoaded = false;
  const localLogs = [];

  const commands = [
    { cmd: ';fly', level: 1, desc: 'Toggle flight' },
    { cmd: ';unfly', level: 1, desc: 'Stop flying' },
    { cmd: ';speed 32', level: 1, desc: 'Set walk speed' },
    { cmd: ';jump 60', level: 1, desc: 'Set jump power' },
    { cmd: ';invisible', level: 1, desc: 'Hide yourself' },
    { cmd: ';visible', level: 1, desc: 'Show yourself' },
    { cmd: ';bring ', level: 1, desc: 'Teleport a player to you' },
    { cmd: ';to ', level: 1, desc: 'Teleport to a player' },
    { cmd: ';freeze ', level: 1, desc: 'Freeze a player' },
    { cmd: ';unfreeze ', level: 1, desc: 'Unfreeze a player' },
    { cmd: ';heal ', level: 1, desc: 'Respawn a player' },
    { cmd: ';announce ', level: 1, desc: 'Server-wide announcement' },
    { cmd: ';kick ', level: 2, desc: 'Kick from this server' },
    { cmd: ';ban ', level: 2, desc: 'Ban (online or offline)' },
    { cmd: ';unban ', level: 2, desc: 'Lift a ban' },
    { cmd: ';give ', level: 2, desc: 'Grant a catalog item' },
    { cmd: ';coins ', level: 2, desc: 'Adjust Sparks' },
    { cmd: ';history', level: 2, desc: 'Recent actions in this server' },
    { cmd: ';role ', level: 3, desc: 'Set platform permission level' },
    { cmd: ';shutdown', level: 3, desc: 'Shut down the server' },
  ];

  const header = () => `
    <div class="admin-head">
      <h2>${icon('shield')} Admin panel ${roleBadge(level)}</h2>
      <button class="btn btn-sm btn-ghost" data-close>${icon('close')}</button>
    </div>
    <div class="admin-tabs">
      ${TABS.map((t) => `<button data-tab="${t}" class="${t === tab ? 'active' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
    </div>`;

  const playersBody = () => {
    const players = getPlayers();
    if (!players.length) return `<div class="empty">Nobody else here yet.</div>`;
    return players.map((p) => `
      <div class="pl-row" data-player="${esc(p.id)}">
        ${avatarChip(p.avatar)}
        <div class="info">
          <b>${esc(p.name)}${p.id === state.user?.id ? ' (you)' : ''}</b>
          <span>${LEVELS[p.level] || 'Player'}${p.frozen ? ' · frozen' : ''}${p.fly ? ' · flying' : ''}</span>
        </div>
        <div class="pl-actions">
          <button class="btn btn-sm btn-ghost" data-cmd=";to ${esc(p.name)}" title="Teleport to player">To</button>
          <button class="btn btn-sm btn-ghost" data-cmd=";bring ${esc(p.name)}" title="Bring to you">Bring</button>
          <button class="btn btn-sm btn-ghost" data-cmd=";${p.frozen ? 'unfreeze' : 'freeze'} ${esc(p.name)}">${p.frozen ? 'Unfreeze' : 'Freeze'}</button>
          <button class="btn btn-sm btn-ghost" data-give="${esc(p.name)}">Give</button>
          <button class="btn btn-sm btn-ghost" data-cmd=";kick ${esc(p.name)} " title="Kick">Kick</button>
          <button class="btn btn-sm btn-danger" data-cmd=";ban ${esc(p.name)} " title="Ban">Ban</button>
        </div>
      </div>`).join('');
  };

  const commandsBody = () => {
    const list = commands
      .filter((c) => c.level <= level)
      .filter((c) => !commandFilter || c.cmd.toLowerCase().includes(commandFilter) || c.desc.toLowerCase().includes(commandFilter));
    return `
      <input class="input" data-filter placeholder="Filter commands…" value="${esc(commandFilter)}" />
      <div class="admin-section-title">${list.length} commands unlocked</div>
      ${list.map((c) => `<div class="cmd-row" data-insert="${esc(c.cmd)}">
        <code>${esc(c.cmd)}</code>
        <span class="lvl">L${c.level} · ${esc(c.desc)}</span>
      </div>`).join('')}
      <p class="hint">Commands can also be typed in chat: <code>;speed 48</code>. Everything is checked server-side.</p>`;
  };

  const permissionsBody = () => {
    if ((state.user?.role || 0) < 3) {
      return `<div class="empty"><b>Read-only</b>Changing platform permissions requires the Owner role. You can still moderate this server.</div>`;
    }
    if (!usersLoaded) return `<div class="empty">Loading accounts…</div>`;
    return `
      <input class="input" data-user-filter placeholder="Search accounts…" />
      <div class="admin-section-title">Platform roles</div>
      ${users.map((u) => `<div class="pl-row" data-account="${esc(u.id)}">
        <div class="info"><b>${esc(u.username)}</b><span>${u.coins} Sparks${u.banned_until > Date.now() ? ' · banned' : ''}</span></div>
        <select class="select" style="width:126px" data-role="${esc(u.id)}">
          ${[0, 1, 2, 3].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${LEVELS[r]}</option>`).join('')}
        </select>
      </div>`).join('')}`;
  };

  const historyBody = () => {
    const rows = [...localLogs, ...logs].slice(0, 40);
    if (!rows.length) return `<div class="empty">No commands logged in this server yet.</div>`;
    return rows.map((row) => {
      const when = new Date(row.created_at || row.at || Date.now());
      return `<div class="log-row ${row.ok ? 'ok' : 'fail'}">
        <time>${when.toLocaleTimeString()}</time> ${esc(row.actor_name || row.actor || '?')}: ${esc(row.raw)}
        ${row.message ? ` — ${esc(row.message)}` : ''}
      </div>`;
    }).join('');
  };

  const draw = () => {
    const body = tab === 'players' ? playersBody()
      : tab === 'commands' ? commandsBody()
      : tab === 'permissions' ? permissionsBody()
      : historyBody();

    root.innerHTML = `${header()}
      <div class="admin-body" data-body>
        ${tab === 'history' ? `<button class="btn btn-sm" data-refresh-history>Refresh log</button>` : ''}
        ${body}
      </div>`;

    if (tab === 'permissions' && !usersLoaded) loadUsers();
  };

  const loadUsers = async () => {
    try {
      const data = await api('/api/admin/overview');
      users = data.users || [];
      logs = (data.logs || []).filter((l) => l.game_id === gameId);
      usersLoaded = true;
      if (tab === 'permissions') draw();
    } catch (err) {
      usersLoaded = true;
      toast(err.message, 'bad');
    }
  };

  const logCommand = (raw, ok, message = '') => {
    localLogs.unshift({ raw, ok, message, at: Date.now(), actor_name: state.user?.username });
    if (tab === 'history') draw();
  };

  root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) {
      root.classList.add('hidden');
      return;
    }
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
      tab = tabBtn.dataset.tab;
      if (tab === 'history' && !usersLoaded) loadUsers();
      draw();
      return;
    }
    const insert = e.target.closest('[data-insert]');
    if (insert) {
      const value = insert.dataset.insert;
      const input = document.querySelector('[data-chat-input]');
      if (input) {
        input.value = value;
        input.focus();
        input.setSelectionRange(value.length, value.length);
      }
      return;
    }
    const cmdBtn = e.target.closest('[data-cmd]');
    if (cmdBtn) {
      const cmd = cmdBtn.dataset.cmd;
      const needsMore = cmd.endsWith(' ');
      if (needsMore) {
        const extra = await promptDialog({
          title: 'Complete the command',
          label: cmd.trim(),
          placeholder: 'reason / duration / value',
          confirm: 'Run',
        });
        if (!extra) return;
        const full = `${cmd}${extra}`;
        sendCommand(full);
        logCommand(full, true, 'sent');
      } else {
        sendCommand(cmd);
        logCommand(cmd, true, 'sent');
      }
      return;
    }
    const giveBtn = e.target.closest('[data-give]');
    if (giveBtn) {
      const item = await promptDialog({
        title: `Give an item to ${giveBtn.dataset.give}`,
        label: 'Item id or name (e.g. hat.crown, "Dev Halo")',
        placeholder: 'hat.crown',
        confirm: 'Give',
      });
      if (!item) return;
      const cmd = `;give ${giveBtn.dataset.give} ${item}`;
      sendCommand(cmd);
      logCommand(cmd, true, 'sent');
      return;
    }
    if (e.target.closest('[data-refresh-history]')) {
      usersLoaded = false;
      await loadUsers();
      return;
    }
  });

  root.addEventListener('input', (e) => {
    if (e.target.matches('[data-filter]')) {
      commandFilter = e.target.value.toLowerCase();
      const body = qs(root, '[data-body]');
      body.innerHTML = commandsBody();
      body.querySelector('[data-filter]')?.focus();
    }
  });

  root.addEventListener('change', async (e) => {
    const select = e.target.closest('[data-role]');
    if (!select) return;
    try {
      await api('/api/admin/role', { method: 'POST', body: { userId: select.dataset.role, role: Number(select.value) } });
      toast('Permission level updated.', 'good');
    } catch (err) {
      toast(err.message, 'bad');
    }
  });

  draw();

  return {
    root,
    refresh() {
      if (tab === 'players') draw();
    },
    open(tabName) {
      if (tabName) tab = tabName;
      root.classList.remove('hidden');
      draw();
    },
    close() {
      root.classList.add('hidden');
    },
    toggle() {
      if (root.classList.contains('hidden')) this.open();
      else this.close();
    },
    noteCommand(raw, ok, message) {
      logCommand(raw, ok, message);
    },
    destroy() {
      root.remove();
    },
  };
}
