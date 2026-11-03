// Serves the few files that are not pages: fonts, the icon, admin CSS/JS, and (in local mode)
// uploaded photos. A small module of our own instead of a dependency: the files are few and known,
// and the previous plugin broke on Vercel's Node runtime.
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from './crypto.js';

const CONTENT_TYPES = {
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
};

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  });
}

// Every file in `root` is read once at start-up and served from memory under `prefix`.
// Only files that exist in the folder can be requested, so paths like ../../ never reach the disk.
export function serveFolderFromMemory(app, { prefix, root, cacheControl }) {
  const files = new Map();
  for (const name of listFiles(root)) {
    const type = CONTENT_TYPES[path.extname(name)];
    if (!type) continue;
    const body = fs.readFileSync(path.join(root, name));
    files.set(name, { body, type, etag: `"${sha256(body).slice(0, 16)}"`, cacheControl: cacheControl(name) });
  }

  app.get(`${prefix}*`, async (request, reply) => {
    const file = files.get(request.params['*']);
    if (!file) return reply.callNotFound();
    reply.header('cache-control', file.cacheControl).header('etag', file.etag);
    if (request.headers['if-none-match'] === file.etag) return reply.code(304).send();
    return reply.type(file.type).send(file.body);
  });
}

// Uploaded photos served by the app (local folder, or a private Blob store).
// Names are content hashes, checked against a strict pattern before anything is read.
export function serveMedia(app, { prefix, read, cacheControl }) {
  const ALLOWED_NAME = /^[a-f0-9]{20}-(480|1200)\.webp$/;
  app.get(`${prefix}:name`, async (request, reply) => {
    const { name } = request.params;
    if (!ALLOWED_NAME.test(name)) return reply.callNotFound();
    const body = await read(name);
    if (!body) return reply.callNotFound();
    return reply.header('cache-control', cacheControl).type('image/webp').send(body);
  });
}
