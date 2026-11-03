// Activity log and backups.
import { activityPage, backupPage } from '../../admin-ui/views/system.js';
import { logActivity, pageContext, parsePage, sendPage } from './helpers.js';

const PAGE_SIZE = 50;
// Everything needed to rebuild the shop. Sessions are left out on purpose: they are login keys.
const BACKUP_TABLES = ['settings', 'users', 'categories', 'collections', 'images', 'perfumes', 'perfume_sizes',
  'perfume_images', 'perfume_collections', 'guide_entries', 'orders', 'order_items', 'daily_events', 'activity_log'];

export async function systemRoutes(app) {
  const { activity, db } = app.repos;

  app.get('/activity', async (request, reply) => {
    const page = parsePage(request.query.page);
    const [ctx, entries, total] = await Promise.all([
      pageContext(app, request),
      activity.list({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
      activity.count(),
    ]);
    return sendPage(reply, activityPage({ ctx, entries, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) }));
  });

  app.get('/backup', { config: { role: 'owner' } }, async (request, reply) =>
    sendPage(reply, backupPage({ ctx: await pageContext(app, request) })));

  // A JSON copy of every table. It works the same on a local file and on Turso.
  // Table names come from the fixed list above, never from input.
  app.post('/backup/database', { config: { role: 'owner' } }, async (request, reply) => {
    const rows = await Promise.all(BACKUP_TABLES.map((table) => db.all(`SELECT * FROM ${table}`)));
    const backup = { createdAt: new Date().toISOString(), tables: Object.fromEntries(BACKUP_TABLES.map((table, i) => [table, rows[i]])) };
    await logActivity(app, request, 'backup.download', 'downloaded a backup');
    return reply
      .type('application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="vallora-backup-${backup.createdAt.slice(0, 10)}.json"`)
      .send(JSON.stringify(backup, null, 1));
  });
}
