// Categories (Earrings, Rings...) and collections (Summer 2025...).
import { createPositionTools } from './positions.js';

export function createCategoriesRepository(db) {
  const positions = createPositionTools(db, 'categories');
  return {
    list: () => db.all(`SELECT c.*, (SELECT COUNT(*) FROM perfumes p WHERE p.category_id = c.id AND p.status != 'archived') AS perfume_count
                        FROM categories c ORDER BY c.position, c.id`),
    get: (id) => db.get('SELECT * FROM categories WHERE id = ?', [id]),
    findBySlug: (slug) => db.get('SELECT * FROM categories WHERE slug = ?', [slug]),
    isSlugTaken: async (slug, exceptId = 0) => (await db.value('SELECT COUNT(*) FROM categories WHERE slug = ? AND id != ?', [slug, exceptId])) > 0,
    async create({ slug, name }) {
      return (await db.run('INSERT INTO categories (slug, name, position) VALUES (?, ?, ?)', [slug, name, await positions.nextPosition()])).lastId;
    },
    update: (id, { slug, name }) => db.run('UPDATE categories SET slug = ?, name = ? WHERE id = ?', [slug, name, id]),
    perfumeCount: (id) => db.value('SELECT COUNT(*) FROM perfumes WHERE category_id = ?', [id]),
    remove: (id) => db.run('DELETE FROM categories WHERE id = ?', [id]),
    move: positions.move,
  };
}

export function createCollectionsRepository(db) {
  const positions = createPositionTools(db, 'collections');
  return {
    list: () => db.all(`SELECT c.*, (SELECT COUNT(*) FROM perfume_collections pc WHERE pc.collection_id = c.id) AS perfume_count
                        FROM collections c ORDER BY c.position, c.id`),
    get: (id) => db.get('SELECT * FROM collections WHERE id = ?', [id]),
    findBySlug: (slug) => db.get('SELECT * FROM collections WHERE slug = ?', [slug]),
    isSlugTaken: async (slug, exceptId = 0) => (await db.value('SELECT COUNT(*) FROM collections WHERE slug = ? AND id != ?', [slug, exceptId])) > 0,
    async create({ slug, name, description, isVisible }) {
      const result = await db.run('INSERT INTO collections (slug, name, description, is_visible, position) VALUES (?, ?, ?, ?, ?)',
        [slug, name, description, isVisible, await positions.nextPosition()]);
      return result.lastId;
    },
    update: (id, { slug, name, description, isVisible }) =>
      db.run('UPDATE collections SET slug = ?, name = ?, description = ?, is_visible = ? WHERE id = ?', [slug, name, description, isVisible, id]),
    remove: (id) => db.run('DELETE FROM collections WHERE id = ?', [id]),
    move: positions.move,
  };
}
