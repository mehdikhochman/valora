// Small, audited wrappers around node:crypto. Nothing here is home-made cryptography.
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

// scrypt cost: about 50 ms per hash on a small server. Raise SCRYPT_N as hardware improves.
const SCRYPT_N = 2 ** 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_BYTES = 64;
const SALT_BYTES = 16;
const SCRYPT_MAXMEM = 128 * SCRYPT_N * SCRYPT_R * 2;

export const MIN_PASSWORD_LENGTH = 12;

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function sha256Base64(text) {
  return crypto.createHash('sha256').update(text).digest('base64');
}

export function hmac(secret, text) {
  return crypto.createHmac('sha256', secret).update(text).digest('hex');
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// Stored as: scrypt$N$r$p$salt$hash (base64url). The parameters travel with the hash
// so they can be raised later without breaking existing passwords.
export async function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt, KEY_BYTES, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM,
  });
  return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password, stored) {
  const [scheme, n, r, p, saltText, keyText] = String(stored).split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(keyText, 'base64url');
  const actual = await scrypt(password, Buffer.from(saltText, 'base64url'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 128 * Number(n) * Number(r) * 2,
  });
  return crypto.timingSafeEqual(expected, actual);
}

// A password nobody has to type twice: shown once to the admin, then changed by the user.
export function generatePassword() {
  return randomToken(12);
}
