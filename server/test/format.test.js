// Prices and phone numbers as customers and WhatsApp read them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney, whatsAppDigits } from '../src/lib/format.js';
import { parseMoney } from '../src/lib/form.js';

test('CFA francs have no decimals and a space between thousands', () => {
  assert.equal(formatMoney(2500000, 'XOF'), '25 000 F CFA');
  assert.equal(formatMoney(11600000, 'XOF'), '116 000 F CFA');
  assert.equal(formatMoney(12050, 'EUR'), '120,50 €');
  assert.equal(formatMoney(null, 'XOF'), '—');
});

test('prices are typed the way people write them', () => {
  assert.equal(parseMoney('45 000'), 4500000);
  assert.equal(parseMoney('48,50'), 4850);
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney('cheap'), undefined);
});

test('Ivorian numbers keep their leading zero after +225', () => {
  assert.equal(whatsAppDigits('07 07 12 34 56'), '2250707123456');
  assert.equal(whatsAppDigits('+225 07 07 12 34 56'), '2250707123456');
  assert.equal(whatsAppDigits('00225 0707123456'), '2250707123456');
  assert.equal(whatsAppDigits('70 123 456', '961'), '96170123456');
});
