// The starter catalogue: it loads completely, every perfume gets its own page, and it never runs twice.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import { seedCatalogue } from '../scripts/seed.js';

let app;
let dataDir;
before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vallora-seed-'));
  app = await buildApp({ dataDir, databaseUrl: `file:${path.join(dataDir, 'seed.db')}`, mediaDriver: 'local', logger: false });
});
after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const quiet = () => {};

test('loads the starter perfumes, each with sizes and notes, and the guide', async () => {
  assert.equal(await seedCatalogue({ repos: app.repos, log: quiet }), true);
  const perfumes = await app.repos.perfumes.listPublished();
  assert.equal(perfumes.length, 16);
  assert.ok(perfumes.every((perfume) => perfume.notes_top && perfume.notes_base), 'every perfume has notes');
  assert.ok(perfumes.every((perfume) => perfume.sizes.length || perfume.price_cents), 'every perfume has a price');
  assert.equal((await app.repos.guide.list()).length, 7);
  const page = (await app.inject({ url: '/' })).body;
  assert.match(page, /"name":"Or Sillage"/);
});

test('every starter perfume has its own page with a product preview', async () => {
  const response = await app.inject({ url: '/parfum/or-sillage' });
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /<title>Or Sillage · Eau de parfum · Vallora<\/title>/);
  assert.match(response.body, /<meta property="og:type" content="product">/);
  assert.match(response.body, /"@type":"Product"/);
  assert.match(response.body, /"lowPrice":25000/);
  assert.match(response.body, /data-start="or-sillage"/);
  const sitemap = (await app.inject({ url: '/sitemap.xml' })).body;
  assert.equal((sitemap.match(/<loc>/g) ?? []).length, 17);
});

test('the dashboard asks the team to review starter perfumes until they do', async () => {
  const status = await app.repos.perfumes.launchStatus();
  assert.equal(status.untouched, 16);
  assert.equal(status.without_photos, 16);
});

test('runs only once, so perfumes the shop deletes do not come back', async () => {
  const [first] = await app.repos.perfumes.list();
  await app.repos.perfumes.remove(first.id);
  assert.equal(await seedCatalogue({ repos: app.repos, log: quiet }), false);
  assert.equal((await app.repos.perfumes.listPublished()).length, 15);
});
