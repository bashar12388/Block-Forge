// Place templates. These are real part lists that the Studio loads and the world
// simulates — not thumbnails.

let counter = 0;
const uid = (prefix = 'p') => `${prefix}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function part(kind, pos, size, color, extras = {}) {
  return {
    id: uid(),
    name: extras.name || kind[0].toUpperCase() + kind.slice(1),
    kind,
    pos,
    size,
    rot: extras.rot || [0, 0, 0],
    color,
    material: extras.material || 'plastic',
    transparency: extras.transparency ?? 0,
    anchored: extras.anchored !== false,
    ...(extras.collide === false ? { collide: false } : {}),
  };
}

const box = (pos, size, color, extras) => part('box', pos, size, color, extras);
const cyl = (pos, size, color, extras) => part('cylinder', pos, size, color, extras);
const sphere = (pos, size, color, extras) => part('sphere', pos, size, color, extras);

function baseplate(size = 200, color = '#46536b') {
  return [box([0, -2, 0], [size, 4, size], color, { name: 'Baseplate', material: 'smooth' })];
}

function tree(x, z, scale = 1) {
  return [
    cyl([x, 4 * scale, z], [2 * scale, 8 * scale, 2 * scale], '#5b3a21', { name: 'Trunk' }),
    sphere([x, 9.5 * scale, z], [7 * scale, 6 * scale, 7 * scale], '#2f9e5f', { name: 'Leaves' }),
  ];
}

export const TEMPLATES = {
  baseplate: {
    id: 'baseplate',
    name: 'Baseplate',
    blurb: 'A clean 200×200 grid to build on.',
    thumb: 'aurora',
    build() {
      return {
        parts: [
          ...baseplate(),
          box([0, 0.5, -40], [60, 1, 12], '#5b6b86', { name: 'Walkway' }),
          cyl([0, 3, 0], [18, 6, 18], '#8b93a7', { name: 'Pedestal', material: 'metal' }),
          part('torus', [0, 8, 0], [26, 1.2, 26], '#38bdf8', { name: 'Halo Ring', material: 'neon', rot: [Math.PI / 2, 0, 0] }),
          ...tree(-52, -52, 1.2),
          ...tree(54, -46, 1),
          ...tree(-48, 48, 0.9),
        ],
        spawn: [0, 8, 24],
      };
    },
  },

  obby: {
    id: 'obby',
    name: 'Neon Obby',
    blurb: 'Floating platforms, checkpoints, and one long drop.',
    thumb: 'neon',
    build() {
      const parts = [...baseplate(180, '#22314a')];
      const colors = ['#38bdf8', '#a855f7', '#f472b6', '#facc15', '#34d399'];
      let x = -46, z = 0, y = 4;
      for (let i = 0; i < 12; i++) {
        const w = i % 3 === 0 ? 9 : 7;
        parts.push(box([x, y, z], [w, 1, w], colors[i % colors.length], {
          name: `Platform ${i + 1}`, material: i % 2 ? 'neon' : 'plastic',
        }));
        parts.push(part('torus', [x, y + 3.4, z], [w * 1.2, 0.5, w * 1.2], colors[i % colors.length], {
          name: `Ring ${i + 1}`, material: 'neon', rot: [Math.PI / 2, 0, 0], collide: false, transparency: 0.25,
        }));
        x += i % 2 === 0 ? 8.5 : 7.5;
        z = Math.sin(i * 1.1) * 14;
        y += 2.4;
      }
      parts.push(box([x + 6, y - 2, z], [24, 2, 24], '#facc15', { name: 'Finish Pad', material: 'neon' }));
      parts.push(cyl([x + 6, y + 12, z], [2, 24, 2], '#ffffff', { name: 'Finish Pole', material: 'metal' }));
      parts.push(box([x + 6, y + 24, z], [8, 6, 0.6], '#f43f5e', { name: 'Finish Flag', material: 'neon' }));
      return { parts, spawn: [-54, 8, 0] };
    },
  },

  tower: {
    id: 'tower',
    name: 'Sky Tower',
    blurb: 'Spiral stairs up to a lookout.',
    thumb: 'sunset',
    build() {
      const parts = [...baseplate(160, '#3b4a5f')];
      const stairs = 40;
      for (let i = 0; i < stairs; i++) {
        const a = (i / stairs) * Math.PI * 5;
        const r = 22;
        parts.push(box(
          [Math.cos(a) * r, 2 + i * 1.2, Math.sin(a) * r],
          [10, 1.2, 6], i % 2 ? '#8b93a7' : '#98a2b3',
          { name: `Step ${i + 1}`, material: 'smooth', rot: [0, -a, 0] }
        ));
      }
      parts.push(cyl([0, 28, 0], [16, 4, 16], '#64748b', { name: 'Lookout Floor', material: 'metal' }));
      parts.push(cyl([0, 44, 0], [6, 32, 6], '#94a3b8', { name: 'Spire', material: 'metal' }));
      parts.push(part('cone', [0, 62, 0], [10, 10, 10], '#f59e0b', { name: 'Beacon', material: 'neon' }));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        parts.push(box([Math.cos(a) * 7.4, 30.6, Math.sin(a) * 7.4], [0.6, 4, 0.6], '#cbd5e1', { name: 'Railing' }));
      }
      return { parts, spawn: [0, 6, 30] };
    },
  },

  house: {
    id: 'house',
    name: 'Starter House',
    blurb: 'Walls, roof, and a door you can walk through.',
    thumb: 'meadow',
    build() {
      const parts = [...baseplate(140, '#3f5d47')];
      const W = 26, D = 20, H = 12;
      const wall = '#e7d7c1';
      parts.push(box([0, 0.5, 0], [W + 6, 1, D + 6], '#8b7355', { name: 'Foundation', material: 'wood' }));
      // Front wall split around the doorway.
      parts.push(box([-8, H / 2, D / 2], [W - 16, H, 1], wall, { name: 'Front Wall L' }));
      parts.push(box([8, H / 2, D / 2], [W - 16, H, 1], wall, { name: 'Front Wall R' }));
      parts.push(box([0, H - 2, D / 2], [8, 4, 1], wall, { name: 'Door Header' }));
      parts.push(box([0, H / 2, -D / 2], [W, H, 1], wall, { name: 'Back Wall' }));
      parts.push(box([-W / 2, H / 2, 0], [1, H, D], wall, { name: 'Left Wall' }));
      parts.push(box([W / 2, H / 2, 0], [1, H, D], wall, { name: 'Right Wall' }));
      parts.push(box([-W / 2, 6, 0], [0.6, 6, 8], '#7dd3fc', { name: 'Window', material: 'glass', transparency: 0.55 }));
      parts.push(box([W / 2, 6, 0], [0.6, 6, 8], '#7dd3fc', { name: 'Window', material: 'glass', transparency: 0.55 }));
      // Gabled roof.
      for (let i = 0; i < 2; i++) {
        parts.push(box([i ? 6.5 : -6.5, H + 3.4, 0], [17, 1, D + 4], '#a63d40', {
          name: i ? 'Roof Right' : 'Roof Left', material: 'wood',
          rot: [0, 0, i ? -0.62 : 0.62],
        }));
      }
      parts.push(box([0, H + 7.2, 0], [2, 1, D + 4], '#7f2f31', { name: 'Ridge', material: 'wood' }));
      parts.push(box([0, 4.2, 2], [4, 0.6, 6], '#f59e0b', { name: 'Table', material: 'wood' }));
      parts.push(box([0, 8, 0], [3, 3, 3], '#fde68a', { name: 'Lamp', material: 'neon', collide: false }));
      parts.push(...tree(-34, -22, 1.3), ...tree(32, -20, 1.1), ...tree(30, 26, 0.9));
      return { parts, spawn: [0, 6, 26] };
    },
  },

  showcase: {
    id: 'showcase',
    name: 'Sculpture Garden',
    blurb: 'Curated shapes on a marble plaza.',
    thumb: 'aurora',
    build() {
      const parts = [box([0, -2, 0], [180, 4, 180], '#8f9bb3', { name: 'Plaza', material: 'smooth' })];
      const accents = ['#38bdf8', '#a855f7', '#f472b6', '#facc15'];
      for (let i = 0; i < 4; i++) {
        const x = -30 + i * 20;
        const z = i % 2 ? 12 : -12;
        parts.push(cyl([x, 4, z], [14, 8, 14], '#e2e8f0', { name: 'Plinth', material: 'smooth' }));
        parts.push(sphere([x, 12, z], [8, 8, 8], accents[i], { name: 'Sculpture', material: i % 2 ? 'metal' : 'neon' }));
        parts.push(part('torus', [x, 18, z], [11, 1, 11], accents[(i + 1) % 4], {
          name: 'Halo', material: 'neon', rot: [Math.PI / 2, 0, 0], collide: false,
        }));
      }
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        parts.push(cyl([Math.cos(a) * 66, 5, Math.sin(a) * 66], [2, 10, 2], '#64748b', { name: 'Post', material: 'metal' }));
        parts.push(sphere([Math.cos(a) * 66, 11, Math.sin(a) * 66], [2.6, 2.6, 2.6], '#fde68a', { name: 'Lamp', material: 'neon' }));
      }
      parts.push(...tree(-62, 58, 1.4), ...tree(62, 58, 1.2));
      return { parts, spawn: [0, 6, 46] };
    },
  },
};

export function templateParts(id = 'baseplate') {
  const template = TEMPLATES[id] || TEMPLATES.baseplate;
  return template.build();
}

export const TEMPLATE_LIST = Object.values(TEMPLATES).map((t) => ({
  id: t.id, name: t.name, blurb: t.blurb, thumb: t.thumb,
}));

/** Strip anything the renderer or simulator would not expect. */
export function sanitizePlace(rawParts, rawSpawn, limit = 2500) {
  if (!Array.isArray(rawParts)) return { error: 'Place must be an array of parts.' };
  if (rawParts.length > limit) return { error: `A place can have at most ${limit} parts.` };

  const KINDS = new Set(['box', 'sphere', 'cylinder', 'cone', 'wedge', 'torus']);
  const MATERIALS = new Set(['plastic', 'smooth', 'neon', 'metal', 'glass', 'wood']);
  const out = [];
  const seen = new Set();

  for (const raw of rawParts) {
    if (!raw || typeof raw !== 'object') continue;
    if (!KINDS.has(raw.kind)) continue;
    const size = toVec(raw.size, 0.2, 400);
    const pos = toVec(raw.pos, -2048, 2048);
    if (!size || !pos) continue;
    let id = typeof raw.id === 'string' && /^[a-z0-9_-]{1,40}$/i.test(raw.id) ? raw.id : uid('u');
    while (seen.has(id)) id = uid('u');
    seen.add(id);
    const color = /^#[0-9a-f]{6}$/i.test(raw.color || '') ? raw.color.toLowerCase() : '#9aa4b2';
    out.push({
      id,
      name: String(raw.name || raw.kind).slice(0, 40).replace(/[<>]/g, ''),
      kind: raw.kind,
      pos,
      size,
      rot: toVec(raw.rot, -Math.PI * 4, Math.PI * 4) || [0, 0, 0],
      color,
      material: MATERIALS.has(raw.material) ? raw.material : 'plastic',
      transparency: clamp01(Number(raw.transparency) || 0),
      anchored: raw.anchored !== false,
      ...(raw.collide === false ? { collide: false } : {}),
    });
    if (out.length >= limit) break;
  }

  if (!out.length) return { error: 'A place needs at least one part.' };
  const spawn = Array.isArray(rawSpawn) && rawSpawn.length === 3
    ? toVec(rawSpawn, -2048, 2048)
    : [0, highestTop(out) + 3, 0];
  return { parts: out, spawn };
}

function toVec(value, min, max) {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const out = value.map(Number);
  if (out.some((n) => !Number.isFinite(n))) return null;
  return out.map((n) => Math.max(min, Math.min(max, n)));
}

function clamp01(n) {
  return Math.max(0, Math.min(0.95, n));
}

function highestTop(parts) {
  let top = 0;
  for (const p of parts) {
    if (p.anchored === false) continue;
    top = Math.max(top, p.pos[1] + p.size[1] / 2);
  }
  return Math.min(top, 300);
}
