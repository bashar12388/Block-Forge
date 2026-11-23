import * as THREE from 'three';
import { api, state, setSession, owns, navigate } from '../store.js';
import { el, esc, qs, qsa, toast } from '../ui.js';
import { buildAvatar } from '../three/avatar3d.js';
import { SKIN_TONES, SHIRT_COLORS, PANTS_COLORS, BODY_TYPES } from '/shared/catalog.js';

const FACE_EMOJI = {
  'face.smile': '🙂', 'face.happy': '😄', 'face.cool': '😎',
  'face.angry': '😠', 'face.shock': '😱', 'face.robot': '🤖',
};
const EMOTE_EMOJI = { 'emote.wave': '👋', 'emote.dance': '🕺', 'emote.cheer': '🙌', 'emote.flex': '💪' };
const EFFECT_EMOJI = { 'effect.none': '∅', 'effect.sparkle': '✨', 'effect.ember': '🔥' };

export async function renderAvatar(root) {
  if (!state.user) {
    root.innerHTML = `<div class="page"><div class="empty"><b>Sign in to edit your avatar</b>
      <a class="btn btn-primary" style="margin-top:14px" href="#/login">Sign in</a></div></div>`;
    return { title: 'Avatar' };
  }

  let avatar = { ...state.user.avatar };
  let dirty = false;

  root.innerHTML = `<div class="page">
    <div class="page-head">
      <div><h1>Avatar</h1><p>Everything here is rendered from the same model other players see in-game.</p></div>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="hint" data-dirty></span>
        <button class="btn btn-ghost" data-reset>Reset</button>
        <button class="btn btn-primary" data-save>Save avatar</button>
      </div>
    </div>
    <div class="avatar-layout">
      <div class="avatar-stage"><div class="stage-hint">Drag to rotate · scroll to zoom</div></div>
      <div class="editor-panel" data-editor></div>
    </div>
  </div>`;

  // ---- three preview -------------------------------------------------------
  const stage = qs(root, '.avatar-stage');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  camera.position.set(0, 6.2, 15);

  scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x1a2233, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(6, 12, 9);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x7dd3fc, 1.4);
  rim.position.set(-8, 5, -7);
  scene.add(rim);

  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(4.6, 5, 0.5, 48),
    new THREE.MeshStandardMaterial({ color: 0x1a2436, roughness: 0.35, metalness: 0.55 })
  );
  platform.position.y = -0.26;
  scene.add(platform);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(4.9, 0.06, 8, 64),
    new THREE.MeshStandardMaterial({ color: 0x5b8cff, emissive: 0x2a4bff, emissiveIntensity: 1.4 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.02;
  scene.add(ring);

  let model = null;
  let spin = 0.25;
  let dragging = false;
  let lastX = 0;
  let emoteUntil = 0;
  let emoteKind = 'wave';

  const rebuild = () => {
    if (model) {
      scene.remove(model.root);
      model.dispose();
    }
    model = buildAvatar(avatar, { name: state.user.username, level: state.user.role, showName: false });
    scene.add(model.root);
  };
  rebuild();

  const resize = () => {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  resize();

  stage.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    spin += (e.clientX - lastX) * 0.008;
    lastX = e.clientX;
  });
  stage.addEventListener('pointerup', () => { dragging = false; });
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    camera.position.z = Math.max(9, Math.min(26, camera.position.z + e.deltaY * 0.02));
  }, { passive: false });

  let raf = 0;
  let last = performance.now();
  const tick = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!dragging) spin += dt * 0.16;
    if (model) {
      const emoting = performance.now() < emoteUntil;
      model.update(dt, emoting ? `emote:${emoteKind}` : 'idle');
      model.root.rotation.y = spin;
    }
    ring.material.emissiveIntensity = 1.1 + Math.sin(now * 0.002) * 0.35;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  // ---- editor --------------------------------------------------------------
  const items = state.items?.length ? state.items : (await api('/api/shop')).items;
  state.items = items;

  const editor = qs(root, '[data-editor]');

  const option = (id, label, { active, locked, dot, emoji }) => `
    <button class="option ${active ? 'active' : ''} ${locked ? 'locked' : ''}" data-pick="${esc(id)}">
      ${dot ? `<span class="swatch-dot" style="background:${esc(dot)}"></span>` : ''}
      ${emoji ? `<span style="font-size:19px;line-height:1">${emoji}</span>` : ''}
      <span>${esc(label)}</span>
    </button>`;

  const drawEditor = () => {
    const hats = items.filter((i) => i.slot === 'hat');
    const faces = items.filter((i) => i.slot === 'face');
    const emotes = items.filter((i) => i.slot === 'emote');
    const effects = items.filter((i) => i.slot === 'effect');

    editor.innerHTML = `
      <div class="editor-block">
        <h4>Body</h4>
        <div class="option-grid">
          ${BODY_TYPES.map((b) => option(`body:${b.id}`, b.name, { active: avatar.body === b.id })).join('')}
        </div>
        <h4 style="margin-top:12px">Skin tone</h4>
        <div class="swatch-row">
          ${SKIN_TONES.map((c) => `<button class="swatch ${avatar.skin === c ? 'active' : ''}" style="background:${c}" data-pick="skin:${c}" aria-label="${c}"></button>`).join('')}
        </div>
      </div>

      <div class="editor-block">
        <h4>Clothing</h4>
        <div style="font-size:11.5px;color:var(--dim);margin-bottom:6px">Shirt</div>
        <div class="swatch-row">
          ${SHIRT_COLORS.map((c) => `<button class="swatch ${avatar.shirt === c ? 'active' : ''}" style="background:${c}" data-pick="shirt:${c}"></button>`).join('')}
        </div>
        <div style="font-size:11.5px;color:var(--dim);margin:10px 0 6px">Pants</div>
        <div class="swatch-row">
          ${PANTS_COLORS.map((c) => `<button class="swatch ${avatar.pants === c ? 'active' : ''}" style="background:${c}" data-pick="pants:${c}"></button>`).join('')}
        </div>
      </div>

      <div class="editor-block">
        <h4>Hats</h4>
        <div class="option-grid">
          ${hats.map((i) => option(i.id, i.name, {
            active: avatar.hat === i.id, locked: i.price > 0 && !owns(i.id),
            emoji: { 'hat.none': '∅', 'hat.cap': '🧢', 'hat.headphones': '🎧', 'hat.wizard': '🧙', 'hat.crown': '👑', 'hat.halo': '😇', 'hat.beanie': '🧶', 'hat.antenna': '📡' }[i.id],
          })).join('')}
        </div>
      </div>

      <div class="editor-block">
        <h4>Face</h4>
        <div class="option-grid">
          ${faces.map((i) => option(i.id, i.name, {
            active: avatar.face === i.id, locked: i.price > 0 && !owns(i.id), emoji: FACE_EMOJI[i.id],
          })).join('')}
        </div>
      </div>

      <div class="editor-block">
        <h4>Emote</h4>
        <div class="option-grid">
          ${emotes.map((i) => option(i.id, i.name, {
            active: avatar.emote === i.id, locked: i.price > 0 && !owns(i.id), emoji: EMOTE_EMOJI[i.id],
          })).join('')}
        </div>
        <button class="btn btn-sm btn-block" style="margin-top:9px" data-test-emote>Play emote</button>
      </div>

      <div class="editor-block">
        <h4>Effect</h4>
        <div class="option-grid">
          ${effects.map((i) => option(i.id, i.name, {
            active: avatar.effect === i.id, locked: i.price > 0 && !owns(i.id), emoji: EFFECT_EMOJI[i.id],
          })).join('')}
        </div>
      </div>

      <div class="hint">Locked items can be bought in the <a href="#/shop" style="color:#9ab8ff">Spark shop</a>.</div>
    `;
  };

  drawEditor();

  editor.addEventListener('click', (e) => {
    const testEmote = e.target.closest('[data-test-emote]');
    if (testEmote) {
      const kind = { 'emote.wave': 'wave', 'emote.dance': 'dance', 'emote.cheer': 'cheer', 'emote.flex': 'flex' }[avatar.emote] || 'wave';
      emoteKind = kind;
      emoteUntil = performance.now() + 2600;
      return;
    }

    const pick = e.target.closest('[data-pick]');
    if (!pick) return;
    const raw = pick.dataset.pick;
    const sep = raw.indexOf(':');
    const key = sep === -1 ? raw : raw.slice(0, sep);
    const value = sep === -1 ? '' : raw.slice(sep + 1);

    if (key === 'body') avatar.body = value;
    else if (['skin', 'shirt', 'pants'].includes(key)) avatar[key] = value;
    else {
      // Catalog options carry the item id directly (`hat.cap`), while color and
      // body options use `field:value`. Resolve the item by its id.
      const item = items.find((i) => i.id === raw);
      if (!item) return;
      if (item.price > 0 && !owns(item.id)) {
        toast(`You do not own ${item.name}. Buy it in the shop.`, 'warn');
        return;
      }
      avatar[item.slot] = item.id;
      if (item.slot === 'emote') {
        emoteKind = item.style?.kind || 'wave';
        emoteUntil = performance.now() + 2600;
      }
    }
    dirty = true;
    qs(root, '[data-dirty]').textContent = 'Unsaved changes';
    rebuild();
    drawEditor();
  });

  qs(root, '[data-save]').addEventListener('click', async () => {
    try {
      const res = await api('/api/me/avatar', { method: 'PATCH', body: { avatar } });
      setSession({ user: res.user, inventory: res.inventory });
      avatar = { ...res.user.avatar };
      dirty = false;
      qs(root, '[data-dirty]').textContent = '';
      rebuild();
      drawEditor();
      toast('Avatar saved.', 'good');
    } catch (err) {
      toast(err.message, 'bad');
    }
  });

  qs(root, '[data-reset]').addEventListener('click', () => {
    avatar = { ...state.user.avatar };
    dirty = false;
    qs(root, '[data-dirty]').textContent = '';
    rebuild();
    drawEditor();
  });

  return {
    title: 'Avatar',
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (model) model.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
