// Admin authentication, roles and CSRF protection.
//
// Every /admin request (except the login page and static assets) must carry a valid
// session cookie. Every POST must also carry the session's CSRF token and come from
// our own origin. Routes that only owners may use declare `config: { role: 'owner' }`.
import { config } from '../config.js';
import { safeEqual } from '../lib/crypto.js';
import { forbidden, HttpError } from '../lib/http-error.js';

export const SESSION_COOKIE = config.isProduction ? '__Secure-vallora_session' : 'vallora_session';
const PUBLIC_ADMIN_PATHS = ['/admin/login', '/admin/assets/'];

export const sessionCookieOptions = {
  path: '/admin',
  httpOnly: true,
  secure: config.isProduction,
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60, // seconds; the server enforces the real limits
};

// The form must come from this site: either the configured address, or the address the visitor
// is on right now (Vercel serves the same deployment under several names, like the
// project-name.vercel.app alias and per-deployment URLs). A browser always sends the real Origin,
// and another site cannot make it look like ours.
export function isSameOrigin(request) {
  const allowed = new Set([config.publicOrigin, `${request.protocol}://${request.host}`]);
  const origin = request.headers.origin;
  if (origin) return allowed.has(origin);
  const referer = request.headers.referer;
  if (referer) return [...allowed].some((site) => referer.startsWith(`${site}/`));
  // Modern browsers always send Origin on POST. Missing both is only tolerated outside production
  // so command-line tools and tests can talk to a local server.
  return !config.isProduction;
}

function isPublicPath(url) {
  return PUBLIC_ADMIN_PATHS.some((path) => url.startsWith(path));
}

export function registerAuth(app) {
  app.decorateRequest('admin', null);

  app.addHook('onRequest', async (request, reply) => {
    if (isPublicPath(request.url)) return;
    const session = await app.repos.sessions.findValid(request.cookies[SESSION_COOKIE]);
    if (!session) {
      if (request.method === 'GET') return reply.redirect(`/admin/login?next=${encodeURIComponent(request.url)}`);
      throw new HttpError(401, 'Your session has ended. Please log in again.');
    }
    request.admin = session;
  });

  app.addHook('preHandler', async (request) => {
    if (request.method !== 'POST') return;
    if (!isSameOrigin(request)) throw new HttpError(403, 'This form was sent from another site and was blocked.');
    if (isPublicPath(request.url)) return;

    const token = readField(request.body, '_csrf') ?? request.headers['x-csrf-token'];
    if (!token || !safeEqual(token, request.admin.csrf_token)) {
      throw new HttpError(403, 'This form has expired. Go back, reload the page and try again.');
    }
  });

  app.addHook('preHandler', async (request) => {
    const requiredRole = request.routeOptions.config?.role;
    if (requiredRole === 'owner' && request.admin?.role !== 'owner') throw forbidden();
  });
}

function readField(body, name) {
  const value = body?.[name];
  if (value && typeof value === 'object' && 'value' in value) return value.value;
  return value;
}
