// Small end-to-end smoke test: HTTP login, WebSocket join, permission silence,
// and anonymous upgrade rejection. Run with the server up: `npm run smoke`.
import WebSocket from 'ws';

const BASE = process.env.BLOCKFORGE_URL || 'http://localhost:4173';

async function login(username, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`login ${res.status}: ${await res.text()}`);
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

async function firstPublishedGame() {
  const res = await fetch(`${BASE}/api/games`);
  const data = await res.json();
  const game = data.games.find((g) => g.published);
  if (!game) throw new Error('No published game to join.');
  return game.id;
}

function connect(cookie, gameId, { ms = 2200, onOpen } = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://${new URL(BASE).host}/ws?game=${gameId}`, {
      headers: { Cookie: cookie, Origin: BASE },
    });
    const out = { types: [], welcome: null, closed: null, error: null };
    const finish = () => {
      try { ws.close(); } catch { /* ignore */ }
      resolve(out);
    };
    const timer = setTimeout(finish, ms);
    ws.on('open', () => onOpen?.(ws));
    ws.on('message', (buf) => {
      const msg = JSON.parse(buf.toString());
      if (msg.t === 'welcome') out.welcome = msg;
      out.types.push(msg.t);
    });
    ws.on('close', (code, reason) => {
      out.closed = { code, reason: reason.toString() };
      clearTimeout(timer);
      resolve(out);
    });
    ws.on('error', (err) => {
      out.error = err.message;
      clearTimeout(timer);
      resolve(out);
    });
  });
}

const gameId = await firstPublishedGame();

const playerCookie = await login('player', 'player12345');
const player = await connect(playerCookie, gameId, {
  onOpen(ws) {
    ws.send(JSON.stringify({ t: 'chat', text: ';help' }));
    setTimeout(() => ws.send(JSON.stringify({ t: 'chat', text: ';speed 300' })), 300);
    setTimeout(() => ws.send(JSON.stringify({ t: 'input', mx: 1, mz: 0, jump: false, up: 0, yaw: 0 })), 450);
  },
});

const anon = await connect('', gameId, { ms: 900 });

const netRes = await fetch(`${BASE}/api/network`);
const net = await netRes.json();
const qrRes = await fetch(`${BASE}/api/network/qr?u=${encodeURIComponent(net.local)}`);
const qrBad = await fetch(`${BASE}/api/network/qr?u=${encodeURIComponent('https://example.com')}`);
const backupsAnon = await fetch(`${BASE}/api/backups`);
const forgeCookie = await login('forge', 'forge12345');
const backups = await fetch(`${BASE}/api/backups`, { headers: { Cookie: forgeCookie } });
const backupsBody = await backups.json();

const results = [
  ['published game join', Boolean(player.welcome)],
  ['player level is 0', player.welcome?.you?.level === 0],
  ['commands are silent for level 0', !player.types.includes('cmd')],
  ['movement snapshots arrive', player.types.includes('snap')],
  ['anonymous upgrade rejected', Boolean(anon.error) || anon.closed?.code === 1006],
  ['network info reports the port', net.port > 0 && net.local.includes('localhost')],
  ['QR renders for a local URL', qrRes.ok && (qrRes.headers.get('content-type') || '').includes('svg')],
  ['QR rejects foreign URLs', qrBad.status === 400],
  ['backups require sign-in', backupsAnon.status === 401],
  ['owner sees at least one backup', backups.status === 200 && backupsBody.count >= 1],
];

let failed = 0;
for (const [label, ok] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed++;
}
if (failed) {
  console.log('\nDebug:', JSON.stringify({ player, anon }, null, 2));
  process.exitCode = 1;
}
