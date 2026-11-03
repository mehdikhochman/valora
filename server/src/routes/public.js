// Everything a shopper touches: the pages, images, fonts, the order endpoint and the counters.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { placeOrder, ORDER_BODY_SCHEMA } from './place-order.js';
import { serveFolderFromMemory, serveMedia } from '../lib/static-files.js';
import { EVENTS } from '../repositories/events.js';

const PUBLIC_DIR = path.resolve(import.meta.dirname, '../../public');
const SERVICE_WORKER = fs.readFileSync(new URL('../storefront/sw.js', import.meta.url));
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;
const SLUG = '^[a-z0-9]+(?:-[a-z0-9]+)*$';

const EVENTS_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['events'],
  properties: {
    events: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['e'],
        properties: { e: { type: 'string', enum: EVENTS }, p: { type: 'integer', minimum: 0 } },
      },
    },
  },
};

function sendPage(request, reply, page) {
  // On Vercel the CDN keeps the page for a few seconds at the edge, close to the visitor.
  if (config.isVercel) reply.header('cdn-cache-control', 'public, s-maxage=10, stale-while-revalidate=60');
  reply
    .header('content-type', 'text/html; charset=utf-8')
    .header('cache-control', 'no-cache') // always revalidate; unchanged pages answer 304 with no body
    .header('etag', page.etag)
    .header('vary', 'accept-encoding')
    .header('content-security-policy', page.csp);

  if (request.headers['if-none-match'] === page.etag) return reply.code(304).send();

  const accepted = request.headers['accept-encoding'] ?? '';
  if (/\bbr\b/.test(accepted)) return reply.header('content-encoding', 'br').send(page.br);
  if (/\bgzip\b/.test(accepted)) return reply.header('content-encoding', 'gzip').send(page.gzip);
  return reply.send(page.html);
}

export async function publicRoutes(app) {
  app.get('/', async (request, reply) => sendPage(request, reply, await app.storefront.getPage()));

  // A perfume's own address: the same shop, opened on that perfume, with its own preview.
  app.get('/parfum/:slug', {
    schema: { params: { type: 'object', properties: { slug: { type: 'string', maxLength: 120, pattern: SLUG } } } },
  }, async (request, reply) => {
    const page = await app.storefront.getPage(request.params.slug);
    if (!page) return reply.redirect('/', 302);
    return sendPage(request, reply, page);
  });

  // Uploaded images: content-hashed names, so they can be cached for a year, by browsers and by
  // Vercel's CDN (so a private Blob photo goes through the function once per CDN location).
  const forever = `public, max-age=${ONE_YEAR_SECONDS}, s-maxage=${ONE_YEAR_SECONDS}, immutable`;
  serveMedia(app, { prefix: '/media/', read: app.media.read, cacheControl: forever });

  // Fonts keep their names forever; brand images and styles may be replaced, so they are cached for a day.
  serveFolderFromMemory(app, {
    prefix: '/assets/',
    root: PUBLIC_DIR,
    cacheControl: (name) => (name.endsWith('.woff2') ? forever : 'public, max-age=86400, s-maxage=86400'),
  });

  app.get('/sw.js', async (request, reply) => reply
    .type('text/javascript; charset=utf-8').header('cache-control', 'no-cache').send(SERVICE_WORKER));

  app.get('/manifest.webmanifest', async (request, reply) => reply
    .type('application/manifest+json; charset=utf-8').header('cache-control', 'public, max-age=3600')
    .send(await app.storefront.manifest()));

  app.get('/sitemap.xml', async (request, reply) => reply
    .type('application/xml; charset=utf-8').header('cache-control', 'public, max-age=3600')
    .send(await app.storefront.sitemap()));

  app.get('/robots.txt', async (request, reply) => reply.type('text/plain')
    .send(`User-agent: *\nDisallow: /admin\nDisallow: /api\nSitemap: ${config.publicOrigin}/sitemap.xml\n`));

  app.get('/health', async () => ({ ok: true }));

  app.post('/api/orders', {
    schema: { body: ORDER_BODY_SCHEMA },
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    const result = await placeOrder(app.repos, request.body, request.ip);
    if (result.created) app.log.info({ order: result.number }, 'Order placed');
    const { created, ...answer } = result;
    return reply.code(created ? 201 : 200).send(answer);
  });

  // Anonymous counters sent by the shop page (sendBeacon). Unknown perfumes are counted as the shop.
  app.post('/api/events', {
    schema: { body: EVENTS_BODY_SCHEMA },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { events } = request.body;
    const known = await app.repos.events.knownPerfumeIds([...new Set(events.map((e) => e.p).filter(Boolean))]);
    await app.repos.events.record(events.map(({ e, p = 0 }) => ({ event: e, perfumeId: known.has(p) ? p : 0 })));
    return reply.code(204).send();
  });
}
