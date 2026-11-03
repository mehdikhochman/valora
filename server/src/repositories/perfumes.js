// Perfumes with their sizes (each with its own price), images and collections.
import { statement } from '../db/database.js';
import { createPositionTools } from './positions.js';
import { slugify } from '../lib/form.js';

export const AUDIENCES = ['women', 'men', 'unisex'];
export const FAMILIES = ['amber', 'woody', 'floral', 'fresh', 'citrus', 'gourmand', 'leather', 'aromatic', 'musky', 'chypre'];
export const CONCENTRATIONS = ['extrait', 'parfum', 'edp', 'edt', 'edc', 'oil', 'mist', 'home'];
export const MOMENTS = ['day', 'night', 'any'];
export const STATUSES = ['draft', 'published', 'archived'];
export const AVAILABILITIES = ['in_stock', 'low_stock', 'preorder', 'sold_out'];

// Columns written by both INSERT and UPDATE, with the named parameter each one takes.
const COLUMNS = {
  name: 'name', house: 'house', category_id: 'categoryId', audience: 'audience', family: 'family',
  concentration: 'concentration', intensity: 'intensity', moment: 'moment', notes_top: 'notesTop',
  notes_heart: 'notesHeart', notes_base: 'notesBase', tagline: 'tagline', badge: 'badge', is_new: 'isNew',
  description: 'description', price_cents: 'priceCents', compare_at_cents: 'compareAtCents', status: 'status',
  availability: 'availability', hue: 'hue', instagram_url: 'instagramUrl',
};
const INSERT_COLUMNS = Object.keys(COLUMNS).join(', ');
const INSERT_VALUES = Object.values(COLUMNS).map((name) => `@${name}`).join(', ');
const UPDATE_SET = Object.entries(COLUMNS).map(([column, name]) => `${column} = @${name}`).join(', ');

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const IMAGE_COLUMNS = `pi.perfume_id, pi.image_id, pi.role, pi.alt, pi.position,
                       i.file_key, i.width, i.height, i.has_alpha, i.base_url`;

function groupBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row[key])) groups.set(row[key], []);
    groups.get(row[key]).push(row);
  }
  return groups;
}

function perfumeArgs(perfume) {
  return Object.fromEntries(Object.values(COLUMNS).map((name) => [name, perfume[name]]));
}

// A row from the database, in the shape the forms and create() use.
function toInput(row) {
  return Object.fromEntries(Object.entries(COLUMNS).map(([column, name]) => [name, row[column]]));
}

function sizeAndCollectionStatements(perfumeId, perfume) {
  return [
    statement('DELETE FROM perfume_sizes WHERE perfume_id = ?', [perfumeId]),
    ...(perfume.sizes ?? []).map((size, index) =>
      statement('INSERT INTO perfume_sizes (perfume_id, label, price_cents, position) VALUES (?, ?, ?, ?)',
        [perfumeId, size.label, size.priceCents, index])),
    statement('DELETE FROM perfume_collections WHERE perfume_id = ?', [perfumeId]),
    ...(perfume.collectionIds ?? []).map((collectionId) =>
      statement('INSERT OR IGNORE INTO perfume_collections (perfume_id, collection_id) VALUES (?, ?)', [perfumeId, collectionId])),
  ];
}

export function createPerfumesRepository(db) {
  const positions = createPositionTools(db, 'perfumes');
  const imagesOf = (perfumeId) => db.all(`SELECT ${IMAGE_COLUMNS} FROM perfume_images pi JOIN images i ON i.id = pi.image_id
                                        WHERE pi.perfume_id = ? ORDER BY pi.position, pi.image_id`, [perfumeId]);
  const sizesOf = (perfumeId) => db.all('SELECT label, price_cents FROM perfume_sizes WHERE perfume_id = ? ORDER BY position, id', [perfumeId]);
  const imageIdsOf = async (perfumeId) =>
    (await db.all('SELECT image_id FROM perfume_images WHERE perfume_id = ? ORDER BY position, image_id', [perfumeId])).map((row) => row.image_id);

  async function uniqueSlug(name, exceptId = 0) {
    const base = slugify(name);
    let slug = base;
    for (let n = 2; (await db.value('SELECT COUNT(*) FROM perfumes WHERE slug = ? AND id != ?', [slug, exceptId])) > 0; n += 1) slug = `${base}-${n}`;
    return slug;
  }

  async function insertPerfume(perfume, slug) {
    const result = await db.run(`INSERT INTO perfumes (slug, position, ${INSERT_COLUMNS})
                                 VALUES (@slug, @position, ${INSERT_VALUES})`,
    { ...perfumeArgs(perfume), slug, position: await positions.nextPosition() });
    return result.lastId;
  }

  return {
    list: ({ q = '', status = '', categoryId = 0 } = {}) => db.all(`
      SELECT p.id, p.name, p.slug, p.house, p.status, p.badge, p.price_cents, p.availability, p.position, p.updated_at,
             p.hue, c.name AS category_name,
             (SELECT MIN(s.price_cents) FROM perfume_sizes s WHERE s.perfume_id = p.id) AS from_price_cents,
             (SELECT i.file_key FROM perfume_images pi JOIN images i ON i.id = pi.image_id
              WHERE pi.perfume_id = p.id ORDER BY pi.role = 'cutout' DESC, pi.position LIMIT 1) AS thumb_key,
             (SELECT i.base_url FROM perfume_images pi JOIN images i ON i.id = pi.image_id
              WHERE pi.perfume_id = p.id ORDER BY pi.role = 'cutout' DESC, pi.position LIMIT 1) AS thumb_base
      FROM perfumes p JOIN categories c ON c.id = p.category_id
      WHERE (@status = '' AND p.status != 'archived' OR p.status = @status)
        AND (@categoryId = 0 OR p.category_id = @categoryId)
        AND (@q = '' OR p.name LIKE '%' || @q || '%' OR p.house LIKE '%' || @q || '%'
             OR p.notes_top || p.notes_heart || p.notes_base LIKE '%' || @q || '%')
      ORDER BY p.position, p.id`, { q, status, categoryId }),

    async get(id) {
      const perfume = await db.get('SELECT * FROM perfumes WHERE id = ?', [id]);
      if (!perfume) return null;
      const [sizes, images, collections] = await Promise.all([
        sizesOf(id),
        imagesOf(id),
        db.all('SELECT collection_id FROM perfume_collections WHERE perfume_id = ?', [id]),
      ]);
      return { ...perfume, sizes, images, collectionIds: collections.map((row) => row.collection_id) };
    },

    // Everything the storefront needs in four queries, whatever the number of perfumes.
    async listPublished() {
      const published = "SELECT id FROM perfumes WHERE status = 'published'";
      const [perfumes, sizes, images, collections] = await Promise.all([
        db.all(`SELECT p.*, c.slug AS category_slug FROM perfumes p JOIN categories c ON c.id = p.category_id
                WHERE p.status = 'published' ORDER BY p.position, p.id`),
        db.all(`SELECT perfume_id, label, price_cents FROM perfume_sizes WHERE perfume_id IN (${published}) ORDER BY position, id`),
        db.all(`SELECT ${IMAGE_COLUMNS} FROM perfume_images pi JOIN images i ON i.id = pi.image_id
                WHERE pi.perfume_id IN (${published}) ORDER BY pi.position, pi.image_id`),
        db.all(`SELECT pc.perfume_id, c.slug FROM perfume_collections pc JOIN collections c ON c.id = pc.collection_id
                WHERE c.is_visible = 1 AND pc.perfume_id IN (${published})`),
      ]);
      const sizesByPerfume = groupBy(sizes, 'perfume_id');
      const imagesByPerfume = groupBy(images, 'perfume_id');
      const collectionsByPerfume = groupBy(collections, 'perfume_id');
      return perfumes.map((perfume) => ({
        ...perfume,
        sizes: sizesByPerfume.get(perfume.id) ?? [],
        images: imagesByPerfume.get(perfume.id) ?? [],
        collectionSlugs: (collectionsByPerfume.get(perfume.id) ?? []).map((row) => row.slug),
      }));
    },

    findBySlug: (slug) => db.get('SELECT id, name FROM perfumes WHERE slug = ?', [slug]),
    imageCount: (id) => db.value('SELECT COUNT(*) FROM perfume_images WHERE perfume_id = ?', [id]),
    getForOrder: (id) => db.get("SELECT id, name, price_cents, availability FROM perfumes WHERE id = ? AND status = 'published'", [id]),
    sizesOf,

    async create(perfume) {
      const id = await insertPerfume(perfume, await uniqueSlug(perfume.name));
      await db.batch(sizeAndCollectionStatements(id, perfume));
      return id;
    },

    async update(id, perfume) {
      const slug = await uniqueSlug(perfume.name, id);
      await db.batch([
        statement(`UPDATE perfumes SET slug = @slug, ${UPDATE_SET}, updated_at = ${NOW} WHERE id = @id`,
          { ...perfumeArgs(perfume), slug, id }),
        ...sizeAndCollectionStatements(id, perfume),
      ]);
    },

    async duplicate(id) {
      const source = await this.get(id);
      const copy = {
        ...toInput(source), name: `${source.name} (copie)`, status: 'draft',
        sizes: source.sizes.map((size) => ({ label: size.label, priceCents: size.price_cents })),
        collectionIds: source.collectionIds,
      };
      const copyId = await this.create(copy);
      await db.batch(source.images.map((image) => statement(
        'INSERT OR IGNORE INTO perfume_images (perfume_id, image_id, role, alt, position) VALUES (?, ?, ?, ?, ?)',
        [copyId, image.image_id, image.role, image.alt, image.position])));
      return copyId;
    },

    setStatus: (ids, status) => db.batch(ids.map((id) => statement(`UPDATE perfumes SET status = ?, updated_at = ${NOW} WHERE id = ?`, [status, id]))),

    // Perfumes that appear in past orders are archived instead, so order history stays readable.
    // Returns the ids of images that may now be unused, so the caller can clean up files.
    async remove(id) {
      if ((await db.value('SELECT COUNT(*) FROM order_items WHERE perfume_id = ?', [id])) > 0) {
        await db.run(`UPDATE perfumes SET status = 'archived', updated_at = ${NOW} WHERE id = ?`, [id]);
        return { archived: true, imageIds: [] };
      }
      const imageIds = await imageIdsOf(id);
      await db.run('DELETE FROM perfumes WHERE id = ?', [id]);
      return { archived: false, imageIds };
    },

    move: positions.move,

    // What still needs the team's attention before launch: starter perfumes never edited, and
    // perfumes shown with a drawn bottle because they have no photo yet.
    launchStatus: () => db.get(`
      SELECT COALESCE(SUM(status = 'published'), 0) AS live,
             COALESCE(SUM(status = 'published' AND updated_at = created_at), 0) AS untouched,
             COALESCE(SUM(status = 'published' AND NOT EXISTS (SELECT 1 FROM perfume_images pi WHERE pi.perfume_id = perfumes.id)), 0) AS without_photos
      FROM perfumes`),

    async countByStatus() {
      const counts = { draft: 0, published: 0, archived: 0 };
      for (const row of await db.all('SELECT status, COUNT(*) AS count FROM perfumes GROUP BY status')) counts[row.status] = row.count;
      return counts;
    },

    addImage: (perfumeId, imageId, role, alt = '') => db.run(`
      INSERT OR IGNORE INTO perfume_images (perfume_id, image_id, role, alt, position)
      VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 10 FROM perfume_images WHERE perfume_id = ?))`,
    [perfumeId, imageId, role, alt, perfumeId]),
    updateImage: (perfumeId, imageId, { role, alt }) =>
      db.run('UPDATE perfume_images SET role = ?, alt = ? WHERE perfume_id = ? AND image_id = ?', [role, alt, perfumeId, imageId]),
    removeImage: (perfumeId, imageId) => db.run('DELETE FROM perfume_images WHERE perfume_id = ? AND image_id = ?', [perfumeId, imageId]),

    async moveImage(perfumeId, imageId, direction) {
      const ids = await imageIdsOf(perfumeId);
      const from = ids.indexOf(imageId);
      const to = direction === 'up' ? from - 1 : from + 1;
      if (from === -1 || to < 0 || to >= ids.length) return;
      [ids[from], ids[to]] = [ids[to], ids[from]];
      await db.batch(ids.map((id, index) =>
        statement('UPDATE perfume_images SET position = ? WHERE perfume_id = ? AND image_id = ?', [(index + 1) * 10, perfumeId, id])));
    },
  };
}
