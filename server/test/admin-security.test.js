import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import { buildTestApp, login, adminPost, ORIGIN, EDITOR } from './helpers.js';

let app;
before(async () => ({ app } = await buildTestApp()));
after(() => app.close());

test('admin pages redirect to the login page without a session', async () => {
  const response = await app.inject({ url: '/admin/orders' });
  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.location, '/admin/login?next=%2Fadmin%2Forders');
});

test('a wrong password gets one generic message', async () => {
  const response = await app.inject({
    method: 'POST', url: '/admin/login', headers: { origin: ORIGIN },
    payload: { email: 'owner@test.local', password: 'wrong-password-000' },
  });
  assert.equal(response.statusCode, 401);
  assert.match(response.body, /do not match/);
  const unknown = await app.inject({
    method: 'POST', url: '/admin/login', headers: { origin: ORIGIN },
    payload: { email: 'nobody@test.local', password: 'whatever-123456' },
  });
  assert.equal(unknown.body.match(/<p class="error-summary"[^>]*>(.*?)<\/p>/)[1], response.body.match(/<p class="error-summary"[^>]*>(.*?)<\/p>/)[1]);
});

test('the session cookie is HttpOnly, SameSite=Strict and scoped to /admin', async () => {
  const response = await app.inject({
    method: 'POST', url: '/admin/login', headers: { origin: ORIGIN },
    payload: { email: 'owner@test.local', password: 'owner-password-123' },
  });
  const cookie = response.cookies[0];
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, 'Strict');
  assert.equal(cookie.path, '/admin');
  assert.equal(response.headers.location, '/admin');
});

test('the session id is stored only as a hash', async () => {
  const session = await login(app);
  const token = Object.values(session.cookies)[0];
  const stored = (await app.repos.db.all('SELECT id_hash FROM sessions')).map((row) => row.id_hash);
  assert.ok(!stored.includes(token));
});

test('a POST without the CSRF token is refused', async () => {
  const session = await login(app);
  const response = await app.inject({
    method: 'POST', url: '/admin/categories', cookies: session.cookies, headers: { origin: ORIGIN }, payload: { name: 'Anklets' },
  });
  assert.equal(response.statusCode, 403);
});

test('a POST from another site is refused even with a valid token', async () => {
  const session = await login(app);
  const response = await app.inject({
    method: 'POST', url: '/admin/categories', cookies: session.cookies,
    headers: { origin: 'https://evil.example' }, payload: { _csrf: session.csrf, name: 'Anklets' },
  });
  assert.equal(response.statusCode, 403);
});

test('editors cannot open owner-only pages', async () => {
  const session = await login(app, EDITOR);
  for (const url of ['/admin/settings', '/admin/users', '/admin/backup']) {
    const response = await app.inject({ url, cookies: session.cookies });
    assert.equal(response.statusCode, 403, url);
  }
  const post = await adminPost(app, session, '/admin/settings/orders-open', { open: '0' });
  assert.equal(post.statusCode, 403);
});

test('admin pages are never cached and carry the strict CSP', async () => {
  const session = await login(app);
  const response = await app.inject({ url: '/admin', cookies: session.cookies });
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.match(response.headers['content-security-policy'], /script-src 'self'/);
  assert.match(response.headers['speculation-rules'], /speculation-rules\.json/);
});

test('logging out ends the session', async () => {
  const session = await login(app);
  await adminPost(app, session, '/admin/logout');
  const response = await app.inject({ url: '/admin', cookies: session.cookies });
  assert.equal(response.statusCode, 302);
});

test('a form sent from the address the visitor is on is accepted (Vercel serves several addresses)', async () => {
  const response = await app.inject({
    method: 'POST', url: '/admin/login', remoteAddress: '10.9.9.1',
    headers: { host: 'vallora-server-git-preview.vercel.app', origin: 'http://vallora-server-git-preview.vercel.app' },
    payload: { email: 'owner@test.local', password: 'owner-password-123' },
  });
  assert.equal(response.statusCode, 303);
  const forged = await app.inject({
    method: 'POST', url: '/admin/login', remoteAddress: '10.9.9.2',
    headers: { host: 'vallora-server-git-preview.vercel.app', origin: 'https://evil.example' },
    payload: { email: 'owner@test.local', password: 'owner-password-123' },
  });
  assert.equal(forged.statusCode, 403);
});

test('with no admin account yet, the login page says how to create one', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vallora-empty-'));
  const empty = await buildApp({ dataDir, databaseUrl: `file:${path.join(dataDir, 'empty.db')}`, mediaDriver: 'local', logger: false });
  const response = await empty.inject({
    method: 'POST', url: '/admin/login', headers: { origin: ORIGIN }, payload: { email: 'me@example.com', password: 'anything-123456' },
  });
  assert.equal(response.statusCode, 401);
  assert.match(response.body, /No admin account exists yet/);
  await empty.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
