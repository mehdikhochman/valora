// Prepares the database. Runs on every Vercel deploy (the "vercel-build" script) and is safe to repeat:
//   1. creates or updates the tables,
//   2. loads the starting catalogue if the shop is empty,
//   3. creates the first owner from OWNER_EMAIL / OWNER_PASSWORD if there is no account yet,
//   4. sets the WhatsApp number from WHATSAPP_NUMBER if the admin has not set one.
// It never stops a deploy for a missing optional value; it explains what to set instead.
import { config } from '../src/config.js';
import { migrateDatabase, openDatabase } from '../src/db/database.js';
import { createRepositories } from '../src/repositories/index.js';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../src/lib/crypto.js';
import { seedCatalogue } from './seed.js';

const log = (message) => console.log(`[setup] ${message}`);

async function createFirstOwner(repos) {
  if ((await repos.users.count()) > 0) return;
  const email = process.env.OWNER_EMAIL;
  const password = process.env.OWNER_PASSWORD ?? '';
  if (!email || password.length < MIN_PASSWORD_LENGTH) {
    log(`No admin account yet. Set OWNER_EMAIL and OWNER_PASSWORD (at least ${MIN_PASSWORD_LENGTH} characters) and redeploy.`);
    return;
  }
  await repos.users.create({ email, name: process.env.OWNER_NAME ?? 'Owner', role: 'owner', passwordHash: await hashPassword(password) });
  await repos.activity.log(null, 'user.create', `created the owner account ${email} during setup`);
  log(`Created the owner account ${email}. You can remove OWNER_PASSWORD from the environment now.`);
}

// Every order goes to this number, so the shop can be deployed with it already in place.
async function setWhatsAppNumber(repos) {
  const number = (process.env.WHATSAPP_NUMBER ?? '').replace(/\D/g, '');
  const current = (await repos.settings.getAll()).whatsapp_number;
  if (current || !number) {
    if (!current) log('No WhatsApp number yet. Set it in the admin (Settings > Contact) or as WHATSAPP_NUMBER.');
    return;
  }
  await repos.settings.setMany({ whatsapp_number: number });
  await repos.settings.bumpCatalogueVersion();
  log(`WhatsApp number set to +${number}.`);
}

await migrateDatabase({ url: config.databaseUrl, authToken: config.databaseToken });
log('Database tables are up to date.');

const db = await openDatabase({ url: config.databaseUrl, authToken: config.databaseToken, migrate: false });
const repos = createRepositories(db);
if (await seedCatalogue({ repos, log })) await repos.settings.bumpCatalogueVersion();
await createFirstOwner(repos);
await setWhatsAppNumber(repos);
db.close();
log('Done.');
