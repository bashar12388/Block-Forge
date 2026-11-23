import { api, state, navigate, refreshMe } from '../store.js';
import { el, esc, fmtNum, qs, toast, icon, avatarChip, roleBadge } from '../ui.js';
import { requireAuth } from './auth.js';
import { createAdminPanel } from './adminPanel.js';
import { WorldView } from '../three/world3d.js';
import { createGamepadControls } from '../gamepad.js';
import { createTouchControls } from '../touch.js';
import { itemFor, DEFAULT_AVATAR } from '/shared/catalog.js';

const DEBUG = () => new URLSearchParams(location.search).has('debug');

function savedWorld(id) {
  try {
    const raw = localStorage.getItem(`bf:world:${id}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function cacheWorld(game) {
  if (!game?.id || !Array.isArray(game.parts)) return;
  try {
    localStorage.setItem(`bf:world:${game.id}`, JSON.stringify({
      game: {
        id: game.id, name: game.name, parts: game.parts, spawn: game.spawn,
        version: game.version, maxPlayers: game.maxPlayers, ownerId: game.ownerId,
      },
      at: Date.now(),
    }));
  } catch { /* storage full — online play still works */ }
}

function readProgress(id) {
  try {
    const raw = localStorage.getItem(`bf:progress:${id}`);
    const data = raw ? JSON.parse(raw) : null;
    return data && Array.isArray(data.pos) ? data : null;
  } catch {
    return null;
  }
}

function writeProgress(id, pos, version) {
  try {
    localStorage.setItem(`bf:progress:${id}`, JSON.stringify({ pos, version, at: Date.now() }));
  } catch { /* ignore */ }
}

export async function renderPlay(root, { params }) {
  const offlineBoot = state.offline || !navigator.onLine;
  if (!state.user && !offlineBoot && !requireAuth()) return { title: 'Play' };

  const gameId = params[0];
  if (!gameId) {
    navigate('discover');
    return { title: 'Discover' };
  }

  let game;
  let soloMode = offlineBoot;
  try {
    game = (await api(`/api/games/${encodeURIComponent(gameId)}`)).game;
    cacheWorld(game);
  } catch (err) {
    const saved = savedWorld(gameId);
    if (saved?.game?.parts?.length) {
      game = saved.game;
      soloMode = true;
    } else {
      root.innerHTML = `<div class="page"><div class="empty"><b>Cannot join</b>${esc(err.message)}
        ${offlineBoot ? `<div style="margin-top:10px">This world has not been saved on this device yet. Open it once with internet to make it available offline.</div>
        <div style="margin-top:14px"><a class="btn btn-primary" href="#/offline">Saved worlds</a></div>` : ''}
      </div></div>`;
      return { title: 'Cannot join' };
    }
  }

  root.innerHTML = `<div class="play-root">
    <div class="world-canvas" style="position:absolute;inset:0"></div>
    <div class="hud">
      <div class="hud-top">
        <button class="hud-pill" data-leave>${icon('arrowLeft')} Leave</button>
        <div class="hud-pill"><span class="dot"></span> <b data-world-name>${esc(game.name)}</b></div>
        <div class="hud-pill" data-ping>ping —</div>
        <div class="hud-pill" data-playercount>0 online</div>
        <button class="hud-pill" data-fullscreen title="Fullscreen" aria-label="Fullscreen">⛶</button>
      </div>
      <div class="hud-right">
        <div class="playerlist">
          <header><span>Players</span><span data-pl-count>0</span></header>
          <ul data-pl-list></ul>
        </div>
        <button class="hud-pill" data-emote>${icon('play')} Emote <kbd>E</kbd></button>
      </div>
      <div class="chat">
        <div class="chat-log" data-log></div>
        <form class="chat-form" data-chat-form>
          <input data-chat-input placeholder="Message or ;command — Enter to send" autocomplete="off" maxlength="240" />
          <button type="submit" aria-label="Send">${icon('send')}</button>
        </form>
      </div>
      <div class="command-hint">
        Type <kbd>;help</kbd> for staff commands · <kbd>Enter</kbd> to chat · <kbd>Esc</kbd> to close
      </div>
    </div>
    <div class="join-overlay" data-overlay>
      <div class="card">
        <h2 data-overlay-title>Joining ${esc(game.name)}…</h2>
        <p data-overlay-text>Connecting to the server. First join builds the world, so give it a second.</p>
      </div>
    </div>
  </div>`;

  const host = qs(root, '.world-canvas');
  const logEl = qs(root, '[data-log]');
  const chatForm = qs(root, '[data-chat-form]');
  const chatInput = qs(root, '[data-chat-input]');
  const overlay = qs(root, '[data-overlay]');
  const overlayTitle = qs(root, '[data-overlay-title]');
  const overlayText = qs(root, '[data-overlay-text]');
  const plList = qs(root, '[data-pl-list]');

  const hint = qs(root, '.command-hint');
  let hintTimer = 0;
  const dismissHint = () => {
    clearTimeout(hintTimer);
    hint?.classList.add('fade');
  };
  hintTimer = setTimeout(dismissHint, 9000);

  const players = new Map();
  let world = null;
  let ws = null;
  let myId = null;
  let myLevel = 0;
  let adminLevel = 0;
  let adminPanel = null;
  let closed = false;
  let raf = 0;
  let sendAccumulator = 0;
  let lastPing = 0;
  let pingMs = 0;
  let lastFrame = performance.now();
  let solo = false;
  let saveAccum = 0;
  const selfAvatar = state.user?.avatar || DEFAULT_AVATAR;
  const selfName = state.user?.username || 'Player';
  let soloSpawn = game.spawn || [0, 6, 0];

  // ---- chat ---------------------------------------------------------------
  const pushLog = (html, cls = '') => {
    const row = el(`<div class="msg ${cls}">${html}</div>`);
    logEl.appendChild(row);
    while (logEl.children.length > 90) logEl.firstElementChild.remove();
    logEl.scrollTop = logEl.scrollHeight;
  };

  const systemMsg = (text) => pushLog(esc(text), 'system');

  // ---- players ------------------------------------------------------------
  const renderPlayers = () => {
    const list = [...players.values()].sort((a, b) => (b.level - a.level) || a.name.localeCompare(b.name));
    qs(root, '[data-pl-count]').textContent = String(list.length);
    qs(root, '[data-playercount]').textContent = `${list.length} online`;
    plList.innerHTML = list.map((p) => `
      <li>
        ${avatarChip(p.avatar)}
        <span class="pl-name" style="color:${['#dbe4f5', '#a5f3fc', '#d8b4fe', '#fde68a'][p.level] || '#dbe4f5'}">${esc(p.name)}${p.id === myId ? ' (you)' : ''}</span>
        ${p.frozen ? '<span title="frozen">❄️</span>' : ''}
        ${p.fly ? '<span title="flying">🕊️</span>' : ''}
      </li>`).join('') || '<li class="hint" style="padding:8px">Just you for now.</li>';
    adminPanel?.refresh();
  };

  // ---- offline solo -------------------------------------------------------
  function startSolo(reason = '') {
    if (world || closed) return false;
    if (!Array.isArray(game.parts) || !game.parts.length) {
      overlay.hidden = false;
      overlayTitle.textContent = 'Saved copy is empty';
      overlayText.textContent = 'Open this world once with internet so its parts can be saved.';
      return false;
    }

    solo = true;
    try {
      world = new WorldView(host, { parts: game.parts, spawn: game.spawn });
    } catch (err) {
      overlayTitle.textContent = '3D failed to start';
      overlayText.textContent = err.message;
      return false;
    }
    if (DEBUG()) window.__bfWorld = world;

    myId = 'local';
    const spawn = game.spawn || [0, 6, 0];
    soloSpawn = spawn;
    const progress = readProgress(gameId);
    const resume = progress && progress.version === (game.version || 0) ? progress.pos : null;
    world.setSelf({ id: myId, name: selfName, avatar: selfAvatar, level: 0, pos: resume || spawn });
    world.setFlags({ speed: 16, jump: 48 });
    if (resume) world.teleport(resume);

    players.clear();
    players.set(myId, {
      id: myId, name: selfName, avatar: selfAvatar, level: 0, frozen: false, fly: false,
    });
    renderPlayers();
    qs(root, '[data-ping]').textContent = 'offline';
    qs(root, '[data-playercount]').textContent = 'solo · offline';
    overlay.hidden = true;
    systemMsg(reason || 'Offline solo mode. Progress is saved on this device.');
    systemMsg('Try ;help for the commands that work without a server.');

    lastFrame = performance.now();
    raf = requestAnimationFrame(loop);
    return true;
  }

  function runSoloCommand(text) {
    const parts = text.slice(1).trim().split(/\s+/);
    const cmd = (parts.shift() || '').toLowerCase();
    const arg = Number(parts[0]);
    switch (cmd) {
      case 'help':
        systemMsg('Offline commands: ;fly ;unfly ;speed [1-400] ;jump [1-400] ;heal / ;respawn ;clear');
        return;
      case 'fly':
        world?.setFlags({ fly: true });
        systemMsg('Flight on. Use Shift or the ▲/▼ buttons to change height.');
        return;
      case 'unfly':
        world?.setFlags({ fly: false });
        systemMsg('Flight off.');
        return;
      case 'speed':
        if (Number.isFinite(arg) && arg > 0) {
          world?.setFlags({ speed: Math.min(400, arg) });
          systemMsg(`Walk speed ${Math.round(Math.min(400, arg))}.`);
        } else systemMsg(';speed [1-400]');
        return;
      case 'jump':
        if (Number.isFinite(arg) && arg > 0) {
          world?.setFlags({ jump: Math.min(400, arg) });
          systemMsg(`Jump power ${Math.round(Math.min(400, arg))}.`);
        } else systemMsg(';jump [1-400]');
        return;
      case 'heal':
      case 'respawn':
        world?.teleport(soloSpawn);
        systemMsg('Respawned at the spawn point.');
        return;
      case 'clear':
        logEl.innerHTML = '';
        return;
      default:
        pushLog(`<span class="hint">Offline: ;${esc(cmd)} needs a server. Try ;help</span>`, 'system');
    }
  }

  const handleSoloChat = (text) => {
    if (text.startsWith(';')) runSoloCommand(text);
    else pushLog(`<b>${esc(selfName)}</b> ${esc(text)}`, '');
  };

  // ---- websocket ----------------------------------------------------------
  const connect = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?game=${encodeURIComponent(gameId)}`);

    ws.addEventListener('open', () => {
      systemMsg('Connected to the server.');
      ping();
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      handleMessage(msg);
    });

    ws.addEventListener('close', (event) => {
      if (closed) return;
      // Server unreachable (bus, airplane mode, host asleep) but this world was
      // saved here: drop into solo mode instead of a dead end.
      if (!world && (event.code === 1006 || !navigator.onLine || state.offline)) {
        if (startSolo('Could not reach the server, so this is offline solo mode from your saved copy.')) return;
      }
      closed = true;
      overlay.hidden = false;
      overlayTitle.textContent = 'Disconnected';
      overlayText.textContent = event.reason || 'The connection to the server closed.';
      const back = el(`<button class="btn btn-primary" data-back>Back to world page</button>`);
      overlay.querySelector('.card').appendChild(back);
      back.onclick = () => navigate(`game/${gameId}`);
      if (adminPanel) adminPanel.close();
    });

    ws.addEventListener('error', () => {
      if (!world) {
        overlayTitle.textContent = 'Could not join';
        overlayText.textContent = 'The server rejected the connection. Is this place published?';
      }
    });
  };

  const send = (payload) => {
    if (ws?.readyState === 1) ws.send(JSON.stringify(payload));
  };

  const ping = () => {
    lastPing = performance.now();
    send({ t: 'ping', time: lastPing });
  };

  const sendCommand = (cmd) => {
    send({ t: 'chat', text: cmd });
    pushLog(`<span style="opacity:.6">&gt;</span> ${esc(cmd)}`, 'cmd');
  };

  function handleMessage(msg) {
    switch (msg.t) {
      case 'welcome': {
        myId = msg.you.id;
        myLevel = msg.you.level;
        adminLevel = msg.you.level;
        const place = msg.place;
        if (place?.parts) {
          game.parts = place.parts;
          game.spawn = place.spawn;
          cacheWorld(game);
        }
        try {
          world = new WorldView(host, { parts: place.parts, spawn: place.spawn });
        } catch (err) {
          overlayTitle.textContent = '3D failed to start';
          overlayText.textContent = err.message;
          return;
        }
        if (new URLSearchParams(location.search).has('debug')) window.__bfWorld = world;
        world.setSelf({
          id: msg.you.id,
          name: msg.you.name,
          avatar: msg.you.avatar,
          level: msg.you.level,
          pos: msg.you.pos,
        });
        world.setFlags({ speed: msg.you.speed, jump: msg.you.jump });
        world.syncPlayers(msg.players || []);
        players.clear();
        for (const p of msg.players || []) players.set(p.id, p);
        renderPlayers();
        overlay.hidden = true;
        systemMsg(`Joined ${msg.world.name}. ${msg.world.maxPlayers} player slots.`);

        if (adminLevel >= 1) {
          const fab = el(`<button class="admin-fab">${icon('shield')} Admin panel <kbd>F2</kbd></button>`);
          root.appendChild(fab);
          adminPanel = createAdminPanel({
            level: adminLevel,
            gameId,
            worldName: msg.world.name,
            getPlayers: () => [...players.values()],
            sendCommand,
          });
          root.appendChild(adminPanel.root);
          fab.onclick = () => adminPanel.toggle();
          systemMsg(`Staff commands unlocked at level ${adminLevel} (${['Player', 'Moderator', 'Admin', 'Owner'][adminLevel]}). Try ;help`);
        }

        lastFrame = performance.now();
        raf = requestAnimationFrame(loop);
        break;
      }

      case 'join': {
        players.set(msg.player.id, msg.player);
        world?.addPlayer(msg.player);
        renderPlayers();
        break;
      }

      case 'leave': {
        players.delete(msg.id);
        world?.removePlayer(msg.id);
        renderPlayers();
        break;
      }

      case 'snap': {
        world?.applySnapshot(msg.players);
        for (const entry of msg.players) {
          const p = players.get(entry.id);
          if (p) {
            p.frozen = !!entry.f;
            p.fly = !!entry.fly;
          }
        }
        break;
      }

      case 'plflags': {
        world?.setPlayerFlags(msg.id, msg);
        const p = players.get(msg.id);
        if (p) {
          p.frozen = !!msg.frozen;
          p.fly = !!msg.fly;
          p.invisible = !!msg.inv;
        }
        renderPlayers();
        break;
      }

      case 'chat': {
        if (msg.kind === 'system') systemMsg(msg.text);
        else if (msg.kind === 'announce') pushLog(`📢 ${esc(msg.text)}`, 'announce');
        else pushLog(`<b>${esc(msg.name)}</b>${msg.level ? ` ${roleBadge(msg.level)}` : ''} ${esc(msg.text)}`, '');
        break;
      }

      case 'cmd': {
        const body = String(msg.text ?? '');
        const lead = body.trimStart().startsWith(';') ? '' : '<span style="opacity:.5">;</span>';
        pushLog(`${lead}${esc(body)}`, `cmd ${msg.ok ? '' : 'err'}`);
        adminPanel?.noteCommand(body, msg.ok, '');
        break;
      }

      case 'flags': {
        world?.setFlags(msg);
        if (typeof msg.pos !== 'undefined') world?.teleport(msg.pos);
        systemMsg(`fly ${msg.fly ? 'on' : 'off'} · walk ${Math.round(msg.speed)} · jump ${Math.round(msg.jump)}${msg.frozen ? ' · frozen' : ''}`);
        break;
      }

      case 'tp': {
        world?.teleport(msg.pos);
        break;
      }

      case 'emote': {
        world?.playEmote(msg.id, msg.kind);
        break;
      }

      case 'place': {
        world?.setParts(msg.parts, msg.spawn);
        if (solo) break;
        game.parts = msg.parts;
        game.spawn = msg.spawn;
        game.version = msg.version || game.version;
        cacheWorld(game);
        systemMsg(`Place updated to version ${msg.version}.`);
        break;
      }

      case 'coins': {
        if (state.user) {
          state.user.coins = msg.coins;
          refreshMe().catch(() => {});
        }
        break;
      }

      case 'kick': {
        closed = true;
        overlay.hidden = false;
        overlayTitle.textContent = 'Removed from server';
        overlayText.textContent = `${msg.reason}${msg.by && msg.by !== 'server' ? ` — by ${msg.by}` : ''}`;
        const back = el(`<button class="btn btn-primary">Back to world page</button>`);
        overlay.querySelector('.card').appendChild(back);
        back.onclick = () => navigate(`game/${gameId}`);
        try { ws?.close(); } catch { /* ignore */ }
        break;
      }

      case 'pong': {
        pingMs = Math.round(performance.now() - (msg.time || performance.now()));
        qs(root, '[data-ping]').textContent = `${pingMs} ms`;
        break;
      }

      case 'error': {
        overlay.hidden = false;
        overlayTitle.textContent = 'Server error';
        overlayText.textContent = msg.text || 'Unknown error';
        break;
      }

      default:
        break;
    }
  }

  // ---- input --------------------------------------------------------------
  const isTyping = () => {
    const active = document.activeElement;
    return active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
  };

  const onKeyDown = (e) => {
    if (isTyping()) {
      if (e.key === 'Escape') chatInput.blur();
      return;
    }
    if (e.code === 'Enter') {
      e.preventDefault();
      chatInput.focus();
      return;
    }
    if (e.code === 'KeyE') {
      doEmote();
      return;
    }
    if (e.code === 'F2' && adminPanel) {
      e.preventDefault();
      adminPanel.toggle();
      return;
    }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    world?.keys.add(e.code);
  };

  const onKeyUp = (e) => world?.keys.delete(e.code);
  const onBlur = () => world?.keys.clear();

  const doEmote = () => {
    send({ t: 'emote' });
    if (myId && state.user) {
      const kind = itemFor('emote', state.user.avatar?.emote)?.style?.kind || 'wave';
      world?.playEmote(myId, kind);
    }
  };

  const pads = createGamepadControls({
    onConnect: (id) => toast(`Controller connected: ${id.slice(0, 28)}`, 'good'),
    onDisconnect: () => toast('Controller disconnected.', 'warn'),
    onEmote: () => doEmote(),
  });

  const touch = createTouchControls({ onEmote: () => doEmote() });
  if (touch) {
    qs(root, '.play-root').appendChild(touch.root);
    document.body.classList.add('has-touch-controls');
  }

  qs(root, '[data-fullscreen]')?.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await qs(root, '.play-root').requestFullscreen?.();
    } catch { /* fullscreen can be blocked by the browser */ }
  });

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    dismissHint();
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    if (solo) {
      handleSoloChat(text);
      chatInput.focus();
      return;
    }
    send({ t: 'chat', text });
    chatInput.focus();
  });

  chatInput.addEventListener('focus', dismissHint);

  qs(root, '[data-emote]').addEventListener('click', () => {
    doEmote();
    chatInput.blur();
  });

  qs(root, '[data-leave]').addEventListener('click', () => navigate(`game/${gameId}`));

  // ---- frame loop ---------------------------------------------------------
  function loop(now) {
    if (closed || !world) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000));
    lastFrame = now;

    const pad = pads.read(now);
    if (pad && world) {
      world.pad.mx = pad.mx;
      world.pad.mz = pad.mz;
      world.pad.jump = pad.jump;
      world.pad.up = pad.up;
      if (pad.lookX || pad.lookY) world.rotateCamera(pad.lookX * dt * 2.4, -pad.lookY * dt * 1.6);
    } else if (world) {
      world.pad.mx = 0;
      world.pad.mz = 0;
      world.pad.jump = false;
      world.pad.up = 0;
    }

    touch?.sync(world);

    world.stepLocal(dt);

    if (solo) {
      saveAccum += dt;
      if (saveAccum >= 2) {
        saveAccum = 0;
        writeProgress(gameId, [...world.self.state.pos], game.version || 0);
      }
    }

    sendAccumulator += dt;
    if (sendAccumulator >= 0.05) {
      sendAccumulator = 0;
      const intent = world.lastIntent;
      send({ t: 'input', mx: intent.mx, mz: intent.mz, jump: intent.jump, up: intent.up, yaw: intent.yaw });
    }

    if (now - lastPing > 4000) ping();
    world.frame(dt);
    raf = requestAnimationFrame(loop);
  }

  if (soloMode) startSolo();
  else connect();

  return {
    title: game.name,
    destroy() {
      closed = true;
      if (solo && world?.self) writeProgress(gameId, [...world.self.state.pos], game.version || 0);
      clearTimeout(hintTimer);
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      try { ws?.close(1000, 'left'); } catch { /* ignore */ }
      adminPanel?.destroy();
      touch?.destroy();
      document.body.classList.remove('has-touch-controls');
      world?.dispose();
      world = null;
    },
  };
}
