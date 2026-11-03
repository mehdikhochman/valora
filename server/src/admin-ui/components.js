// Small building blocks for admin pages. Each returns escaped HTML (see lib/html.js).
import { html } from '../lib/html.js';
import { ORDER_STATUS_LABELS } from '../repositories/orders.js';

export const NOTICES = {
  saved: 'Changes saved.',
  created: 'Created.',
  deleted: 'Deleted.',
  archived: 'This perfume appears in past orders, so it was archived instead of deleted.',
  uploaded: 'Photos uploaded.',
  moved: 'Order updated.',
  password: 'Password changed.',
  sessions: 'You are now logged out everywhere else.',
  bulk: 'Selected perfumes updated.',
  'in-use': 'This category still has perfumes. Move them to another category first.',
};

export function notice(key) {
  const message = NOTICES[key];
  return message ? html`<p class="notice" role="status" data-autohide>${message}</p>` : '';
}

export function csrfField(csrf) {
  return html`<input type="hidden" name="_csrf" value="${csrf}">`;
}

function describedBy(name, help, error) {
  return [help && `${name}-help`, error && `${name}-error`].filter(Boolean).join(' ') || false;
}

function fieldShell({ name, label, help, error, optional }, control) {
  return html`<div class="field${error ? ' has-error' : ''}">
    <label for="f-${name}">${label}${optional ? html` <span class="optional">(optional)</span>` : ''}</label>
    ${control}
    ${help ? html`<p class="help" id="${name}-help">${help}</p>` : ''}
    ${error ? html`<p class="error" id="${name}-error">${error}</p>` : ''}
  </div>`;
}

export function input({ name, label, value = '', type = 'text', help, error, required, max, optional, placeholder, attrs = '' }) {
  const ids = describedBy(name, help, error);
  return fieldShell({ name, label, help, error, optional }, html`<input id="f-${name}" name="${name}" type="${type}"
    value="${value ?? ''}" ${required ? 'required' : ''} ${max ? html`maxlength="${max}"` : ''}
    ${placeholder ? html`placeholder="${placeholder}"` : ''} ${ids ? html`aria-describedby="${ids}"` : ''}
    ${error ? 'aria-invalid="true"' : ''} ${attrs}>`);
}

export function textarea({ name, label, value = '', help, error, required, max, rows = 4, optional }) {
  const ids = describedBy(name, help, error);
  return fieldShell({ name, label, help, error, optional }, html`<textarea id="f-${name}" name="${name}" rows="${rows}"
    ${required ? 'required' : ''} ${max ? html`maxlength="${max}"` : ''}
    ${ids ? html`aria-describedby="${ids}"` : ''} ${error ? 'aria-invalid="true"' : ''}>${value ?? ''}</textarea>`);
}

export function select({ name, label, value, options, help, error }) {
  return fieldShell({ name, label, help, error }, html`<select id="f-${name}" name="${name}">
    ${options.map(([optionValue, optionLabel]) =>
      html`<option value="${optionValue}" ${String(optionValue) === String(value) ? 'selected' : ''}>${optionLabel}</option>`)}
  </select>`);
}

export function checkbox({ name, label, checked, help }) {
  return html`<div class="field check-field">
    <label><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}> ${label}</label>
    ${help ? html`<p class="help">${help}</p>` : ''}
  </div>`;
}

export function errorSummary(errors) {
  const entries = Object.entries(errors ?? {});
  if (!entries.length) return '';
  return html`<div class="error-summary" role="alert" tabindex="-1" data-focus>
    <p>Please fix ${entries.length === 1 ? 'this' : 'these'} before saving:</p>
    <ul>${entries.map(([name, message]) => html`<li><a href="#f-${name}">${message}</a></li>`)}</ul>
  </div>`;
}

export function statusPill(status) {
  return html`<span class="pill pill-${status}">${ORDER_STATUS_LABELS[status] ?? status}</span>`;
}

export function perfumePill(status) {
  const labels = { draft: 'Draft', published: 'Live', archived: 'Archived' };
  return html`<span class="pill pill-${status}">${labels[status]}</span>`;
}

// A POST button that lives outside other forms (move, delete, toggle).
export function actionButton({ action, csrf, label, confirm, className = 'link-button', hidden = {} }) {
  return html`<form method="post" action="${action}" class="inline-form" ${confirm ? html`data-confirm="${confirm}"` : ''}>
    ${csrfField(csrf)}
    ${Object.entries(hidden).map(([key, value]) => html`<input type="hidden" name="${key}" value="${value}">`)}
    <button type="submit" class="${className}">${label}</button>
  </form>`;
}

export function moveButtons({ baseAction, csrf, label }) {
  return html`<span class="move">
    ${actionButton({ action: `${baseAction}/move`, csrf, label: '↑', hidden: { direction: 'up' }, className: 'icon-button' })}
    ${actionButton({ action: `${baseAction}/move`, csrf, label: '↓', hidden: { direction: 'down' }, className: 'icon-button' })}
    <span class="visually-hidden">Move ${label}</span>
  </span>`;
}

export function pagination({ page, pageCount, buildUrl }) {
  if (pageCount <= 1) return '';
  return html`<nav class="pagination" aria-label="Pages">
    ${page > 1 ? html`<a href="${buildUrl(page - 1)}">Previous</a>` : ''}
    <span>Page ${page} of ${pageCount}</span>
    ${page < pageCount ? html`<a href="${buildUrl(page + 1)}">Next</a>` : ''}
  </nav>`;
}

export function emptyState(message, action) {
  return html`<div class="empty"><p>${message}</p>${action ?? ''}</div>`;
}
