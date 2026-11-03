import { html } from '../../lib/html.js';
import { centsToInput } from '../../lib/format.js';
import { SETTINGS_FIELDS } from '../../repositories/settings-fields.js';
import { layout } from '../layout.js';
import { checkbox, csrfField, errorSummary, input, select, textarea } from '../components.js';

function renderField(field, value, error) {
  const common = { name: field.key, label: field.label, help: field.help, error };
  switch (field.type) {
    case 'textarea': return textarea({ ...common, value, max: field.max, rows: field.max > 500 ? 6 : 3 });
    case 'checkbox': return checkbox({ name: field.key, label: field.label, checked: value === '1', help: field.help });
    case 'select': return select({ ...common, value, options: field.options.map((option) => [option, option]) });
    case 'money': return input({ ...common, value: centsToInput(value), attrs: html`inputmode="decimal"` });
    case 'phone': return input({ ...common, value, attrs: html`inputmode="numeric"` });
    default: return input({ ...common, value, max: field.max });
  }
}

export function settingsPage({ ctx, values, errors = {} }) {
  const groups = [...new Set(SETTINGS_FIELDS.map((field) => field.group))];
  return layout({
    ctx, title: 'Settings', active: 'settings',
    body: html`<form method="post" action="/admin/settings" data-dirty-check data-hotkey-save>
      ${csrfField(ctx.admin.csrf_token)}
      ${errorSummary(errors)}
      ${groups.map((group) => html`<fieldset class="panel">
        <legend>${group}</legend>
        ${SETTINGS_FIELDS.filter((field) => field.group === group).map((field) => renderField(field, values[field.key], errors[field.key]))}
      </fieldset>`)}
      <div class="form-actions"><button class="button" type="submit">Save settings</button></div>
    </form>`,
  });
}
