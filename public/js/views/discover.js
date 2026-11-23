import { api } from '../store.js';
import { el, esc, gameCard, qs, qsa, fmtNum, icon } from '../ui.js';

export async function renderDiscover(root, { query } = {}) {
  const initial = query?.get('q') || '';

  root.innerHTML = `<div class="page">
    <div class="page-head">
      <div>
        <h1>Discover</h1>
        <p data-count>Loading worlds…</p>
      </div>
      <div class="chips" data-sorts>
        <button class="chip active" data-sort="popular">Popular</button>
        <button class="chip" data-sort="trending">Trending</button>
        <button class="chip" data-sort="new">Newest</button>
        <button class="chip" data-sort="updated">Recently updated</button>
      </div>
    </div>
    <div class="chips" style="margin-bottom:16px" data-cats>
      <button class="chip active" data-cat="all">All genres</button>
      <button class="chip" data-cat="obby">Obby</button>
      <button class="chip" data-cat="tower">Towers</button>
      <button class="chip" data-cat="house">Sandbox</button>
      <button class="chip" data-cat="build">Building</button>
    </div>
    <div data-results class="grid-games"></div>
  </div>`;

  let sort = 'popular';
  let category = 'all';
  let term = initial;

  const load = async () => {
    const params = new URLSearchParams({ sort });
    if (term) params.set('q', term);
    const data = await api(`/api/games?${params}`);
    let games = data.games;

    if (category !== 'all') {
      const rx = {
        obby: /obby|parkour/i,
        tower: /tower|spire/i,
        house: /house|sandbox|tycoon/i,
        build: /build|plate|lab|garden/i,
      }[category];
      games = games.filter((g) => rx?.test(g.name));
    }

    qs(root, '[data-count]').textContent = games.length
      ? `${games.length} world${games.length === 1 ? '' : 's'}${term ? ` matching “${term}”` : ''}`
      : 'No worlds matched';

    qs(root, '[data-results]').innerHTML = games.length
      ? games.map(gameCard).join('')
      : `<div class="empty" style="grid-column:1/-1"><b>Nothing here yet</b>Try a different search — or build the first one.</div>`;
  };

  qsa(root, '[data-sort]').forEach((btn) => btn.addEventListener('click', () => {
    sort = btn.dataset.sort;
    qsa(root, '[data-sort]').forEach((b) => b.classList.toggle('active', b === btn));
    load();
  }));

  qsa(root, '[data-cat]').forEach((btn) => btn.addEventListener('click', () => {
    category = btn.dataset.cat;
    qsa(root, '[data-cat]').forEach((b) => b.classList.toggle('active', b === btn));
    load();
  }));

  await load();

  return { title: 'Discover' };
}
