// Assembles the application: database, repositories, plugins and routes.
// Kept separate from server.js (local) and api/index.js (Vercel) so both, and the tests,
// build exactly the same app.
import path from 'node:path';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { openDatabase } from './db/database.js';
import { createRepositories } from './repositories/index.js';
import { createMediaStore } from './lib/media.js';
import { createStorefront } from './storefront/render.js';
import { registerSecurityHeaders } from './plugins/security-headers.js';
import { registerErrorHandling } from './plugins/errors.js';
import { publicRoutes } from './routes/public.js';
import { adminRoutes } from './routes/admin/index.js';

export async function buildApp({
  dataDir = config.dataDir,
  databaseUrl = config.databaseUrl,
  mediaDriver = config.mediaDriver,
  media = createMediaStore({ driver: mediaDriver, mediaDir: path.join(dataDir, 'media'), blobToken: config.blobToken }),
  logger = true,
} = {}) {
  const db = await openDatabase({ url: databaseUrl, authToken: config.databaseToken, migrate: config.migrateOnStart });
  const repos = createRepositories(db);

  const app = Fastify({
    logger: logger && {
      level: config.isProduction ? 'info' : 'debug',
      redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]'],
    },
    trustProxy: config.trustProxy,
    bodyLimit: 64 * 1024, // JSON and forms; image uploads have their own limit in the admin
    // Reject unknown or wrongly-typed fields instead of silently stripping or converting them.
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });

  app.decorate('repos', repos);
  app.decorate('media', media);
  app.decorate('storefront', createStorefront({ repos }));

  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, { global: false });
  registerSecurityHeaders(app);
  registerErrorHandling(app);

  await app.register(publicRoutes);
  await app.register(adminRoutes, { prefix: '/admin' });

  app.addHook('onClose', async () => db.close());
  return app;
}
