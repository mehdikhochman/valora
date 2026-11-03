// Anonymous shop analytics: counters per day, event and perfume.
//
// Nothing personal is stored: no cookie, no IP, no visitor id. The shop learns which perfumes are
// looked at, added and ordered, which is enough to decide what to restock and what to promote.
import { statement } from '../db/database.js';

export const EVENTS = ['visit', 'view', 'add', 'checkout', 'whatsapp', 'quiz', 'search'];
export const FUNNEL = ['visit', 'view', 'add', 'checkout', 'whatsapp'];

const UPSERT = `INSERT INTO daily_events (day, event, perfume_id, count) VALUES (?, ?, ?, ?)
                ON CONFLICT (day, event, perfume_id) DO UPDATE SET count = count + excluded.count`;

export function createEventsRepository(db) {
  return {
    // Records a batch of events in one round trip. `events` is [{ event, perfumeId }].
    async record(events, day = new Date().toISOString().slice(0, 10)) {
      const counts = new Map();
      for (const { event, perfumeId = 0 } of events) {
        const key = `${event}:${perfumeId}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      if (!counts.size) return;
      await db.batch([...counts].map(([key, count]) => {
        const [event, perfumeId] = key.split(':');
        return statement(UPSERT, [day, event, Number(perfumeId), count]);
      }));
    },

    async funnelSince(day) {
      const totals = Object.fromEntries(EVENTS.map((event) => [event, 0]));
      const rows = await db.all('SELECT event, SUM(count) AS total FROM daily_events WHERE day >= ? GROUP BY event', [day]);
      for (const row of rows) totals[row.event] = row.total;
      return totals;
    },

    dailySince: (day) => db.all(`SELECT day, event, SUM(count) AS total FROM daily_events
                                 WHERE day >= ? GROUP BY day, event ORDER BY day`, [day]),

    // Most viewed perfumes with how often each was added to the bag: the "interest" table.
    topPerfumes: (day, limit = 8) => db.all(`
      SELECT p.id, p.name,
             SUM(CASE WHEN e.event = 'view' THEN e.count ELSE 0 END) AS views,
             SUM(CASE WHEN e.event = 'add' THEN e.count ELSE 0 END) AS adds
      FROM daily_events e JOIN perfumes p ON p.id = e.perfume_id
      WHERE e.day >= ? AND e.perfume_id != 0
      GROUP BY p.id ORDER BY views DESC, adds DESC LIMIT ?`, [day, limit]),

    knownPerfumeIds: async (ids) => {
      if (!ids.length) return new Set();
      const rows = await db.all(`SELECT id FROM perfumes WHERE status = 'published' AND id IN (${ids.map(() => '?').join(', ')})`, ids);
      return new Set(rows.map((row) => row.id));
    },
  };
}
