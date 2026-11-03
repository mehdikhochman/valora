// Turns a checkout submission into an order, and writes the WhatsApp message that confirms it.
//
// Orders are finished on WhatsApp, where the shop and the customer talk. The website still records
// each one first, so the team has a clean list to work from and the message carries a number.
// The browser's prices are never trusted: names and prices are read from the database.
// The idempotency key makes a double click or a retried request place one order, not two.
import { config } from '../config.js';
import { hmac } from '../lib/crypto.js';
import { formatMoney } from '../lib/format.js';
import { HttpError, badRequest } from '../lib/http-error.js';

const MAX_ORDERS_PER_IP_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const PICKUP_ADDRESS = 'Retrait en boutique';

const text = (minLength, maxLength) => ({ type: 'string', minLength, maxLength });

export const ORDER_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['idempotencyKey', 'customer', 'items'],
  properties: {
    idempotencyKey: { type: 'string', pattern: '^[A-Za-z0-9_-]{16,64}$' },
    website: { type: 'string', maxLength: 200 }, // hidden honeypot field: people leave it empty, bots fill it
    customer: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'phone', 'city'],
      properties: {
        name: text(2, 80),
        phone: { type: 'string', pattern: '^\\+?[0-9 ()\\-.]{7,22}$' },
        email: { type: 'string', maxLength: 120, pattern: '^$|^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' },
        city: text(2, 60),
        address: text(0, 300),
        note: text(0, 500),
        delivery: { type: 'string', enum: ['delivery', 'pickup'] },
      },
    },
    location: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['lat', 'lng'],
      properties: {
        lat: { type: 'number', minimum: -90, maximum: 90 },
        lng: { type: 'number', minimum: -180, maximum: 180 },
        accuracy: { type: 'number', minimum: 0, maximum: 100000 },
      },
    },
    items: {
      type: 'array',
      minItems: 1,
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['perfumeId', 'quantity'],
        properties: {
          perfumeId: { type: 'integer', minimum: 1 },
          option: { type: 'string', maxLength: 40 },
          quantity: { type: 'integer', minimum: 1, maximum: 20 },
        },
      },
    },
  },
};

export async function placeOrder(repos, body, ip) {
  const settings = await repos.settings.getAll();
  if (settings.orders_open !== '1') throw new HttpError(403, settings.orders_closed_message);
  if (body.website) throw badRequest('La commande n’a pas pu être envoyée.');

  const existing = await repos.orders.findByIdempotencyKey(body.idempotencyKey);
  if (existing) return { created: false, ...(await describeOrder(repos, existing.id, settings)) };

  const ipHash = hmac(config.ipHashSecret, ip ?? '');
  const since = new Date(Date.now() - DAY_MS).toISOString();
  if ((await repos.orders.countRecentFromIp(ipHash, since)) >= MAX_ORDERS_PER_IP_PER_DAY) {
    throw new HttpError(429, 'Trop de commandes depuis cette connexion aujourd’hui. Écrivez-nous directement sur WhatsApp.');
  }

  const items = await Promise.all(body.items.map((item) => resolveItem(repos, item)));
  const order = buildOrder(body, items, settings, ipHash);
  try {
    const { id } = await repos.orders.create(order, items);
    return { created: true, ...(await describeOrder(repos, id, settings)) };
  } catch (error) {
    // Two identical requests at the same instant: the second one hits the unique key. Same order.
    const sameOrder = await repos.orders.findByIdempotencyKey(body.idempotencyKey);
    if (sameOrder) return { created: false, ...(await describeOrder(repos, sameOrder.id, settings)) };
    throw error;
  }
}

async function resolveItem(repos, item) {
  const perfume = await repos.perfumes.getForOrder(item.perfumeId);
  if (!perfume) throw badRequest('Un parfum de votre sélection n’est plus disponible. Retirez-le puis réessayez.');
  if (perfume.availability === 'sold_out') throw badRequest(`${perfume.name} est épuisé. Retirez-le de votre sélection puis réessayez.`);

  const sizes = await repos.perfumes.sizesOf(perfume.id);
  const sizeLabel = item.option ?? '';
  if (!sizes.length) {
    if (sizeLabel) throw badRequest(`${perfume.name} n’existe qu’en un seul format.`);
    return { perfumeId: perfume.id, perfumeName: perfume.name, optionLabel: '', quantity: item.quantity, unitPriceCents: perfume.price_cents };
  }
  const size = sizes.find((candidate) => candidate.label === sizeLabel);
  if (!size) throw badRequest(`Choisissez un format pour ${perfume.name}.`);
  // A size without its own price falls back to the perfume's price.
  const unitPriceCents = size.price_cents ?? perfume.price_cents;
  return { perfumeId: perfume.id, perfumeName: perfume.name, optionLabel: size.label, quantity: item.quantity, unitPriceCents };
}

export function deliveryFeeCents(settings, subtotalCents, method) {
  if (method === 'pickup') return 0;
  const freeFrom = settings.free_delivery_from === '' ? null : Number(settings.free_delivery_from);
  if (freeFrom !== null && subtotalCents !== null && subtotalCents >= freeFrom) return 0;
  return settings.delivery_fee === '' ? null : Number(settings.delivery_fee);
}

function buildOrder(body, items, settings, ipHash) {
  const { customer, location } = body;
  const method = customer.delivery === 'pickup' && settings.pickup_address ? 'pickup' : 'delivery';
  const address = (customer.address ?? '').trim();
  if (method === 'delivery' && address.length < 3) throw badRequest('Indiquez une adresse ou un repère de livraison.');

  const allPriced = items.every((item) => item.unitPriceCents !== null);
  const subtotalCents = allPriced ? items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0) : null;
  const deliveryCents = deliveryFeeCents(settings, subtotalCents, method);

  return {
    idempotencyKey: body.idempotencyKey,
    customerName: customer.name.trim(),
    phone: customer.phone.trim(),
    email: (customer.email ?? '').trim(),
    city: customer.city.trim(),
    address: method === 'pickup' ? PICKUP_ADDRESS : address,
    customerNote: (customer.note ?? '').trim(),
    deliveryMethod: method,
    latitude: location?.lat ?? null,
    longitude: location?.lng ?? null,
    locationAccuracy: location?.accuracy == null ? null : Math.round(location.accuracy),
    currency: settings.currency,
    subtotalCents,
    deliveryCents,
    totalCents: subtotalCents !== null && deliveryCents !== null ? subtotalCents + deliveryCents : null,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    ipHash,
  };
}

async function describeOrder(repos, orderId, settings) {
  const order = await repos.orders.get(orderId);
  const message = whatsAppMessage(order, settings);
  const whatsappUrl = settings.whatsapp_number
    ? `https://wa.me/${settings.whatsapp_number}?text=${encodeURIComponent(message)}` : null;
  return { number: order.number, totalCents: order.total_cents, message, whatsappUrl };
}

// The message the customer sends to the shop. Plain text with WhatsApp's *bold* markers,
// so the team reads the whole order at a glance on a phone.
export function whatsAppMessage(order, settings) {
  const money = (cents) => (cents === null ? 'à confirmer' : formatMoney(cents, order.currency));
  const lines = [
    settings.whatsapp_greeting,
    `Je souhaite confirmer ma commande *${order.number}* :`,
    '',
    ...order.items.map((item) => {
      const size = item.option_label ? ` · ${item.option_label}` : '';
      const price = item.unit_price_cents === null ? '' : ` — ${money(item.unit_price_cents * item.quantity)}`;
      return `• ${item.quantity} × ${item.perfume_name}${size}${price}`;
    }),
    '',
    `Sous-total : ${money(order.subtotal_cents)}`,
    order.delivery_method === 'pickup'
      ? 'Retrait en boutique'
      : `Livraison : ${order.delivery_cents === 0 ? 'offerte' : money(order.delivery_cents)}`,
    `*Total : ${money(order.total_cents)}*`,
    '',
    `Nom : ${order.customer_name}`,
    `Téléphone : ${order.phone}`,
    order.delivery_method === 'pickup' ? `Ville : ${order.city}` : `Adresse : ${order.address}, ${order.city}`,
  ];
  if (order.latitude !== null) lines.push(`Position : https://maps.google.com/?q=${order.latitude},${order.longitude}`);
  if (order.customer_note) lines.push(`Note : ${order.customer_note}`);
  return lines.join('\n');
}
