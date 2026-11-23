import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = path.resolve(process.env.BLOCKFORGE_DATA || './data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const DB_PATH = path.join(DATA_DIR, 'blockforge.db');
export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    username_lc TEXT NOT NULL UNIQUE,
    pass_hash TEXT NOT NULL,
    pass_salt TEXT NOT NULL,
    role INTEGER NOT NULL DEFAULT 0,
    coins INTEGER NOT NULL DEFAULT 750,
    avatar TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '',
    banned_until INTEGER NOT NULL DEFAULT 0,
    ban_reason TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    thumb TEXT NOT NULL DEFAULT 'aurora',
    parts TEXT NOT NULL DEFAULT '[]',
    spawn TEXT NOT NULL DEFAULT '[0,6,0]',
    published INTEGER NOT NULL DEFAULT 0,
    visits INTEGER NOT NULL DEFAULT 0,
    likes INTEGER NOT NULL DEFAULT 0,
    max_players INTEGER NOT NULL DEFAULT 12,
    place_version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS purchases (
    user_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, item_id)
  );

  CREATE TABLE IF NOT EXISTS command_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    target TEXT NOT NULL DEFAULT '',
    command TEXT NOT NULL,
    raw TEXT NOT NULL,
    ok INTEGER NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    game_id TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_games_published ON games(published, updated_at);
  CREATE INDEX IF NOT EXISTS idx_log_game ON command_log(game_id, id);
  CREATE INDEX IF NOT EXISTS idx_visits_game ON visits(game_id);
`);

export const now = () => Date.now();

export function metaGet(key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function metaSet(key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

export function sessionSecret() {
  let secret = metaGet('session_secret');
  if (!secret) {
    secret = crypto.randomBytes(48).toString('base64url');
    metaSet('session_secret', secret);
  }
  return secret;
}

export function id(prefix) {
  return `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;
}

// ---- users ------------------------------------------------------------------

export function userByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username_lc = ?').get(String(username || '').toLowerCase()) || null;
}

export function userById(userID) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(String(userID || '')) || null;
}

export function createUser({ username, passHash, passSalt, avatar }) {
  const userID = id('usr');
  const ts = now();
  db.prepare(`INSERT INTO users (id, username, username_lc, pass_hash, pass_salt, avatar, created_at, last_seen)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(userID, username, username.toLowerCase(), passHash, passSalt, JSON.stringify(avatar), ts, ts);
  db.prepare('INSERT OR IGNORE INTO purchases (user_id, item_id, created_at) VALUES (?, ?, ?)')
    .run(userID, 'hat.none', ts);
  return userById(userID);
}

export function touchUser(userID) {
  db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now(), userID);
}

export function setCoins(userID, coins) {
  db.prepare('UPDATE users SET coins = ? WHERE id = ?').run(Math.max(0, Math.round(coins)), userID);
}

export function adjustCoins(userID, delta) {
  db.prepare('UPDATE users SET coins = MAX(0, coins + ?) WHERE id = ?').run(Math.round(delta), userID);
  return userById(userID)?.coins ?? 0;
}

export function setRole(userID, role) {
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(Math.max(0, Math.min(3, role | 0)), userID);
}

export function setAvatar(userID, avatar) {
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(JSON.stringify(avatar), userID);
}

export function banUser(userID, until, reason) {
  db.prepare('UPDATE users SET banned_until = ?, ban_reason = ? WHERE id = ?')
    .run(until, String(reason || '').slice(0, 200), userID);
}

// ---- games ------------------------------------------------------------------

const GAME_FIELDS = `g.id, g.owner_id, g.name, g.description, g.thumb, g.published, g.visits,
  g.likes, g.max_players, g.place_version, g.created_at, g.updated_at,
  json_array_length(g.parts) AS parts_count,
  u.username AS owner_name`;

export function listGames({ sort = 'popular', q = '', limit = 24, ownerId = null } = {}) {
  const order = {
    popular: 'g.visits DESC, g.likes DESC',
    trending: '(g.likes * 3 + g.visits) DESC, g.updated_at DESC',
    new: 'g.created_at DESC',
    updated: 'g.updated_at DESC',
  }[sort] || 'g.visits DESC';

  const clauses = ['g.published = 1'];
  const params = [];
  if (q) {
    clauses.push('(g.name LIKE ? OR g.description LIKE ? OR u.username LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (ownerId) {
    clauses.push('g.owner_id = ?');
    params.push(ownerId);
  }
  const sql = `SELECT ${GAME_FIELDS} FROM games g JOIN users u ON u.id = g.owner_id
    WHERE ${clauses.join(' AND ')} ORDER BY ${order} LIMIT ?`;
  return db.prepare(sql).all(...params, Math.min(60, Math.max(1, limit)));
}

export function gamesByOwner(ownerID) {
  return db.prepare(`SELECT ${GAME_FIELDS} FROM games g JOIN users u ON u.id = g.owner_id
    WHERE g.owner_id = ? ORDER BY g.updated_at DESC`).all(ownerID);
}

export function gameById(gameID) {
  return db.prepare(`SELECT ${GAME_FIELDS}, g.parts, g.spawn FROM games g
    JOIN users u ON u.id = g.owner_id WHERE g.id = ?`).get(String(gameID || '')) || null;
}

export function createGame({ ownerID, name, description, thumb, parts, spawn }) {
  const gameID = id('gam');
  const ts = now();
  db.prepare(`INSERT INTO games (id, owner_id, name, description, thumb, parts, spawn, published, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
    .run(gameID, ownerID, name, description, thumb, JSON.stringify(parts), JSON.stringify(spawn), ts, ts);
  return gameById(gameID);
}

export function savePlace(gameID, { parts, spawn, name, description }) {
  const current = gameById(gameID);
  if (!current) return null;
  db.prepare(`UPDATE games SET parts = ?, spawn = ?, name = COALESCE(?, name),
              description = COALESCE(?, description), place_version = place_version + 1, updated_at = ?
              WHERE id = ?`)
    .run(
      JSON.stringify(parts),
      JSON.stringify(spawn),
      name ?? null,
      description ?? null,
      now(),
      gameID
    );
  return gameById(gameID);
}

export function publishGame(gameID, published = 1) {
  db.prepare('UPDATE games SET published = ?, updated_at = ? WHERE id = ?').run(published ? 1 : 0, now(), gameID);
  return gameById(gameID);
}

export function recordVisit(gameID, userID) {
  db.prepare('UPDATE games SET visits = visits + 1 WHERE id = ?').run(gameID);
  db.prepare('INSERT INTO visits (game_id, user_id, created_at) VALUES (?, ?, ?)').run(gameID, userID, now());
}

export function likeGame(gameID) {
  db.prepare('UPDATE games SET likes = likes + 1 WHERE id = ?').run(gameID);
  return db.prepare('SELECT likes FROM games WHERE id = ?').get(gameID)?.likes ?? 0;
}

// ---- inventory --------------------------------------------------------------

export function inventory(userID) {
  return db.prepare('SELECT item_id FROM purchases WHERE user_id = ?').all(userID).map((r) => r.item_id);
}

export function ownsItem(userID, itemID) {
  return !!db.prepare('SELECT 1 FROM purchases WHERE user_id = ? AND item_id = ?').get(userID, itemID);
}

export function grantItem(userID, itemID) {
  db.prepare('INSERT OR IGNORE INTO purchases (user_id, item_id, created_at) VALUES (?, ?, ?)')
    .run(userID, itemID, now());
}

export function spendCoins(userID, amount) {
  const user = userById(userID);
  if (!user || user.coins < amount) return false;
  db.prepare('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?').run(amount, userID, amount);
  return true;
}

// ---- moderation -------------------------------------------------------------

export function logCommand({ gameID, actorID, actorName, target, command, raw, ok, message }) {
  db.prepare(`INSERT INTO command_log (game_id, actor_id, actor_name, target, command, raw, ok, message, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(gameID, actorID, actorName, target || '', command, raw, ok ? 1 : 0, String(message || '').slice(0, 400), now());
}

export function commandHistory({ gameID = null, limit = 50 } = {}) {
  if (gameID) {
    return db.prepare(`SELECT * FROM command_log WHERE game_id = ? ORDER BY id DESC LIMIT ?`).all(gameID, limit);
  }
  return db.prepare('SELECT * FROM command_log ORDER BY id DESC LIMIT ?').all(limit);
}

export function searchUsers(q, limit = 40) {
  const like = `%${String(q || '')}%`;
  return db.prepare(`SELECT id, username, role, coins, banned_until, created_at, last_seen FROM users
                     WHERE username LIKE ? ORDER BY role DESC, created_at ASC LIMIT ?`).all(like, limit);
}

export function addReport({ reporterID, targetID, gameID, reason }) {
  db.prepare('INSERT INTO reports (reporter_id, target_id, game_id, reason, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(reporterID, targetID, gameID || '', String(reason).slice(0, 500), now());
}

export function reports(limit = 50) {
  return db.prepare('SELECT * FROM reports ORDER BY id DESC LIMIT ?').all(limit);
}

export function stats() {
  return {
    users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    games: db.prepare('SELECT COUNT(*) AS n FROM games WHERE published = 1').get().n,
    visits: db.prepare('SELECT COALESCE(SUM(visits), 0) AS n FROM games').get().n,
  };
}
