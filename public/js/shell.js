import { state, isStaff, currentRoute } from './store.js';
import { fmtNum, icon } from './ui.js';

const LOGO = `<svg viewBox="0 0 64 64" aria-hidden="true">
  <defs><linearGradient id="bflogo" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#5b8cff"/><stop offset="0.5" stop-color="#a855f7"/><stop offset="1" stop-color="#22d3ee"/>
  </linearGradient></defs>
  <path d="M32 8 54 20v24L32 56 10 44V20z" fill="none" stroke="url(#bflogo)" stroke-width="4" stroke-linejoin="round"/>
  <path d="M32 8v24m0 0 22-12M32 32 10 20m22 12v24" stroke="url(#bflogo)" stroke-width="3" stroke-linecap="round" opacity=".85"/>
  <circle cx="32" cy="32" r="3.6" fill="#fff"/>
</svg>`;

export function navMarkup() {
  const { name } = currentRoute();
  const cls = (...names) => (names.includes(name) ? 'active' : '');
  const user = state.user;

  return `
    <a class="brand" href="#/home">${LOGO} Block<em>forge</em></a>
    <nav class="nav">
      <a href="#/home" class="${cls('home', 'discover', 'game')}">Discover</a>
      <a href="#/offline" class="${cls('offline')}" title="Worlds saved for offline play">Saved</a>
      <a href="#/create" class="${cls('create', 'studio')}">Studio</a>
      <a href="#/avatar" class="${cls('avatar')}">Avatar</a>
      <a href="#/shop" class="${cls('shop')}">Shop</a>
      ${isStaff() ? `<a href="#/admin" class="${cls('admin')}"><span style="opacity:.85">${icon('shield')}</span> Admin</a>` : ''}
    </nav>
    <div class="topbar-spacer"></div>
    <form class="search" role="search">
      ${icon('search')}
      <input name="q" type="search" placeholder="Search games and creators" autocomplete="off" aria-label="Search" />
    </form>
    <div class="topbar-right">
      ${user
        ? `<a class="sparks" href="#/shop" title="Your Sparks">${icon('spark')} ${fmtNum(user.coins)}</a>
           <button class="userchip" data-act="usermenu" aria-haspopup="menu">
             <span class="face-orb">${faceEmoji(user.avatar)}</span>
             <span>${escapeHtml(user.username)}</span>
           </button>
           <div class="usermenu hidden" data-menu>
             <a href="#/avatar">${icon('user')} Avatar</a>
             <a href="#/create">${icon('hammer')} My creations</a>
             <a href="#/shop">${icon('spark')} Spark shop</a>
             ${isStaff() ? `<a href="#/admin">${icon('shield')} Admin console</a>` : ''}
             <hr />
             <button data-act="logout">${icon('logout')} Sign out</button>
           </div>`
        : `<a class="btn btn-ghost btn-sm" href="#/login">Sign in</a>
           <a class="btn btn-primary btn-sm" href="#/register">Join free</a>`}
    </div>
  `;
}

function faceEmoji(avatar) {
  const map = {
    'face.smile': '🙂', 'face.happy': '😄', 'face.cool': '😎',
    'face.angry': '😠', 'face.shock': '😱', 'face.robot': '🤖',
  };
  return map[avatar?.face] || '🙂';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** Delegated bindings survive header re-renders. */
export function bindNav(header, { onSearch, onLogout }) {
  if (!header || header.dataset.bound === '1') return;
  header.dataset.bound = '1';

  header.addEventListener('submit', (e) => {
    const form = e.target.closest('form.search');
    if (!form) return;
    e.preventDefault();
    const term = new FormData(form).get('q') || '';
    onSearch(String(term));
    form.querySelector('input').blur();
  });

  header.addEventListener('click', (e) => {
    const logoutBtn = e.target.closest('[data-act="logout"]');
    if (logoutBtn) {
      e.preventDefault();
      onLogout();
      return;
    }
    const menuBtn = e.target.closest('[data-act="usermenu"]');
    if (menuBtn) {
      e.preventDefault();
      header.querySelector('[data-menu]')?.classList.toggle('hidden');
      return;
    }
    if (!e.target.closest('[data-menu]')) {
      header.querySelector('[data-menu]')?.classList.add('hidden');
    }
  });
}

export function refreshNav() {
  const header = document.querySelector('.topbar');
  if (!header) return;
  header.innerHTML = navMarkup();
}
