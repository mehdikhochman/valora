// Shop settings (owners only). Each field is validated according to its type in SETTINGS_FIELDS.
import { FormReader } from '../../lib/form.js';
import { SETTINGS_FIELDS } from '../../repositories/settings-fields.js';
import { settingsPage } from '../../admin-ui/views/settings.js';
import { pageContext, recordChange, redirect, sendPage } from './helpers.js';

const OWNER_ONLY = { config: { role: 'owner' } };
const PHONE_DIGITS = /^\d{8,15}$/;
const MONEY_KEYS = SETTINGS_FIELDS.filter((field) => field.type === 'money').map((field) => field.key);

function readField(form, field) {
  switch (field.type) {
    case 'checkbox': return form.checkbox(field.key) ? '1' : '0';
    case 'select': return form.oneOf(field.key, field.options, { label: field.label });
    case 'money': {
      const cents = form.money(field.key, { label: field.label });
      return cents === null ? '' : String(cents);
    }
    case 'phone': return form.text(field.key, {
      label: field.label, max: 15, pattern: PHONE_DIGITS, patternMessage: 'Use digits only, with the country code, for example 96170123456.',
    });
    default: return form.text(field.key, {
      label: field.label, max: field.max ?? 200, pattern: field.pattern ? new RegExp(field.pattern) : undefined,
    });
  }
}

export async function settingsRoutes(app) {
  const { settings } = app.repos;

  app.get('/settings', OWNER_ONLY, async (request, reply) =>
    sendPage(reply, settingsPage({ ctx: await pageContext(app, request), values: await settings.getAll() })));

  app.post('/settings', OWNER_ONLY, async (request, reply) => {
    const form = new FormReader(request.body);
    const values = Object.fromEntries(SETTINGS_FIELDS.map((field) => [field.key, readField(form, field)]));
    if (form.hasErrors) {
      // Money fields are stored as cents; show the saved amount again rather than half-typed text.
      const typed = Object.fromEntries(Object.entries(form.body).filter(([key]) => !MONEY_KEYS.includes(key)));
      return sendPage(reply, settingsPage({ ctx: await pageContext(app, request), values: { ...settings.getAll(), ...typed }, errors: form.errors }), 400);
    }
    await settings.setMany(values);
    await recordChange(app, request, 'settings.update', 'updated the shop settings');
    return redirect(reply, '/admin/settings', 'saved');
  });

  // One-click pause/resume from the dashboard.
  app.post('/settings/orders-open', OWNER_ONLY, async (request, reply) => {
    const open = request.body.open === '1';
    await settings.setMany({ orders_open: open ? '1' : '0' });
    await recordChange(app, request, 'settings.orders', open ? 'resumed orders' : 'paused orders');
    return redirect(reply, '/admin', 'saved');
  });
}
