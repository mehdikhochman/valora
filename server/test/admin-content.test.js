import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, login, adminPost, multipart, pngBuffer, ORIGIN, orderBody } from './helpers.js';

let app;
let ids;
let session;
before(async () => {
  ({ app, ids } = await buildTestApp());
  session = await login(app);
});
after(() => app.close());

const page = (url) => app.inject({ url, cookies: session.cookies });

test('every admin page renders', async () => {
  for (const url of ['/admin', '/admin/orders', '/admin/perfumes', '/admin/perfumes/new', `/admin/perfumes/${ids.ambreId}`,
    '/admin/categories', '/admin/collections', '/admin/guide', '/admin/settings', '/admin/users',
    '/admin/account', '/admin/activity', '/admin/backup']) {
    const response = await page(url);
    assert.equal(response.statusCode, 200, url);
  }
});

const PERFUME_FIELDS = {
  house: '', tagline: '', description: '', badge: '', status: 'published', availability: 'in_stock', audience: 'women',
  family: 'floral', concentration: 'edp', intensity: '3', moment: 'day', notes_top: 'Litchi', notes_heart: 'Rose',
  notes_base: 'Musc', hue: '345', sizes: '', price: '', compare_at: '',
};

test('a perfume can be created, shown again with errors, and published with its sizes', async () => {
  const invalid = await adminPost(app, session, '/admin/perfumes', { ...PERFUME_FIELDS, name: '', category_id: ids.women, price: 'cheap' });
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.body, /Name is required/);
  assert.match(invalid.body, /Price must be a number/);

  const created = await adminPost(app, session, '/admin/perfumes', {
    ...PERFUME_FIELDS, name: 'Rose Matin', category_id: ids.women, sizes: '30 ml, 22 000\n100 ml, 52000',
  });
  assert.equal(created.statusCode, 303);
  const storefront = (await app.inject({ url: '/' })).body;
  assert.match(storefront, /"name":"Rose Matin"/);
  assert.match(storefront, /"sizes":\[\{"l":"30 ml","p":2200000\},\{"l":"100 ml","p":5200000\}\]/);
  assert.match(storefront, /"top":\["Litchi"\]/);
});

test('sizes with a bad price or listed twice are refused', async () => {
  for (const sizes of ['50 ml, cheap', '50 ml, 1000\n50 ml, 2000']) {
    const response = await adminPost(app, session, '/admin/perfumes', { ...PERFUME_FIELDS, name: 'Bad sizes', category_id: ids.women, sizes });
    assert.equal(response.statusCode, 400, sizes);
  }
});

test('photos are uploaded, re-encoded to WebP, and transparent ones become cut-outs', async () => {
  const body = multipart({ _csrf: session.csrf }, [
    { field: 'photos', filename: 'cutout.png', type: 'image/png', buffer: await pngBuffer({ transparent: true }) },
    { field: 'photos', filename: 'photo.png', type: 'image/png', buffer: await pngBuffer() },
  ]);
  const response = await app.inject({
    method: 'POST', url: `/admin/perfumes/${ids.ambreId}/images`, cookies: session.cookies,
    headers: { origin: ORIGIN, 'content-type': body.contentType }, payload: body.payload,
  });
  assert.equal(response.statusCode, 303);
  const images = (await app.repos.perfumes.get(ids.ambreId)).images;
  assert.deepEqual(images.map((i) => i.role).sort(), ['cutout', 'photo']);
  const media = await app.inject({ url: `/media/${images[0].file_key}-480.webp` });
  assert.equal(media.statusCode, 200);
  assert.match(media.headers['cache-control'], /immutable/);
});

test('a file that is not an image is refused', async () => {
  const body = multipart({ _csrf: session.csrf }, [
    { field: 'photos', filename: 'evil.png', type: 'image/png', buffer: Buffer.from('<?php system($_GET["c"]); ?>') },
  ]);
  const response = await app.inject({
    method: 'POST', url: `/admin/perfumes/${ids.ambreId}/images`, cookies: session.cookies,
    headers: { origin: ORIGIN, 'content-type': body.contentType }, payload: body.payload,
  });
  assert.equal(response.statusCode, 400);
});

test('orders can be processed and exported, with formula injection neutralised', async () => {
  const order = orderBody({ items: [{ perfumeId: ids.ambreId, option: '50 ml', quantity: 1 }] });
  order.customer.name = '=HYPERLINK("http://evil")';
  await app.inject({ method: 'POST', url: '/api/orders', payload: order, remoteAddress: '10.1.1.1' });
  const orderId = (await app.repos.orders.list())[0].id;

  const detail = await page(`/admin/orders/${orderId}`);
  assert.match(detail.body, /wa\.me\/2250707123456/);
  assert.match(detail.body, /google\.com\/maps/);

  await adminPost(app, session, `/admin/orders/${orderId}/status`, { status: 'confirmed' });
  assert.equal((await app.repos.orders.get(orderId)).status, 'confirmed');

  const csv = await page('/admin/orders.csv');
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.body, /"'=HYPERLINK/);
});

test('team members get a one-time password and the last owner cannot be removed', async () => {
  const created = await adminPost(app, session, '/admin/users', { name: 'New Person', email: 'new@test.local', role: 'editor' });
  assert.equal(created.statusCode, 200);
  assert.match(created.body, /shown only once/);

  const ownerId = (await app.repos.users.findByEmail('owner@test.local')).id;
  const editorId = (await app.repos.users.findByEmail('editor@test.local')).id;
  await adminPost(app, session, `/admin/users/${editorId}/role`, { role: 'owner' });
  await adminPost(app, session, `/admin/users/${editorId}/role`, { role: 'editor' });
  const selfDelete = await adminPost(app, session, `/admin/users/${ownerId}/delete`);
  assert.equal(selfDelete.statusCode, 400);
});

test('every change is written to the activity log', async () => {
  const entries = (await app.repos.activity.list({ limit: 100 })).map((e) => e.action);
  for (const action of ['perfume.create', 'perfume.photos', 'order.status', 'user.create']) assert.ok(entries.includes(action), action);
});

test('the backup downloads every table except login sessions', async () => {
  const response = await adminPost(app, session, '/admin/backup/database');
  assert.equal(response.statusCode, 200);
  const backup = response.json();
  assert.ok(backup.tables.orders.length > 0);
  assert.ok(backup.tables.perfumes.length > 0);
  assert.equal(backup.tables.sessions, undefined);
});
