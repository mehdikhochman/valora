// Manual ordering ("move up / move down") shared by every list the admin can reorder.
import { statement } from '../db/database.js';

const ORDERED_TABLES = new Set(['categories', 'collections', 'perfumes', 'guide_entries']);

export function createPositionTools(db, table) {
  if (!ORDERED_TABLES.has(table)) throw new Error(`Not an orderable table: ${table}`);
  // Table names cannot be SQL parameters. This one comes from the fixed list above, never from input.

  return {
    async move(id, direction) {
      const ids = (await db.all(`SELECT id FROM ${table} ORDER BY position, id`)).map((row) => row.id);
      const from = ids.indexOf(id);
      const to = direction === 'up' ? from - 1 : from + 1;
      if (from === -1 || to < 0 || to >= ids.length) return;
      [ids[from], ids[to]] = [ids[to], ids[from]];
      await db.batch(ids.map((rowId, index) => statement(`UPDATE ${table} SET position = ? WHERE id = ?`, [(index + 1) * 10, rowId])));
    },

    async nextPosition() {
      return (await db.value(`SELECT COALESCE(MAX(position), 0) FROM ${table}`)) + 10;
    },
  };
}
