// Prepare a copy of the database for public (internet) hosting.
//
// Usage (from the project folder):
//   set BLOCKFORGE_DATA=./data-live
//   set LIVE_OWNER_PASSWORD=choose-a-strong-one
//   node scripts/live-db.mjs
//
// The script takes a consistent snapshot of ./data/blockforge.db into the
// target folder, resets the owner password, and randomizes every demo
// account so the public server cannot be signed into with the known
// development passwords.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const target = path.resolve(process.env.BLOCKFORGE_DATA || './data-live');
const source = path.resolve(process.env.LIVE_SOURCE || './data/blockforge.db');
const dbPath = path.join(target, 'blockforge.db');
const ownerPassword = process.env.LIVE_OWNER_PASSWORD || '';

fs.mkdirSync(target, { recursive: true });

if (!fs.existsSync(dbPath)) {
  if (!fs.existsSync(source)) {
    console.error(`No source database at ${source}. Start the development server once first.`);
    process.exit(1);
  }
  const src = new DatabaseSync(source, { readOnly: true });
  src.exec(`VACUUM INTO '${dbPath.replaceAll("'", "''")}'`);
  src.close();
  console.log(`snapshot: ${source} -> ${dbPath}`);
} else {
  console.log(`using existing database: ${dbPath}`);
}

if (ownerPassword.length < 8) {
  console.error('Set LIVE_OWNER_PASSWORD (at least 8 characters) before running this script.');
  process.exit(1);
}

const { hashPassword } = await import('../server/auth.js');
const { db } = await import('../server/db.js');

const owner = db.prepare("SELECT id, username FROM users WHERE role = 3 ORDER BY id LIMIT 1").get();
if (!owner) {
  console.error('No owner account found in the snapshot.');
  process.exit(1);
}

function setPassword(id, password) {
  const { salt, hash } = hashPassword(password);
  db.prepare('UPDATE users SET pass_salt = ?, pass_hash = ? WHERE id = ?').run(salt, hash, id);
}

setPassword(owner.id, ownerPassword);
console.log(`owner password updated for ${owner.username}`);

// Demo accounts: keep their worlds, but remove the ability to sign in with
// the passwords printed in the README. They can still be moderated or
// re-enabled by the owner from the admin panel.
const demos = db.prepare("SELECT id, username FROM users WHERE role < 3").all();
for (const user of demos) {
  setPassword(user.id, crypto.randomBytes(32).toString('base64url'));
  db.prepare('UPDATE users SET role = 0 WHERE id = ?').run(user.id);
}
console.log(`demo accounts locked: ${demos.map((u) => u.username).join(', ') || 'none'}`);

db.close();
