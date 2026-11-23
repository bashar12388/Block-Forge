// Turns an avatar config into a renderer-agnostic limb description.
// Both the avatar editor preview and the in-world characters consume this.

import { BODY_TYPES, itemFor, DEFAULT_AVATAR } from './catalog.js';

export const HEAD_SIZE = 1.2;
const HAIR = '#2a1a12';

export function avatarSpec(avatar = DEFAULT_AVATAR) {
  const body = BODY_TYPES.find((b) => b.id === avatar.body) || BODY_TYPES[0];
  const torsoW = body.torsoWidth;
  const armW = body.armWidth;
  const legW = torsoW / 2 - 0.02;
  const armX = torsoW / 2 + armW / 2;

  const spec = {
    body: body.id,
    torso: { size: [torsoW, 2, 1], pos: [0, 3, 0], color: avatar.shirt },
    head: { size: [HEAD_SIZE, HEAD_SIZE, HEAD_SIZE], pos: [0, 4.6, 0], color: avatar.skin },
    hair: { size: [HEAD_SIZE + 0.04, 0.22, HEAD_SIZE + 0.04], pos: [0, 5.16, 0], color: HAIR },
    arms: [
      { side: 'left', pivot: [-armX, 4, 0], size: [armW, 2, 1], color: avatar.shirt, hand: avatar.skin },
      { side: 'right', pivot: [armX, 4, 0], size: [armW, 2, 1], color: avatar.shirt, hand: avatar.skin },
    ],
    legs: [
      { side: 'left', pivot: [-legW / 2 - 0.02, 2, 0], size: [legW, 2, 1], color: avatar.pants },
      { side: 'right', pivot: [legW / 2 + 0.02, 2, 0], size: [legW, 2, 1], color: avatar.pants },
    ],
    face: itemFor('face', avatar.face)?.style?.kind || 'smile',
    hat: itemFor('hat', avatar.hat)?.style?.parts || [],
    hatId: avatar.hat,
    effect: itemFor('effect', avatar.effect)?.style || { kind: 'none' },
    emote: itemFor('emote', avatar.emote)?.style?.kind || 'wave',
  };
  return spec;
}

/** Collision/click height, used for name tags and camera framing. */
export const AVATAR_HEIGHT = 5.2;

export function randomAvatar(rng = Math.random) {
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  return {
    ...DEFAULT_AVATAR,
    skin: pick(['#f7d7bd', '#f4c69a', '#d99a63', '#b06b3c', '#7a4a28', '#9be7a3']),
    shirt: pick(['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#a855f7', '#06b6d4']),
    pants: pick(['#1e293b', '#0f172a', '#334155', '#1d4ed8', '#be123c']),
  };
}
