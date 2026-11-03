// Behaviour that matters when several copies of the app run at once (Vercel), and Vercel's entry point.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildApp } from '../src/app.js';
import { buildTestApp, orderBody, login, adminPost } from './helpers.js';

let app;
let ids;
let secondInstance;
before(async () => {
  ({ app, ids } = await buildTestApp());
  // A second copy of the app on the same database, like a second Vercel function instance.
  const dataDir = path.dirname(app.media.dir);
  secondInstance = await buildApp({ dataDir, databaseUrl: `file:${path.join(dataDir, 'test.db')}`, mediaDriver: 'local', logger: false });
});
after(async () => {
  await secondInstance.close();
  await app.close();
});

test('a change made through one instance reaches the page served by another', async () => {
  const before = (await secondInstance.inject({ url: '/' })).headers.etag;
  const session = await login(app);
  await adminPost(app, session, '/admin/settings/orders-open', { open: '0' });
  const afterChange = await secondInstance.inject({ url: '/' });
  assert.notEqual(afterChange.headers.etag, before);
  assert.match(afterChange.body, /"ordersOpen":false/);
  await adminPost(app, session, '/admin/settings/orders-open', { open: '1' });
});

test('two identical orders sent at the same moment create one order', async () => {
  const body = orderBody({ items: [{ perfumeId: ids.ambreId, option: '50 ml', quantity: 1 }] });
  const [first, second] = await Promise.all([
    app.inject({ method: 'POST', url: '/api/orders', payload: body, remoteAddress: '10.2.0.1' }),
    secondInstance.inject({ method: 'POST', url: '/api/orders', payload: body, remoteAddress: '10.2.0.1' }),
  ]);
  assert.ok([200, 201].includes(first.statusCode) && [200, 201].includes(second.statusCode));
  assert.equal(first.json().number, second.json().number);
  const count = await app.repos.db.value('SELECT COUNT(*) FROM orders WHERE idempotency_key = ?', [body.idempotencyKey]);
  assert.equal(count, 1);
});

test('on Vercel without a database, the site explains what to set instead of crashing', () => {
  const script = `
    const { default: handler } = await import('./api/index.js');
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { console.log(JSON.stringify({ status: this.statusCode, body })); } };
    await handler({}, res);`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { PATH: process.env.PATH, VERCEL: '1', NODE_ENV: 'production' },
    encoding: 'utf8',
  });
  const output = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.equal(output.status, 503);
  assert.match(output.body, /not set up yet\. Missing .*TURSO_DATABASE_URL.*TURSO_AUTH_TOKEN.*BLOB_READ_WRITE_TOKEN/);
});

test('a Blob token created with a custom prefix is accepted', () => {
  const script = `
    const { default: handler } = await import('./api/index.js');
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { console.log(JSON.stringify({ status: this.statusCode, body })); } };
    await handler({}, res);`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { PATH: process.env.PATH, VERCEL: '1', NODE_ENV: 'production', VALLORA_READ_WRITE_TOKEN: 'vercel_blob_rw_example' },
    encoding: 'utf8',
  });
  const output = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.match(output.body, /TURSO_DATABASE_URL/);
  assert.doesNotMatch(output.body, /BLOB_READ_WRITE_TOKEN/);
});

test('a Blob store connected by store ID (no token) is accepted', () => {
  const script = `
    const { default: handler } = await import('./api/index.js');
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { console.log(JSON.stringify({ status: this.statusCode, body })); } };
    await handler({}, res);`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { PATH: process.env.PATH, VERCEL: '1', NODE_ENV: 'production', BLOB_STORE_ID: 'store_example' },
    encoding: 'utf8',
  });
  const output = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.match(output.body, /TURSO_DATABASE_URL/);
  assert.doesNotMatch(output.body, /BLOB_STORE_ID/);
});

// Vercel's Node runtime cannot require() ES-only packages. A dependency that does so worked
// locally but crashed every request in production once; this keeps it from happening again.
test('the app starts on a Node runtime without require() of ES modules', () => {
  const dataDir = path.join(path.dirname(app.media.dir), 'esm-check');
  const script = `
    const { buildApp } = await import('./src/app.js');
    const app = await buildApp({ dataDir: ${JSON.stringify(dataDir)}, databaseUrl: 'file:${dataDir}/check.db', mediaDriver: 'local', logger: false });
    await app.ready();
    console.log('started');
    await app.close();`;
  const result = spawnSync(process.execPath, ['--no-experimental-require-module', '--input-type=module', '-e', script], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
  });
  assert.match(result.stdout, /started/, result.stderr.split('\n').find((line) => line.includes('Error')) ?? result.stderr);
});
