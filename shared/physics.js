// Shared character physics. Runs identically on the server (authority) and in the
// browser (prediction), so the two never disagree about how the world behaves.
//
// Units are studs and seconds. Character position is the *feet* point.

export const GRAVITY = 196.2;
export const WALK_SPEED = 16;
export const JUMP_POWER = 48;
export const CHAR_HEIGHT = 5;
export const CHAR_HALF = 1.0;
export const MAX_STEP = 0.9;
export const EPS = 1e-3;
export const MAX_DT = 1 / 30;

const HALF = [CHAR_HALF, CHAR_HEIGHT / 2, CHAR_HALF];

/** Axis-aligned bounds of a rotated part (rotation is an approximation of the true hull). */
export function partBounds(part) {
  const [sx, sy, sz] = part.size;
  const [rx, ry, rz] = part.rot || [0, 0, 0];
  const cx = Math.cos(rx), sxr = Math.sin(rx);
  const cy = Math.cos(ry), syr = Math.sin(ry);
  const cz = Math.cos(rz), szr = Math.sin(rz);

  // Rotation matrix for XYZ order (matches three.js default Euler order).
  const m00 = cy * cz;
  const m01 = -cy * szr;
  const m02 = syr;
  const m10 = cx * szr + sxr * syr * cz;
  const m11 = cx * cz - sxr * syr * szr;
  const m12 = -sxr * cy;
  const m20 = sxr * szr - cx * syr * cz;
  const m21 = sxr * cz + cx * syr * szr;
  const m22 = cx * cy;

  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const ex = Math.abs(m00) * hx + Math.abs(m01) * hy + Math.abs(m02) * hz;
  const ey = Math.abs(m10) * hx + Math.abs(m11) * hy + Math.abs(m12) * hz;
  const ez = Math.abs(m20) * hx + Math.abs(m21) * hy + Math.abs(m22) * hz;

  return {
    min: [part.pos[0] - ex, part.pos[1] - ey, part.pos[2] - ez],
    max: [part.pos[0] + ex, part.pos[1] + ey, part.pos[2] + ez],
  };
}

/** Pre-compute solid bounds once per place load. */
export function buildCollision(parts) {
  const solid = [];
  for (const p of parts) {
    if (p.anchored === false) continue;
    if (p.collide === false) continue;
    if (!p.size || !p.pos) continue;
    if (p.size[0] <= 0 || p.size[1] <= 0 || p.size[2] <= 0) continue;
    solid.push(partBounds(p));
  }
  return solid;
}

function overlaps(min, max, b) {
  return (
    max[0] > b.min[0] + EPS && min[0] < b.max[0] - EPS &&
    max[1] > b.min[1] + EPS && min[1] < b.max[1] - EPS &&
    max[2] > b.min[2] + EPS && min[2] < b.max[2] - EPS
  );
}

/**
 * Move the character box along one axis, stopping at the first surface it hits.
 * Returns true when a collision occurred.
 */
function sweepAxis(pos, axis, delta, solid) {
  if (delta === 0) return false;
  const before = pos[axis];
  pos[axis] += delta;

  const min = [pos[0] - HALF[0], pos[1] - HALF[1], pos[2] - HALF[2]];
  const max = [pos[0] + HALF[0], pos[1] + HALF[1], pos[2] + HALF[2]];

  let hit = false;
  for (const b of solid) {
    if (!overlaps(min, max, b)) continue;
    hit = true;
    if (delta > 0) pos[axis] = b.min[axis] - HALF[axis] - EPS;
    else pos[axis] = b.max[axis] + HALF[axis] + EPS;
    min[axis] = pos[axis] - HALF[axis];
    max[axis] = pos[axis] + HALF[axis];
  }
  if (!Number.isFinite(pos[axis]) || Math.abs(pos[axis] - before) > Math.abs(delta) + MAX_STEP) {
    pos[axis] = before;
  }
  return hit;
}

/** Is the character currently standing on something? */
export function isGrounded(pos, solid) {
  const min = [pos[0] - HALF[0] + 0.05, pos[1] - HALF[1] - 0.12, pos[2] - HALF[2] + 0.05];
  const max = [pos[0] + HALF[0] - 0.05, pos[1] - HALF[1] + 0.02, pos[2] + HALF[2] - 0.05];
  for (const b of solid) if (overlaps(min, max, b)) return true;
  return false;
}

export function makePlayerState(pos = [0, 6, 0]) {
  return {
    pos: [pos[0], pos[1], pos[2]],
    vel: [0, 0, 0],
    grounded: false,
    fly: false,
    speed: WALK_SPEED,
    jumpPower: JUMP_POWER,
    frozen: false,
  };
}

/**
 * Advance one character by dt.
 * intent: { mx, mz, jump, up } where mx/mz is a world-space direction in [-1,1].
 */
export function stepPlayer(state, intent, solid, dt) {
  dt = Math.min(Math.max(dt, 0), MAX_DT);

  const frozen = !!state.frozen;
  const speed = frozen ? 0 : Math.max(0, Math.min(400, state.speed ?? WALK_SPEED));

  let mx = Number(intent?.mx) || 0;
  let mz = Number(intent?.mz) || 0;
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  const moving = Math.hypot(mx, mz) > 0.02;

  const jumpHeld = !!intent?.jump && !frozen;
  const vertical = Number(intent?.up) || 0;

  if (state.fly) {
    state.vel[0] = mx * speed;
    state.vel[2] = mz * speed;
    // Space (or an on-screen ▲) climbs, Shift/C/▼ descends, neither hovers.
    state.vel[1] = (jumpHeld || vertical > 0 ? 1 : 0) * speed * 0.75
      - (vertical < 0 ? speed * 0.75 : 0);
    state.grounded = false;
  } else {
    // Snappy ground movement, softer air control.
    const accel = state.grounded ? 1 : 0.35;
    state.vel[0] += (mx * speed - state.vel[0]) * Math.min(1, accel + 0.15);
    state.vel[2] += (mz * speed - state.vel[2]) * Math.min(1, accel + 0.15);

    if (jumpHeld && state.grounded && !frozen) {
      state.vel[1] = state.jumpPower;
      state.grounded = false;
    }

    state.vel[1] -= GRAVITY * dt;
    if (state.vel[1] < -250) state.vel[1] = -250;
  }

  // Keep per-frame travel small enough that we cannot tunnel through thin walls.
  const travel = Math.max(
    Math.abs(state.vel[0]), Math.abs(state.vel[1]), Math.abs(state.vel[2])
  ) * dt;
  const steps = Math.min(8, Math.max(1, Math.ceil(travel / 0.5)));
  const sub = dt / steps;

  let landed = false;
  for (let i = 0; i < steps; i++) {
    const dy = state.vel[1] * sub;
    const hitY = sweepAxis(state.pos, 1, dy, solid);
    if (hitY) {
      if (dy < 0) { landed = true; state.grounded = true; }
      state.vel[1] = 0;
    }

    const hitX = sweepAxis(state.pos, 0, state.vel[0] * sub, solid);
    if (hitX) state.vel[0] = 0;

    const hitZ = sweepAxis(state.pos, 2, state.vel[2] * sub, solid);
    if (hitZ) state.vel[2] = 0;

    // Small step-up over kerbs and stairs so terrain feels walkable.
    if ((hitX || hitZ) && !state.fly && state.grounded) {
      const save = [state.pos[0], state.pos[1], state.pos[2]];
      state.pos[1] += MAX_STEP;
      const blocked = solid.some((b) => overlaps(
        [state.pos[0] - HALF[0], state.pos[1] - HALF[1], state.pos[2] - HALF[2]],
        [state.pos[0] + HALF[0], state.pos[1] + HALF[1], state.pos[2] + HALF[2]],
        b
      ));
      if (blocked) state.pos[1] = save[1];
      else landed = true;
    }
  }

  if (state.fly) {
    state.grounded = isGrounded(state.pos, solid);
  } else if (moving || !landed) {
    state.grounded = landed || isGrounded(state.pos, solid);
  } else {
    // Standing still: verify there is still ground beneath us.
    state.grounded = isGrounded(state.pos, solid);
  }

  return {
    moving,
    airborne: !state.grounded,
    speed: Math.hypot(state.vel[0], state.vel[2]),
  };
}

/** Keep a position inside the playable volume. */
export function clampPosition(pos, bounds = 2048) {
  for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(pos[i])) pos[i] = 0;
    pos[i] = Math.max(-bounds, Math.min(bounds, pos[i]));
  }
  return pos;
}

export function animFor(state, info) {
  if (state.fly) return 'fly';
  if (info.airborne) return 'jump';
  if (info.moving) return 'walk';
  return 'idle';
}
