import { dashboardPage } from '../../admin-ui/views/dashboard.js';
import { pageContext, sendPage } from './helpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days) => new Date(Date.now() - days * DAY_MS).toISOString();
const ANALYTICS_DAYS = 30;

export async function dashboardRoutes(app) {
  const { orders, perfumes, activity, settings, events } = app.repos;

  app.get('/', async (request, reply) => {
    // Independent queries run in parallel: on Turso each one is a network round trip.
    const since = daysAgo(ANALYTICS_DAYS).slice(0, 10);
    const [ctx, shopSettings, week, month, perfumeCounts, recentOrders, topPerfumes, recentActivity,
      funnel, daily, interest, launch] = await Promise.all([
      pageContext(app, request),
      settings.getAll(),
      orders.totalsSince(daysAgo(7)),
      orders.totalsSince(daysAgo(30)),
      perfumes.countByStatus(),
      orders.list({ limit: 6 }),
      orders.topPerfumes(daysAgo(30)),
      activity.list({ limit: 8 }),
      events.funnelSince(since),
      events.dailySince(since),
      events.topPerfumes(since),
      perfumes.launchStatus(),
    ]);
    return sendPage(reply, dashboardPage({
      ctx,
      settings: shopSettings,
      stats: { newOrders: ctx.newOrders, week, month, perfumes: perfumeCounts },
      recentOrders,
      topPerfumes,
      activity: recentActivity,
      analytics: { funnel, daily, interest, days: ANALYTICS_DAYS },
      launch,
    }));
  });
}
