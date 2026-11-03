import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, orderBody } from './helpers.js';

let app;
let ids;
before(async () => ({ app, ids } = await buildTestApp()));
after(() => app.close());

const place = (body, ip = '10.0.0.1') => app.inject({ method: 'POST', url: '/api/orders', payload: body, remoteAddress: ip });

test('a valid order is saved with the size price from the database, not from the browser', async () => {
  const response = await place(orderBody({ items: [{ perfumeId: ids.ambreId, option: '100 ml', quantity: 2 }] }));
  assert.equal(response.statusCode, 201);
  assert.match(response.json().number, /^VL-\d{4}$/);

  const order = await app.repos.orders.get(1);
  assert.equal(order.customer_name, 'Awa Koné');
  assert.equal(order.city, 'Abidjan · Cocody');
  assert.equal(order.latitude, 5.3599);
  assert.equal(order.subtotal_cents, 11000000);
  assert.equal(order.items[0].option_label, '100 ml');
  assert.equal(order.ip_hash.length, 64, 'the IP is stored only as a keyed hash');
});

test('the answer carries the WhatsApp message, written from the saved order', async () => {
  await app.repos.settings.setMany({ whatsapp_number: '2250700000000', delivery_fee: '200000' });
  const response = await place(orderBody({ items: [{ perfumeId: ids.ambreId, option: '50 ml', quantity: 1 }] }), '10.0.0.7');
  const { number, message, whatsappUrl } = response.json();
  assert.match(message, new RegExp(`\\*${number}\\*`));
  assert.match(message, /1 × Ambre Test · 50 ml — 35 000 F CFA/);
  assert.match(message, /\*Total : 37 000 F CFA\*/);
  assert.match(message, /Adresse : Riviera 3, villa 12, Abidjan · Cocody/);
  assert.equal(whatsappUrl, `https://wa.me/2250700000000?text=${encodeURIComponent(message)}`);
});

test('pick-up orders need no address and pay no delivery', async () => {
  await app.repos.settings.setMany({ pickup_address: 'Boutique Cocody', delivery_fee: '200000' });
  const body = orderBody({ items: [{ perfumeId: ids.ambreId, option: '50 ml', quantity: 1 }] });
  body.customer = { ...body.customer, address: '', delivery: 'pickup' };
  const response = await place(body, '10.0.0.8');
  assert.equal(response.statusCode, 201);
  const order = await app.repos.orders.findByIdempotencyKey(body.idempotencyKey);
  const saved = await app.repos.orders.get(order.id);
  assert.equal(saved.delivery_method, 'pickup');
  assert.equal(saved.total_cents, 3500000);
});

test('a delivery order without an address is refused', async () => {
  const body = orderBody({ items: [{ perfumeId: ids.ambreId, option: '50 ml', quantity: 1 }] });
  body.customer = { ...body.customer, address: '' };
  assert.equal((await place(body, '10.0.0.10')).statusCode, 400);
});

test('delivery is free from the threshold set in the admin', async () => {
  await app.repos.settings.setMany({ delivery_fee: '200000', free_delivery_from: '5000000' });
  const body = orderBody({ items: [{ perfumeId: ids.ambreId, option: '100 ml', quantity: 1 }] });
  await place(body, '10.0.0.11');
  const order = await app.repos.orders.findByIdempotencyKey(body.idempotencyKey);
  assert.equal((await app.repos.orders.get(order.id)).delivery_cents, 0);
  await app.repos.settings.setMany({ free_delivery_from: '' });
});

test('a double click places one order', async () => {
  const body = orderBody({ items: [{ perfumeId: ids.ambreId, option: '50 ml', quantity: 1 }] });
  const first = await place(body, '10.0.0.2');
  const second = await place(body, '10.0.0.2');
  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 200);
  assert.equal(first.json().number, second.json().number);
});

test('draft perfumes, unknown or missing sizes and silly quantities are rejected', async () => {
  const cases = [
    { items: [{ perfumeId: ids.draftId, quantity: 1 }] },
    { items: [{ perfumeId: ids.ambreId, option: '75 ml', quantity: 1 }] },
    { items: [{ perfumeId: ids.ambreId, quantity: 1 }] },
    { items: [{ perfumeId: ids.ambreId, option: '50 ml', quantity: 500 }] },
    { items: [] },
  ];
  for (const overrides of cases) {
    const response = await place(orderBody(overrides), '10.0.0.3');
    assert.equal(response.statusCode, 400, JSON.stringify(overrides));
    assert.ok(response.json().error);
  }
});

test('unknown fields and bad phone numbers are rejected, not silently fixed', async () => {
  const extra = await place({ ...orderBody(), isAdmin: true }, '10.0.0.4');
  assert.equal(extra.statusCode, 400);
  const badPhone = orderBody();
  badPhone.customer.phone = 'call me';
  assert.equal((await place(badPhone, '10.0.0.4')).statusCode, 400);
});

test('the hidden honeypot field stops bots', async () => {
  const response = await place(orderBody({ website: 'http://spam.example' }), '10.0.0.5');
  assert.equal(response.statusCode, 400);
});

test('orders are rate limited per connection', async () => {
  let last;
  for (let i = 0; i < 7; i += 1) last = await place(orderBody({ items: [{ perfumeId: ids.ambreId, option: '50 ml', quantity: 1 }] }), '10.0.0.9');
  assert.equal(last.statusCode, 429);
});

test('no orders are taken while the shop is paused', async () => {
  await app.repos.settings.setMany({ orders_open: '0' });
  const response = await place(orderBody({ items: [{ perfumeId: ids.ambreId, option: '50 ml', quantity: 1 }] }), '10.0.0.6');
  assert.equal(response.statusCode, 403);
  await app.repos.settings.setMany({ orders_open: '1' });
});
