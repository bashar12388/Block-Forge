import { api, state, setSession, owns, navigate } from '../store.js';
import { el, esc, fmtNum, qs, qsa, toast, icon, confirmDialog } from '../ui.js';

const EMOJI = {
  'hat.none': '∅', 'hat.cap': '🧢', 'hat.headphones': '🎧', 'hat.wizard': '🧙',
  'hat.crown': '👑', 'hat.halo': '😇', 'hat.beanie': '🧶', 'hat.antenna': '📡',
  'face.smile': '🙂', 'face.happy': '😄', 'face.cool': '😎', 'face.angry': '😠',
  'face.shock': '😱', 'face.robot': '🤖',
  'emote.wave': '👋', 'emote.dance': '🕺', 'emote.cheer': '🙌', 'emote.flex': '💪',
  'effect.none': '∅', 'effect.sparkle': '✨', 'effect.ember': '🔥',
};

const SLOT_LABEL = { hat: 'Hats', face: 'Faces', emote: 'Emotes', effect: 'Effects' };

export async function renderShop(root, { query }) {
  root.innerHTML = `<div class="page">
    <div class="page-head">
      <div>
        <h1>Spark shop</h1>
        <p>Spend the Sparks you earn by playing and publishing. Your balance is <b data-balance>${fmtNum(state.user?.coins || 0)}</b>.</p>
      </div>
      <div class="chips" data-filters>
        <button class="chip active" data-slot="all">Everything</button>
        ${Object.entries(SLOT_LABEL).map(([slot, label]) => `<button class="chip" data-slot="${slot}">${label}</button>`).join('')}
      </div>
    </div>
    <div class="shop-grid" data-grid></div>
  </div>`;

  let items = [];
  let ownedSet = new Set(state.inventory);
  let slot = query?.get('slot') || 'all';

  const draw = () => {
    const list = items.filter((i) => (slot === 'all' ? true : i.slot === slot));
    qs(root, '[data-grid]').innerHTML = list.map((item) => {
      const owned = ownedSet.has(item.id);
      const equipped = state.user?.avatar?.[item.slot] === item.id;
      const free = item.price === 0;
      return `<div class="item-card">
        <div class="item-preview" title="${esc(SLOT_LABEL[item.slot])}">
          <span style="filter:drop-shadow(0 8px 16px rgba(0,0,0,.5))">${EMOJI[item.id] || '📦'}</span>
          <span class="badge rarity-${esc(item.rarity)}" style="position:absolute;top:8px;left:8px;background:rgba(0,0,0,.35)">${esc(item.rarity)}</span>
        </div>
        <div>
          <h4>${esc(item.name)}</h4>
          <div class="hint">${esc(SLOT_LABEL[item.slot])}</div>
        </div>
        <p class="item-blurb">${esc(item.blurb)}</p>
        <div class="item-foot">
          <span class="price">${free ? 'Free' : `${icon('spark')} ${fmtNum(item.price)}`}</span>
          ${owned
            ? (equipped
              ? `<span class="badge badge-good">Equipped</span>`
              : `<button class="btn btn-sm" data-equip="${esc(item.id)}">Equip</button>`)
            : `<button class="btn btn-sm btn-primary" data-buy="${esc(item.id)}" ${(state.user?.coins || 0) < item.price ? 'disabled' : ''}>Buy</button>`}
        </div>
      </div>`;
    }).join('');
  };

  try {
    const data = await api('/api/shop');
    items = data.items;
    ownedSet = new Set(data.owned);
    if (data.coins !== null && state.user) state.user.coins = data.coins;
    qs(root, '[data-balance]').textContent = fmtNum(state.user?.coins || 0);
  } catch (err) {
    toast(err.message, 'bad');
  }

  qsa(root, '[data-slot]').forEach((btn) => btn.addEventListener('click', () => {
    slot = btn.dataset.slot;
    qsa(root, '[data-slot]').forEach((b) => b.classList.toggle('active', b === btn));
    draw();
  }));

  root.addEventListener('click', async (e) => {
    const buyBtn = e.target.closest('[data-buy]');
    const equipBtn = e.target.closest('[data-equip]');

    if (buyBtn) {
      if (!state.user) {
        navigate('login');
        return;
      }
      const item = items.find((i) => i.id === buyBtn.dataset.buy);
      if (!item) return;
      const ok = await confirmDialog({
        title: `Buy ${item.name}?`,
        message: `${fmtNum(item.price)} Sparks will be deducted. You keep it forever.`,
        confirm: `Buy for ${fmtNum(item.price)}`,
      });
      if (!ok) return;
      buyBtn.disabled = true;
      try {
        const res = await api('/api/shop/buy', { method: 'POST', body: { itemId: item.id } });
        setSession({ user: res.user, inventory: res.owned });
        ownedSet = new Set(res.owned);
        state.inventory = res.owned;
        qs(root, '[data-balance]').textContent = fmtNum(state.user.coins);
        draw();
        toast(`${item.name} added to your inventory.`, 'good');
      } catch (err) {
        toast(err.message, 'bad');
        buyBtn.disabled = false;
      }
    }

    if (equipBtn) {
      const id = equipBtn.dataset.equip;
      const item = items.find((i) => i.id === id);
      if (!item || !state.user) return;
      try {
        const avatar = { ...state.user.avatar, [item.slot]: id };
        const res = await api('/api/me/avatar', { method: 'PATCH', body: { avatar } });
        setSession({ user: res.user, inventory: res.inventory });
        draw();
        toast(`${item.name} equipped.`, 'good');
      } catch (err) {
        toast(err.message, 'bad');
      }
    }
  });

  draw();
  return { title: 'Shop' };
}
