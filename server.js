// BookMyVenue web server. Start with:  node server.js
// Needs only Node 22.5 or newer - there is nothing to install.
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./src/config');
const { HttpError } = require('./src/errors');
const auth = require('./src/auth');
const api = require('./src/api');
const venues = require('./src/venues');
require('./src/db');

const COOKIE = 'bmv_session';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
};

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

const sendJson = (res, status, data, headers = {}) =>
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit * 20) return req.destroy(); // far too big: just hang up
      if (size <= limit) chunks.push(chunk); // otherwise discard, and answer 413 at the end
    });
    req.on('end', () => (size > limit ? reject(new HttpError(413, 'That upload is too large.')) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

// Block requests that another website tries to make on a logged-in person's behalf.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function serveFile(res, file, { cache = 'no-cache' } = {}) {
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    send(res, 200, data, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': cache,
    });
  });
}

function serveStatic(res, urlPath) {
  const requested = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.normalize(path.join(config.PUBLIC_DIR, requested));
  // Never serve anything outside the public folder.
  if (!file.startsWith(config.PUBLIC_DIR + path.sep)) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      // Unknown page address: hand back the app shell (the app does its own routing).
      if (!path.extname(urlPath)) return serveFile(res, path.join(config.PUBLIC_DIR, 'index.html'));
      return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    }
    serveFile(res, file);
  });
}

async function onRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const method = req.method;
  try {
    if (url.pathname.startsWith('/uploads/')) {
      if (method !== 'GET') throw new HttpError(405, 'Method not allowed.');
      const file = venues.imageFilePath(url.pathname.slice('/uploads/'.length));
      if (!file) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
      return serveFile(res, file, { cache: 'public, max-age=86400' });
    }

    if (!url.pathname.startsWith('/api/')) {
      if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
      return serveStatic(res, decodeURIComponent(url.pathname));
    }

    const token = parseCookies(req.headers.cookie)[COOKIE] || null;
    const ctx = {
      method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      ip: req.socket.remoteAddress || '',
      token,
      user: auth.userFromToken(token),
      body: {},
      raw: null,
    };

    let cookie = null;
    ctx.setSession = (value) => {
      const flags = `Path=/; HttpOnly; SameSite=Strict${config.COOKIE_SECURE ? '; Secure' : ''}`;
      cookie = value
        ? `${COOKIE}=${value}; Max-Age=${config.SESSION_HOURS * 3600}; ${flags}`
        : `${COOKIE}=; Max-Age=0; ${flags}`;
    };

    if (method !== 'GET') {
      if (!sameOrigin(req)) throw new HttpError(403, 'Request blocked.');
      const type = String(req.headers['content-type'] || '');
      if (type.startsWith('image/')) {
        ctx.raw = await readBody(req, config.MAX_IMAGE_BYTES);
      } else {
        const raw = await readBody(req, 100 * 1024);
        if (raw.length > 0) {
          // Requiring JSON also stops simple cross-site form posts.
          if (!type.startsWith('application/json')) throw new HttpError(415, 'Please send JSON.');
          try {
            ctx.body = JSON.parse(raw.toString('utf8'));
          } catch {
            throw new HttpError(400, 'That request was not valid.');
          }
          if (ctx.body === null || typeof ctx.body !== 'object' || Array.isArray(ctx.body)) {
            throw new HttpError(400, 'That request was not valid.');
          }
        }
      }
    }

    const result = await api.handle(ctx);
    return sendJson(res, 200, result === undefined ? { ok: true } : result, cookie ? { 'Set-Cookie': cookie } : {});
  } catch (err) {
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
    console.error('Unexpected error:', err);
    return sendJson(res, 500, { error: 'Something went wrong on our side. Please try again.' });
  }
}

function start(port = config.PORT) {
  const server = http.createServer(onRequest);
  server.listen(port, () => {
    const addr = server.address();
    console.log(`BookMyVenue is running at http://localhost:${addr.port}`);
  });
  setInterval(auth.purgeExpiredSessions, 60 * 60 * 1000).unref();
  return server;
}

if (require.main === module) start();

module.exports = { start };
