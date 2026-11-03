// Orders placed on the website, and the numbers the dashboard shows about them.
import { statement } from '../db/database.js';

export const ORDER_STATUSES = ['new', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
export const ORDER_STATUS_LABELS = {
  new: 'New',
  confirmed: 'Confirmed',
  preparing: 'Being prepared',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};
const FIRST_ORDER_NUMBER = 1001;
const SEARCH = `(@status = '' OR status = @status)
  AND (@q = '' OR number LIKE '%' || @q || '%' OR customer_name LIKE '%' || @q || '%'
       OR phone LIKE '%' || @q || '%' OR city LIKE '%' || @q || '%')`;

export function createOrdersRepository(db) {
  return {
    findByIdempotencyKey: (key) => db.get('SELECT id, number FROM orders WHERE idempotency_key = ?', [key]),

    // One round trip, all-or-nothing. The number is computed inside the INSERT, and the database
    // runs one write at a time, so two orders can never get the same number.
    async create(order, items) {
      const lookupOrderId = '(SELECT id FROM orders WHERE idempotency_key = @idempotencyKey)';
      const results = await db.batch([
        statement(`
          INSERT INTO orders (number, idempotency_key, customer_name, phone, email, city, address, customer_note, delivery_method,
                              latitude, longitude, location_accuracy_m, currency, subtotal_cents, delivery_cents,
                              total_cents, item_count, ip_hash)
          VALUES ((SELECT 'VL-' || (COALESCE(MAX(id), 0) + ${FIRST_ORDER_NUMBER}) FROM orders),
                  @idempotencyKey, @customerName, @phone, @email, @city, @address, @customerNote, @deliveryMethod,
                  @latitude, @longitude, @locationAccuracy, @currency, @subtotalCents, @deliveryCents,
                  @totalCents, @itemCount, @ipHash)`, order),
        ...items.map((item) => statement(`
          INSERT INTO order_items (order_id, perfume_id, perfume_name, option_label, quantity, unit_price_cents)
          VALUES (${lookupOrderId}, @perfumeId, @perfumeName, @optionLabel, @quantity, @unitPriceCents)`,
        { ...item, idempotencyKey: order.idempotencyKey })),
        statement('SELECT id, number FROM orders WHERE idempotency_key = ?', [order.idempotencyKey]),
      ]);
      return results.at(-1)[0];
    },

    list: ({ status = '', q = '', limit = 50, offset = 0 } = {}) => db.all(`
      SELECT id, number, status, customer_name, phone, city, total_cents, currency, item_count, created_at
      FROM orders WHERE ${SEARCH} ORDER BY id DESC LIMIT @limit OFFSET @offset`, { status, q, limit, offset }),
    count: ({ status = '', q = '' } = {}) => db.value(`SELECT COUNT(*) FROM orders WHERE ${SEARCH}`, { status, q }),

    async get(id) {
      const [order, items] = await Promise.all([
        db.get('SELECT * FROM orders WHERE id = ?', [id]),
        db.all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', [id]),
      ]);
      return order ? { ...order, items } : null;
    },

    update: (id, { status, adminNote }) => db.run(`UPDATE orders SET status = ?, admin_note = ?,
                                                   updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`, [status, adminNote, id]),
    remove: (id) => db.run('DELETE FROM orders WHERE id = ?', [id]),

    async countByStatus() {
      const counts = Object.fromEntries(ORDER_STATUSES.map((status) => [status, 0]));
      for (const row of await db.all('SELECT status, COUNT(*) AS count FROM orders GROUP BY status')) counts[row.status] = row.count;
      return counts;
    },

    totalsSince: (isoDate) => db.get(`SELECT COUNT(*) AS orders, COALESCE(SUM(total_cents), 0) AS total_cents
                                      FROM orders WHERE created_at >= ? AND status != 'cancelled'`, [isoDate]),
    countRecentFromIp: (ipHash, isoDate) => db.value('SELECT COUNT(*) FROM orders WHERE ip_hash = ? AND created_at >= ?', [ipHash, isoDate]),
    topPerfumes: (isoDate, limit = 5) => db.all(`
      SELECT oi.perfume_name, SUM(oi.quantity) AS quantity
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.created_at >= ? AND o.status != 'cancelled'
      GROUP BY oi.perfume_name ORDER BY quantity DESC LIMIT ?`, [isoDate, limit]),

    async exportAll() {
      const [orders, items] = await Promise.all([
        db.all('SELECT * FROM orders ORDER BY id'),
        db.all('SELECT * FROM order_items ORDER BY order_id, id'),
      ]);
      const itemsByOrder = new Map();
      for (const item of items) {
        if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, []);
        itemsByOrder.get(item.order_id).push(item);
      }
      return orders.map((order) => ({ ...order, items: itemsByOrder.get(order.id) ?? [] }));
    },
  };
}
