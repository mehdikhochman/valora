// Images, guide entries, settings and the activity log.
import { createPositionTools } from './positions.js';

export function createImagesRepository(db) {
  return {
    // The same file uploaded twice is stored once (file_key is a content hash).
    async save({ fileKey, width, height, hasAlpha, baseUrl }) {
      await db.run('INSERT OR IGNORE INTO images (file_key, width, height, has_alpha, base_url) VALUES (?, ?, ?, ?, ?)',
        [fileKey, width, height, hasAlpha, baseUrl]);
      return db.get('SELECT * FROM images WHERE file_key = ?', [fileKey]);
    },
    get: (id) => db.get('SELECT * FROM images WHERE id = ?', [id]),
    // Returns the image when it is no longer used anywhere, so its files can be deleted.
    async removeIfUnused(id) {
      const image = await db.get('SELECT * FROM images WHERE id = ?', [id]);
      if (!image) return null;
      const usage = await db.value('SELECT COUNT(*) FROM perfume_images WHERE image_id = ?', [id]);
      if (usage > 0) return null;
      await db.run('DELETE FROM images WHERE id = ?', [id]);
      return image;
    },
  };
}

export function createGuideRepository(db) {
  const positions = createPositionTools(db, 'guide_entries');
  const list = () => db.all('SELECT * FROM guide_entries ORDER BY position, id');
  return {
    list,
    listVisible: async () => (await list()).filter((entry) => entry.is_visible),
    get: (id) => db.get('SELECT * FROM guide_entries WHERE id = ?', [id]),
    async create({ question, answer, isVisible }) {
      const result = await db.run('INSERT INTO guide_entries (question, answer, is_visible, position) VALUES (?, ?, ?, ?)',
        [question, answer, isVisible, await positions.nextPosition()]);
      return result.lastId;
    },
    update: (id, { question, answer, isVisible }) =>
      db.run('UPDATE guide_entries SET question = ?, answer = ?, is_visible = ? WHERE id = ?', [question, answer, isVisible, id]),
    remove: (id) => db.run('DELETE FROM guide_entries WHERE id = ?', [id]),
    move: positions.move,
  };
}

// catalogue_version is not a visible setting: it counts storefront changes, so every server
// instance (Vercel runs several) knows when its cached copy of the shop page is out of date.
const VERSION_KEY = 'catalogue_version';

export function createSettingsRepository(db, fields) {
  const defaults = Object.fromEntries(fields.map((field) => [field.key, field.default ?? '']));
  const upsert = 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value';

  return {
    // Every known key is always present, falling back to its default.
    async getAll() {
      const stored = Object.fromEntries((await db.all('SELECT key, value FROM settings')).map((row) => [row.key, row.value]));
      return { ...defaults, ...stored };
    },
    async setMany(values) {
      const known = Object.entries(values).filter(([key]) => key in defaults);
      if (!known.length) return;
      await db.batch(known.map(([key, value]) => ({ sql: upsert, args: [key, String(value)] })));
    },
    // Internal markers (not shown in the settings form), e.g. "the starter catalogue was loaded".
    getMarker: (key) => db.value('SELECT value FROM settings WHERE key = ?', [`marker:${key}`]),
    setMarker: (key, value) => db.run(upsert, [`marker:${key}`, String(value)]),
    catalogueVersion: async () => Number(await db.value('SELECT value FROM settings WHERE key = ?', [VERSION_KEY]) ?? 0),
    bumpCatalogueVersion: () => db.run(`INSERT INTO settings (key, value) VALUES (?, '1')
                                        ON CONFLICT (key) DO UPDATE SET value = CAST(value AS INTEGER) + 1`, [VERSION_KEY]),
  };
}

export function createActivityRepository(db) {
  return {
    log: (userId, action, summary) => db.run('INSERT INTO activity_log (user_id, action, summary) VALUES (?, ?, ?)', [userId ?? null, action, summary.slice(0, 300)]),
    list: ({ limit = 50, offset = 0 } = {}) => db.all(`SELECT a.*, u.name AS user_name FROM activity_log a
                                                       LEFT JOIN users u ON u.id = a.user_id
                                                       ORDER BY a.id DESC LIMIT ? OFFSET ?`, [limit, offset]),
    count: () => db.value('SELECT COUNT(*) FROM activity_log'),
  };
}
