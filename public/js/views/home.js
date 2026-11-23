import { api, state } from '../store.js';
import { el, esc, fmtNum, gameCard, glyphFor, thumb, qs, on, icon } from '../ui.js';

export async function renderHome(root) {
  root.innerHTML = `<div class="page">
    <div class="hero">
      <div class="hero-copy">
        <span class="hero-eyebrow"><i></i> The builder's universe</span>
        <h1>Build a world.<br /><em>Then let everyone in.</em></h1>
        <p>Blockforge is a multiplayer platform where every game is a place you can edit. Open the Studio, drag parts around, hit publish, and play it with friends in the same afternoon.</p>
        <div class="hero-actions">
          <a class="btn btn-primary btn-lg" href="#/create">${icon('hammer')} Open Studio</a>
          <a class="btn btn-lg" href="#/discover">${icon('play')} Browse games</a>
        </div>
        <div class="hero-stats">
          <div><b data-stat-users>—</b><span>builders</span></div>
          <div><b data-stat-games>—</b><span>live worlds</span></div>
          <div><b data-stat-visits>—</b><span>visits</span></div>
        </div>
      </div>
      <div class="hero-art" data-hero-art></div>
    </div>

    <section class="section nearby-cta">
      <div class="nearby-cta-card">
        <div class="nearby-cta-icon">${icon('wifi')}</div>
        <div class="nearby-cta-copy">
          <h2>No internet? Play on your Wi-Fi.</h2>
          <p>One device hosts the world. Everyone else scans a QR code and joins — a phone hotspot is enough.</p>
        </div>
        <a class="btn btn-primary" href="#/nearby">How it works →</a>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>Popular right now</h2>
        <a class="hint" href="#/discover">See all →</a>
      </div>
      <div class="row-scroll" data-row="popular"></div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Trending this week</h2></div>
      <div class="row-scroll" data-row="trending"></div>
    </section>

    <section class="section" data-owned hidden>
      <div class="section-head">
        <h2>Your creations</h2>
        <a class="hint" href="#/create">Manage →</a>
      </div>
      <div class="row-scroll" data-row="mine"></div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Freshly forged</h2></div>
      <div class="grid-games" data-row="new"></div>
    </section>
  </div>`;

  const { games, stats } = await api('/api/games?sort=popular');
  qs(root, '[data-stat-users]').textContent = fmtNum(stats.users);
  qs(root, '[data-stat-games]').textContent = fmtNum(stats.games);
  qs(root, '[data-stat-visits]').textContent = fmtNum(stats.visits);

  const popular = [...games].sort((a, b) => b.visits - a.visits);
  const trending = [...games].sort((a, b) => (b.likes * 3 + b.visits) - (a.likes * 3 + a.visits));
  const fresh = [...games].sort((a, b) => b.createdAt - a.createdAt);

  qs(root, '[data-row="popular"]').innerHTML = popular.slice(0, 10).map(gameCard).join('') || empty('No games yet');
  qs(root, '[data-row="trending"]').innerHTML = trending.slice(0, 10).map(gameCard).join('');
  qs(root, '[data-row="new"]').innerHTML = fresh.slice(0, 8).map(gameCard).join('');

  const heroArt = qs(root, '[data-hero-art]');
  heroArt.innerHTML = popular.slice(0, 4).map((g) => `
    <a class="mini thumb" data-thumb="${esc(g.thumb)}" href="#/game/${esc(g.id)}">
      <div class="grid-lines"></div>
      <div class="glyph" style="font-size:56px;position:absolute;left:12px;top:6px;opacity:.55">${glyphFor(g)}</div>
      <span>${esc(g.name)}</span>
    </a>`).join('');

  if (state.user) {
    const mine = (state.myGames || []).slice(0, 8);
    if (mine.length) {
      qs(root, '[data-owned]').hidden = false;
      qs(root, '[data-row="mine"]').innerHTML = mine.map((g) => `
        <a class="game-card" href="#/studio/${esc(g.id)}">
          ${thumb(g.thumb, glyphFor(g))}
          <div class="meta"><h3>${esc(g.name)}</h3>
            <span class="badge ${g.published ? 'badge-good' : ''}">${g.published ? 'Live' : 'Draft'}</span>
          </div>
          <div class="sub"><span>v${g.version}</span><i class="dot"></i><span>${fmtNum(g.visits)} visits</span></div>
        </a>`).join('');
    }
  }

  return { title: 'Home' };
}

function empty(text) {
  return `<div class="empty" style="grid-column:1/-1">${esc(text)}</div>`;
}
