import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(body);
}

export function sendError(res, err) {
  if (err instanceof HttpError) {
    sendJson(res, err.status, { error: err.message, ...err.extra });
    return;
  }
  console.error('[http] unhandled', err);
  sendJson(res, 500, { error: 'Internal server error' });
}

export async function readJson(req, limit = 2 * 1024 * 1024) {
  const chunkType = String(req.headers['content-type'] || '');
  if (!chunkType.includes('application/json')) {
    throw new HttpError(415, 'Expected application/json');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Payload too large');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Malformed JSON');
  }
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

// ---- routing ----------------------------------------------------------------

export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    const keys = [];
    const rx = pattern
      .split('/')
      .map((part) => {
        if (!part.startsWith(':')) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        keys.push(part.slice(1));
        return '([^/]+)';
      })
      .join('/');
    this.routes.push({ method, re: new RegExp(`^${rx}$`), keys, handler });
    return this;
  }

  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  patch(p, h) { return this.add('PATCH', p, h); }
  delete(p, h) { return this.add('DELETE', p, h); }

  match(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const m = route.re.exec(pathname);
      if (!m) continue;
      const params = {};
      route.keys.forEach((key, i) => { params[key] = decodeURIComponent(m[i + 1]); });
      return { handler: route.handler, params };
    }
    return null;
  }
}

// ---- static files -----------------------------------------------------------

const CACHE_IMMUTABLE = new Set(['.png', '.jpg', '.webp', '.woff2', '.svg']);

export async function serveStatic(req, res, rootDir, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel.endsWith('/')) rel += 'index.html';

  const root = path.resolve(rootDir);
  const target = path.resolve(root, '.' + path.posix.normalize(rel));
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new HttpError(403, 'Forbidden');
  }

  let stat;
  try {
    stat = await fs.promises.stat(target);
  } catch {
    return false;
  }
  if (stat.isDirectory()) return serveStatic(req, res, rootDir, rel + '/');
  if (!stat.isFile()) return false;

  const ext = path.extname(target).toLowerCase();
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304).end();
    return true;
  }

  const headers = {
    'content-type': MIME[ext] || 'application/octet-stream',
    'content-length': stat.size,
    etag,
    'cache-control': CACHE_IMMUTABLE.has(ext) ? 'public, max-age=86400' : 'no-cache',
  };
  if (req.method === 'HEAD') {
    res.writeHead(200, headers).end();
    return true;
  }
  res.writeHead(200, headers);
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(target);
    stream.on('error', reject);
    stream.on('end', resolve);
    Readable.toWeb(stream).pipeTo(
      new WritableStream({
        write(chunk) { res.write(chunk); },
        close() { res.end(); },
      })
    ).catch(reject);
  });
  return true;
}

export function parseUrl(req) {
  return new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
}
