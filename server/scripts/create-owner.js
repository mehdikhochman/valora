// Creates an owner account from the command line (the first account, or a recovery account).
//   npm run create-owner -- "you@example.com" "Your Name"
// A strong password is generated and printed once.
import { config } from '../src/config.js';
import { openDatabase } from '../src/db/database.js';
import { createRepositories } from '../src/repositories/index.js';
import { generatePassword, hashPassword } from '../src/lib/crypto.js';

const [email, name = 'Owner'] = process.argv.slice(2);
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: npm run create-owner -- "you@example.com" "Your Name"');
  process.exit(1);
}

const db = await openDatabase({ url: config.databaseUrl, authToken: config.databaseToken });
const repos = createRepositories(db);
if (await repos.users.findByEmail(email)) {
  console.error(`An account with ${email} already exists. Reset its password from the Team page instead.`);
  process.exit(1);
}

const password = generatePassword();
await repos.users.create({ email, name, role: 'owner', passwordHash: await hashPassword(password) });
await repos.activity.log(null, 'user.create', `created the owner account ${email} from the command line`);
db.close();

console.log(`\nOwner account created.\n  Email:    ${email}\n  Password: ${password}\n\nLog in at ${config.publicOrigin}/admin and change the password on your account page.\n`);
