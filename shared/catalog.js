// Item catalog. Server validates purchases against this list; the client renders
// from the same specs, so a hat looks identical in the shop, the editor and the world.

export const SLOTS = ['hat', 'face', 'emote', 'effect'];

export const BODY_TYPES = [
  { id: 'blocky', name: 'Blocky', blurb: 'The classic six-part silhouette.', armWidth: 1, torsoWidth: 2 },
  { id: 'slim', name: 'Slim', blurb: 'Narrower build, faster-looking.', armWidth: 0.85, torsoWidth: 1.8 },
];

export const STARTER_ITEMS = ['hat.none', 'face.smile', 'emote.wave', 'effect.none'];

export const ITEMS = [
  // ---- Hats -------------------------------------------------------------
  {
    id: 'hat.none', slot: 'hat', name: 'No Hat', price: 0, rarity: 'common',
    blurb: 'Let the hair breathe.', style: { parts: [] },
  },
  {
    id: 'hat.cap', slot: 'hat', name: 'Forge Cap', price: 120, rarity: 'common',
    blurb: 'Standard issue for new builders.',
    style: {
      parts: [
        { kind: 'box', size: [1.32, 0.34, 1.32], pos: [0, 0.74, 0], color: '#ef4444' },
        { kind: 'box', size: [1.24, 0.1, 0.62], pos: [0, 0.6, 0.86], color: '#dc2626' },
        { kind: 'box', size: [0.22, 0.16, 0.22], pos: [0, 0.95, 0], color: '#fca5a5' },
      ],
    },
  },
  {
    id: 'hat.headphones', slot: 'hat', name: 'Pulse Headphones', price: 340, rarity: 'rare',
    blurb: 'Zero noise, all bass.',
    style: {
      parts: [
        { kind: 'box', size: [1.5, 0.16, 0.3], pos: [0, 0.82, 0], color: '#0ea5e9' },
        { kind: 'cyl', radius: 0.3, height: 0.24, pos: [-0.72, 0.55, 0], rot: [0, 0, Math.PI / 2], color: '#0284c7' },
        { kind: 'cyl', radius: 0.3, height: 0.24, pos: [0.72, 0.55, 0], rot: [0, 0, Math.PI / 2], color: '#0284c7' },
      ],
    },
  },
  {
    id: 'hat.wizard', slot: 'hat', name: 'Archmage Hat', price: 890, rarity: 'epic',
    blurb: 'For people who write the engine, not the game.',
    style: {
      parts: [
        { kind: 'cone', radius: 0.85, height: 1.9, pos: [0, 1.45, 0], color: '#7c3aed' },
        { kind: 'cyl', radius: 1.02, height: 0.12, pos: [0, 0.66, 0], color: '#5b21b6' },
      ],
    },
  },
  {
    id: 'hat.crown', slot: 'hat', name: 'Founder Crown', price: 2400, rarity: 'legendary',
    blurb: 'Reserved for people who ship.',
    style: {
      parts: [
        { kind: 'cyl', radius: 0.66, height: 0.26, pos: [0, 0.78, 0], color: '#facc15', emissive: '#7c5e00', emissiveIntensity: 0.4 },
        { kind: 'cone', radius: 0.16, height: 0.42, pos: [0, 1.06, 0.5], color: '#fde047' },
        { kind: 'cone', radius: 0.16, height: 0.42, pos: [0.45, 1.06, -0.25], color: '#fde047' },
        { kind: 'cone', radius: 0.16, height: 0.42, pos: [-0.45, 1.06, -0.25], color: '#fde047' },
      ],
    },
  },
  {
    id: 'hat.halo', slot: 'hat', name: 'Dev Halo', price: 1500, rarity: 'legendary',
    blurb: 'Suspiciously good at code review.',
    style: {
      parts: [
        { kind: 'torus', radius: 0.52, tube: 0.075, pos: [0, 1.15, 0], rot: [Math.PI / 2, 0, 0], color: '#fef08a', emissive: '#fde047', emissiveIntensity: 1.2 },
      ],
    },
  },
  {
    id: 'hat.beanie', slot: 'hat', name: 'Late Night Beanie', price: 210, rarity: 'common',
    blurb: 'It is always 3am somewhere.',
    style: {
      parts: [
        { kind: 'sphere', radius: 0.72, pos: [0, 0.72, 0], scale: [1, 0.7, 1], color: '#f97316' },
        { kind: 'cyl', radius: 0.73, height: 0.2, pos: [0, 0.6, 0], color: '#ea580c' },
      ],
    },
  },
  {
    id: 'hat.antenna', slot: 'hat', name: 'Signal Antennae', price: 640, rarity: 'rare',
    blurb: 'Picks up patch notes from orbit.',
    style: {
      parts: [
        { kind: 'cyl', radius: 0.05, height: 0.9, pos: [-0.32, 1.1, 0], color: '#94a3b8' },
        { kind: 'cyl', radius: 0.05, height: 0.9, pos: [0.32, 1.1, 0], color: '#94a3b8' },
        { kind: 'sphere', radius: 0.13, pos: [-0.32, 1.58, 0], color: '#22d3ee', emissive: '#22d3ee', emissiveIntensity: 1.4 },
        { kind: 'sphere', radius: 0.13, pos: [0.32, 1.58, 0], color: '#f472b6', emissive: '#f472b6', emissiveIntensity: 1.4 },
      ],
    },
  },

  // ---- Faces ------------------------------------------------------------
  { id: 'face.smile', slot: 'face', name: 'Easy Smile', price: 0, rarity: 'common', blurb: 'Default, and fine.', style: { kind: 'smile' } },
  { id: 'face.happy', slot: 'face', name: 'Big Grin', price: 90, rarity: 'common', blurb: 'Teeth included.', style: { kind: 'happy' } },
  {
    id: 'face.cool', slot: 'face', name: 'Cool Shades', price: 260, rarity: 'rare',
    blurb: 'Cannot see the bug, cannot fix the bug.',
    style: { kind: 'cool' },
  },
  { id: 'face.angry', slot: 'face', name: 'Review Face', price: 150, rarity: 'common', blurb: 'Someone touched main.', style: { kind: 'angry' } },
  { id: 'face.shock', slot: 'face', name: 'Oh No', price: 150, rarity: 'common', blurb: 'Production is down.', style: { kind: 'shock' } },
  { id: 'face.robot', slot: 'face', name: 'Unit 7', price: 700, rarity: 'epic', blurb: 'Not a bot, allegedly.', style: { kind: 'robot' } },

  // ---- Emotes -----------------------------------------------------------
  { id: 'emote.wave', slot: 'emote', name: 'Wave', price: 0, rarity: 'common', blurb: 'Say hi to the server.', style: { kind: 'wave' } },
  { id: 'emote.dance', slot: 'emote', name: 'Full Dance', price: 320, rarity: 'rare', blurb: 'Two bars, no shame.', style: { kind: 'dance' } },
  { id: 'emote.cheer', slot: 'emote', name: 'Victory Cheer', price: 260, rarity: 'common', blurb: 'For deploy days.', style: { kind: 'cheer' } },
  { id: 'emote.flex', slot: 'emote', name: 'Flex', price: 480, rarity: 'rare', blurb: 'Mostly a shoulder thing.', style: { kind: 'flex' } },

  // ---- Effects ----------------------------------------------------------
  { id: 'effect.none', slot: 'effect', name: 'No Effect', price: 0, rarity: 'common', blurb: 'Clean silhouette.', style: { kind: 'none' } },
  {
    id: 'effect.sparkle', slot: 'effect', name: 'Sparkle Trail', price: 520, rarity: 'rare',
    blurb: 'Leaves a little magic behind.', style: { kind: 'sparkle', color: '#7dd3fc' },
  },
  {
    id: 'effect.ember', slot: 'effect', name: 'Ember Aura', price: 900, rarity: 'epic',
    blurb: 'You were forged, not built.', style: { kind: 'ember', color: '#fb923c' },
  },
];

export const ITEM_MAP = new Map(ITEMS.map((i) => [i.id, i]));

export const DEFAULT_AVATAR = {
  body: 'blocky',
  skin: '#f4c69a',
  shirt: '#3b82f6',
  pants: '#1e293b',
  hat: 'hat.none',
  face: 'face.smile',
  emote: 'emote.wave',
  effect: 'effect.none',
};

export const SKIN_TONES = ['#f7d7bd', '#f4c69a', '#d99a63', '#b06b3c', '#7a4a28', '#4a2c17', '#c9d6df', '#9be7a3', '#c4b5fd'];
export const SHIRT_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#a855f7', '#06b6d4', '#f472b6', '#f8fafc', '#1e293b', '#84cc16'];
export const PANTS_COLORS = ['#1e293b', '#0f172a', '#334155', '#4b5563', '#7c3f1d', '#1d4ed8', '#be123c', '#14532d', '#f8fafc', '#6d28d9'];

export function itemFor(slot, id) {
  const item = ITEM_MAP.get(id);
  if (item && item.slot === slot) return item;
  return ITEMS.find((i) => i.slot === slot) || null;
}

export function sanitizeAvatar(raw) {
  const out = { ...DEFAULT_AVATAR };
  if (!raw || typeof raw !== 'object') return out;
  if (BODY_TYPES.some((b) => b.id === raw.body)) out.body = raw.body;
  for (const key of ['skin', 'shirt', 'pants']) {
    if (typeof raw[key] === 'string' && /^#[0-9a-f]{6}$/i.test(raw[key])) out[key] = raw[key].toLowerCase();
  }
  for (const slot of ['hat', 'face', 'emote', 'effect']) {
    if (typeof raw[slot] === 'string' && itemFor(slot, raw[slot])) out[slot] = raw[slot];
  }
  return out;
}

export function itemPrice(id) {
  return ITEM_MAP.get(id)?.price ?? 0;
}
