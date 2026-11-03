// Display helpers shared by admin views and exports.

// Currencies that are never written with decimals.
const WHOLE_CURRENCIES = new Set(['XOF', 'XAF', 'LBP']);
const SYMBOLS = { XOF: 'F CFA', XAF: 'F CFA', EUR: '€', USD: '$', GBP: '£', MAD: 'MAD', LBP: 'LBP' };

export function currencyDigits(currency) {
  return WHOLE_CURRENCIES.has(currency) ? 0 : 2;
}

// "25 000 F CFA", "120,50 €": French style, as customers read it. Grouping is done here rather
// than by Intl, because Node and browsers ship different currency data and the two must agree
// (the same amount appears on the site, in the WhatsApp message and in the admin).
export function formatMoney(cents, currency = 'XOF') {
  if (cents === null || cents === undefined) return '—';
  const digits = currencyDigits(currency);
  const [whole, fraction] = (Math.abs(cents) / 100).toFixed(digits).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const sign = cents < 0 ? '-' : '';
  return `${sign}${grouped}${fraction ? `,${fraction}` : ''} ${SYMBOLS[currency] ?? currency}`;
}

// "48.5" for a form input, from 4850 cents.
export function centsToInput(cents) {
  if (cents === null || cents === undefined || cents === '') return '';
  const value = Number(cents) / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: process.env.SHOP_TIMEZONE ?? 'Africa/Abidjan',
});

export function formatDate(iso) {
  return iso ? DATE_FORMAT.format(new Date(iso)) : '—';
}

export function timeAgo(iso, now = Date.now()) {
  const minutes = Math.round((now - Date.parse(iso)) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return formatDate(iso);
}

// Countries whose numbers keep their leading 0 after the country code.
// Côte d'Ivoire moved to 10 digits in 2021: 07 07 12 34 56 is dialled +225 07 07 12 34 56.
const KEEPS_LEADING_ZERO = new Set(['225']);

// Customers type numbers however they like. WhatsApp links need digits with a country code.
export function whatsAppDigits(phone, defaultCountryCode = '225') {
  const trimmed = String(phone).trim();
  let digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith(defaultCountryCode) && digits.length >= defaultCountryCode.length + 8) return digits;
  if (digits.startsWith('0') && !KEEPS_LEADING_ZERO.has(defaultCountryCode)) digits = digits.slice(1);
  return `${defaultCountryCode}${digits}`;
}
