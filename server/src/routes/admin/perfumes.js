// Creating and editing perfumes, their photos and their order in the shop.
import { FormReader, parseMoney } from '../../lib/form.js';
import { notFound } from '../../lib/http-error.js';
import {
  AUDIENCES, AVAILABILITIES, CONCENTRATIONS, FAMILIES, MOMENTS, STATUSES,
} from '../../repositories/perfumes.js';
import { perfumeFormPage, perfumesListPage } from '../../admin-ui/views/perfumes.js';
import {
  deleteImageIfUnused, pageContext, parseDirection, parseId, recordChange, redirect, sendPage, storeImage, uploadedFiles,
} from './helpers.js';

const MAX_SIZES = 8;
const INSTAGRAM_URL = /^https:\/\/(www\.)?instagram\.com\/[\w\-./?=&%]+$/;
const BULK_ACTIONS = { publish: 'published', draft: 'draft', archive: 'archived' };

const EMPTY_PERFUME = {
  name: '', house: '', tagline: '', description: '', price_cents: null, compare_at_cents: null, badge: '', is_new: 0,
  status: 'draft', availability: 'in_stock', category_id: null, audience: 'unisex', family: 'amber', concentration: 'edp',
  intensity: 3, moment: 'any', notes_top: '', notes_heart: '', notes_base: '', hue: 24, instagram_url: '',
  sizes: [], collectionIds: [], images: [],
};

// "50 ml, 45000" per line -> [{ label: '50 ml', priceCents: 4500000 }]. A size without a price
// uses the perfume's price.
function readSizes(form) {
  const lines = String(form.raw('sizes') ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length > MAX_SIZES) return form.fail('sizes', `Use at most ${MAX_SIZES} sizes.`) ?? [];
  const sizes = [];
  for (const line of lines) {
    const comma = line.indexOf(',');
    const label = (comma === -1 ? line : line.slice(0, comma)).trim();
    const priceCents = comma === -1 ? null : parseMoney(line.slice(comma + 1));
    if (!label || label.length > 40) return form.fail('sizes', 'Each size needs a name of up to 40 characters.') ?? [];
    if (priceCents === undefined) return form.fail('sizes', `The price of "${label}" is not a number.`) ?? [];
    if (sizes.some((size) => size.label === label)) return form.fail('sizes', `"${label}" is listed twice.`) ?? [];
    sizes.push({ label, priceCents });
  }
  return sizes;
}

const notes = (form, field, label) => form.text(field, { label, max: 300 });

async function readPerfumeForm(body, repos) {
  const form = new FormReader(body);
  const perfume = {
    name: form.text('name', { label: 'Name', required: true, max: 80 }),
    house: form.text('house', { label: 'House', max: 40 }),
    tagline: form.text('tagline', { label: 'Tagline', max: 120 }),
    description: form.text('description', { label: 'Description', max: 1200 }),
    priceCents: form.money('price', { label: 'Price' }),
    compareAtCents: form.money('compare_at', { label: 'Former price' }),
    badge: form.text('badge', { label: 'Badge', max: 24 }),
    isNew: form.checkbox('is_new'),
    status: form.oneOf('status', STATUSES, { label: 'Status' }),
    availability: form.oneOf('availability', AVAILABILITIES, { label: 'Availability' }),
    categoryId: form.integer('category_id', { label: 'Category', required: true, min: 1 }),
    audience: form.oneOf('audience', AUDIENCES, { label: 'For' }),
    family: form.oneOf('family', FAMILIES, { label: 'Family' }),
    concentration: form.oneOf('concentration', CONCENTRATIONS, { label: 'Concentration' }),
    intensity: form.integer('intensity', { label: 'Sillage', required: true, min: 1, max: 5 }),
    moment: form.oneOf('moment', MOMENTS, { label: 'Moment' }),
    notesTop: notes(form, 'notes_top', 'Top notes'),
    notesHeart: notes(form, 'notes_heart', 'Heart notes'),
    notesBase: notes(form, 'notes_base', 'Base notes'),
    hue: form.integer('hue', { label: 'Bottle colour', required: true, min: 0, max: 360 }),
    instagramUrl: form.text('instagram_url', {
      label: 'Instagram post', max: 200, pattern: INSTAGRAM_URL, patternMessage: 'Paste a link that starts with https://www.instagram.com/',
    }),
    sizes: readSizes(form),
    collectionIds: form.idList('collection_ids'),
  };
  if (perfume.categoryId && !(await repos.categories.get(perfume.categoryId))) form.fail('category_id', 'Choose a category.');
  return { perfume, form };
}

// What the form shows again after an error: the values just typed, in the view's shape.
function asView(perfume, existing = EMPTY_PERFUME) {
  return {
    ...existing,
    name: perfume.name ?? '', house: perfume.house ?? '', tagline: perfume.tagline ?? '', description: perfume.description ?? '',
    price_cents: perfume.priceCents, compare_at_cents: perfume.compareAtCents, badge: perfume.badge ?? '', is_new: perfume.isNew,
    status: perfume.status ?? 'draft', availability: perfume.availability ?? 'in_stock', category_id: perfume.categoryId,
    audience: perfume.audience ?? 'unisex', family: perfume.family ?? 'amber', concentration: perfume.concentration ?? 'edp',
    intensity: perfume.intensity ?? 3, moment: perfume.moment ?? 'any', notes_top: perfume.notesTop ?? '',
    notes_heart: perfume.notesHeart ?? '', notes_base: perfume.notesBase ?? '', hue: perfume.hue ?? 24,
    instagram_url: perfume.instagramUrl ?? '',
    sizes: (perfume.sizes ?? []).map((size) => ({ label: size.label, price_cents: size.priceCents })),
    collectionIds: perfume.collectionIds,
  };
}

export async function perfumeRoutes(app) {
  const { perfumes, categories, collections } = app.repos;

  async function formPage(request, reply, { perfume, errors, isNew, statusCode }) {
    return sendPage(reply, perfumeFormPage({
      ctx: await pageContext(app, request), perfume, errors, isNew,
      categories: await categories.list(), collections: await collections.list(),
    }), statusCode);
  }

  async function loadPerfume(id) {
    const perfume = await perfumes.get(parseId(id));
    if (!perfume) throw notFound('Perfume');
    return perfume;
  }

  app.get('/perfumes', async (request, reply) => {
    const filters = {
      q: String(request.query.q ?? '').trim().slice(0, 80),
      status: STATUSES.includes(request.query.status) ? request.query.status : '',
      categoryId: Number(request.query.category) || 0,
    };
    return sendPage(reply, perfumesListPage({
      ctx: await pageContext(app, request), perfumes: await perfumes.list(filters), categories: await categories.list(),
      filters, currency: (await app.repos.settings.getAll()).currency,
    }));
  });

  app.get('/perfumes/new', async (request, reply) =>
    formPage(request, reply, { perfume: { ...EMPTY_PERFUME, category_id: (await categories.list())[0]?.id }, isNew: true }));

  app.post('/perfumes', async (request, reply) => {
    const { perfume, form } = await readPerfumeForm(request.body, app.repos);
    if (form.hasErrors) return formPage(request, reply, { perfume: asView(perfume), errors: form.errors, isNew: true, statusCode: 400 });
    const id = await perfumes.create(perfume);
    await recordChange(app, request, 'perfume.create', `added the perfume "${perfume.name}"`);
    return redirect(reply, `/admin/perfumes/${id}`, 'created');
  });

  app.get('/perfumes/:id', async (request, reply) => formPage(request, reply, { perfume: await loadPerfume(request.params.id) }));

  app.post('/perfumes/:id', async (request, reply) => {
    const existing = await loadPerfume(request.params.id);
    const { perfume, form } = await readPerfumeForm(request.body, app.repos);
    if (form.hasErrors) return formPage(request, reply, { perfume: asView(perfume, existing), errors: form.errors, statusCode: 400 });
    await perfumes.update(existing.id, perfume);
    await recordChange(app, request, 'perfume.update', `edited "${perfume.name}"`);
    return redirect(reply, `/admin/perfumes/${existing.id}`, 'saved');
  });

  app.post('/perfumes/:id/move', async (request, reply) => {
    const perfume = await loadPerfume(request.params.id);
    await perfumes.move(perfume.id, parseDirection(request.body.direction ?? request.query.direction));
    await recordChange(app, request, 'perfume.move', `moved "${perfume.name}" in the shop order`);
    return redirect(reply, '/admin/perfumes', 'moved');
  });

  app.post('/perfumes/:id/duplicate', async (request, reply) => {
    const perfume = await loadPerfume(request.params.id);
    const copyId = await perfumes.duplicate(perfume.id);
    await recordChange(app, request, 'perfume.duplicate', `duplicated "${perfume.name}"`);
    return redirect(reply, `/admin/perfumes/${copyId}`, 'created');
  });

  app.post('/perfumes/:id/delete', async (request, reply) => {
    const perfume = await loadPerfume(request.params.id);
    const result = await perfumes.remove(perfume.id);
    for (const imageId of result.imageIds) await deleteImageIfUnused(app, imageId);
    await recordChange(app, request, 'perfume.delete', `${result.archived ? 'archived' : 'deleted'} "${perfume.name}"`);
    return redirect(reply, '/admin/perfumes', result.archived ? 'archived' : 'deleted');
  });

  app.post('/perfumes/bulk', async (request, reply) => {
    const form = new FormReader(request.body);
    const status = BULK_ACTIONS[form.raw('action')];
    const ids = form.idList('ids');
    if (status && ids.length) {
      await perfumes.setStatus(ids, status);
      await recordChange(app, request, 'perfume.bulk', `set ${ids.length} perfumes to ${status}`);
    }
    return redirect(reply, '/admin/perfumes', 'bulk');
  });

  app.post('/perfumes/:id/images', async (request, reply) => {
    const perfume = await loadPerfume(request.params.id);
    const files = uploadedFiles(request);
    for (const file of files) {
      const image = await storeImage(app, file.value);
      await perfumes.addImage(perfume.id, image.id, image.has_alpha ? 'cutout' : 'photo', perfume.name);
    }
    await recordChange(app, request, 'perfume.photos', `added ${files.length} photo(s) to "${perfume.name}"`);
    return redirect(reply, `/admin/perfumes/${perfume.id}`, 'uploaded');
  });

  app.post('/perfumes/:id/images/:imageId', async (request, reply) => {
    const perfume = await loadPerfume(request.params.id);
    const form = new FormReader(request.body);
    const role = form.oneOf('role', ['cutout', 'photo'], { label: 'Type' }) ?? 'photo';
    await perfumes.updateImage(perfume.id, parseId(request.params.imageId), { role, alt: form.text('alt', { label: 'Description', max: 120 }) ?? '' });
    await recordChange(app, request, 'perfume.photos', `edited a photo of "${perfume.name}"`);
    return redirect(reply, `/admin/perfumes/${perfume.id}`, 'saved');
  });

  app.post('/perfumes/:id/images/:imageId/move', async (request, reply) => {
    const perfume = await loadPerfume(request.params.id);
    await perfumes.moveImage(perfume.id, parseId(request.params.imageId), parseDirection(request.body.direction));
    await recordChange(app, request, 'perfume.photos', `reordered photos of "${perfume.name}"`);
    return redirect(reply, `/admin/perfumes/${perfume.id}`, 'moved');
  });

  app.post('/perfumes/:id/images/:imageId/delete', async (request, reply) => {
    const perfume = await loadPerfume(request.params.id);
    const imageId = parseId(request.params.imageId);
    await perfumes.removeImage(perfume.id, imageId);
    await deleteImageIfUnused(app, imageId);
    await recordChange(app, request, 'perfume.photos', `removed a photo from "${perfume.name}"`);
    return redirect(reply, `/admin/perfumes/${perfume.id}`, 'deleted');
  });

}
