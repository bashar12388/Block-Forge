// Authoritative world simulation.
//
// The server owns every character's position. Clients send movement *intent*
// (direction + jump), and the server integrates it with the same shared physics
// module the browser uses for prediction. A client that lies about position has
// nothing to lie with.

import { buildCollision, stepPlayer, makePlayerState, clampPosition, animFor, MAX_DT } from '../shared/physics.js';
import { executeCommand } from './commands.js';
import { recordVisit } from './db.js';
import { itemFor } from '../shared/catalog.js';

const TICK_HZ = 30;
const SNAPSHOT_EVERY = 3; // 10 Hz snapshots
const IDLE_AFTER = 30_000;

export function ensureBaseplate(parts) {
  const list = Array.isArray(parts) ? parts.filter((p) => p && p.pos && p.size) : [];
  const hasFloor = list.some((p) => p.anchored !== false && p.size[1] >= 1 && p.pos[1] < 2 && p.size[0] >= 40 && p.size[2] >= 40);
  if (hasFloor) return list;
  return [
    {
      id: 'baseplate', name: 'Baseplate', kind: 'box', pos: [0, -2, 0], size: [320, 4, 320],
      rot: [0, 0, 0], color: '#3f4a5a', material: 'plastic', anchored: true,
    },
    ...list,
  ];
}

export class World {
  constructor({ game, parts, spawn }) {
    this.gameId = game.id;
    this.name = game.name;
    this.ownerId = game.owner_id;
    this.maxPlayers = Math.max(1, Math.min(50, game.max_players || 12));
    this.version = game.place_version || 1;
    this.parts = ensureBaseplate(parts);
    this.spawn = Array.isArray(spawn) && spawn.length === 3 ? spawn.map(Number) : [0, spawnHeight(this.parts), 0];
    this.collision = buildCollision(this.parts);
    this.players = new Map();
    this.tick = 0;
    this.shuttingDown = false;
    this.createdAt = Date.now();
    this.lastEmptyAt = Date.now();
    this.interval = null;
    this.snapshotJson = null;
    this.start();
  }

  get playerCount() {
    return this.players.size;
  }

  start() {
    if (this.interval) return;
    const dt = 1 / TICK_HZ;
    this.interval = setInterval(() => this.step(dt), 1000 / TICK_HZ);
    this.interval.unref?.();
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  sendTo(player, message) {
    if (!player?.socket || player.socket.readyState !== 1) return;
    try {
      player.socket.send(JSON.stringify(message));
    } catch {
      /* socket is going away */
    }
  }

  broadcast(message, exceptId = null) {
    const payload = JSON.stringify(message);
    for (const player of this.players.values()) {
      if (player.id === exceptId) continue;
      if (!player.socket || player.socket.readyState !== 1) continue;
      try { player.socket.send(payload); } catch { /* ignore */ }
    }
  }

  effectiveLevel(player) {
    const platform = Number(player.role) || 0;
    const owner = player.id === this.ownerId ? 3 : 0;
    return Math.max(platform, owner);
  }

  // ---- membership ---------------------------------------------------------

  join(socket, user) {
    if (this.players.size >= this.maxPlayers) {
      socket.send(JSON.stringify({ t: 'error', text: 'This server is full.' }));
      socket.close(4004, 'Server full');
      return null;
    }
    const existing = this.players.get(user.id);
    if (existing) {
      try { existing.socket?.close(4001, 'Signed in from another tab'); } catch { /* ignore */ }
      this.leave(existing, 'Reconnected');
    }

    const player = {
      id: user.id,
      username: user.username,
      role: Number(user.role) || 0,
      avatar: user.avatar,
      socket,
      state: makePlayerState(this.spawn.map((v, i) => (i === 1 ? v + 2 : v))),
      yaw: 0,
      anim: 'idle',
      invisible: false,
      emoteUntil: 0,
      emoteKind: '',
      intent: { mx: 0, mz: 0, jump: false, up: 0, yaw: 0 },
      lastInputAt: Date.now(),
      joinedAt: Date.now(),
      inputCount: 0,
      inputWindow: Date.now(),
      commandWindow: Date.now(),
      commandCount: 0,
      chatAt: 0,
    };
    player.effectiveLevel = this.effectiveLevel(player);
    this.players.set(player.id, player);
    this.lastEmptyAt = 0;
    // A world can be idle-stopped before the sweeper disposes it. Revive the tick
    // loop when somebody joins it again.
    this.start();

    recordVisit(this.gameId, user.id);

    this.sendTo(player, {
      t: 'welcome',
      world: { id: this.gameId, name: this.name, maxPlayers: this.maxPlayers, ownerId: this.ownerId },
      you: {
        id: player.id,
        name: player.username,
        role: player.role,
        level: player.effectiveLevel,
        avatar: player.avatar,
        pos: player.state.pos,
        speed: player.state.speed,
        jump: player.state.jumpPower,
      },
      place: { parts: this.parts, spawn: this.spawn, version: this.version },
      players: [...this.players.values()].map((p) => this.playerSummary(p)),
      history: [],
    });

    this.broadcast({
      t: 'join',
      player: this.playerSummary(player),
    }, player.id);

    this.announcePlayer(player);
    return player;
  }

  announcePlayer(player) {
    const rank = player.effectiveLevel > 0 ? ` [${['Player', 'Moderator', 'Admin', 'Owner'][player.effectiveLevel]}]` : '';
    this.broadcast({
      t: 'chat', kind: 'system',
      text: `${player.username}${rank} joined the server.`,
    });
  }

  leave(player, reason = 'Left') {
    const current = this.players.get(player.id);
    if (!current) return;
    // A reconnect may already have replaced this entry with a fresh socket. The old
    // socket's close event must not evict the player who just rejoined.
    if (current !== player) return;
    this.players.delete(player.id);
    this.broadcast({ t: 'leave', id: player.id, name: player.username });
    if (!this.players.size) this.lastEmptyAt = Date.now();
    if (reason === 'Left') {
      this.broadcast({ t: 'chat', kind: 'system', text: `${player.username} left the server.` });
    }
  }

  playerSummary(player) {
    return {
      id: player.id,
      name: player.username,
      role: player.role,
      level: player.effectiveLevel,
      avatar: player.avatar,
      pos: player.state.pos,
      yaw: player.yaw,
      fly: player.state.fly,
      inv: player.invisible,
      frozen: player.state.frozen,
      speed: player.state.speed,
      jump: player.state.jumpPower,
      joinedAt: player.joinedAt,
    };
  }

  // ---- simulation ---------------------------------------------------------

  step(dt) {
    this.tick += 1;
    const nowMs = Date.now();

    for (const player of this.players.values()) {
      if (player.state.frozen) {
        player.state.vel = [0, 0, 0];
      }
      // A disconnected or backgrounded client must not keep sliding forever.
      if (nowMs - player.lastInputAt > 1200) {
        player.intent.mx = 0;
        player.intent.mz = 0;
        player.intent.jump = false;
        player.intent.up = 0;
      }

      const info = stepPlayer(player.state, player.intent, this.collision, dt);
      clampPosition(player.state.pos);

      if (player.state.pos[1] < -80) {
        this.teleport(player, this.spawn.map((v, i) => (i === 1 ? v + 2 : v)));
      }

      let anim = animFor(player.state, info);
      if (nowMs < player.emoteUntil) anim = `emote:${player.emoteKind}`;
      player.anim = anim;
    }

    if (this.tick % SNAPSHOT_EVERY === 0) this.pushSnapshot();
    if (!this.players.size && this.lastEmptyAt && nowMs - this.lastEmptyAt > IDLE_AFTER) {
      this.stop();
    }
  }

  pushSnapshot() {
    const players = [];
    for (const p of this.players.values()) {
      players.push({
        id: p.id,
        p: [round2(p.state.pos[0]), round2(p.state.pos[1]), round2(p.state.pos[2])],
        yaw: round2(p.yaw),
        a: p.anim,
        i: p.invisible ? 1 : 0,
        f: p.state.frozen ? 1 : 0,
        fly: p.state.fly ? 1 : 0,
      });
    }
    const msg = { t: 'snap', s: this.tick, players };
    this.snapshotJson = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (!p.socket || p.socket.readyState !== 1) continue;
      try { p.socket.send(this.snapshotJson); } catch { /* ignore */ }
    }
  }

  // ---- interactions -------------------------------------------------------

  /** Anti-flood: returns false when the client is sending faster than allowed. */
  allowInput(player) {
    const t = Date.now();
    if (t - player.inputWindow > 1000) {
      player.inputWindow = t;
      player.inputCount = 0;
    }
    player.inputCount += 1;
    return player.inputCount <= 90; // 90 intent packets per second is generous
  }

  handleInput(player, msg) {
    if (!this.allowInput(player)) return;
    const mx = clampNum(msg.mx, -1, 1);
    const mz = clampNum(msg.mz, -1, 1);
    const yaw = clampNum(msg.yaw, -Math.PI * 4, Math.PI * 4);
    player.intent.mx = mx;
    player.intent.mz = mz;
    player.intent.jump = !!msg.jump;
    player.intent.up = clampNum(msg.up, -1, 1);
    player.yaw = yaw;
    player.lastInputAt = Date.now();
  }

  handleChat(player, text) {
    const t = Date.now();
    if (t - player.chatAt < 350) return;
    player.chatAt = t;

    const clean = String(text || '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240);
    if (!clean) return;

    if (clean.startsWith(';')) {
      return this.runCommand(player, clean);
    }

    const level = player.effectiveLevel;
    this.broadcast({
      t: 'chat',
      kind: 'chat',
      from: player.id,
      name: player.username,
      text: clean,
      level,
    });
  }

  runCommand(player, raw) {
    const t = Date.now();
    if (t - player.commandWindow > 3000) {
      player.commandWindow = t;
      player.commandCount = 0;
    }
    player.commandCount += 1;
    if (player.commandCount > 12) {
      this.sendTo(player, { t: 'cmd', ok: false, text: 'Slow down — too many commands.', kind: 'err' });
      return;
    }

    const level = this.effectiveLevel(player);
    player.effectiveLevel = level;

    const ctx = {
      world: this,
      player,
      level,
      reply: (text, kind = 'info') => this.sendTo(player, { t: 'cmd', ok: kind !== 'err', text, kind }),
      syncSelf: () => this.sendTo(player, {
        t: 'flags',
        fly: player.state.fly,
        speed: player.state.speed,
        jump: player.state.jumpPower,
        frozen: player.state.frozen,
        inv: player.invisible,
        pos: player.state.pos,
      }),
    };
    executeCommand(raw, ctx);
  }

  handleEmote(player) {
    const kind = itemFor('emote', player.avatar?.emote)?.style?.kind || 'wave';
    player.emoteKind = kind;
    player.emoteUntil = Date.now() + 2600;
    this.broadcast({ t: 'emote', id: player.id, kind }, null);
  }

  teleport(player, pos) {
    player.state.pos = [Number(pos[0]) || 0, Number(pos[1]) || 0, Number(pos[2]) || 0];
    player.state.vel = [0, 0, 0];
    this.sendTo(player, { t: 'tp', pos: player.state.pos });
    clampPosition(player.state.pos);
  }

  kick(player, reason, by = 'server') {
    this.sendTo(player, { t: 'kick', reason, by });
    try { player.socket?.close(4003, String(reason).slice(0, 100)); } catch { /* ignore */ }
    this.leave(player, 'Kicked');
    this.announce(`${player.username} was removed by ${by}: ${reason}`);
  }

  announce(text) {
    this.broadcast({ t: 'chat', kind: 'announce', text });
  }

  broadcastFlags(player) {
    this.broadcast({
      t: 'plflags',
      id: player.id,
      inv: player.invisible,
      frozen: player.state.frozen,
      fly: player.state.fly,
    });
  }

  /** Live place update (Studio save while people are playing). */
  reload(parts, spawn, version) {
    this.parts = ensureBaseplate(parts);
    this.collision = buildCollision(this.parts);
    this.version = version || this.version + 1;
    if (Array.isArray(spawn) && spawn.length === 3) this.spawn = spawn.map(Number);
    this.broadcast({ t: 'place', parts: this.parts, spawn: this.spawn, version: this.version });
    this.announce(`The place was updated to version ${this.version}.`);
  }

  shutdown(reason = 'Server closed') {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    for (const p of [...this.players.values()]) {
      this.sendTo(p, { t: 'kick', reason, by: 'server' });
      try { p.socket?.close(1001, 'Server shutting down'); } catch { /* ignore */ }
      this.players.delete(p.id);
    }
    this.stop();
  }
}

function clampNum(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(min, Math.min(max, n));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function spawnHeight(parts) {
  let top = 0;
  for (const p of parts) {
    if (p.anchored === false) continue;
    if (p.pos[1] < 4 && p.size[0] > 20 && p.size[2] > 20) {
      top = Math.max(top, p.pos[1] + p.size[1] / 2);
    }
  }
  return top + 3;
}

// ---- manager ---------------------------------------------------------------

export class WorldManager {
  constructor() {
    this.worlds = new Map();
  }

  get(game) {
    const existing = this.worlds.get(game.id);
    if (existing) return existing;
    const parts = typeof game.parts === 'string' ? safeParse(game.parts, []) : game.parts || [];
    const spawn = typeof game.spawn === 'string' ? safeParse(game.spawn, [0, 6, 0]) : game.spawn || [0, 6, 0];
    const world = new World({ game, parts, spawn });
    this.worlds.set(game.id, world);
    console.log(`[world] created ${game.name} (${game.id}) v${world.version}`);
    return world;
  }

  reload(game) {
    const world = this.worlds.get(game.id);
    if (!world) return;
    const parts = typeof game.parts === 'string' ? safeParse(game.parts, []) : game.parts;
    const spawn = typeof game.spawn === 'string' ? safeParse(game.spawn, [0, 6, 0]) : game.spawn;
    world.reload(parts, spawn, game.place_version);
  }

  close(gameId, reason) {
    const world = this.worlds.get(gameId);
    if (!world) return;
    world.shutdown(reason);
    this.worlds.delete(gameId);
  }

  playing(gameId) {
    return this.worlds.get(gameId)?.playerCount || 0;
  }

  totalPlayers() {
    let n = 0;
    for (const world of this.worlds.values()) n += world.playerCount;
    return n;
  }

  sweep() {
    for (const [id, world] of this.worlds) {
      if (!world.playerCount && world.lastEmptyAt && Date.now() - world.lastEmptyAt > IDLE_AFTER * 2) {
        world.stop();
        this.worlds.delete(id);
      }
    }
  }
}

function safeParse(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

export const worlds = new WorldManager();
setInterval(() => worlds.sweep(), 30_000).unref?.();
