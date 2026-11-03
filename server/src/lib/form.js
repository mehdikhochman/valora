// Validates submitted admin forms field by field and collects every error,
// so a form can be shown again with all messages at once and nothing retyped.
//
//   const form = new FormReader(request.body);
//   const name = form.text('name', { label: 'Name', required: true, max: 80 });
//   if (form.hasErrors) return renderAgain(form.errors);

export class FormReader {
  constructor(body) {
    this.body = normaliseBody(body ?? {});
    this.errors = {};
  }

  get hasErrors() {
    return Object.keys(this.errors).length > 0;
  }

  fail(field, message) {
    this.errors[field] ??= message;
    return null;
  }

  raw(field) {
    return this.body[field];
  }

  text(field, { label, required = false, min = 0, max = 200, pattern, patternMessage } = {}) {
    const value = String(this.body[field] ?? '').trim();
    if (!value) return required ? this.fail(field, `${label} is required.`) : '';
    if (value.length < min) return this.fail(field, `${label} must be at least ${min} characters.`);
    if (value.length > max) return this.fail(field, `${label} must be at most ${max} characters.`);
    if (pattern && !pattern.test(value)) return this.fail(field, patternMessage ?? `${label} is not valid.`);
    return value;
  }

  integer(field, { label, required = false, min = -Infinity, max = Infinity } = {}) {
    const text = String(this.body[field] ?? '').trim();
    if (!text) return required ? this.fail(field, `${label} is required.`) : null;
    if (!/^-?\d+$/.test(text)) return this.fail(field, `${label} must be a whole number.`);
    const value = Number(text);
    if (value < min || value > max) return this.fail(field, `${label} must be between ${min} and ${max}.`);
    return value;
  }

  // Prices are typed as "45000", "45 000" or "48.50" and stored as integer cents to avoid float errors.
  money(field, { label } = {}) {
    const cents = parseMoney(this.body[field]);
    if (cents === undefined) return this.fail(field, `${label} must be a number like 45000 or 48.50.`);
    return cents;
  }

  oneOf(field, allowed, { label } = {}) {
    const value = String(this.body[field] ?? '');
    return allowed.includes(value) ? value : this.fail(field, `Choose a valid ${label.toLowerCase()}.`);
  }

  checkbox(field) {
    const value = this.body[field];
    return value === 'on' || value === '1' || value === 'true';
  }

  idList(field) {
    const value = this.body[field];
    const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
    return list.map(Number).filter((id) => Number.isInteger(id) && id > 0);
  }
}

const MAX_PRICE = 100_000_000;

// Returns cents, null for an empty value, or undefined when the text is not a price.
export function parseMoney(value) {
  const text = String(value ?? '').trim().replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  if (!text) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return undefined;
  const amount = Number(text);
  return amount > MAX_PRICE ? undefined : Math.round(amount * 100);
}

// @fastify/multipart (with attachFieldsToBody) wraps every field as { value }.
// Plain urlencoded forms do not. This makes both look the same.
function normaliseBody(body) {
  const result = {};
  for (const [key, entry] of Object.entries(body)) {
    if (Array.isArray(entry)) result[key] = entry.map(unwrap);
    else result[key] = unwrap(entry);
  }
  return result;
}

function unwrap(entry) {
  if (entry && typeof entry === 'object' && 'value' in entry && !entry.file) return entry.value;
  return entry;
}

export function slugify(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item';
}
