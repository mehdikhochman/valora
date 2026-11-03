// Categories, collections and guide entries.
import { FormReader, slugify } from '../../lib/form.js';
import { notFound } from '../../lib/http-error.js';
import { categoriesPage, collectionsPage, guidePage } from '../../admin-ui/views/catalogue.js';
import { pageContext, parseDirection, parseId, recordChange, redirect, sendPage } from './helpers.js';

async function loadOr404(repository, id, what) {
  const row = await repository.get(parseId(id));
  if (!row) throw notFound(what);
  return row;
}

async function uniqueSlug(repository, name, exceptId) {
  const base = slugify(name);
  let slug = base;
  for (let n = 2; await repository.isSlugTaken(slug, exceptId); n += 1) slug = `${base}-${n}`;
  return slug;
}

function categoryRoutes(app) {
  const { categories } = app.repos;
  const page = async (request, reply, extra = {}, statusCode = 200) =>
    sendPage(reply, categoriesPage({ ctx: await pageContext(app, request), categories: await categories.list(), ...extra }), statusCode);

  app.get('/categories', async (request, reply) => page(request, reply));

  app.post('/categories', async (request, reply) => {
    const form = new FormReader(request.body);
    const name = form.text('name', { label: 'Name', required: true, max: 40 });
    if (form.hasErrors) return page(request, reply, { errors: form.errors, values: form.body }, 400);
    await categories.create({ name, slug: await uniqueSlug(categories, name, 0) });
    await recordChange(app, request, 'category.create', `added the category "${name}"`);
    return redirect(reply, '/admin/categories', 'created');
  });

  app.post('/categories/:id', async (request, reply) => {
    const category = await loadOr404(categories, request.params.id, 'Category');
    const form = new FormReader(request.body);
    const name = form.text('name', { label: 'Name', required: true, max: 40 });
    if (form.hasErrors) return page(request, reply, { errors: form.errors }, 400);
    await categories.update(category.id, { name, slug: await uniqueSlug(categories, name, category.id) });
    await recordChange(app, request, 'category.update', `renamed the category "${category.name}" to "${name}"`);
    return redirect(reply, '/admin/categories', 'saved');
  });

  app.post('/categories/:id/move', async (request, reply) => {
    const category = await loadOr404(categories, request.params.id, 'Category');
    await categories.move(category.id, parseDirection(request.body.direction));
    await recordChange(app, request, 'category.move', `moved the category "${category.name}"`);
    return redirect(reply, '/admin/categories', 'moved');
  });

  app.post('/categories/:id/delete', async (request, reply) => {
    const category = await loadOr404(categories, request.params.id, 'Category');
    if (await categories.perfumeCount(category.id) > 0) return redirect(reply, '/admin/categories', 'in-use');
    await categories.remove(category.id);
    await recordChange(app, request, 'category.delete', `deleted the category "${category.name}"`);
    return redirect(reply, '/admin/categories', 'deleted');
  });
}

function collectionRoutes(app) {
  const { collections } = app.repos;
  const page = async (request, reply, extra = {}, statusCode = 200) =>
    sendPage(reply, collectionsPage({ ctx: await pageContext(app, request), collections: await collections.list(), ...extra }), statusCode);

  function read(body) {
    const form = new FormReader(body);
    const values = {
      name: form.text('name', { label: 'Name', required: true, max: 40 }),
      description: form.text('description', { label: 'Description', max: 200 }) ?? '',
      isVisible: form.checkbox('is_visible'),
    };
    return { form, values };
  }

  app.get('/collections', async (request, reply) => page(request, reply));

  app.post('/collections', async (request, reply) => {
    const { form, values } = read(request.body);
    if (form.hasErrors) return page(request, reply, { errors: form.errors, values: form.body }, 400);
    await collections.create({ ...values, isVisible: true, slug: await uniqueSlug(collections, values.name, 0) });
    await recordChange(app, request, 'collection.create', `added the collection "${values.name}"`);
    return redirect(reply, '/admin/collections', 'created');
  });

  app.post('/collections/:id', async (request, reply) => {
    const collection = await loadOr404(collections, request.params.id, 'Collection');
    const { form, values } = read(request.body);
    if (form.hasErrors) return page(request, reply, { errors: form.errors }, 400);
    await collections.update(collection.id, { ...values, slug: await uniqueSlug(collections, values.name, collection.id) });
    await recordChange(app, request, 'collection.update', `edited the collection "${values.name}"`);
    return redirect(reply, '/admin/collections', 'saved');
  });

  app.post('/collections/:id/move', async (request, reply) => {
    const collection = await loadOr404(collections, request.params.id, 'Collection');
    await collections.move(collection.id, parseDirection(request.body.direction));
    await recordChange(app, request, 'collection.move', `moved the collection "${collection.name}"`);
    return redirect(reply, '/admin/collections', 'moved');
  });

  app.post('/collections/:id/delete', async (request, reply) => {
    const collection = await loadOr404(collections, request.params.id, 'Collection');
    await collections.remove(collection.id);
    await recordChange(app, request, 'collection.delete', `deleted the collection "${collection.name}"`);
    return redirect(reply, '/admin/collections', 'deleted');
  });
}

function guideRoutes(app) {
  const { guide } = app.repos;
  const page = async (request, reply, extra = {}, statusCode = 200) =>
    sendPage(reply, guidePage({ ctx: await pageContext(app, request), entries: await guide.list(), ...extra }), statusCode);

  function read(body) {
    const form = new FormReader(body);
    const values = {
      question: form.text('question', { label: 'Question', required: true, max: 140 }),
      answer: form.text('answer', { label: 'Answer', required: true, max: 1500 }),
      isVisible: form.checkbox('is_visible'),
    };
    return { form, values };
  }

  app.get('/guide', async (request, reply) => page(request, reply));

  app.post('/guide', async (request, reply) => {
    const { form, values } = read(request.body);
    if (form.hasErrors) return page(request, reply, { errors: form.errors, values: form.body }, 400);
    await guide.create({ ...values, isVisible: true });
    await recordChange(app, request, 'guide.create', `added the question "${values.question}"`);
    return redirect(reply, '/admin/guide', 'created');
  });

  app.post('/guide/:id', async (request, reply) => {
    const entry = await loadOr404(guide, request.params.id, 'Question');
    const { form, values } = read(request.body);
    if (form.hasErrors) return page(request, reply, { errors: form.errors }, 400);
    await guide.update(entry.id, values);
    await recordChange(app, request, 'guide.update', `edited the question "${values.question}"`);
    return redirect(reply, '/admin/guide', 'saved');
  });

  app.post('/guide/:id/move', async (request, reply) => {
    const entry = await loadOr404(guide, request.params.id, 'Question');
    await guide.move(entry.id, parseDirection(request.body.direction));
    await recordChange(app, request, 'guide.move', 'reordered the guide');
    return redirect(reply, '/admin/guide', 'moved');
  });

  app.post('/guide/:id/delete', async (request, reply) => {
    const entry = await loadOr404(guide, request.params.id, 'Question');
    await guide.remove(entry.id);
    await recordChange(app, request, 'guide.delete', `deleted the question "${entry.question}"`);
    return redirect(reply, '/admin/guide', 'deleted');
  });
}

export async function catalogueRoutes(app) {
  categoryRoutes(app);
  collectionRoutes(app);
  guideRoutes(app);
}
