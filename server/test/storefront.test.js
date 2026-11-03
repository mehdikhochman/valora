import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { buildTestApp, login, adminPost } from './helpers.js';

let app;
let ids;
before(async () => ({ app, ids } = await buildTestApp()));
after(() => app.close());

test('the storefront script is inlined byte for byte', async () => {
  const script = fs.readFileSync(new URL('../src/storefront/storefront.js', import.meta.url), 'utf8');
  const html = (await app.inject({ url: '/' })).body;
  assert.ok(html.includes(script));
});

const catalogueOf = (html) => JSON.parse(html.match(/<script id="catalogue" type="application\/json">([\s\S]*?)<\/script>/)[1]);

test('the home page is served compressed with an ETag and a hash-based CSP', async () => {
  const response = await app.inject({ url: '/', headers: { 'accept-encoding': 'br, gzip' } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-encoding'], 'br');
  assert.match(response.headers.etag, /^"[a-f0-9]{20}"$/);
  assert.match(response.headers['content-security-policy'], /script-src 'sha256-[A-Za-z0-9+/=]+'/);
  assert.doesNotMatch(response.headers['content-security-policy'], /script-src[^;]*unsafe-inline/);
  assert.equal(response.headers['x-frame-options'], 'DENY');
  const html = zlib.brotliDecompressSync(response.rawPayload).toString();
  assert.match(html, /VALLORA/);
});

test('an unchanged page answers 304 with no body', async () => {
  const first = await app.inject({ url: '/' });
  const second = await app.inject({ url: '/', headers: { 'if-none-match': first.headers.etag } });
  assert.equal(second.statusCode, 304);
  assert.equal(second.body, '');
});

test('only published perfumes reach the catalogue, with prices from the database', async () => {
  const catalogue = catalogueOf((await app.inject({ url: '/' })).body);
  assert.deepEqual(catalogue.perfumes.map((p) => p.name), ['Ambre Test']);
  const [perfume] = catalogue.perfumes;
  assert.equal(perfume.price, 3500000, 'the "from" price is the cheapest size');
  assert.equal(perfume.maxPrice, 5500000);
  assert.deepEqual(perfume.base, ['Vanille', 'Musc']);
});

test('a perfume page carries its own title, preview and structured data; unknown ones go home', async () => {
  const page = await app.inject({ url: '/parfum/ambre-test' });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /<link rel="canonical" href="[^"]+\/parfum\/ambre-test">/);
  assert.match(page.body, /"@type":"Product"/);
  assert.equal((await app.inject({ url: '/parfum/secret-draft' })).statusCode, 302, 'drafts have no page');
  assert.equal((await app.inject({ url: '/parfum/..%2f..%2fetc' })).statusCode, 400);
});

test('the app files are served: manifest, service worker, sitemap', async () => {
  const manifest = await app.inject({ url: '/manifest.webmanifest' });
  assert.equal(JSON.parse(manifest.body).display, 'standalone');
  const worker = await app.inject({ url: '/sw.js' });
  assert.match(worker.headers['content-type'], /javascript/);
  assert.match((await app.inject({ url: '/robots.txt' })).body, /Sitemap: /);
  const csp = (await app.inject({ url: '/' })).headers['content-security-policy'];
  assert.match(csp, /worker-src 'self'/);
});

test('anonymous counters are recorded per day, and unknown perfumes count for the shop', async () => {
  const send = (events) => app.inject({ method: 'POST', url: '/api/events', payload: { events } });
  assert.equal((await send([{ e: 'visit' }, { e: 'view', p: ids.ambreId }, { e: 'view', p: ids.ambreId }, { e: 'add', p: 9999 }])).statusCode, 204);
  const day = new Date().toISOString().slice(0, 10);
  const funnel = await app.repos.events.funnelSince(day);
  assert.equal(funnel.visit, 1);
  assert.equal(funnel.view, 2);
  assert.equal(funnel.add, 1);
  const [top] = await app.repos.events.topPerfumes(day);
  assert.equal(top.name, 'Ambre Test');
  assert.equal(top.views, 2);
  assert.equal((await send([{ e: 'hack' }])).statusCode, 400, 'only known events');
  assert.equal((await send([{ e: 'visit', extra: 1 }])).statusCode, 400, 'no extra fields');
});

test('admin text cannot break out of the page (escaping)', async () => {
  const session = await login(app);
  await adminPost(app, session, '/admin/settings', {
    ...(await app.repos.settings.getAll()),
    hero_line: '</script><script>alert(1)</script>',
    delivery_fee: '',
  });
  const html = (await app.inject({ url: '/' })).body;
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('saving in the admin rebuilds the page', async () => {
  const before = (await app.inject({ url: '/' })).headers.etag;
  const session = await login(app);
  await adminPost(app, session, '/admin/settings/orders-open', { open: '0' });
  const response = await app.inject({ url: '/' });
  assert.notEqual(response.headers.etag, before);
  assert.equal(catalogueOf(response.body).settings.ordersOpen, false);
});

test('media paths outside the image pattern are refused', async () => {
  const response = await app.inject({ url: '/media/..%2f..%2fvallora.db' });
  assert.equal(response.statusCode, 404);
});
