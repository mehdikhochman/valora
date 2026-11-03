// Reads configuration from environment variables once, at start-up.
//
// Two ways to run:
//   - Locally / on a server: SQLite file and photos in DATA_DIR.
//   - On Vercel: Turso database (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN) and Vercel Blob photos
//     (BLOB_READ_WRITE_TOKEN). Vercel's disk is wiped between requests, so files cannot live there.
import path from 'node:path';
import { sha256 } from './lib/crypto.js';

const env = process.env;
const isProduction = env.NODE_ENV === 'production';
const isVercel = Boolean(env.VERCEL);
const port = Number(env.PORT ?? 3000);

export class ConfigError extends Error {
  name = 'ConfigError';
}

// Vercel tells each deployment its own address, so PUBLIC_ORIGIN is only needed for a custom domain.
function vercelOrigin() {
  const host = env.VERCEL_ENV === 'production' ? env.VERCEL_PROJECT_PRODUCTION_URL : env.VERCEL_URL;
  return host ? `https://${host}` : undefined;
}

function publicOrigin() {
  const origin = env.PUBLIC_ORIGIN ?? vercelOrigin() ?? (isProduction ? undefined : `http://localhost:${port}`);
  if (!origin) throw new ConfigError('PUBLIC_ORIGIN is not set. Set it to the address customers use, like https://vallora.ci.');
  return origin.replace(/\/$/, '');
}

// Vercel Blob has two ways to sign in:
//   - newer stores: BLOB_STORE_ID, plus a short-lived token Vercel gives every build and request
//     (OIDC). Nothing secret to copy; @vercel/blob finds that token itself.
//   - older stores: a long-lived BLOB_READ_WRITE_TOKEN (or <PREFIX>_READ_WRITE_TOKEN).
function blobToken() {
  if (env.BLOB_READ_WRITE_TOKEN) return env.BLOB_READ_WRITE_TOKEN;
  const key = Object.keys(env).find((name) => name.endsWith('_READ_WRITE_TOKEN') && env[name].startsWith('vercel_blob_rw_'));
  return key ? env[key] : undefined;
}

function hasBlobStore() {
  return Boolean(blobToken() || env.BLOB_STORE_ID);
}

function databaseUrl(dataDir) {
  return env.TURSO_DATABASE_URL ?? `file:${path.join(dataDir, 'vallora.db')}`;
}

// On Vercel, list every missing setting at once so it can be fixed in one go.
function checkVercelSetup() {
  if (!isVercel) return;
  const missing = [
    !env.TURSO_DATABASE_URL && 'TURSO_DATABASE_URL (connect a Turso database to the project)',
    !env.TURSO_AUTH_TOKEN && 'TURSO_AUTH_TOKEN (comes with the Turso database)',
    !hasBlobStore() && 'BLOB_STORE_ID or BLOB_READ_WRITE_TOKEN (Storage > Create > Blob, then connect it to this project)',
  ].filter(Boolean);
  if (missing.length) throw new ConfigError(`Missing in Vercel > Settings > Environment Variables: ${missing.join('; ')}.`);
}

// Used to hash visitor IPs. Falls back to a key derived from the database token, which is also secret.
function ipHashSecret() {
  if (env.IP_HASH_SECRET) return env.IP_HASH_SECRET;
  if (env.TURSO_AUTH_TOKEN) return sha256(`ip-hash:${env.TURSO_AUTH_TOKEN}`);
  if (isProduction) throw new ConfigError('IP_HASH_SECRET is not set.');
  return 'development-only-secret';
}

function load() {
  checkVercelSetup();
  const dataDir = path.resolve(env.DATA_DIR ?? './data');
  return Object.freeze({
    isProduction,
    isVercel,
    host: env.HOST ?? '127.0.0.1',
    port,
    publicOrigin: publicOrigin(),
    dataDir,
    databaseUrl: databaseUrl(dataDir),
    databaseToken: env.TURSO_AUTH_TOKEN,
    mediaDriver: hasBlobStore() ? 'blob' : 'local',
    blobToken: blobToken(), // undefined with a store ID: @vercel/blob then signs in with Vercel's OIDC token
    trustProxy: isVercel || env.TRUST_PROXY === 'true',
    ipHashSecret: ipHashSecret(),
    // Vercel refuses request bodies over 4.5 MB; the admin shrinks photos before upload to stay under it.
    maxUploadBytes: isVercel ? 4 * 1024 * 1024 : 15 * 1024 * 1024,
    // Migrations run at deploy time on Vercel (npm run setup), on start-up everywhere else.
    migrateOnStart: !isVercel,
  });
}

export const config = load();
