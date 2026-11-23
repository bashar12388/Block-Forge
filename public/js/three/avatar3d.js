// Blocky character built from the shared avatar spec. Used by the world and the
// avatar editor so what you equip is exactly what other players see.

import * as THREE from 'three';
import { avatarSpec, AVATAR_HEIGHT } from '/shared/avatar.js';

const geoCache = new Map();
const matCache = new Map();

function material(color, opts = {}) {
  const key = `${color}|${opts.transparent ? 1 : 0}|${opts.emissive || ''}|${opts.opacity ?? 1}`;
  if (matCache.has(key)) return matCache.get(key);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: opts.roughness ?? 0.62,
    metalness: opts.metalness ?? 0.05,
    emissive: opts.emissive ? new THREE.Color(opts.emissive) : 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
  });
  matCache.set(key, mat);
  return mat;
}

function boxGeo() {
  if (!geoCache.has('box')) geoCache.set('box', new THREE.BoxGeometry(1, 1, 1));
  return geoCache.get('box');
}

function mesh(size, color, opts) {
  const m = new THREE.Mesh(boxGeo(), material(color, opts));
  m.scale.set(size[0], size[1], size[2]);
  return m;
}

// ---- face ------------------------------------------------------------------

function faceTexture(kind) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#111318';
  ctx.strokeStyle = '#111318';
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';

  const eye = (x, y, r = 13) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };

  if (kind === 'cool') {
    // Shades.
    ctx.fillStyle = '#0b0e14';
    ctx.beginPath();
    ctx.roundRect(40, 92, 72, 34, 12);
    ctx.roundRect(144, 92, 72, 34, 12);
    ctx.fill();
    ctx.fillRect(104, 100, 52, 8);
    ctx.strokeStyle = '#7dd3fc';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(52, 100); ctx.lineTo(100, 116);
    ctx.moveTo(204, 100); ctx.lineTo(156, 116);
    ctx.stroke();
    ctx.strokeStyle = '#111318';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(96, 174);
    ctx.quadraticCurveTo(128, 196, 160, 174);
    ctx.stroke();
  } else if (kind === 'robot') {
    ctx.fillStyle = '#22d3ee';
    ctx.beginPath();
    ctx.roundRect(48, 90, 58, 26, 8);
    ctx.roundRect(150, 90, 58, 26, 8);
    ctx.fill();
    ctx.fillRect(40, 176, 176, 10);
    ctx.fillStyle = '#0ea5e9';
    for (let i = 0; i < 7; i++) ctx.fillRect(44 + i * 24, 176, 10, 28);
  } else {
    const eyes = {
      smile: [12, 12], happy: [13, 13], angry: [12, 12], shock: [20, 20],
    }[kind] || [12, 12];
    eye(88, 110, eyes[0]);
    eye(168, 110, eyes[1]);

    if (kind === 'angry') {
      ctx.lineWidth = 12;
      ctx.beginPath(); ctx.moveTo(64, 82); ctx.lineTo(112, 96); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(192, 82); ctx.lineTo(144, 96); ctx.stroke();
    }
    if (kind === 'shock') {
      ctx.lineWidth = 12;
      ctx.beginPath(); ctx.arc(128, 186, 24, 0, Math.PI * 2); ctx.stroke();
    } else if (kind === 'happy') {
      ctx.lineWidth = 14;
      ctx.beginPath(); ctx.arc(128, 150, 46, 0.25, Math.PI - 0.25); ctx.stroke();
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 4; i++) ctx.fillRect(100 + i * 15, 168, 10, 12);
    } else {
      ctx.lineWidth = 13;
      ctx.beginPath();
      ctx.arc(128, 150, 42, 0.35, Math.PI - 0.35);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---- name tag --------------------------------------------------------------

const RANK_COLORS = ['#cbd5e1', '#67e8f9', '#d8b4fe', '#fde68a'];

function nameTexture(name, level) {
  const canvas = document.createElement('canvas');
  const scale = 3;
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.font = '600 26px Inter, "Segoe UI", system-ui, sans-serif';
  const label = String(name || '').slice(0, 18);
  const w = Math.min(170, ctx.measureText(label).width + 26);
  const x = (canvas.width / scale - w) / 2;
  ctx.fillStyle = 'rgba(6, 10, 18, 0.66)';
  ctx.beginPath();
  ctx.roundRect(x, 26, w, 34, 17);
  ctx.fill();
  ctx.strokeStyle = RANK_COLORS[Math.max(0, Math.min(3, level || 0))] + '99';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = RANK_COLORS[Math.max(0, Math.min(3, level || 0))];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, canvas.width / (2 * scale), 43);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---- hat geometry ----------------------------------------------------------

function hatPiece(part) {
  let geo;
  switch (part.kind) {
    case 'cyl':
      geo = new THREE.CylinderGeometry(part.radius, part.radius, part.height, 28);
      break;
    case 'cone':
      geo = new THREE.ConeGeometry(part.radius, part.height, 28);
      break;
    case 'torus':
      geo = new THREE.TorusGeometry(part.radius, part.tube, 12, 40);
      break;
    case 'sphere':
      geo = new THREE.SphereGeometry(part.radius, 20, 14);
      break;
    default:
      geo = new THREE.BoxGeometry(part.size[0], part.size[1], part.size[2]);
  }
  const mat = material(part.color, {
    emissive: part.emissive,
    emissiveIntensity: part.emissiveIntensity,
    roughness: 0.35,
    metalness: part.emissive ? 0.3 : 0.15,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(part.pos[0], part.pos[1], part.pos[2]);
  if (part.rot) mesh.rotation.set(part.rot[0], part.rot[1], part.rot[2]);
  if (part.scale) mesh.scale.set(part.scale[0], part.scale[1], part.scale[2]);
  mesh.castShadow = false;
  return mesh;
}

// ---- avatar ----------------------------------------------------------------

export function buildAvatar(avatar, { name = '', level = 0, showName = true } = {}) {
  const spec = avatarSpec(avatar);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const torso = mesh(spec.torso.size, spec.torso.color, { roughness: 0.55 });
  torso.position.set(...spec.torso.pos);
  body.add(torso);

  const head = new THREE.Group();
  head.position.set(...spec.head.pos);
  body.add(head);

  const headMesh = mesh(spec.head.size, spec.head.color, { roughness: 0.7 });
  head.add(headMesh);

  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(spec.head.size[0] * 0.98, spec.head.size[1] * 0.98),
    new THREE.MeshBasicMaterial({ map: faceTexture(spec.face), transparent: true, depthWrite: false })
  );
  face.position.z = spec.head.size[2] / 2 + 0.012;
  head.add(face);

  const hair = mesh(spec.hair.size, spec.hair.color, { roughness: 0.9 });
  hair.position.set(0, spec.head.size[1] / 2 + 0.1, -0.02);
  head.add(hair);

  for (const piece of spec.hat) head.add(hatPiece(piece));

  const arms = [];
  for (const armSpec of spec.arms) {
    const pivot = new THREE.Group();
    pivot.position.set(armSpec.pivot[0], armSpec.pivot[1], armSpec.pivot[2]);
    const limb = mesh(armSpec.size, armSpec.color, { roughness: 0.55 });
    limb.position.y = -armSpec.size[1] / 2;
    pivot.add(limb);
    const hand = mesh([armSpec.size[0] * 0.98, 0.4, armSpec.size[2] * 0.98], armSpec.hand, { roughness: 0.72 });
    hand.position.y = -armSpec.size[1] + 0.2;
    pivot.add(hand);
    body.add(pivot);
    arms.push({ pivot, side: armSpec.side });
  }

  const legs = [];
  for (const legSpec of spec.legs) {
    const pivot = new THREE.Group();
    pivot.position.set(legSpec.pivot[0], legSpec.pivot[1], legSpec.pivot[2]);
    const limb = mesh(legSpec.size, legSpec.color, { roughness: 0.6 });
    limb.position.y = -legSpec.size[1] / 2;
    pivot.add(limb);
    body.add(pivot);
    legs.push({ pivot, side: legSpec.side });
  }

  // Soft contact shadow.
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.35, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  root.add(shadow);

  let label = null;
  if (showName) {
    const mat = new THREE.SpriteMaterial({
      map: nameTexture(name, level), transparent: true, depthWrite: false,
    });
    label = new THREE.Sprite(mat);
    label.scale.set(3.6, 0.9, 1);
    label.position.y = AVATAR_HEIGHT + 0.85;
    root.add(label);
  }

  let phase = 0;
  let time = 0;
  const current = { armX: 0, armZ: 0, legX: 0, bodyY: 0, bodyRot: 0 };
  const rightArm = arms.find((a) => a.side === 'right')?.pivot;
  const leftArm = arms.find((a) => a.side === 'left')?.pivot;
  const rightLeg = legs.find((l) => l.side === 'right')?.pivot;
  const leftLeg = legs.find((l) => l.side === 'left')?.pivot;

  function update(dt, anim = 'idle', speed = 0) {
    time += dt;
    const kind = String(anim || 'idle');
    const emote = kind.startsWith('emote:') ? kind.slice(6) : null;
    const moving = kind === 'walk' || speed > 1.2;
    phase += dt * (moving ? Math.max(6, speed * 1.15) : 2.2);

    let armX = 0;
    let armZ = 0;
    let legX = 0;
    let bodyY = 0;
    let bodyRot = 0;

    if (emote) {
      const t = time * 7;
      if (emote === 'wave') {
        armZ = -2.5;
        armX = 0.2;
        bodyRot = Math.sin(t * 0.4) * 0.05;
      } else if (emote === 'dance') {
        bodyY = Math.abs(Math.sin(t * 0.6)) * 0.32;
        bodyRot = Math.sin(t * 0.6) * 0.24;
        armZ = Math.sin(t * 0.8) * 1.5;
        armX = Math.cos(t * 0.6) * 0.5;
        legX = Math.sin(t * 0.6) * 0.35;
      } else if (emote === 'cheer') {
        armZ = 2.7;
        armX = -0.3;
        bodyY = Math.abs(Math.sin(t * 0.9)) * 0.34;
      } else if (emote === 'flex') {
        armZ = 2.2;
        armX = -0.5;
        bodyRot = Math.sin(t * 0.35) * 0.1;
      }
    } else if (kind === 'fly') {
      armZ = 1.35;
      armX = -0.2;
      legX = 0.22;
      bodyRot = 0.12;
    } else if (kind === 'jump') {
      armX = -2.1;
      armZ = -0.35;
      legX = 0.4;
    } else if (moving) {
      const swing = Math.sin(phase) * 0.72;
      legX = swing;
      armX = -swing * 0.85;
      bodyY = Math.abs(Math.sin(phase * 2)) * 0.055;
    } else {
      armX = Math.sin(phase * 0.5) * 0.035;
      bodyY = Math.sin(phase * 0.5) * 0.012;
    }

    const ease = Math.min(1, dt * 12);
    current.armX += (armX - current.armX) * ease;
    current.armZ += (armZ - current.armZ) * ease;
    current.legX += (legX - current.legX) * ease;
    current.bodyY += (bodyY - current.bodyY) * ease;
    current.bodyRot += (bodyRot - current.bodyRot) * ease;

    if (leftArm) leftArm.rotation.set(current.armX, 0, -current.armZ / 1.6);
    if (rightArm) rightArm.rotation.set(current.armX, 0, current.armZ);
    if (leftLeg) leftLeg.rotation.x = -current.legX;
    if (rightLeg) rightLeg.rotation.x = current.legX;
    body.position.y = current.bodyY;
    body.rotation.z = current.bodyRot;
    if (label) label.position.y = AVATAR_HEIGHT + 0.85 + current.bodyY;
  }

  function dispose() {
    root.traverse((obj) => {
      if (obj.isMesh || obj.isSprite) {
        if (obj.geometry && obj.geometry !== geoCache.get('box')) obj.geometry.dispose?.();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (!m) continue;
          if (m.isSpriteMaterial) { m.map?.dispose?.(); m.dispose(); }
          else if (m.map && m.transparent) { m.map.dispose(); m.dispose(); }
        }
      }
    });
  }

  return { root, spec, update, dispose, setAvatar: null };
}

export function disposeAvatarCaches() {
  for (const geo of geoCache.values()) geo.dispose();
  geoCache.clear();
  for (const mat of matCache.values()) mat.dispose();
  matCache.clear();
}
