import { html } from '../../lib/html.js';
import { centsToInput, formatMoney } from '../../lib/format.js';
import { mediaUrl } from '../../lib/media.js';
import { AUDIENCE_LABELS, CONCENTRATION_LABELS, FAMILY_LABELS } from '../../lib/perfume-labels.js';
import { layout } from '../layout.js';
import {
  actionButton, checkbox, csrfField, emptyState, errorSummary, input, perfumePill, select, textarea,
} from '../components.js';

const INTENSITY_LABELS = [[1, '1 · Skin scent'], [2, '2 · Discreet'], [3, '3 · Noticeable'], [4, '4 · Generous'], [5, '5 · Bold']];
const MOMENT_LABELS = [['any', 'Day and evening'], ['day', 'Day'], ['night', 'Evening']];
const AVAILABILITY_LABELS = [
  ['in_stock', 'In stock'], ['low_stock', 'Only a few left'], ['preorder', 'On order (delay confirmed on WhatsApp)'],
  ['sold_out', 'Sold out (visible, cannot be ordered)'],
];

export function perfumesListPage({ ctx, perfumes, categories, filters, currency }) {
  const csrf = ctx.admin.csrf_token;
  return layout({
    ctx, title: 'Perfumes', active: 'perfumes',
    actions: html`<a class="button" href="/admin/perfumes/new">Add a perfume</a>`,
    body: html`
      <form class="search" method="get" action="/admin/perfumes" role="search">
        <label class="visually-hidden" for="perfume-search">Search perfumes</label>
        <input id="perfume-search" name="q" type="search" value="${filters.q}" placeholder="Search by name, house or note">
        <select name="status" aria-label="Status">
          ${[['', 'Live and drafts'], ['published', 'Live'], ['draft', 'Drafts'], ['archived', 'Archived']].map(([value, label]) =>
            html`<option value="${value}" ${filters.status === value ? 'selected' : ''}>${label}</option>`)}
        </select>
        <select name="category" aria-label="Category">
          <option value="">All categories</option>
          ${categories.map((c) => html`<option value="${c.id}" ${String(filters.categoryId) === String(c.id) ? 'selected' : ''}>${c.name}</option>`)}
        </select>
        <button class="button secondary" type="submit">Filter</button>
      </form>
      ${perfumes.length ? html`<form method="post" action="/admin/perfumes/bulk" data-bulk>
        ${csrfField(csrf)}
        <div class="bulk-bar">
          <label><input type="checkbox" data-select-all> Select all</label>
          <select name="action" aria-label="Action for selected perfumes">
            <option value="publish">Put live</option>
            <option value="draft">Move to drafts</option>
            <option value="archive">Archive</option>
          </select>
          <button class="button secondary" type="submit">Apply to selected</button>
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th class="check"><span class="visually-hidden">Select</span></th><th>Perfume</th><th>Category</th><th class="num">Price</th><th>Status</th><th>Order</th></tr></thead>
          <tbody>${perfumes.map((perfume) => html`<tr>
            <td class="check"><input type="checkbox" name="ids" value="${perfume.id}" aria-label="Select ${perfume.name}"></td>
            <td class="perfume-cell">
              ${perfume.thumb_key ? html`<img src="${mediaUrl({ file_key: perfume.thumb_key, base_url: perfume.thumb_base }, 480)}" alt="" width="48" height="48" loading="lazy">` : html`<span class="no-thumb"></span>`}
              <a href="/admin/perfumes/${perfume.id}"><b>${perfume.name}</b></a>
              ${perfume.house ? html`<span class="muted">${perfume.house}</span>` : ''}
              ${perfume.badge ? html`<span class="tag">${perfume.badge}</span>` : ''}
              ${perfume.availability === 'sold_out' ? html`<span class="tag">Sold out</span>` : ''}
              ${perfume.availability === 'low_stock' ? html`<span class="tag">Low stock</span>` : ''}
            </td>
            <td>${perfume.category_name}</td>
            <td class="num">${priceCell(perfume, currency)}</td>
            <td>${perfumePill(perfume.status)}</td>
            <td class="move">
              <button class="icon-button" type="submit" formaction="/admin/perfumes/${perfume.id}/move?direction=up" aria-label="Move ${perfume.name} up">↑</button>
              <button class="icon-button" type="submit" formaction="/admin/perfumes/${perfume.id}/move?direction=down" aria-label="Move ${perfume.name} down">↓</button>
            </td></tr>`)}
          </tbody></table></div>
        <p class="help">The order here is the order in the shop's "Featured" view.</p>
      </form>` : emptyState('No perfumes match this filter.', html`<a class="button" href="/admin/perfumes/new">Add a perfume</a>`)}`,
  });
}

function priceCell(perfume, currency) {
  const cents = perfume.from_price_cents ?? perfume.price_cents;
  if (cents === null) return html`<span class="muted">On request</span>`;
  return perfume.from_price_cents !== null ? html`<span class="muted">from</span> ${formatMoney(cents, currency)}` : formatMoney(cents, currency);
}

function sizesText(sizes) {
  return sizes.map((size) => (size.price_cents === null ? size.label : `${size.label}, ${centsToInput(size.price_cents)}`)).join('\n');
}

const labelsOf = (labels) => Object.entries(labels);

function perfumeFields({ perfume, categories, collections, errors, isNew }) {
  return html`
    ${errorSummary(errors)}
    <div class="form-grid">
      <fieldset class="panel">
        <legend>Shown in the shop</legend>
        ${input({ name: 'name', label: 'Name', value: perfume.name, required: true, max: 80, error: errors.name })}
        ${input({ name: 'house', label: 'House', value: perfume.house, max: 40, optional: true, error: errors.house,
          help: 'The brand on the bottle. Leave empty for the shop\'s own name.' })}
        ${input({ name: 'tagline', label: 'Tagline', value: perfume.tagline, max: 120, optional: true, error: errors.tagline,
          help: 'One evocative line under the name, like "Un ambre qui brûle doucement".' })}
        ${textarea({ name: 'description', label: 'Description', value: perfume.description, max: 1200, rows: 5, optional: true, error: errors.description })}
        ${input({ name: 'badge', label: 'Badge', value: perfume.badge, max: 24, optional: true,
          help: 'Small label on the card, like "Best-seller".', error: errors.badge })}
        ${checkbox({ name: 'is_new', label: 'Show in "Nouveautés"', checked: perfume.is_new })}
      </fieldset>
      <fieldset class="panel">
        <legend>Sizes and prices</legend>
        ${textarea({ name: 'sizes', label: 'Sizes', value: sizesText(perfume.sizes), rows: 4, optional: true, error: errors.sizes,
          help: 'One per line: name, then price after a comma. For example: 50 ml, 45000' })}
        ${input({ name: 'price', label: 'Price', value: centsToInput(perfume.price_cents), optional: true, error: errors.price,
          help: 'Used when there are no sizes, or for a size without a price. Empty shows "Prix sur demande".', attrs: html`inputmode="decimal"` })}
        ${input({ name: 'compare_at', label: 'Former price', value: centsToInput(perfume.compare_at_cents), optional: true, error: errors.compare_at,
          help: 'Shown crossed out next to the price during a promotion.', attrs: html`inputmode="decimal"` })}
        ${select({ name: 'availability', label: 'Stock', value: perfume.availability, options: AVAILABILITY_LABELS })}
      </fieldset>
      <fieldset class="panel">
        <legend>The scent</legend>
        ${select({ name: 'family', label: 'Olfactive family', value: perfume.family, options: labelsOf(FAMILY_LABELS) })}
        ${input({ name: 'notes_top', label: 'Top notes', value: perfume.notes_top, max: 300, optional: true, error: errors.notes_top,
          help: 'Separated by commas: Bergamote, Safran' })}
        ${input({ name: 'notes_heart', label: 'Heart notes', value: perfume.notes_heart, max: 300, optional: true, error: errors.notes_heart })}
        ${input({ name: 'notes_base', label: 'Base notes', value: perfume.notes_base, max: 300, optional: true, error: errors.notes_base })}
        ${select({ name: 'intensity', label: 'Sillage', value: perfume.intensity, options: INTENSITY_LABELS })}
        ${select({ name: 'moment', label: 'Best worn', value: perfume.moment, options: MOMENT_LABELS })}
        ${select({ name: 'audience', label: 'For', value: perfume.audience, options: labelsOf(AUDIENCE_LABELS) })}
        ${select({ name: 'concentration', label: 'Concentration', value: perfume.concentration, options: labelsOf(CONCENTRATION_LABELS) })}
        ${input({ name: 'hue', label: 'Bottle colour (0–360)', value: String(perfume.hue), type: 'number', required: true, error: errors.hue,
          help: 'Colour of the juice in the drawn bottle, shown until you upload a photo. 20–40 amber, 340 rose, 190 blue, 100 green.',
          attrs: html`min="0" max="360" step="1"` })}
      </fieldset>
      <fieldset class="panel">
        <legend>Organisation</legend>
        ${select({ name: 'status', label: 'Status', value: perfume.status,
          options: [['draft', 'Draft (hidden)'], ['published', 'Live in the shop'], ['archived', 'Archived']] })}
        ${select({ name: 'category_id', label: 'Category', value: perfume.category_id, error: errors.category_id,
          options: categories.map((c) => [c.id, c.name]) })}
        ${collections.length ? html`<div class="field"><span class="label">Collections</span>
          ${collections.map((c) => html`<label class="check-line"><input type="checkbox" name="collection_ids" value="${c.id}"
            ${perfume.collectionIds.includes(c.id) ? 'checked' : ''}> ${c.name}</label>`)}</div>` : ''}
        ${input({ name: 'instagram_url', label: 'Instagram post', value: perfume.instagram_url, optional: true, error: errors.instagram_url,
          placeholder: 'https://www.instagram.com/p/…' })}
      </fieldset>
    </div>
    <div class="form-actions">
      <button class="button" type="submit">${isNew ? 'Create perfume' : 'Save changes'}</button>
      <a href="/admin/perfumes">Cancel</a>
      <span class="help">Tip: Ctrl + S (or ⌘ + S) saves.</span>
    </div>`;
}

function photoManager({ perfume, csrf }) {
  return html`<section class="panel photos">
    <h2>Photos</h2>
    <p class="help">A <b>cut-out</b> (bottle on a transparent background) is shown standing on a plain backdrop.
      Photos fill the card and the product view. Without any, the shop draws a bottle in the colour set above.</p>
    ${perfume.images.length ? html`<ul class="photo-grid">${perfume.images.map((image) => html`<li>
      <img src="${mediaUrl(image, 480)}" alt="" loading="lazy" class="${image.role === 'cutout' ? 'on-plaster' : ''}">
      <form method="post" action="/admin/perfumes/${perfume.id}/images/${image.image_id}" class="stack">
        ${csrfField(csrf)}
        <label class="visually-hidden" for="role-${image.image_id}">Type</label>
        <select id="role-${image.image_id}" name="role">
          <option value="cutout" ${image.role === 'cutout' ? 'selected' : ''}>Cut-out</option>
          <option value="photo" ${image.role === 'photo' ? 'selected' : ''}>Photo</option>
        </select>
        <label class="visually-hidden" for="alt-${image.image_id}">Description for screen readers</label>
        <input id="alt-${image.image_id}" name="alt" value="${image.alt}" maxlength="120" placeholder="Describe the photo">
        <button class="button secondary small" type="submit">Save</button>
      </form>
      <div class="photo-actions">
        ${actionButton({ action: `/admin/perfumes/${perfume.id}/images/${image.image_id}/move`, csrf, label: '←', hidden: { direction: 'up' }, className: 'icon-button' })}
        ${actionButton({ action: `/admin/perfumes/${perfume.id}/images/${image.image_id}/move`, csrf, label: '→', hidden: { direction: 'down' }, className: 'icon-button' })}
        ${actionButton({ action: `/admin/perfumes/${perfume.id}/images/${image.image_id}/delete`, csrf, label: 'Remove', className: 'link-button danger', confirm: 'Remove this photo from the perfume?' })}
      </div></li>`)}</ul>` : html`<p class="muted">No photos yet.</p>`}
    <form method="post" action="/admin/perfumes/${perfume.id}/images" enctype="multipart/form-data" class="upload" data-upload>
      ${csrfField(csrf)}
      <label for="f-photos" class="label">Add photos</label>
      <input id="f-photos" name="photos" type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple required>
      <p class="help">JPEG, PNG or WebP. Large photos are resized before upload. PNGs with a transparent background become cut-outs automatically.</p>
      <button class="button secondary" type="submit">Upload</button>
      <p class="help" data-upload-status role="status"></p>
    </form>
  </section>`;
}

export function perfumeFormPage({ ctx, perfume, categories, collections, errors = {}, isNew }) {
  const csrf = ctx.admin.csrf_token;
  const action = isNew ? '/admin/perfumes' : `/admin/perfumes/${perfume.id}`;
  return layout({
    ctx, title: isNew ? 'Add a perfume' : perfume.name, active: 'perfumes',
    actions: isNew ? '' : html`
      ${perfume.status === 'published' ? html`<a class="button secondary" href="/parfum/${perfume.slug}" target="_blank" rel="noopener">See in shop</a>` : ''}
      ${actionButton({ action: `/admin/perfumes/${perfume.id}/duplicate`, csrf, label: 'Duplicate', className: 'button secondary' })}
      ${actionButton({ action: `/admin/perfumes/${perfume.id}/delete`, csrf, label: 'Delete', className: 'button danger',
        confirm: `Delete "${perfume.name}"? Perfumes that were ordered before are archived instead.` })}`,
    body: html`
      <form method="post" action="${action}" data-dirty-check data-hotkey-save>
        ${csrfField(csrf)}
        ${perfumeFields({ perfume, categories, collections, errors, isNew })}
      </form>
      ${isNew ? html`<p class="help">You can add photos after creating the perfume.</p>` : photoManager({ perfume, csrf })}`,
  });
}
