// Categories, collections and guide: simple ordered lists edited in place.
import { html } from '../../lib/html.js';
import { layout } from '../layout.js';
import { actionButton, csrfField, errorSummary, moveButtons } from '../components.js';

export function categoriesPage({ ctx, categories, errors = {}, values = {} }) {
  const csrf = ctx.admin.csrf_token;
  return layout({
    ctx, title: 'Categories', active: 'categories',
    body: html`
      <p class="help">Categories build the shop's menu and filters. Only categories with live perfumes are shown to customers.</p>
      ${errorSummary(errors)}
      <ul class="rows">${categories.map((category) => html`<li>
        <form method="post" action="/admin/categories/${category.id}" class="row-form">
          ${csrfField(csrf)}
          <label class="visually-hidden" for="cat-${category.id}">Name</label>
          <input id="cat-${category.id}" name="name" value="${category.name}" required maxlength="40">
          <span class="muted">${category.perfume_count} ${category.perfume_count === 1 ? 'perfume' : 'perfumes'}</span>
          <button class="button secondary small" type="submit">Rename</button>
        </form>
        ${moveButtons({ baseAction: `/admin/categories/${category.id}`, csrf, label: category.name })}
        ${actionButton({ action: `/admin/categories/${category.id}/delete`, csrf, label: 'Delete', className: 'link-button danger',
          confirm: `Delete the category "${category.name}"?` })}
      </li>`)}</ul>
      <form method="post" action="/admin/categories" class="panel row-form">
        ${csrfField(csrf)}
        <label for="f-name">New category</label>
        <input id="f-name" name="name" value="${values.name ?? ''}" required maxlength="40" placeholder="For example Anklets">
        <button class="button" type="submit">Add</button>
      </form>`,
  });
}

export function collectionsPage({ ctx, collections, errors = {}, values = {} }) {
  const csrf = ctx.admin.csrf_token;
  return layout({
    ctx, title: 'Collections', active: 'collections',
    body: html`
      <p class="help">Collections group perfumes by drop or season, like "Summer 2025". Customers can filter by them. Assign perfumes on each perfume's page.</p>
      ${errorSummary(errors)}
      <ul class="rows">${collections.map((collection) => html`<li>
        <form method="post" action="/admin/collections/${collection.id}" class="row-form wide">
          ${csrfField(csrf)}
          <label class="visually-hidden" for="col-${collection.id}">Name</label>
          <input id="col-${collection.id}" name="name" value="${collection.name}" required maxlength="40">
          <label class="visually-hidden" for="col-d-${collection.id}">Description</label>
          <input id="col-d-${collection.id}" name="description" value="${collection.description}" maxlength="200" placeholder="Short description (optional)">
          <label class="check-line"><input type="checkbox" name="is_visible" ${collection.is_visible ? 'checked' : ''}> Visible</label>
          <span class="muted">${collection.perfume_count} perfumes</span>
          <button class="button secondary small" type="submit">Save</button>
        </form>
        ${moveButtons({ baseAction: `/admin/collections/${collection.id}`, csrf, label: collection.name })}
        ${actionButton({ action: `/admin/collections/${collection.id}/delete`, csrf, label: 'Delete', className: 'link-button danger',
          confirm: `Delete "${collection.name}"? The perfumes stay in the shop.` })}
      </li>`)}</ul>
      <form method="post" action="/admin/collections" class="panel row-form">
        ${csrfField(csrf)}
        <label for="f-name">New collection</label>
        <input id="f-name" name="name" value="${values.name ?? ''}" required maxlength="40" placeholder="For example Winter 2025">
        <button class="button" type="submit">Add</button>
      </form>`,
  });
}

export function guidePage({ ctx, entries, errors = {}, values = {} }) {
  const csrf = ctx.admin.csrf_token;
  return layout({
    ctx, title: 'Guide', active: 'guide',
    body: html`
      <p class="help">Questions and answers shown in the Guide section of the shop (care, sizing, returns). Separate paragraphs with a new line.</p>
      ${errorSummary(errors)}
      <ul class="rows stacked">${entries.map((entry) => html`<li class="${entry.is_visible ? '' : 'is-hidden'}">
        <form method="post" action="/admin/guide/${entry.id}" class="stack">
          ${csrfField(csrf)}
          <label for="q-${entry.id}">Question</label>
          <input id="q-${entry.id}" name="question" value="${entry.question}" required maxlength="140">
          <label for="a-${entry.id}">Answer</label>
          <textarea id="a-${entry.id}" name="answer" rows="4" required maxlength="1500">${entry.answer}</textarea>
          <label class="check-line"><input type="checkbox" name="is_visible" ${entry.is_visible ? 'checked' : ''}> Visible</label>
          <button class="button secondary small" type="submit">Save</button>
        </form>
        <div class="row-actions">
          ${moveButtons({ baseAction: `/admin/guide/${entry.id}`, csrf, label: entry.question })}
          ${actionButton({ action: `/admin/guide/${entry.id}/delete`, csrf, label: 'Delete', className: 'link-button danger', confirm: 'Delete this question?' })}
        </div></li>`)}</ul>
      <form method="post" action="/admin/guide" class="panel stack">
        ${csrfField(csrf)}
        <h2>Add a question</h2>
        <label for="f-question">Question</label>
        <input id="f-question" name="question" value="${values.question ?? ''}" required maxlength="140">
        <label for="f-answer">Answer</label>
        <textarea id="f-answer" name="answer" rows="4" required maxlength="1500">${values.answer ?? ''}</textarea>
        <button class="button" type="submit">Add question</button>
      </form>`,
  });
}
