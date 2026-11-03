// Opens the database and gives repositories four small helpers: all, get, value, run, plus batch.
//
// The same code talks to a local SQLite file (development, tests, a VPS) and to Turso
// (hosted SQLite, used on Vercel). Both speak the SQLite dialect, so SQL never changes.
// Every call is async because Turso is reached over the network.
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);

// libSQL refuses undefined and booleans; SQLite stores flags as 0/1.
function cleanArgs(args) {
  const clean = (value) => (value === undefined ? null : typeof value === 'boolean' ? Number(value) : value);
  if (Array.isArray(args)) return args.map(clean);
  return Object.fromEntries(Object.entries(args).map(([key, value]) => [key, clean(value)]));
}

function toObjects(result) {
  return result.rows.map((row) => Object.fromEntries(result.columns.map((column, index) => [column, row[index]])));
}

export function statement(sql, args = []) {
  return { sql, args: cleanArgs(args) };
}

// A local file needs its folder to exist; Turso URLs (libsql://) need nothing.
function connect(url, authToken) {
  if (url.startsWith('file:')) fs.mkdirSync(path.dirname(url.slice(5)), { recursive: true });
  return createClient({ url, authToken });
}

export async function openDatabase({ url, authToken, migrate = true }) {
  const client = connect(url, authToken);
  if (url.startsWith('file:')) await client.execute('PRAGMA journal_mode = WAL');
  await client.execute('PRAGMA foreign_keys = ON');

  const db = {
    async all(sql, args) {
      return toObjects(await client.execute(statement(sql, args)));
    },
    async get(sql, args) {
      return (await db.all(sql, args))[0] ?? null;
    },
    async value(sql, args) {
      const result = await client.execute(statement(sql, args));
      return result.rows[0]?.[0] ?? null;
    },
    async run(sql, args) {
      const result = await client.execute(statement(sql, args));
      return { changes: result.rowsAffected, lastId: Number(result.lastInsertRowid ?? 0) };
    },
    // Several statements in one round trip, all-or-nothing.
    async batch(statements) {
      const results = await client.batch(statements.filter(Boolean), 'write');
      return results.map(toObjects);
    },
    close: () => client.close(),
  };

  if (migrate) await runMigrations(client);
  return db;
}

// Applies every .sql file in migrations/ that has not run yet, in name order.
export async function runMigrations(client) {
  await client.execute('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set((await client.execute('SELECT name FROM schema_migrations')).rows.map((row) => row.name));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')).sort();

  for (const name of files) {
    if (applied.has(name)) continue;
    const sql = fs.readFileSync(new URL(name, MIGRATIONS_DIR), 'utf8');
    await client.executeMultiple(sql);
    await client.execute({ sql: 'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', args: [name, new Date().toISOString()] });
  }
}

export async function migrateDatabase({ url, authToken }) {
  const client = connect(url, authToken);
  try {
    await runMigrations(client);
  } finally {
    client.close();
  }
}
