// Logging in and out.
import { hashPassword, randomToken, verifyPassword } from '../../lib/crypto.js';
import { SESSION_COOKIE, sessionCookieOptions } from '../../plugins/auth.js';
import { loginPage } from '../../admin-ui/views/auth.js';
import { redirect, sendPage } from './helpers.js';

const LOGIN_ERROR = 'That email and password do not match, or the account is locked for 15 minutes after too many attempts.';
const NO_ACCOUNT_YET = 'No admin account exists yet. In Vercel, set OWNER_EMAIL and OWNER_PASSWORD for this environment '
  + '(Production and Preview), then redeploy. Locally, run: npm run create-owner -- "you@example.com"';

// Checking a password takes ~50 ms. When the email is unknown we still check one, against this
// throwaway hash, so response times do not reveal which emails have accounts.
const DUMMY_HASH = await hashPassword(randomToken());

// Only redirect back inside the admin, never to another site.
function safeNext(value) {
  return typeof value === 'string' && value.startsWith('/admin') && !value.startsWith('//') ? value : '/admin';
}

export async function authRoutes(app) {
  const { users, sessions, activity } = app.repos;

  app.get('/login', async (request, reply) => {
    if (await sessions.findValid(request.cookies[SESSION_COOKIE])) return redirect(reply, '/admin');
    return sendPage(reply, loginPage({ next: safeNext(request.query.next) }));
  });

  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const email = String(request.body?.email ?? '').trim().slice(0, 120);
    const password = String(request.body?.password ?? '').slice(0, 200);
    const next = safeNext(request.body?.next);
    const user = email ? await users.findByEmail(email) : null;

    const passwordMatches = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || users.isLocked(user) || !passwordMatches) {
      if (user && !users.isLocked(user)) await users.recordFailedLogin(user);
      // Saying "there are no accounts at all" reveals nothing about any particular email.
      const message = !user && (await users.count()) === 0 ? NO_ACCOUNT_YET : LOGIN_ERROR;
      return sendPage(reply, loginPage({ error: message, email, next }), 401);
    }

    await users.recordSuccessfulLogin(user.id);
    await sessions.purgeExpired(); // no background timer on serverless hosts, so tidy up here
    const token = await sessions.create(user.id, request.headers['user-agent'] ?? '');
    await activity.log(user.id, 'auth.login', 'logged in');
    reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions);
    return redirect(reply, next);
  });

  app.post('/logout', async (request, reply) => {
    await sessions.destroy(request.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: sessionCookieOptions.path });
    return redirect(reply, '/admin/login');
  });
}
