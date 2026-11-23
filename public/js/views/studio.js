// Blockforge Studio — a real part-based editor.
// Parts are the same JSON the server validates and the world simulates.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { api, isServerDown, state as appState, navigate } from '../store.js';
import { el, esc, fmtNum, qs, qsa, icon, toast, confirmDialog } from '../ui.js';
import { buildPartMesh } from '../three/world3d.js';

const PALETTE = ['#5b8cff', '#a855f7', '#22d3ee', '#34d399', '#facc15', '#fb7185', '#f97316', '#94a3b8', '#e2e8f0', '#64748b'];
const KINDS = { box: 'Box', sphere: 'Sphere', cylinder: 'Cylinder', wedge: 'Wedge', cone: 'Cone', torus: 'Torus' };
const MATERIALS = ['plastic', 'smooth', 'neon', 'metal', 'glass', 'wood'];

let idCounter = 0;
const newId = () => `p${Date.now().toString(36)}${(idCounter++).toString(36)}`.slice(0, 30);

export async function renderStudio(root, { params }) {
  const gameId = params[0];
  if (!gameId) {
    navigate('create');
    return { title: 'Studio' };
  }

  let game;
  try {
    const res = await api(`/api/games/${encodeURIComponent(gameId)}`);
    game = res.game;
    if (!game.canEdit) throw new Error('That place belongs to someone else.');
  } catch (err) {
    root.innerHTML = `<div class="page"><div class="empty"><b>Cannot open Studio</b>${esc(err.message)}
      <div style="margin-top:14px"><a class="btn" href="#/create">Back to Studio home</a></div></div></div>`;
    return { title: 'Studio' };
  }

  const model = {
    id: game.id,
    name: game.name,
    description: game.description || '',
    parts: (game.parts || []).map((p) => ({ ...p })),
    spawn: game.spawn || [0, 6, 0],
    version: game.version || 1,
    published: !!game.published,
    dirty: false,
    recovered: false,
    selectedId: null,
    tool: 'translate',
    snap: true,
  };

  // ---- offline draft -------------------------------------------------------
  // Everything is edited in memory, so a crash, a closed tab, or a server that
  // went away would otherwise lose work. Mirror the place into localStorage as
  // soon as it is touched and offer it back on the next visit.
  const DRAFT_KEY = `bf:draft:${model.id}`;

  function readDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const draft = JSON.parse(raw);
      if (!draft || !Array.isArray(draft.parts)) return null;
      return draft;
    } catch {
      return null;
    }
  }

  function writeDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        v: 1,
        baseVersion: model.version,
        savedAt: Date.now(),
        name: model.name,
        description: model.description,
        parts: model.parts,
        spawn: model.spawn,
      }));
    } catch { /* storage full or blocked — the server save still works */ }
  }

  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
  }

  const savedDraft = readDraft();
  if (savedDraft && savedDraft.baseVersion === model.version && savedDraft.parts.length
    && JSON.stringify(savedDraft.parts) !== JSON.stringify(model.parts)) {
    model.parts = savedDraft.parts.map((p) => ({ ...p }));
    model.spawn = Array.isArray(savedDraft.spawn) ? savedDraft.spawn : model.spawn;
    if (typeof savedDraft.name === 'string' && savedDraft.name.trim()) model.name = savedDraft.name;
    if (typeof savedDraft.description === 'string') model.description = savedDraft.description;
    model.dirty = true;
    model.recovered = true;
  } else if (savedDraft) {
    // Nothing to recover, or the server moved on (newer version saved
    // elsewhere) and the draft is stale.
    clearDraft();
  }

  root.innerHTML = `<div class="studio">
    <div class="studio-top">
      <a class="tool-btn" href="#/create" title="Back to Studio home">${icon('arrowLeft')}</a>
      <div class="studio-title"><span class="dot"></span><span data-title>${esc(model.name)}</span>
        <span class="badge" data-save-state>Saved</span></div>
      <div class="toolbar-group" data-tools>
        <button class="tool-btn ${model.tool === 'translate' ? 'active' : ''}" data-tool="translate" title="Move (W)">${icon('move')}</button>
        <button class="tool-btn" data-tool="rotate" title="Rotate (E)">${icon('rotate')}</button>
        <button class="tool-btn" data-tool="scale" title="Scale (R)">${icon('scale')}</button>
      </div>
      <div class="toolbar-group" data-add>
        <button class="tool-btn" data-add-kind="box" title="Add box">▢</button>
        <button class="tool-btn" data-add-kind="sphere" title="Add sphere">◍</button>
        <button class="tool-btn" data-add-kind="cylinder" title="Add cylinder">◲</button>
        <button class="tool-btn" data-add-kind="wedge" title="Add wedge">◤</button>
      </div>
      <div class="toolbar-group">
        <button class="tool-btn" data-undo title="Undo (Ctrl+Z)">↶</button>
        <button class="tool-btn" data-redo title="Redo (Ctrl+Shift+Z)">↷</button>
        <button class="tool-btn ${model.snap ? 'active' : ''}" data-snap title="Snap to grid">⌗</button>
      </div>
      <div class="studio-toolbar-right">
        <button class="btn btn-sm" data-test>${icon('play')} Play test</button>
        <button class="btn btn-sm" data-save>${icon('save')} Save</button>
        <button class="btn btn-sm ${model.published ? 'btn-good' : 'btn-primary'}" data-publish>${model.published ? 'Live · Unpublish' : 'Publish'}</button>
      </div>
    </div>

    <div class="studio-main">
      <aside class="studio-left">
        <div class="panel-head"><span>Toolbox</span><span data-tb-count>${KINDS.box}s</span></div>
        <div class="toolbox" data-toolbox></div>
      </aside>
      <div class="studio-viewport" data-viewport>
        <div class="selection-badge" data-sel-badge>Nothing selected — click a part</div>
        <div class="studio-help">
          <b>W</b> move · <b>E</b> rotate · <b>R</b> scale · <b>F</b> focus<br/>
          <b>Delete</b> remove · <b>Ctrl+D</b> duplicate · <b>Ctrl+S</b> save<br/>
          Spawn point: <span data-spawn-hint></span>
        </div>
      </div>
      <aside class="studio-right">
        <div class="panel-head"><span>Properties</span><span data-prop-kind></span></div>
        <div class="props" data-props></div>
      </aside>
    </div>

    <div class="studio-status">
      <span data-partcount></span><i class="sep"></i>
      <span data-sel></span><i class="sep"></i>
      <span data-version>v${model.version}</span><i class="sep"></i>
      <span data-published>${model.published ? 'Published' : 'Draft'}</span>
      <span style="margin-left:auto" data-coords></span>
    </div>
  </div>`;

  const viewport = qs(root, '[data-viewport]');
  const propsEl = qs(root, '[data-props]');
  const badge = qs(root, '[data-sel-badge]');
  const saveState = qs(root, '[data-save-state]');

  let draftTimer = 0;
  const scheduleDraft = () => {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(writeDraft, 500);
  };

  if (model.recovered) {
    saveState.textContent = 'Recovered draft';
    saveState.className = 'badge badge-bad';
    toast('Recovered unsaved changes saved in this browser. Press Save to keep them.', 'warn');
  }

  // ---- three ---------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  viewport.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0a0e17');
  scene.fog = new THREE.Fog('#0a0e17', 220, 620);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 3000);
  camera.position.set(44, 38, 48);

  scene.add(new THREE.HemisphereLight(0xd8e6ff, 0x1a2130, 1.15));
  const sun = new THREE.DirectionalLight(0xfff4e6, 2.0);
  sun.position.set(80, 140, 60);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x86a8ff, 0.8);
  rim.position.set(-70, 50, -80);
  scene.add(rim);

  const grid = new THREE.GridHelper(400, 200, 0x3b527a, 0x1d2a41);
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
  scene.add(grid);
  const axes = new THREE.AxesHelper(8);
  axes.position.y = 0.02;
  scene.add(axes);

  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.target.set(0, 4, 0);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.08;
  orbit.maxPolarAngle = Math.PI * 0.495;
  orbit.minDistance = 6;
  orbit.maxDistance = 420;

  const transform = new TransformControls(camera, renderer.domElement);
  transform.setSize(0.85);
  transform.setTranslationSnap(1);
  transform.setRotationSnap(Math.PI / 12);
  transform.setScaleSnap(0.5);
  scene.add(transform.getHelper());
  transform.addEventListener('dragging-changed', (e) => { orbit.enabled = !e.value; });
  transform.addEventListener('objectChange', () => syncFromMesh());

  const placeGroup = new THREE.Group();
  scene.add(placeGroup);
  const meshes = new Map();
  let selectionBox = null;

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  const resize = () => {
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(viewport);
  resize();

  // ---- mesh management -----------------------------------------------------
  function applyTransform(mesh, part) {
    mesh.position.set(part.pos[0], part.pos[1], part.pos[2]);
    mesh.rotation.set(part.rot[0], part.rot[1], part.rot[2]);
    if (part.kind === 'torus') {
      const t = Math.max(0.03, Math.min(0.42, (part.size[1] || 1) / Math.max(1, part.size[0]) / 2));
      const geo = new THREE.TorusGeometry(0.5 - t, t, 10, 40);
      if (mesh.userData.ownGeometry) mesh.geometry.dispose();
      mesh.geometry = geo;
      mesh.userData.ownGeometry = true;
      mesh.userData.tube = t;
      mesh.scale.setScalar(part.size[0]);
    } else {
      const unit = mesh.userData.unitScale !== false;
      if (unit) mesh.scale.set(part.size[0], part.size[1], part.size[2]);
    }
  }

  function addMesh(part) {
    const mesh = buildPartMesh(part);
    mesh.userData.partId = part.id;
    mesh.userData.part = part;
    if (part.kind === 'torus') mesh.userData.ownGeometry = true;
    applyTransform(mesh, part);
    placeGroup.add(mesh);
    meshes.set(part.id, mesh);
    return mesh;
  }

  function rebuildMeshes() {
    for (const [id, mesh] of meshes) {
      placeGroup.remove(mesh);
      if (mesh.userData.ownGeometry) mesh.geometry.dispose();
      mesh.material?.dispose?.();
    }
    meshes.clear();
    for (const part of model.parts) addMesh(part);
    updateSelectionBox();
    updateStatus();
  }

  function select(id) {
    model.selectedId = id;
    const mesh = meshes.get(id);
    if (mesh) {
      transform.attach(mesh);
      if (!selectionBox) {
        selectionBox = new THREE.BoxHelper(mesh, 0xffe082);
        selectionBox.material.depthTest = false;
        selectionBox.material.transparent = true;
        scene.add(selectionBox);
      } else {
        selectionBox.setFromObject(mesh);
      }
      badge.textContent = `${mesh.userData.part?.name || 'Part'} · ${mesh.userData.part?.kind}`;
    } else {
      transform.detach();
      if (selectionBox) {
        scene.remove(selectionBox);
        selectionBox.geometry.dispose();
        selectionBox.material.dispose();
        selectionBox = null;
      }
      badge.textContent = 'Nothing selected — click a part';
    }
    drawProps();
    updateStatus();
  }

  function updateSelectionBox() {
    if (!selectionBox) return;
    const mesh = meshes.get(model.selectedId);
    if (mesh) selectionBox.setFromObject(mesh);
  }

  function syncFromMesh() {
    const mesh = meshes.get(model.selectedId);
    const part = model.parts.find((p) => p.id === model.selectedId);
    if (!mesh || !part) return;
    part.pos = [round(mesh.position.x, 2), round(mesh.position.y, 2), round(mesh.position.z, 2)];
    part.rot = [round(mesh.rotation.x, 3), round(mesh.rotation.y, 3), round(mesh.rotation.z, 3)];
    if (part.kind === 'torus') {
      const tube = mesh.userData.tube || 0.1;
      part.size = [round(mesh.scale.x, 2), round(tube * 2 * mesh.scale.x, 2), round(mesh.scale.x, 2)];
    } else {
      part.size = [round(mesh.scale.x, 2), round(mesh.scale.y, 2), round(mesh.scale.z, 2)];
    }
    markDirty();
    updateSelectionBox();
    drawProps(true);
    updateStatus();
  }

  // ---- history -------------------------------------------------------------
  const history = [];
  const future = [];
  const snapshot = () => JSON.stringify(model.parts);
  function pushHistory() {
    history.push(snapshot());
    if (history.length > 40) history.shift();
    future.length = 0;
  }
  function undo() {
    if (!history.length) return;
    future.push(snapshot());
    model.parts = JSON.parse(history.pop());
    model.selectedId = null;
    rebuildMeshes();
    select(null);
    markDirty();
  }
  function redo() {
    if (!future.length) return;
    history.push(snapshot());
    model.parts = JSON.parse(future.pop());
    model.selectedId = null;
    rebuildMeshes();
    select(null);
    markDirty();
  }

  // ---- mutations -----------------------------------------------------------
  function markDirty() {
    model.dirty = true;
    saveState.textContent = 'Unsaved';
    saveState.className = 'badge badge-bad';
    scheduleDraft();
  }

  function addPart(kind = 'box', size = defaultSize(kind)) {
    pushHistory();
    const focus = orbit.target.clone();
    const part = {
      id: newId(),
      name: `${KINDS[kind] || 'Part'} ${model.parts.length + 1}`,
      kind,
      pos: [round(focus.x, 1), round(Math.max(1, focus.y), 1), round(focus.z, 1)],
      size,
      rot: [0, 0, 0],
      color: PALETTE[model.parts.length % PALETTE.length],
      material: 'plastic',
      transparency: 0,
      anchored: true,
    };
    model.parts.push(part);
    addMesh(part);
    select(part.id);
    markDirty();
    updateStatus();
  }

  function addModel(parts, name) {
    pushHistory();
    const focus = orbit.target;
    const base = model.parts.length;
    for (const [index, blueprint] of parts.entries()) {
      const part = {
        id: newId(),
        name: `${name} ${index + 1}`,
        kind: blueprint.kind,
        pos: [
          round(focus.x + (blueprint.pos[0] || 0), 1),
          round(Math.max(0.5, (blueprint.pos[1] || 0) + 1), 1),
          round(focus.z + (blueprint.pos[2] || 0), 1),
        ],
        size: blueprint.size,
        rot: blueprint.rot || [0, 0, 0],
        color: blueprint.color || PALETTE[(base + index) % PALETTE.length],
        material: blueprint.material || 'plastic',
        transparency: blueprint.transparency || 0,
        anchored: true,
      };
      model.parts.push(part);
      addMesh(part);
    }
    select(null);
    markDirty();
    updateStatus();
  }

  function deleteSelected() {
    if (!model.selectedId) return;
    pushHistory();
    const index = model.parts.findIndex((p) => p.id === model.selectedId);
    if (index < 0) return;
    const mesh = meshes.get(model.selectedId);
    if (mesh) {
      placeGroup.remove(mesh);
      if (mesh.userData.ownGeometry) mesh.geometry.dispose();
      mesh.material?.dispose?.();
      meshes.delete(model.selectedId);
    }
    model.parts.splice(index, 1);
    select(null);
    markDirty();
    updateStatus();
  }

  function duplicateSelected() {
    const part = model.parts.find((p) => p.id === model.selectedId);
    if (!part) return;
    pushHistory();
    const copy = JSON.parse(JSON.stringify(part));
    copy.id = newId();
    copy.name = `${part.name} copy`;
    copy.pos = [part.pos[0] + 4, part.pos[1], part.pos[2] + 4];
    model.parts.push(copy);
    addMesh(copy);
    select(copy.id);
    markDirty();
    updateStatus();
  }

  function defaultSize(kind) {
    if (kind === 'sphere') return [4, 4, 4];
    if (kind === 'cylinder') return [4, 6, 4];
    if (kind === 'wedge') return [6, 4, 6];
    return [4, 4, 4];
  }

  // ---- toolbox -------------------------------------------------------------
  const PRESETS = [
    { id: 'platform', label: 'Platform', icon: '▭', parts: [{ kind: 'box', pos: [0, 0.5, 0], size: [24, 1, 24], color: '#64748b', material: 'smooth' }] },
    { id: 'wall', label: 'Wall', icon: '▮', parts: [{ kind: 'box', pos: [0, 5, 0], size: [20, 10, 1], color: '#e2e8f0' }] },
    { id: 'ramp', label: 'Ramp', icon: '◺', parts: [{ kind: 'wedge', pos: [0, 2, 0], size: [10, 4, 12], color: '#94a3b8' }] },
    { id: 'stairs', label: 'Stairs', icon: '≋', parts: Array.from({ length: 6 }, (_, i) => ({ kind: 'box', pos: [0, 0.5 + i * 0.9, i * 1.6], size: [8, 1, 1.8], color: '#cbd5e1' })) },
    { id: 'arch', label: 'Arch', icon: '∩', parts: [
      { kind: 'box', pos: [-4, 4, 0], size: [2, 8, 2], color: '#e2e8f0' },
      { kind: 'box', pos: [4, 4, 0], size: [2, 8, 2], color: '#e2e8f0' },
      { kind: 'box', pos: [0, 8.6, 0], size: [10, 1.2, 2], color: '#cbd5e1' },
    ] },
    { id: 'tree', label: 'Tree', icon: '🌳', parts: [
      { kind: 'cylinder', pos: [0, 4, 0], size: [2, 8, 2], color: '#5b3a21', material: 'wood' },
      { kind: 'sphere', pos: [0, 10, 0], size: [8, 6, 8], color: '#2f9e5f' },
    ] },
    { id: 'lamp', label: 'Lamp post', icon: '💡', parts: [
      { kind: 'cylinder', pos: [0, 3, 0], size: [0.8, 6, 0.8], color: '#475569', material: 'metal' },
      { kind: 'sphere', pos: [0, 6.6, 0], size: [1.8, 1.8, 1.8], color: '#fde68a', material: 'neon' },
    ] },
    { id: 'tower', label: 'Tower', icon: '🗼', parts: [
      { kind: 'cylinder', pos: [0, 3, 0], size: [10, 6, 10], color: '#94a3b8', material: 'smooth' },
      { kind: 'cylinder', pos: [0, 12, 0], size: [7, 12, 7], color: '#cbd5e1' },
      { kind: 'cone', pos: [0, 21, 0], size: [9, 6, 9], color: '#f59e0b', material: 'neon' },
    ] },
    { id: 'ring', label: 'Neon ring', icon: '◎', parts: [
      { kind: 'torus', pos: [0, 8, 0], size: [14, 1, 14], rot: [0, 0, 0], color: '#22d3ee', material: 'neon' },
    ] },
  ];

  qs(root, '[data-toolbox]').innerHTML = `
    <div class="admin-section-title">Primitives</div>
    ${Object.entries(KINDS).map(([kind, label]) => `<div class="preset" data-primitive="${kind}">
      <span class="ico">▢</span><span>${label}</span>
    </div>`).join('')}
    <div class="admin-section-title" style="margin-top:8px">Models</div>
    ${PRESETS.map((p) => `<div class="preset" data-preset="${p.id}">
      <span class="ico">${p.icon}</span><span>${p.label}</span>
    </div>`).join('')}
  `;

  qs(root, '[data-toolbox]').addEventListener('click', (e) => {
    const prim = e.target.closest('[data-primitive]');
    if (prim) return addPart(prim.dataset.primitive);
    const preset = e.target.closest('[data-preset]');
    if (preset) {
      const found = PRESETS.find((p) => p.id === preset.dataset.preset);
      if (found) addModel(found.parts, found.label);
    }
  });

  // ---- inspector -----------------------------------------------------------
  const fmt = (n) => Math.round(n * 100) / 100;

  function drawProps(skipFocus) {
    const part = model.parts.find((p) => p.id === model.selectedId);
    qs(root, '[data-prop-kind]').textContent = part ? KINDS[part.kind] : 'place';
    if (!part) {
      propsEl.innerHTML = `
        <div class="admin-section-title">Place</div>
        <div class="field"><label>Name</label><input class="input" data-place-name value="${esc(model.name)}" maxlength="48" /></div>
        <div class="field"><label>Description</label><textarea class="textarea" data-place-desc rows="3">${esc(model.description)}</textarea></div>
        <div class="admin-section-title">Spawn point</div>
        <div class="vec-row"><span></span>
          <input class="prop-input" data-spawn="0" value="${fmt(model.spawn[0])}" />
          <input class="prop-input" data-spawn="1" value="${fmt(model.spawn[1])}" />
          <input class="prop-input" data-spawn="2" value="${fmt(model.spawn[2])}" />
        </div>
        <button class="btn btn-sm" data-spawn-here>Set spawn to camera focus</button>
        <div class="hint" style="margin-top:10px">Parts: <b>${model.parts.length}</b> · Collision is built from every anchored part.</div>
        <div class="hint">Play test opens the real server, so a second tab can join you.</div>
      `;
      return;
    }

    propsEl.innerHTML = `
      <div class="field" style="margin-bottom:8px"><label>Name</label>
        <input class="input" data-field="name" value="${esc(part.name)}" maxlength="40" /></div>
      <div class="admin-section-title">Position</div>
      <div class="vec-row"><span></span>
        ${[0, 1, 2].map((i) => `<input class="prop-input" type="number" step="0.5" data-vec="pos" data-i="${i}" value="${fmt(part.pos[i])}" />`).join('')}
      </div>
      <div class="admin-section-title">Rotation (deg)</div>
      <div class="vec-row"><span></span>
        ${[0, 1, 2].map((i) => `<input class="prop-input" type="number" step="15" data-vec="rot" data-i="${i}" value="${fmt((part.rot[i] * 180) / Math.PI)}" />`).join('')}
      </div>
      <div class="admin-section-title">Size</div>
      <div class="vec-row"><span></span>
        ${[0, 1, 2].map((i) => `<input class="prop-input" type="number" step="0.5" min="0.2" data-vec="size" data-i="${i}" value="${fmt(part.size[i])}" />`).join('')}
      </div>
      <div class="admin-section-title">Appearance</div>
      <div class="prop-row"><label>Color</label>
        <input type="color" data-field="color" value="${esc(part.color)}" style="width:38px;height:29px;border:1px solid var(--stroke);border-radius:7px;background:none" />
        <select class="select" data-field="material" style="flex:1">
          ${MATERIALS.map((m) => `<option value="${m}" ${part.material === m ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
      </div>
      <div class="prop-row"><label>Fade</label>
        <input type="range" min="0" max="0.9" step="0.05" value="${part.transparency || 0}" data-field="transparency" style="flex:1" />
      </div>
      <div class="prop-row"><label>Solid</label>
        <input type="checkbox" data-field="anchored" ${part.anchored !== false ? 'checked' : ''} />
        <span class="hint">collides with players</span>
      </div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button class="btn btn-sm" data-focus>Focus (F)</button>
        <button class="btn btn-sm" data-dup>Duplicate</button>
        <button class="btn btn-sm btn-danger" data-del>Delete</button>
      </div>
    `;
  }

  propsEl.addEventListener('change', (e) => {
    const part = model.parts.find((p) => p.id === model.selectedId);
    if (!part) {
      if (e.target.matches('[data-place-name]')) {
        model.name = e.target.value.slice(0, 48);
        qs(root, '[data-title]').textContent = model.name;
        markDirty();
      } else if (e.target.matches('[data-place-desc]')) {
        model.description = e.target.value;
        markDirty();
      } else if (e.target.matches('[data-spawn]')) {
        model.spawn[Number(e.target.dataset.spawn)] = Number(e.target.value) || 0;
        markDirty();
        updateStatus();
      }
      return;
    }

    if (e.target.matches('[data-field]')) {
      const field = e.target.dataset.field;
      pushHistory();
      if (field === 'name') part.name = e.target.value.slice(0, 40);
      else if (field === 'color') part.color = e.target.value;
      else if (field === 'material') part.material = e.target.value;
      else if (field === 'transparency') part.transparency = Number(e.target.value) || 0;
      else if (field === 'anchored') part.anchored = e.target.checked;
      refreshMesh(part);
      markDirty();
      return;
    }

    if (e.target.matches('[data-vec]')) {
      pushHistory();
      const axis = Number(e.target.dataset.i);
      const kind = e.target.dataset.vec;
      const value = Number(e.target.value);
      if (!Number.isFinite(value)) return;
      if (kind === 'rot') part.rot[axis] = (value * Math.PI) / 180;
      else if (kind === 'size') part.size[axis] = Math.max(0.2, value);
      else part.pos[axis] = value;
      refreshMesh(part);
      badge.textContent = `${part.name} · ${part.kind}`;
      markDirty();
      updateStatus();
    }
  });

  propsEl.addEventListener('input', (e) => {
    if (e.target.matches('[data-field="color"]')) {
      const part = model.parts.find((p) => p.id === model.selectedId);
      if (!part) return;
      part.color = e.target.value;
      refreshMesh(part);
      markDirty();
    }
  });

  propsEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-del]')) return deleteSelected();
    if (e.target.closest('[data-dup]')) return duplicateSelected();
    if (e.target.closest('[data-focus]')) return focusSelected();
    if (e.target.closest('[data-spawn-here]')) {
      model.spawn = [round(orbit.target.x, 1), round(Math.max(1, orbit.target.y), 1), round(orbit.target.z, 1)];
      markDirty();
      drawProps();
      updateStatus();
      toast('Spawn point moved.', 'good');
      return;
    }
  });

  function refreshMesh(part) {
    const mesh = meshes.get(part.id);
    if (!mesh) { addMesh(part); return; }
    if (part.kind === 'torus' && mesh.userData.tube !== undefined) {
      applyTransform(mesh, part);
      return;
    }
    mesh.material?.dispose?.();
    const replacement = buildPartMesh(part);
    replacement.userData = { partId: part.id, part };
    if (part.kind === 'torus') replacement.userData.ownGeometry = true;
    applyTransform(replacement, part);
    placeGroup.remove(mesh);
    placeGroup.add(replacement);
    meshes.set(part.id, replacement);
    if (model.selectedId === part.id) select(part.id);
    updateSelectionBox();
  }

  function focusSelected() {
    const mesh = meshes.get(model.selectedId);
    if (!mesh) {
      orbit.target.set(0, 4, 0);
      camera.position.set(44, 38, 48);
      return;
    }
    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    orbit.target.copy(center);
    const dir = new THREE.Vector3(1, 0.85, 1).normalize();
    camera.position.copy(center).addScaledVector(dir, Math.max(14, size * 1.6));
  }

  // ---- pointer selection ---------------------------------------------------
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    downAt = { x: e.clientX, y: e.clientY, button: e.button };
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || downAt.button !== 0) { downAt = null; return; }
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    downAt = null;
    if (moved > 5 || transform.dragging) return;

    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects([...meshes.values()], false);
    if (hits.length) select(hits[0].object.userData.partId);
    else select(null);
  });

  // ---- toolbar -------------------------------------------------------------
  qs(root, '[data-tools]').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tool]');
    if (!btn) return;
    setTool(btn.dataset.tool);
  });

  function setTool(tool) {
    model.tool = tool;
    transform.setMode(tool);
    qsa(root, '[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
  }

  qs(root, '[data-add]').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-add-kind]');
    if (btn) addPart(btn.dataset.addKind);
  });

  qs(root, '[data-snap]').addEventListener('click', (e) => {
    model.snap = !model.snap;
    transform.setTranslationSnap(model.snap ? 1 : null);
    transform.setRotationSnap(model.snap ? Math.PI / 12 : null);
    transform.setScaleSnap(model.snap ? 0.5 : null);
    e.currentTarget.classList.toggle('active', model.snap);
  });

  qs(root, '[data-undo]').addEventListener('click', undo);
  qs(root, '[data-redo]').addEventListener('click', redo);

  qs(root, '[data-save]').addEventListener('click', () => save());
  qs(root, '[data-test]').addEventListener('click', async () => {
    const ok = await save({ quiet: true });
    if (ok) navigate(`play/${model.id}`);
  });
  qs(root, '[data-publish]').addEventListener('click', publish);

  // ---- save / publish -----------------------------------------------------
  async function save({ quiet = false, silent = false } = {}) {
    saveState.textContent = 'Saving…';
    saveState.className = 'badge';
    try {
      const res = await api(`/api/games/${model.id}/place`, {
        method: 'POST',
        body: {
          parts: model.parts,
          spawn: model.spawn,
          name: model.name,
          description: model.description,
        },
      });
      model.version = res.game.version;
      model.parts = (res.game.parts || model.parts).map((p) => ({ ...p }));
      model.dirty = false;
      clearTimeout(draftTimer);
      clearDraft();
      if (!quiet) {
        rebuildMeshes();
        select(null);
      }
      qs(root, '[data-version]').textContent = `v${model.version}`;
      saveState.textContent = 'Saved';
      saveState.className = 'badge badge-good';
      if (!quiet) toast(`Saved ${res.parts} parts as v${model.version}. Live servers reload instantly.`, 'good');
      return true;
    } catch (err) {
      const offline = isServerDown(err);
      saveState.textContent = offline ? 'Draft on device' : 'Unsaved';
      saveState.className = 'badge badge-bad';
      writeDraft();
      if (!silent) {
        toast(offline
          ? 'Server unreachable. Changes are kept as a draft on this device — press Save again when you are back online.'
          : err.message, 'bad');
      }
      return false;
    }
  }

  async function publish() {
    if (!model.published) {
      if (model.dirty) {
        const ok = await save({ quiet: true });
        if (!ok) return;
      }
      try {
        await api(`/api/games/${model.id}/publish`, { method: 'POST', body: { published: true } });
        model.published = true;
        qs(root, '[data-publish]').textContent = 'Live · Unpublish';
        qs(root, '[data-publish]').className = 'btn btn-sm btn-good';
        qs(root, '[data-published]').textContent = 'Published';
        toast('Published. It is now listed on Discover.', 'good');
      } catch (err) {
        toast(err.message, 'bad');
      }
      return;
    }

    const ok = await confirmDialog({
      title: 'Unpublish this place?',
      message: 'It disappears from Discover and new players cannot join. Your parts are kept.',
      confirm: 'Unpublish',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/games/${model.id}/publish`, { method: 'POST', body: { published: false } });
      model.published = false;
      qs(root, '[data-publish]').textContent = 'Publish';
      qs(root, '[data-publish]').className = 'btn btn-sm btn-primary';
      qs(root, '[data-published]').textContent = 'Draft';
      toast('Place is a draft again.', 'warn');
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  // ---- status --------------------------------------------------------------
  function updateStatus() {
    qs(root, '[data-partcount]').textContent = `${model.parts.length} parts`;
    const part = model.parts.find((p) => p.id === model.selectedId);
    qs(root, '[data-sel]').textContent = part ? `selected: ${part.name}` : 'no selection';
    qs(root, '[data-spawn-hint]').textContent = `${fmt(model.spawn[0])}, ${fmt(model.spawn[1])}, ${fmt(model.spawn[2])}`;
    qs(root, '[data-coords]').textContent = `focus ${fmt(orbit.target.x)}, ${fmt(orbit.target.y)}, ${fmt(orbit.target.z)}`;
  }

  // ---- keyboard ------------------------------------------------------------
  const onKeyDown = (e) => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (typing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); return; }
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); return; }
    if (e.key.toLowerCase() === 'w') setTool('translate');
    if (e.key.toLowerCase() === 'e') setTool('rotate');
    if (e.key.toLowerCase() === 'r') setTool('scale');
    if (e.key.toLowerCase() === 'f') focusSelected();
  };
  window.addEventListener('keydown', onKeyDown);

  const beforeUnload = (e) => {
    if (!model.dirty) return;
    writeDraft();
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('beforeunload', beforeUnload);

  const onHidden = () => {
    if (document.visibilityState === 'hidden' && model.dirty) writeDraft();
  };
  document.addEventListener('visibilitychange', onHidden);

  // Local draft every 15 s, quiet server autosave every 60 s. The draft is the
  // safety net when the server itself is unreachable.
  const autosave = setInterval(() => {
    if (!model.dirty) return;
    writeDraft();
  }, 15_000);

  const serverAutosave = setInterval(() => {
    if (!model.dirty) return;
    save({ quiet: true, silent: true });
  }, 60_000);

  // ---- loop ----------------------------------------------------------------
  let raf = 0;
  const loop = () => {
    orbit.update();
    if (selectionBox) {
      const mesh = meshes.get(model.selectedId);
      if (mesh) selectionBox.setFromObject(mesh);
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  rebuildMeshes();
  drawProps();
  select(null);
  updateStatus();
  qs(root, '[data-title]').textContent = model.name;

  return {
    title: `Studio · ${model.name}`,
    destroy() {
      cancelAnimationFrame(raf);
      clearTimeout(draftTimer);
      clearInterval(autosave);
      clearInterval(serverAutosave);
      if (model.dirty) writeDraft();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('visibilitychange', onHidden);
      ro.disconnect();
      transform.detach();
      transform.dispose?.();
      orbit.dispose();
      for (const mesh of meshes.values()) {
        if (mesh.userData.ownGeometry) mesh.geometry.dispose();
        mesh.material?.dispose?.();
      }
      meshes.clear();
      if (selectionBox) { selectionBox.geometry.dispose(); selectionBox.material.dispose(); }
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

function round(n, digits = 0) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
