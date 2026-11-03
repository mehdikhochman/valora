// Team management (owners) and each person's own account.
import { FormReader } from '../../lib/form.js';
import { badRequest, notFound } from '../../lib/http-error.js';
import { generatePassword, hashPassword, MIN_PASSWORD_LENGTH, sha256, verifyPassword } from '../../lib/crypto.js';
import { SESSION_COOKIE } from '../../plugins/auth.js';
import { accountPage, passwordCreatedPage, usersPage } from '../../admin-ui/views/team.js';
import { logActivity, pageContext, parseId, redirect, sendPage } from './helpers.js';

const OWNER_ONLY = { config: { role: 'owner' } };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ['editor', 'owner'];

export async function teamRoutes(app) {
  const { users, sessions } = app.repos;

  async function loadOtherUser(request) {
    const user = await users.get(parseId(request.params.id));
    if (!user) throw notFound('Person');
    if (user.id === request.admin.user_id) throw badRequest('Use your account page to change your own access.');
    return user;
  }

  // There must always be someone who can manage the team and settings.
  async function assertNotLastOwner(user) {
    if (user.role === 'owner' && await users.countOwners() <= 1) throw badRequest('The shop needs at least one owner.');
  }

  const listPage = async (request, reply, extra = {}, statusCode = 200) =>
    sendPage(reply, usersPage({ ctx: await pageContext(app, request), users: await users.list(), ...extra }), statusCode);

  app.get('/users', OWNER_ONLY, async (request, reply) => listPage(request, reply));

  app.post('/users', OWNER_ONLY, async (request, reply) => {
    const form = new FormReader(request.body);
    const name = form.text('name', { label: 'Name', required: true, max: 60 });
    const email = form.text('email', { label: 'Email', required: true, max: 120, pattern: EMAIL, patternMessage: 'Enter a valid email address.' });
    const role = form.oneOf('role', ROLES, { label: 'Role' });
    if (email && await users.findByEmail(email)) form.fail('email', 'Someone on the team already uses this email.');
    if (form.hasErrors) return listPage(request, reply, { errors: form.errors, values: form.body }, 400);

    const password = generatePassword();
    const id = await users.create({ name, email, role, passwordHash: await hashPassword(password) });
    await logActivity(app, request, 'user.create', `added ${name} to the team as ${role}`);
    return sendPage(reply, passwordCreatedPage({ ctx: await pageContext(app, request), user: await users.get(id), password }));
  });

  app.post('/users/:id/role', OWNER_ONLY, async (request, reply) => {
    const user = await loadOtherUser(request);
    const role = ROLES.includes(request.body.role) ? request.body.role : user.role;
    if (role !== user.role) {
      if (role === 'editor') await assertNotLastOwner(user);
      await users.setRole(user.id, role);
      await logActivity(app, request, 'user.role', `made ${user.name} ${role}`);
    }
    return redirect(reply, '/admin/users', 'saved');
  });

  app.post('/users/:id/reset-password', OWNER_ONLY, async (request, reply) => {
    const user = await loadOtherUser(request);
    const password = generatePassword();
    await users.setPassword(user.id, await hashPassword(password));
    await sessions.destroyAllForUser(user.id);
    await logActivity(app, request, 'user.password', `created a new password for ${user.name}`);
    return sendPage(reply, passwordCreatedPage({ ctx: await pageContext(app, request), user, password }));
  });

  app.post('/users/:id/delete', OWNER_ONLY, async (request, reply) => {
    const user = await loadOtherUser(request);
    await assertNotLastOwner(user);
    await users.remove(user.id);
    await logActivity(app, request, 'user.delete', `removed ${user.name} from the team`);
    return redirect(reply, '/admin/users', 'deleted');
  });

  app.get('/account', async (request, reply) =>
    sendPage(reply, accountPage({ ctx: await pageContext(app, request), sessionCount: await sessions.countForUser(request.admin.user_id) })));

  app.post('/account/password', async (request, reply) => {
    const form = new FormReader(request.body);
    const current = String(form.raw('current_password') ?? '');
    const next = String(form.raw('new_password') ?? '');
    const me = await users.getWithHash(request.admin.user_id);

    if (!(await verifyPassword(current, me.password_hash))) form.fail('current_password', 'Your current password is not right.');
    if (next.length < MIN_PASSWORD_LENGTH) form.fail('new_password', `Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (next !== form.raw('confirm_password')) form.fail('confirm_password', 'The two new passwords are different.');
    if (form.hasErrors) {
      return sendPage(reply, accountPage({ ctx: await pageContext(app, request), errors: form.errors,
        sessionCount: await sessions.countForUser(me.id) }), 400);
    }

    await users.setPassword(me.id, await hashPassword(next));
    await sessions.destroyOthers(me.id, sha256(request.cookies[SESSION_COOKIE]));
    await logActivity(app, request, 'user.password', 'changed their password');
    return redirect(reply, '/admin/account', 'password');
  });

  app.post('/account/sessions', async (request, reply) => {
    await sessions.destroyOthers(request.admin.user_id, sha256(request.cookies[SESSION_COOKIE]));
    await logActivity(app, request, 'user.sessions', 'logged out their other devices');
    return redirect(reply, '/admin/account', 'sessions');
  });
}
