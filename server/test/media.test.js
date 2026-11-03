// Vercel Blob stores are public or private. The shop must work with both.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import { blobStore } from '../src/lib/media.js';
import { pngBuffer } from './helpers.js';

// Behaves like Vercel Blob: keeps files in memory and enforces the store's access setting.
function fakeBlob(storeAccess) {
  const files = new Map();
  return {
    files,
    async put(pathname, data, options) {
      if (options.access !== storeAccess) {
        throw new Error(`Vercel Blob: Cannot use ${options.access} access on a ${storeAccess} store. The store is configured with ${storeAccess} access.`);
      }
      files.set(pathname, Buffer.from(data));
      return { url: `https://store.${storeAccess}.blob.vercel-storage.com/${pathname}` };
    },
    async get(pathname) {
      const data = files.get(pathname);
      return data ? { stream: new Blob([data]).stream() } : null;
    },
    async del(pathnames) {
      for (const pathname of pathnames) files.delete(pathname);
    },
  };
}

const dirs = [];
after(() => dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

test('a public store links photos to its own CDN address', async () => {
  const store = blobStore(undefined, fakeBlob('public'));
  const saved = await store.save(await pngBuffer());
  assert.match(saved.baseUrl, /^https:\/\/store\.public\.blob\.vercel-storage\.com\/media$/);
});

test('a private store is detected, and its photos are served by the shop at /media', async () => {
  const blob = fakeBlob('private');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vallora-media-'));
  dirs.push(dataDir);
  const app = await buildApp({ dataDir, databaseUrl: `file:${path.join(dataDir, 'm.db')}`, media: blobStore(undefined, blob), logger: false });

  const saved = await app.media.save(await pngBuffer());
  assert.equal(saved.baseUrl, '/media');
  assert.equal(blob.files.size, 2, 'both widths were uploaded privately');

  const response = await app.inject({ url: `/media/${saved.fileKey}-480.webp` });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'image/webp');
  assert.match(response.headers['cache-control'], /s-maxage=31536000/);
  assert.equal(response.rawPayload.subarray(0, 4).toString(), 'RIFF');

  await app.media.remove({ file_key: saved.fileKey, base_url: '/media' });
  assert.equal(blob.files.size, 0);
  assert.equal((await app.inject({ url: `/media/${saved.fileKey}-480.webp` })).statusCode, 404);
  await app.close();
});
