import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  addReport, banUser, commandHistory, createGame, createUser, db, gameById,
  gamesByOwner, grantItem, inventory, likeGame, listGames, now, ownsItem, publishGame,
  reports, savePlace, searchUsers, setAvatar, setRole, spendCoins, stats,
  userById, userByUsername,
} from './db.js';
import {
  clearSessionCookie, createLimiter, hashPassword, issueSessionCookie, publicUser,
  safeJson, userFromRequest, verifyPassword,
} from './auth.js';
import { HttpError, Router, readJson, sendJson, clientIp } from './http.js';
import { ITEMS, ITEM_MAP, DEFAULT_AVATAR, sanitizeAvatar } from '../shared/catalog.js';
import { sanitizePlace, templateParts, TEMPLATE_LIST, TEMPLATES } from './templates.js';
import { networkInfo, allowedUrls } from './network.js';
import { BACKUP_DIR, backupStatus, listBackups, runBackup } from './backup.js';
import QRCode from 'qrcode';

const loginLimiter = createLimiter({ windowMs: 10 * 60_000, max: 12 });
const registerLimiter = createLimiter({ windowMs: 60 * 60_000, max: 8 });
const writeLimiter = createLimiter({ windowMs: 60_000, max: 120 });
const reportLimiter = createLimiter({ windowMs: 30 * 60_000, max: 5 });

const RESERVED = new Set(['admin', 'owner', 'blockforge', 'studio', 'moderator', 'system', 'support', 'staff', 'mod']);

export function buildApi({ worlds, port }) {
  const r = new Router();

  // ---- local / offline play ----------------------------------------------
  r.get('/api/network', ({ res }) => {
    sendJson(res, 200, networkInfo(port));
  });

  r.get('/api/network/qr', async ({ res, url }) => {
    const target = String(url.searchParams.get('u') || '');
    if (!allowedUrls(port).has(target)) throw new HttpError(400, 'Unknown address.');
    const svg = await QRCode.toString(target, {
      type: 'svg',
      margin: 1,
      width: 240,
      errorCorrectionLevel: 'M',
      color: { dark: '#0b1020ff', light: '#ffffffff' },
    });
    res.writeHead(200, {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    });
    res.end(svg);
  });

  // ---- local backups ------------------------------------------------------
  // Snapshots contain password hashes, so only signed-in staff can look at
  // them, and only the owner can download the file.
  r.get('/api/backups', (ctx) => {
    const user = requireUser(ctx);
    if (user.role < 2) throw new HttpError(403, 'Admins only.');
    sendJson(ctx.res, 200, { ...backupStatus(), backups: listBackups() });
  });

  r.post('/api/backups', (ctx) => {
    const user = requireUser(ctx);
    if (user.role < 2) throw new HttpError(403, 'Admins only.');
    const result = runBackup(`manual:${user.username}`);
    if (!result.ok) throw new HttpError(500, `Backup failed: ${result.error}`);
    sendJson(ctx.res, 200, { ...backupStatus(), backups: listBackups(), made: result.file });
  });

  r.get('/api/backups/:file', (ctx) => {
    const user = requireUser(ctx);
    if (user.role < 3) throw new HttpError(403, 'Owner only.');
    const file = String(ctx.params.file || '');
    if (!/^blockforge-\d{8}-\d{6}(-\d+)?\.db$/.test(file)) throw new HttpError(400, 'Unknown backup.');
    if (!listBackups().some((b) => b.file === file)) throw new HttpError(404, 'Backup not found.');
    const full = path.join(BACKUP_DIR, file);
    const stat = fs.statSync(full);
    ctx.res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': stat.size,
      'content-disposition': `attachment; filename="${file}"`,
      'cache-control': 'no-store',
    });
    fs.createReadStream(full).pipe(ctx.res);
  });

  // ---- session ------------------------------------------------------------
  r.get('/api/health', ({ res }) => {
    sendJson(res, 200, { ok: true, uptime: process.uptime(), players: worlds.totalPlayers() });
  });

  r.get('/api/me', (ctx) => {
    const user = userFromRequest(ctx.req);
    if (!user) return sendJson(ctx.res, 200, { user: null, inventory: [], items: ITEMS });
    sendJson(ctx.res, 200, {
      user: publicUser(user),
      inventory: inventory(user.id),
      items: ITEMS,
      games: gamesByOwner(user.id).map(summary),
    });
  });

  r.post('/api/auth/register', async (ctx) => {
    if (!registerLimiter(clientIp(ctx.req))) throw new HttpError(429, 'Too many accounts created from this address.');
    const body = await readJson(ctx.req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      throw new HttpError(400, 'Username must be 3-20 characters, letters/numbers/underscore only.');
    }
    if (RESERVED.has(username.toLowerCase())) throw new HttpError(400, 'That username is reserved.');
    if (password.length < 8 || password.length > 200) throw new HttpError(400, 'Password must be at least 8 characters.');
    if (userByUsername(username)) throw new HttpError(409, 'That username is already taken.');

    const { salt, hash } = hashPassword(password);
    const user = createUser({
      username,
      passHash: hash,
      passSalt: salt,
      avatar: sanitizeAvatar({ ...DEFAULT_AVATAR, skin: pick(['#f4c69a', '#d99a63', '#b06b3c', '#f7d7bd']) }),
    });
    for (const starter of ['hat.none', 'face.smile', 'emote.wave', 'effect.none']) grantItem(user.id, starter);

    sendJson(ctx.res, 201, {
      user: publicUser(user),
      inventory: inventory(user.id),
      items: ITEMS,
    }, { 'set-cookie': issueSessionCookie(user.id, secureRequest(ctx.req)) });
  });

  r.post('/api/auth/login', async (ctx) => {
    const ip = clientIp(ctx.req);
    if (!loginLimiter(ip)) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
    const body = await readJson(ctx.req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const user = userByUsername(username);

    // Constant-ish work whether or not the account exists.
    const ok = user
      ? verifyPassword(password, user.pass_salt, user.pass_hash)
      : (crypto.scryptSync(password, 'blockforge-dummy-salt', 64, { N: 16384, r: 8, p: 1 }), false);

    if (!user || !ok) throw new HttpError(401, 'Wrong username or password.');
    if (user.banned_until && user.banned_until > now()) {
      throw new HttpError(403, `This account is banned: ${user.ban_reason || 'no reason given'}`);
    }

    sendJson(ctx.res, 200, {
      user: publicUser(user),
      inventory: inventory(user.id),
      items: ITEMS,
      games: gamesByOwner(user.id).map(summary),
    }, { 'set-cookie': issueSessionCookie(user.id, secureRequest(ctx.req)) });
  });

  r.post('/api/auth/logout', ({ res, req }) => {
    sendJson(res, 200, { ok: true }, { 'set-cookie': clearSessionCookie(secureRequest(req)) });
  });

  // ---- profile & avatar ---------------------------------------------------
  r.patch('/api/me/avatar', async (ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(ctx.req);
    const avatar = sanitizeAvatar(body.avatar);

    // You can only equip what you own. Free items are always allowed.
    const owned = new Set(inventory(user.id));
    for (const slot of ['hat', 'face', 'emote', 'effect']) {
      const id = avatar[slot];
      const item = ITEM_MAP.get(id);
      if (!item) { avatar[slot] = DEFAULT_AVATAR[slot]; continue; }
      if (item.price > 0 && !owned.has(id)) {
        throw new HttpError(403, `You do not own ${item.name}.`);
      }
    }

    setAvatar(user.id, avatar);
    const fresh = userById(user.id);
    sendJson(ctx.res, 200, { user: publicUser(fresh), inventory: [...owned] });
  });

  // ---- discovery ----------------------------------------------------------
  r.get('/api/games', (ctx) => {
    const url = ctx.url;
    const sort = url.searchParams.get('sort') || 'popular';
    const q = (url.searchParams.get('q') || '').slice(0, 60);
    const items = listGames({ sort, q, limit: 30 }).map((g) => ({
      ...summary(g),
      playing: worlds.playing(g.id),
    }));
    sendJson(ctx.res, 200, { games: items, templates: TEMPLATE_LIST, stats: stats() });
  });

  r.get('/api/games/:id', (ctx) => {
    const game = gameById(ctx.params.id);
    if (!game) throw new HttpError(404, 'Game not found');
    const viewer = userFromRequest(ctx.req);
    const isOwner = viewer && viewer.id === game.owner_id;
    if (!game.published && !isOwner) throw new HttpError(404, 'Game not found');

    sendJson(ctx.res, 200, {
      game: {
        ...summary(game),
        description: game.description,
        playing: worlds.playing(game.id),
        canEdit: !!isOwner,
        parts: isOwner || game.published ? safeJson(game.parts, []) : undefined,
        spawn: safeJson(game.spawn, [0, 6, 0]),
      },
    });
  });

  r.post('/api/games', async (ctx) => {
    const user = requireUser(ctx);
    if (!writeLimiter(`game:${user.id}`)) throw new HttpError(429, 'Slow down.');
    const body = await readJson(ctx.req);
    const name = String(body.name || '').trim().slice(0, 48);
    if (name.length < 3) throw new HttpError(400, 'Give your game a name (3+ characters).');

    const template = TEMPLATES[String(body.template || 'baseplate')] || TEMPLATES.baseplate;
    const built = template.build();
    const game = createGame({
      ownerID: user.id,
      name,
      description: String(body.description || template.blurb).slice(0, 400),
      thumb: template.thumb,
      parts: built.parts,
      spawn: built.spawn,
    });
    sendJson(ctx.res, 201, { game: { ...summary(game), canEdit: true } });
  });

  r.patch('/api/games/:id', async (ctx) => {
    const user = requireUser(ctx);
    const game = ownedGame(ctx, user);
    const body = await readJson(ctx.req);
    const name = body.name !== undefined ? String(body.name).trim().slice(0, 48) : undefined;
    if (name !== undefined && name.length < 3) throw new HttpError(400, 'Name is too short.');
    db.prepare(`UPDATE games SET name = COALESCE(?, name), description = COALESCE(?, description),
                updated_at = ? WHERE id = ?`)
      .run(name ?? null, body.description !== undefined ? String(body.description).slice(0, 400) : null, now(), game.id);
    sendJson(ctx.res, 200, { game: { ...summary(gameById(game.id)), canEdit: true } });
  });

  r.post('/api/games/:id/place', async (ctx) => {
    const user = requireUser(ctx);
    const game = ownedGame(ctx, user);
    const body = await readJson(ctx.req, 4 * 1024 * 1024);
    const result = sanitizePlace(body.parts, body.spawn);
    if (result.error) throw new HttpError(400, result.error);

    const saved = savePlace(game.id, {
      parts: result.parts,
      spawn: result.spawn,
      name: body.name ? String(body.name).trim().slice(0, 48) : undefined,
      description: body.description !== undefined ? String(body.description).slice(0, 400) : undefined,
    });
    worlds.reload(saved);
    sendJson(ctx.res, 200, {
      game: { ...summary(saved), canEdit: true, parts: result.parts, spawn: result.spawn, version: saved.place_version },
      parts: result.parts.length,
    });
  });

  r.post('/api/games/:id/publish', async (ctx) => {
    const user = requireUser(ctx);
    const game = ownedGame(ctx, user);
    const body = await readJson(ctx.req);
    const published = body.published !== false;
    const saved = publishGame(game.id, published);
    sendJson(ctx.res, 200, { game: { ...summary(saved), canEdit: true } });
  });

  r.post('/api/games/:id/like', (ctx) => {
    const user = requireUser(ctx);
    const game = gameById(ctx.params.id);
    if (!game) throw new HttpError(404, 'Game not found');
    sendJson(ctx.res, 200, { likes: likeGame(game.id) });
  });

  r.post('/api/reports', async (ctx) => {
    const user = requireUser(ctx);
    if (!reportLimiter(user.id)) throw new HttpError(429, 'Too many reports. Take a breath.');
    const body = await readJson(ctx.req);
    const target = userById(String(body.targetId || ''));
    if (!target) throw new HttpError(400, 'Unknown player.');
    if (target.id === user.id) throw new HttpError(400, 'You cannot report yourself.');
    addReport({
      reporterID: user.id,
      targetID: target.id,
      gameID: String(body.gameId || '').slice(0, 40),
      reason: String(body.reason || 'No details').slice(0, 400),
    });
    sendJson(ctx.res, 201, { ok: true });
  });

  // ---- shop ---------------------------------------------------------------
  r.get('/api/shop', (ctx) => {
    const user = userFromRequest(ctx.req);
    sendJson(ctx.res, 200, {
      items: ITEMS,
      owned: user ? inventory(user.id) : [],
      coins: user?.coins ?? null,
    });
  });

  r.post('/api/shop/buy', async (ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(ctx.req);
    const item = ITEM_MAP.get(String(body.itemId || ''));
    if (!item) throw new HttpError(404, 'Unknown item.');
    if (item.price <= 0) throw new HttpError(400, 'That item is free.');
    if (ownsItem(user.id, item.id)) throw new HttpError(409, 'You already own that.');

    db.exec('BEGIN IMMEDIATE');
    let ok = false;
    try {
      ok = spendCoins(user.id, item.price);
      if (ok) grantItem(user.id, item.id);
      db.exec(ok ? 'COMMIT' : 'ROLLBACK');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    if (!ok) throw new HttpError(402, 'Not enough Sparks.');

    const fresh = userById(user.id);
    sendJson(ctx.res, 200, { user: publicUser(fresh), owned: inventory(user.id), item });
  });

  // ---- admin / moderation -------------------------------------------------
  r.get('/api/admin/overview', (ctx) => {
    const user = requireUser(ctx);
    const level = user.role || 0;
    if (level < 1) throw new HttpError(403, 'Not staff.');
    const online = [];
    for (const world of worlds.worlds.values()) {
      for (const p of world.players.values()) {
        online.push({
          id: p.id, name: p.username, role: p.role, level: p.effectiveLevel,
          gameId: world.gameId, gameName: world.name,
        });
      }
    }
    sendJson(ctx.res, 200, {
      level,
      users: searchUsers(ctx.url.searchParams.get('q') || '', 60),
      logs: commandHistory({ limit: 40 }),
      reports: level >= 2 ? reports(30) : [],
      online,
      stats: stats(),
      games: listGames({ sort: 'new', limit: 30 }).map(summary),
    });
  });

  r.post('/api/admin/role', async (ctx) => {
    const user = requireUser(ctx);
    if (user.role < 3) throw new HttpError(403, 'Only owners can change permissions.');
    const body = await readJson(ctx.req);
    const target = userById(String(body.userId || ''));
    const role = Number(body.role);
    if (!target) throw new HttpError(404, 'Unknown user.');
    if (!Number.isInteger(role) || role < 0 || role > 3) throw new HttpError(400, 'Invalid role.');
    if (target.id === user.id) throw new HttpError(400, 'You cannot change your own role.');
    setRole(target.id, role);
    sendJson(ctx.res, 200, { ok: true, user: publicUser(userById(target.id)) });
  });

  r.post('/api/admin/ban', async (ctx) => {
    const user = requireUser(ctx);
    if (user.role < 2) throw new HttpError(403, 'Admins only.');
    const body = await readJson(ctx.req);
    const target = userById(String(body.userId || ''));
    if (!target) throw new HttpError(404, 'Unknown user.');
    if (target.id === user.id) throw new HttpError(400, 'You cannot ban yourself.');
    if (target.role >= user.role) throw new HttpError(403, 'That account has equal or higher rank.');
    const hours = Math.min(24 * 365, Math.max(0, Number(body.hours) || 0));
    const until = hours ? now() + hours * 3_600_000 : now() + 100 * 365 * 24 * 3_600_000;
    banUser(target.id, until, String(body.reason || 'Banned by staff').slice(0, 200));
    for (const world of worlds.worlds.values()) {
      const p = world.players.get(target.id);
      if (p) world.kick(p, `Banned: ${body.reason || 'Banned by staff'}`, user.username);
    }
    sendJson(ctx.res, 200, { ok: true });
  });

  r.post('/api/admin/unban', async (ctx) => {
    const user = requireUser(ctx);
    if (user.role < 2) throw new HttpError(403, 'Admins only.');
    const body = await readJson(ctx.req);
    const target = userById(String(body.userId || ''));
    if (!target) throw new HttpError(404, 'Unknown user.');
    banUser(target.id, 0, '');
    sendJson(ctx.res, 200, { ok: true });
  });

  r.post('/api/admin/grant', async (ctx) => {
    const user = requireUser(ctx);
    if (user.role < 2) throw new HttpError(403, 'Admins only.');
    const body = await readJson(ctx.req);
    const target = userById(String(body.userId || ''));
    const item = ITEM_MAP.get(String(body.itemId || ''));
    if (!target) throw new HttpError(404, 'Unknown user.');
    if (!item) throw new HttpError(404, 'Unknown item.');
    grantItem(target.id, item.id);
    sendJson(ctx.res, 200, { ok: true });
  });

  return r;
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function requireUser(ctx) {
  const user = userFromRequest(ctx.req);
  if (!user) throw new HttpError(401, 'Sign in first.');
  return user;
}

/** Hosting behind a proxy (Render, Fly, nginx) terminates TLS for us. */
function secureRequest(req) {
  if (req.socket?.encrypted) return true;
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function ownedGame(ctx, user) {
  const game = gameById(ctx.params.id);
  if (!game) throw new HttpError(404, 'Game not found');
  if (game.owner_id !== user.id && user.role < 3) throw new HttpError(403, 'That is not your game.');
  return game;
}

export function summary(game) {
  if (!game) return null;
  return {
    id: game.id,
    name: game.name,
    description: game.description,
    thumb: game.thumb,
    ownerId: game.owner_id,
    ownerName: game.owner_name,
    visits: game.visits,
    likes: game.likes,
    parts: game.parts_count ?? 0,
    published: !!game.published,
    maxPlayers: game.max_players,
    version: game.place_version,
    updatedAt: game.updated_at,
    createdAt: game.created_at,
  };
}
