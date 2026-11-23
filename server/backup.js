// Local, no-internet backups of the SQLite database.
//
// `VACUUM INTO` writes a complete, consistent snapshot even while the server is
// running (WAL included), so a power cut or a bad migration never costs a
// family's worlds or accounts. Everything stays on this computer.
import fs from 'node:fs';
import path from 'node:path';

import { db, DB_PATH } from './db.js';

const DATA_DIR = path.dirname(DB_PATH);
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const KEEP = 12;
const INTERVAL_MS = 30 * 60_000;

let timer = null;
let last = null;
let lastError = null;

function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

function prune() {
  let files;
  try {
    files = fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.db'))
      .map((file) => {
        let at = 0;
        try { at = fs.statSync(path.join(BACKUP_DIR, file)).mtimeMs; } catch { /* ignore */ }
        return { file, at };
      })
      .sort((a, b) => a.at - b.at);
  } catch {
    return;
  }
  while (files.length > KEEP) {
    const oldest = files.shift();
    try { fs.rmSync(path.join(BACKUP_DIR, oldest.file), { force: true }); } catch { /* ignore */ }
  }
}

export function listBackups() {
  try {
    return fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.db'))
      .map((file) => {
        let size = 0;
        let at = 0;
        try {
          const stat = fs.statSync(path.join(BACKUP_DIR, file));
          size = stat.size;
          at = stat.mtimeMs;
        } catch { /* ignore */ }
        return { file, size, at };
      })
      .sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

export function backupStatus() {
  const backups = listBackups();
  return {
    dir: BACKUP_DIR,
    keep: KEEP,
    count: backups.length,
    latest: backups[0] || null,
    lastError,
    intervalMinutes: INTERVAL_MS / 60_000,
  };
}

export function runBackup(reason = 'auto') {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  let file = `blockforge-${stamp()}.db`;
  let n = 1;
  while (fs.existsSync(path.join(BACKUP_DIR, file))) {
    file = `blockforge-${stamp()}-${++n}.db`;
  }
  const target = path.join(BACKUP_DIR, file);
  try {
    // VACUUM INTO refuses to overwrite, which is what we want for snapshots.
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    prune();
    last = { file, at: Date.now(), reason, size: fs.statSync(target).size };
    lastError = null;
    return { ok: true, ...last };
  } catch (err) {
    lastError = { message: err.message, at: Date.now(), reason };
    console.error(`[backup] failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

export function startBackups() {
  // Snapshot on boot so there is always a fallback from the previous session.
  runBackup('startup');
  timer = setInterval(() => runBackup('auto'), INTERVAL_MS);
  timer.unref?.();

  const shutdown = (signal) => {
    const result = runBackup(`shutdown:${signal}`);
    if (result.ok) console.log(`[backup] saved ${result.file}`);
    else console.error(`[backup] shutdown snapshot failed: ${result.error}`);
    process.exit(0);
  };
  // Only take over when nobody else is already handling a graceful shutdown.
  if (process.listenerCount('SIGINT') === 0) process.once('SIGINT', () => shutdown('SIGINT'));
  if (process.listenerCount('SIGTERM') === 0) process.once('SIGTERM', () => shutdown('SIGTERM'));

  return { stop() { if (timer) clearInterval(timer); timer = null; } };
}

export function lastBackup() {
  return last;
}
