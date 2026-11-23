// DOM + formatting helpers shared by every view.

export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

export function el(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

export const qs = (root, sel) => root.querySelector(sel);
export const qsa = (root, sel) => [...root.querySelectorAll(sel)];

export function on(root, sel, event, handler) {
  root.addEventListener(event, (e) => {
    const target = e.target.closest(sel);
    if (target && root.contains(target)) handler(e, target);
  });
}

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  spark: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" fill="currentColor" stroke="none"/>',
  play: '<path d="M7 4.5v15l13-7.5-13-7.5z" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5m6-7-7 7 7 7"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
  users: '<circle cx="9" cy="8" r="3.4"/><path d="M2.5 20c0-3.4 3-5.4 6.5-5.4s6.5 2 6.5 5.4"/><path d="M17 5.2a3.4 3.4 0 0 1 0 6.6M18 20c0-2.6-.8-4.2-2-5"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
  hammer: '<path d="m14 3 7 7-3 3-7-7 3-3z"/><path d="m11 6-8 8v4h4l8-8"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.4 8.3-8 9-4.6-.7-8-4-8-9V6l8-3z"/>',
  eye: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>',
  send: '<path d="M4 12 20 4l-6 16-3.5-6.5L4 12z"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3m0 14v3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M2 12h3m14 0h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  cube: '<path d="M12 2.6 21 7.4v9.2L12 21.4 3 16.6V7.4l9-4.8z"/><path d="M12 2.6v9.4m0 0 9-4.6M12 12 3 7.4"/>',
  wifi: '<path d="M2.5 8.5a15 15 0 0 1 19 0"/><path d="M5.5 12a10.5 10.5 0 0 1 13 0"/><path d="M8.5 15.4a6 6 0 0 1 7 0"/><circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>',
  move: '<path d="M12 3v18M3 12h18"/><path d="m8 7 4-4 4 4M8 17l4 4 4-4M7 8 3 12l4 4M17 8l4 4-4 4"/>',
  scale: '<path d="M4 20h6M4 20v-6M20 4h-6M20 4v6"/><path d="m4 20 6-6M20 4l-6 6"/>',
  trash: '<path d="M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13"/>',
  save: '<path d="M5 3h11l4 4v14H4V3z"/><path d="M8 3v6h7V3M8 21v-6h8v6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5.5A2.5 2.5 0 0 0 12.5 3H6a2 2 0 0 0-2 2v9"/>',
  bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/>',
  flag: '<path d="M5 21V4m0 0 12 3-12 5"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
};

export function icon(name, cls = '') {
  const body = ICONS[name] || '';
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function fmtNum(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 10_000) return `${Math.round(v / 1000)}K`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return String(v);
}

export function fmtFull(n) {
  return (Number(n) || 0).toLocaleString();
}

export function timeAgo(ts) {
  const diff = Date.now() - Number(ts || 0);
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(Number(ts)).toLocaleDateString();
}

const GLYPHS = [
  [/obby|parkour|jump/i, '🏁'],
  [/tower|spire|climb/i, '🗼'],
  [/garden|sculpt|museum/i, '🗿'],
  [/house|home|village|tycoon/i, '🏠'],
  [/base|build|lab|sandbox|plate/i, '🧱'],
  [/defen|battle|fight|arena/i, '⚔️'],
  [/speed|race|drive/i, '🏎️'],
];

export function glyphFor(game) {
  for (const [rx, glyph] of GLYPHS) if (rx.test(game?.name || '')) return glyph;
  return '🧊';
}

export function thumb(theme, glyph, { playing = 0, big = false } = {}) {
  return `<div class="thumb" data-thumb="${esc(theme || 'aurora')}"${big ? ' style="border-radius:22px"' : ''}>
    <div class="grid-lines"></div>
    <div class="glyph">${glyph || '🧊'}</div>
    ${playing ? `<div class="playing"><b>●</b> ${fmtNum(playing)} playing</div>` : ''}
  </div>`;
}

export function gameCard(game) {
  return `<a class="game-card" href="#/game/${esc(game.id)}">
    ${thumb(game.thumb, glyphFor(game), { playing: game.playing })}
    <div class="meta">
      <h3>${esc(game.name)}</h3>
    </div>
    <div class="sub">
      <span>${esc(game.ownerName || 'unknown')}</span>
      <i class="dot"></i>
      <span>${fmtNum(game.visits)} visits</span>
      <i class="dot"></i>
      <span>👍 ${fmtNum(game.likes)}</span>
    </div>
  </a>`;
}

export function roleBadge(level) {
  if (level >= 3) return '<span class="badge badge-owner">Owner</span>';
  if (level === 2) return '<span class="badge badge-admin">Admin</span>';
  if (level === 1) return '<span class="badge badge-mod">Mod</span>';
  return '';
}

export function avatarFace(avatar) {
  const face = avatar?.face || 'face.smile';
  const map = {
    'face.smile': '🙂', 'face.happy': '😄', 'face.cool': '😎',
    'face.angry': '😠', 'face.shock': '😱', 'face.robot': '🤖',
  };
  return map[face] || '🙂';
}

export function avatarChip(avatar) {
  return `<span class="swatch-dot" style="background:linear-gradient(140deg, ${esc(avatar?.shirt || '#3b82f6')}, ${esc(avatar?.pants || '#1e293b')})"></span>`;
}

// ---- toasts ---------------------------------------------------------------

export function toast(text, kind = 'info', ms = 4200) {
  const root = document.getElementById('toasts');
  if (!root) return;
  const node = el(`<div class="toast ${kind}"><i class="bar"></i><div>${esc(text)}</div></div>`);
  root.appendChild(node);
  const kill = () => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 200);
  };
  const timer = setTimeout(kill, ms);
  node.addEventListener('click', () => { clearTimeout(timer); kill(); });
  return kill;
}

// ---- modals ---------------------------------------------------------------

export function modal(innerHtml, { wide = false, onMount } = {}) {
  const root = document.getElementById('modal-root');
  const backdrop = el(`<div class="modal-backdrop"><div class="modal ${wide ? 'wide' : ''}">${innerHtml}</div></div>`);
  root.appendChild(backdrop);

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });

  if (onMount) onMount(backdrop.firstElementChild, close);
  return { root: backdrop, card: backdrop.firstElementChild, close };
}

export function confirmDialog({ title = 'Are you sure?', message = '', confirm = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    const m = modal(`
      <h2>${esc(title)}</h2>
      <p class="modal-sub">${esc(message)}</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-act="cancel">Cancel</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${esc(confirm)}</button>
      </div>
    `);
    m.card.querySelector('[data-act="cancel"]').onclick = () => { m.close(); resolve(false); };
    m.card.querySelector('[data-act="ok"]').onclick = () => { m.close(); resolve(true); };
  });
}

export function promptDialog({ title, label = '', value = '', placeholder = '', confirm = 'Save', danger = false } = {}) {
  return new Promise((resolve) => {
    const m = modal(`
      <h2>${esc(title)}</h2>
      <div class="field" style="margin-top:14px">
        ${label ? `<label>${esc(label)}</label>` : ''}
        <input class="input" data-input value="${esc(value)}" placeholder="${esc(placeholder)}" />
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-act="cancel">Cancel</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${esc(confirm)}</button>
      </div>
    `);
    const input = m.card.querySelector('[data-input]');
    input.focus();
    input.select();
    const done = (v) => { m.close(); resolve(v); };
    m.card.querySelector('[data-act="cancel"]').onclick = () => done(null);
    m.card.querySelector('[data-act="ok"]').onclick = () => done(input.value.trim() || null);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input.value.trim() || null);
    });
  });
}
