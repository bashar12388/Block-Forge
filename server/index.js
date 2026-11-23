import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { buildApi } from './api.js';
import { userFromRequest, safeJson } from './auth.js';
import { gameById, touchUser } from './db.js';
import { HttpError, parseUrl, sendError, sendJson, serveStatic } from './http.js';
import { worlds } from './world.js';
import { seed } from './seed.js';
import { networkInfo } from './network.js';
import { startBackups } from './backup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';

const PUBLIC = path.join(ROOT, 'public');
const SHARED = path.join(ROOT, 'shared');
const THREE_BUILD = path.join(ROOT, 'node_modules', 'three', 'build');
const THREE_ADDONS = path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm');

const api = buildApi({ worlds, port: PORT });

seed();
startBackups();

const server = http.createServer(async (req, res) => {
  const url = parseUrl(req);
  const pathname = url.pathname;

  try {
    if (pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        // Same-origin guard for state-changing requests.
        const origin = req.headers.origin;
        if (origin) {
          let originHost = '';
          try { originHost = new URL(origin).host; } catch { /* ignore */ }
          if (originHost && originHost !== req.headers.host) {
            throw new HttpError(403, 'Cross-origin request rejected.');
          }
        }
      }
      const match = api.match(req.method, pathname);
      if (!match) throw new HttpError(404, 'No such endpoint');
      const user = userFromRequest(req);
      if (user) touchUser(user.id);
      await match.handler({ req, res, url, params: match.params, user });
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }

    if (pathname === '/vendor/three/build/three.module.js' || pathname.startsWith('/vendor/three/build/')) {
      if (await serveStatic(req, res, THREE_BUILD, pathname.replace('/vendor/three/build', ''))) return;
    }
    if (pathname.startsWith('/vendor/three/addons/')) {
      if (await serveStatic(req, res, THREE_ADDONS, pathname.replace('/vendor/three/addons', ''))) return;
    }
    if (pathname.startsWith('/shared/')) {
      if (await serveStatic(req, res, SHARED, pathname.replace('/shared', ''))) return;
    }

    if (await serveStatic(req, res, PUBLIC, pathname)) return;

    // Single-page app fallback.
    if (!path.extname(pathname)) {
      if (await serveStatic(req, res, PUBLIC, '/index.html')) return;
    }
    throw new HttpError(404, 'Not found');
  } catch (err) {
    if (res.headersSent) {
      try { res.end(); } catch { /* ignore */ }
      return;
    }
    if (pathname.startsWith('/api/')) sendError(res, err);
    else {
      const status = err instanceof HttpError ? err.status : 500;
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }).end(`${status} — ${err.message}`);
    }
  }
});

// ---- websocket --------------------------------------------------------------

const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname !== '/ws') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  const reject = (status, message) => {
    const body = message;
    socket.write(
      `HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : 'Not Found'}\r\n` +
      'content-type: text/plain\r\n' +
      `content-length: ${Buffer.byteLength(body)}\r\n` +
      'connection: close\r\n\r\n' + body
    );
    socket.destroy();
  };

  const gameId = url.searchParams.get('game') || '';
  const game = gameById(gameId);
  if (!game) return reject(404, 'No such game.');

  const user = userFromRequest(req, { allowBanned: true });
  if (!user) return reject(401, 'Sign in to play.');
  if (user.banned_until && user.banned_until > Date.now()) {
    return reject(403, `Banned: ${user.ban_reason || 'contact support'}`);
  }
  if (!game.published && game.owner_id !== user.id && user.role < 3) {
    return reject(403, 'This place is not published yet.');
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req, { game, user });
  });
});

wss.on('connection', (ws, req, ctx) => {
  const { game, user } = ctx;
  const world = worlds.get(game);
  const player = world.join(ws, {
    id: user.id,
    username: user.username,
    role: user.role,
    avatar: safeJson(user.avatar, {}),
  });

  if (!player) return;

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    switch (msg.t) {
      case 'input':
        world.handleInput(player, msg);
        break;
      case 'chat':
        world.handleChat(player, msg.text);
        break;
      case 'emote':
        world.handleEmote(player);
        break;
      case 'ping':
        world.sendTo(player, { t: 'pong', time: msg.time });
        break;
      default:
        break;
    }
  });

  ws.on('close', () => world.leave(player));
  ws.on('error', () => world.leave(player));
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }
}, 30_000);
heartbeat.unref?.();

server.listen(PORT, HOST, () => {
  const net = networkInfo(PORT);
  console.log(`\n  Blockforge running at ${net.local}`);
  if (HOST === '0.0.0.0' || HOST === '::') {
    if (!net.urls.length) {
      console.log('  No Wi-Fi/LAN address found. Connect this computer to Wi-Fi or a hotspot to play nearby.\n');
    } else {
      console.log('  Play together with no internet - same Wi-Fi or phone hotspot:');
      for (const item of net.urls) console.log(`    ${item.url}  (${item.name})`);
      console.log('  Scan the QR code on the "Play nearby" page on the host screen.\n');
    }
  } else {
    console.log(`  Bound to ${HOST}; other devices cannot reach this server.\n`);
  }
});
