// Client-side world: renders the place, predicts the local character with the
// shared physics module, and interpolates everyone else from server snapshots.

import * as THREE from 'three';
import { buildCollision, makePlayerState, stepPlayer, animFor } from '/shared/physics.js';
import { buildAvatar } from './avatar3d.js';

const KIND_GEO = {};
let geoReady = false;

function unitGeometries() {
  if (geoReady) return KIND_GEO;
  KIND_GEO.sphere = new THREE.SphereGeometry(0.5, 20, 14);
  KIND_GEO.cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 1);
  KIND_GEO.cone = new THREE.ConeGeometry(0.5, 1, 24, 1);
  KIND_GEO.box = new THREE.BoxGeometry(1, 1, 1);
  KIND_GEO.wedge = wedgeGeometry();
  geoReady = true;
  return KIND_GEO;
}

function wedgeGeometry() {
  // Triangular prism: rises toward -Z, flat at +Z.
  const a = [-0.5, -0.5, -0.5]; // back bottom left
  const b = [0.5, -0.5, -0.5];
  const c = [-0.5, 0.5, -0.5];
  const d = [0.5, 0.5, -0.5];
  const e = [-0.5, -0.5, 0.5];
  const f = [0.5, -0.5, 0.5];
  const tris = [
    a, b, d, a, d, c,          // back
    a, e, f, a, f, b,          // bottom
    a, c, e,                   // left
    b, f, d,                   // right
    c, d, f, c, f, e,          // slope
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  geo.computeVertexNormals();
  return geo;
}

function partMaterial(part) {
  const neon = part.material === 'neon';
  const glass = part.material === 'glass';
  const metal = part.material === 'metal';
  const wood = part.material === 'wood';
  const transparent = glass || (part.transparency || 0) > 0;
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(part.color || '#9aa4b2'),
    roughness: neon ? 0.45 : metal ? 0.28 : glass ? 0.08 : wood ? 0.85 : part.material === 'smooth' ? 0.3 : 0.62,
    metalness: metal ? 0.85 : glass ? 0.2 : 0.04,
    emissive: neon ? new THREE.Color(part.color || '#fff') : 0x000000,
    emissiveIntensity: neon ? 1.25 : 0,
    transparent,
    opacity: glass ? 0.42 : 1 - (part.transparency || 0) * 0.85,
    depthWrite: !transparent,
  });
  return mat;
}

export function buildPartMesh(part) {
  const geoSet = unitGeometries();
  let mesh;
  if (part.kind === 'torus') {
    const outer = Math.max(1, part.size[0]);
    const tube = Math.max(0.04, Math.min(0.42, (part.size[1] || 1) / outer / 2));
    const geo = new THREE.TorusGeometry(0.5 - tube, tube, 10, 40);
    mesh = new THREE.Mesh(geo, partMaterial(part));
    const scale = outer;
    mesh.scale.set(scale, scale, scale);
    mesh.userData.ownGeometry = true;
  } else {
    mesh = new THREE.Mesh(geoSet[part.kind] || geoSet.box, partMaterial(part));
    mesh.scale.set(part.size[0], part.size[1], part.size[2]);
  }
  mesh.position.set(part.pos[0], part.pos[1], part.pos[2]);
  if (part.rot) mesh.rotation.set(part.rot[0] || 0, part.rot[1] || 0, part.rot[2] || 0);
  mesh.frustumCulled = true;
  mesh.userData.partId = part.id;
  return mesh;
}

function skyDome() {
  const geo = new THREE.SphereGeometry(900, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color('#122a58') },
      mid: { value: new THREE.Color('#0a1430') },
      bottom: { value: new THREE.Color('#05070e') },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 bottom;
      varying vec3 vPos;
      void main() {
        float h = normalize(vPos).y;
        vec3 col = h > 0.0 ? mix(mid, top, pow(h, 0.7)) : mix(mid, bottom, pow(-h, 0.55));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

function starField() {
  const count = 700;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 500 + Math.random() * 300;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 0.9);
    positions[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
    positions[i * 3 + 1] = Math.abs(Math.cos(phi)) * r;
    positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0xbcd4ff, size: 2.4, sizeAttenuation: true, transparent: true, opacity: 0.7, depthWrite: false });
  return new THREE.Points(geo, mat);
}

export class WorldView {
  constructor(container, { parts = [], spawn = [0, 6, 0] } = {}) {
    this.container = container;
    this.spawn = spawn;
    this.parts = parts;
    this.remote = new Map();
    this.self = null;
    this.collision = buildCollision(parts);
    this.keys = new Set();
    this.camYaw = 0;
    this.camPitch = 0.28;
    this.camDist = 18;
    this.pad = { mx: 0, mz: 0, jump: false, up: 0 };
    this.touch = { mx: 0, mz: 0, jump: false, up: 0 };
    this.lastIntent = { mx: 0, mz: 0, jump: false, up: 0, yaw: 0 };
    this.time = 0;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setSize(container.clientWidth || 800, container.clientHeight || 600, false);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0a1220, 160, 620);

    this.camera = new THREE.PerspectiveCamera(68, 1, 0.1, 2400);
    this.camera.position.set(0, 12, 24);

    this.scene.add(skyDome());
    this.scene.add(starField());
    this.scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x1b2130, 1.35));
    const sun = new THREE.DirectionalLight(0xfff2df, 2.1);
    sun.position.set(120, 220, 90);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x7ea6ff, 0.85);
    fill.position.set(-90, 60, -110);
    this.scene.add(fill);

    this.placeGroup = new THREE.Group();
    this.scene.add(this.placeGroup);
    this.grid = null;
    this.setParts(parts, spawn);

    this.avatarGroup = new THREE.Group();
    this.scene.add(this.avatarGroup);

    this.raycaster = new THREE.Raycaster();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    this._bindPointer(container);
    this.resize();
  }

  // ---- place ---------------------------------------------------------------

  setParts(parts, spawn) {
    for (const child of [...this.placeGroup.children]) {
      this.placeGroup.remove(child);
      if (child.userData.ownGeometry) child.geometry.dispose();
      child.material?.dispose?.();
    }
    this.parts = parts || [];
    if (spawn) this.spawn = spawn;
    this.collision = buildCollision(this.parts);

    let floorTop = 0;
    for (const part of this.parts) {
      if (!part || !part.pos || !part.size) continue;
      this.placeGroup.add(buildPartMesh(part));
      if (part.pos[1] < 4 && part.size[0] >= 60 && part.size[2] >= 60) {
        floorTop = Math.max(floorTop, part.pos[1] + part.size[1] / 2);
      }
    }

    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.material.dispose();
      this.grid.geometry.dispose();
      this.grid = null;
    }
    const grid = new THREE.GridHelper(400, 80, 0x38507a, 0x22304a);
    grid.position.y = floorTop + 0.04;
    grid.material.transparent = true;
    grid.material.opacity = 0.35;
    grid.material.depthWrite = false;
    this.scene.add(grid);
    this.grid = grid;
  }

  // ---- players -------------------------------------------------------------

  setSelf({ id, name, avatar, level = 0, pos }) {
    if (this.self?.model) {
      this.avatarGroup.remove(this.self.model.root);
      this.self.model.dispose();
    }
    const model = buildAvatar(avatar, { name, level, showName: false });
    this.avatarGroup.add(model.root);
    const state = makePlayerState(pos || this.spawn.map((v, i) => (i === 1 ? v + 2 : v)));
    this.self = { id, name, avatar, level, model, state, yaw: 0, invisible: false, emoteUntil: 0, emoteKind: '' };
    this.syncCamera(true);
  }

  setSelfAvatar(avatar) {
    if (!this.self) return;
    this.self.model.dispose();
    this.avatarGroup.remove(this.self.model.root);
    this.self.avatar = avatar;
    this.self.model = buildAvatar(avatar, { name: this.self.name, level: this.self.level, showName: false });
    this.avatarGroup.add(this.self.model.root);
  }

  addPlayer(summary) {
    if (!summary || summary.id === this.self?.id) return;
    let entry = this.remote.get(summary.id);
    if (entry) {
      entry.name = summary.name;
      return;
    }
    const model = buildAvatar(summary.avatar || {}, { name: summary.name, level: summary.level || 0 });
    const pos = summary.pos || this.spawn;
    model.root.position.set(pos[0], pos[1], pos[2]);
    this.scene.add(model.root);
    entry = {
      id: summary.id,
      name: summary.name,
      level: summary.level || 0,
      avatar: summary.avatar || {},
      model,
      current: new THREE.Vector3(pos[0], pos[1], pos[2]),
      target: new THREE.Vector3(pos[0], pos[1], pos[2]),
      yaw: summary.yaw || 0,
      targetYaw: summary.yaw || 0,
      anim: 'idle',
      invisible: !!summary.inv,
      emoteUntil: 0,
      emoteKind: 'wave',
      speed: 0,
    };
    this.remote.set(summary.id, entry);
  }

  removePlayer(id) {
    const entry = this.remote.get(id);
    if (!entry) return;
    this.scene.remove(entry.model.root);
    entry.model.dispose();
    this.remote.delete(id);
  }

  syncPlayers(list) {
    if (!Array.isArray(list)) return;
    const ids = new Set();
    for (const summary of list) {
      ids.add(summary.id);
      this.addPlayer(summary);
    }
    for (const id of [...this.remote.keys()]) {
      if (!ids.has(id)) this.removePlayer(id);
    }
  }

  applySnapshot(players) {
    if (!this.self) return;
    for (const entry of players) {
      if (entry.id === this.self.id) {
        this.reconcile(entry);
        continue;
      }
      const remote = this.remote.get(entry.id);
      if (!remote) continue;
      remote.target.set(entry.p[0], entry.p[1], entry.p[2]);
      remote.targetYaw = entry.yaw;
      remote.anim = entry.a || 'idle';
      remote.invisible = !!entry.i;
      remote.frozen = !!entry.f;
    }
  }

  reconcile(entry) {
    if (!this.self || !Array.isArray(entry.p)) return;
    const s = this.self.state;
    const dx = entry.p[0] - s.pos[0];
    const dy = entry.p[1] - s.pos[1];
    const dz = entry.p[2] - s.pos[2];
    const dist = Math.hypot(dx, dy, dz);
    if (dist > 2.5) {
      s.pos[0] = entry.p[0];
      s.pos[1] = entry.p[1];
      s.pos[2] = entry.p[2];
      s.vel[0] = 0;
      s.vel[1] = 0;
      s.vel[2] = 0;
    } else if (dist > 0.12) {
      const k = 0.22;
      s.pos[0] += dx * k;
      s.pos[1] += dy * k;
      s.pos[2] += dz * k;
    }
    if (entry.f) {
      s.frozen = true;
      s.vel[0] = s.vel[2] = 0;
    } else {
      s.frozen = false;
    }
    this.self.invisible = !!entry.i;
  }

  setFlags({ fly, speed, jump, frozen, inv }) {
    if (!this.self) return;
    const s = this.self.state;
    if (typeof fly === 'boolean') s.fly = fly;
    if (typeof speed === 'number' && speed >= 0) s.speed = speed;
    if (typeof jump === 'number' && jump >= 0) s.jumpPower = jump;
    if (typeof frozen === 'boolean') s.frozen = frozen;
    if (typeof inv === 'boolean') this.self.invisible = inv;
  }

  setPlayerFlags(id, flags) {
    if (this.self && id === this.self.id) {
      if (typeof flags.frozen === 'boolean') {
        this.self.state.frozen = flags.frozen;
        if (flags.frozen) this.self.state.vel[0] = this.self.state.vel[2] = 0;
      }
      if (typeof flags.fly === 'boolean') this.self.state.fly = flags.fly;
      if (typeof flags.inv === 'boolean') this.self.invisible = flags.inv;
    }
    const remote = this.remote.get(id);
    if (!remote) return;
    if (typeof flags.inv === 'boolean') remote.invisible = flags.inv;
    if (typeof flags.frozen === 'boolean') remote.frozen = flags.frozen;
  }

  teleport(pos) {
    if (!this.self || !Array.isArray(pos)) return;
    this.self.state.pos = [pos[0], pos[1], pos[2]];
    this.self.state.vel = [0, 0, 0];
    this.syncCamera(true);
  }

  playEmote(id, kind) {
    if (id === this.self?.id) {
      this.self.emoteKind = kind;
      this.self.emoteUntil = performance.now() + 2600;
      return;
    }
    const remote = this.remote.get(id);
    if (!remote) return;
    remote.emoteKind = kind;
    remote.emoteUntil = performance.now() + 2600;
  }

  // ---- camera + input ------------------------------------------------------

  _bindPointer(container) {
    const canvas = this.renderer.domElement;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture?.(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.camYaw -= (e.clientX - lastX) * 0.0055;
      this.camPitch = Math.max(-0.35, Math.min(1.05, this.camPitch + (e.clientY - lastY) * 0.0035));
      lastX = e.clientX;
      lastY = e.clientY;
    });
    const stop = () => { dragging = false; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    canvas.addEventListener('pointerleave', stop);

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camDist = Math.max(6, Math.min(48, this.camDist + e.deltaY * 0.03));
    }, { passive: false });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  cameraBasis() {
    const s = Math.sin(this.camYaw);
    const c = Math.cos(this.camYaw);
    return { forward: [-s, -c], right: [c, -s] };
  }

  computeIntent() {
    const { forward, right } = this.cameraBasis();
    const k = this.keys;
    // Keyboard, gamepad, and touch all express movement in screen space
    // (forward/back + strafe), then get rotated into the world by the camera.
    const w = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0)
      - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0)
      - this.pad.mz - this.touch.mz;
    const d = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0)
      - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0)
      + this.pad.mx + this.touch.mx;
    let mx = forward[0] * w + right[0] * d;
    let mz = forward[1] * w + right[1] * d;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const shift = k.has('ShiftLeft') || k.has('ShiftRight');
    return {
      mx, mz,
      jump: k.has('Space') || this.pad.jump || this.touch.jump,
      up: shift ? -1 : (this.pad.up || this.touch.up),
      yaw: Math.atan2(mx, mz),
    };
  }

  rotateCamera(dYaw, dPitch) {
    this.camYaw -= dYaw;
    this.camPitch = Math.max(-0.35, Math.min(1.05, this.camPitch + dPitch));
  }

  stepLocal(dt) {
    if (!this.self) return this.lastIntent;
    const intent = this.computeIntent();
    this.lastIntent = intent;
    const info = stepPlayer(this.self.state, intent, this.collision, dt);
    if (intent.mx || intent.mz) {
      const targetYaw = Math.atan2(intent.mx, intent.mz);
      let delta = targetYaw - this.self.yaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      this.self.yaw += delta * Math.min(1, dt * 14);
    }
    this.self.anim = animFor(this.self.state, info);
    if (performance.now() < this.self.emoteUntil) this.self.anim = `emote:${this.self.emoteKind}`;
    return intent;
  }

  syncCamera(snap = false) {
    if (!this.self) return;
    const [x, y, z] = this.self.state.pos;
    const cos = Math.cos(this.camPitch);
    const dist = this.camDist;
    const tx = x + Math.sin(this.camYaw) * dist * cos;
    const tz = z + Math.cos(this.camYaw) * dist * cos;
    const ty = y + 6.4 + Math.sin(this.camPitch) * dist * 0.85;
    if (snap) this.camera.position.set(tx, ty, tz);
    else this.camera.position.lerp(new THREE.Vector3(tx, ty, tz), 0.22);
    this.camera.lookAt(x, y + 3.6, z);
  }

  // ---- frame ---------------------------------------------------------------

  frame(dt) {
    this.time += dt;
    const now = performance.now();

    if (this.self) {
      const s = this.self.state;
      this.self.model.root.position.set(s.pos[0], s.pos[1], s.pos[2]);
      this.self.model.root.rotation.y = this.self.yaw;
      const speed = Math.hypot(s.vel[0], s.vel[2]);
      this.self.model.update(dt, this.self.anim, speed);
      this.self.model.root.visible = !this.self.invisible || this.self.anim === 'fly';
      if (this.self.invisible) this.self.model.root.visible = false;
      this.syncCamera(false);
    }

    for (const remote of this.remote.values()) {
      const k = 1 - Math.exp(-dt * 11);
      remote.current.lerp(remote.target, k);
      let dyaw = remote.targetYaw - remote.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      remote.yaw += dyaw * Math.min(1, dt * 11);

      const root = remote.model.root;
      root.position.copy(remote.current);
      root.rotation.y = remote.yaw;
      const moved = root.position.distanceToSquared(new THREE.Vector3(remote.target.x, remote.target.y, remote.target.z));
      const anim = now < remote.emoteUntil ? `emote:${remote.emoteKind}` : remote.anim;
      remote.model.update(dt, anim, moved > 0.05 ? 8 : 0);
      root.visible = !remote.invisible;
    }

    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.resizeObserver.disconnect();
    for (const remote of this.remote.values()) {
      this.scene.remove(remote.model.root);
      remote.model.dispose();
    }
    this.remote.clear();
    if (this.self?.model) this.self.model.dispose();
    for (const child of [...this.placeGroup.children]) {
      if (child.userData.ownGeometry) child.geometry.dispose();
      child.material?.dispose?.();
    }
    this.scene.traverse((obj) => {
      if (obj.isMesh || obj.isPoints) {
        if (obj.geometry && obj.geometry.userData?.shared !== true) obj.geometry.dispose?.();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => m?.dispose?.());
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
