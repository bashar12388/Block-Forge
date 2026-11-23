import crypto from 'node:crypto';
import { sessionSecret, userById } from './db.js';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const COOKIE = 'bf_session';
const SESSION_DAYS = 30;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return { salt, hash: hash.toString('hex') };
}

export function verifyPassword(password, salt, expectedHex) {
  const actual = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  const expected = Buffer.from(expectedHex, 'hex');
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function sign(payload) {
  return crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url').slice(0, 43);
}

export function issueSessionCookie(userID, secure = false) {
  const payload = `${userID}.${Date.now()}`;
  const token = `${payload}.${sign(payload)}`;
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(secure = false) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function parseCookies(header = '') {
  const out = {};
  for (const piece of String(header).split(';')) {
    const idx = piece.indexOf('=');
    if (idx < 0) continue;
    const key = piece.slice(0, idx).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(piece.slice(idx + 1).trim());
  }
  return out;
}

export function userFromRequest(req, { allowBanned = false } = {}) {
  const token = parseCookies(req.headers.cookie || '')[COOKIE];
  if (!token) return null;
  const [userID, issued, sig] = token.split('.');
  if (!userID || !issued || !sig) return null;
  const expected = sign(`${userID}.${issued}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Date.now() - Number(issued) > SESSION_DAYS * 86400000) return null;

  const user = userById(userID);
  if (!user) return null;
  if (!allowBanned && user.banned_until && user.banned_until > Date.now()) return null;
  return user;
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    coins: user.coins,
    avatar: safeJson(user.avatar),
    bannedUntil: user.banned_until || 0,
    banReason: user.ban_reason || '',
    createdAt: user.created_at,
  };
}

export function safeJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/** Small fixed-window limiter, keyed by IP or user id. */
export function createLimiter({ windowMs = 60_000, max = 30 } = {}) {
  const hits = new Map();
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, entry] of hits) if (entry.start < cutoff) hits.delete(key);
  }, Math.min(windowMs, 60_000)).unref?.();

  return function take(key) {
    const t = Date.now();
    let entry = hits.get(key);
    if (!entry || t - entry.start > windowMs) {
      entry = { start: t, count: 0 };
      hits.set(key, entry);
    }
    entry.count += 1;
    return entry.count <= max;
  };
}
