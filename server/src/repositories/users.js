// Admin accounts and their login protection.

const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60 * 1000;
const PUBLIC_COLUMNS = 'id, email, name, role, last_login_at, created_at';

export function createUsersRepository(db) {
  return {
    findByEmail: (email) => db.get('SELECT * FROM users WHERE email = ?', [email]),
    get: (id) => db.get(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`, [id]),
    getWithHash: (id) => db.get('SELECT * FROM users WHERE id = ?', [id]),
    list: () => db.all(`SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY name`),
    count: () => db.value('SELECT COUNT(*) FROM users'),
    countOwners: () => db.value("SELECT COUNT(*) FROM users WHERE role = 'owner'"),

    async create({ email, name, passwordHash, role }) {
      const result = await db.run('INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)', [email, name, passwordHash, role]);
      return result.lastId;
    },

    setRole: (id, role) => db.run('UPDATE users SET role = ? WHERE id = ?', [role, id]),
    setPassword: (id, passwordHash) =>
      db.run('UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?', [passwordHash, id]),
    remove: (id) => db.run('DELETE FROM users WHERE id = ?', [id]),

    isLocked(user, now = Date.now()) {
      return Boolean(user.locked_until) && Date.parse(user.locked_until) > now;
    },

    recordFailedLogin(user, now = Date.now()) {
      const failures = user.failed_logins + 1;
      const lockedUntil = failures >= MAX_FAILED_LOGINS ? new Date(now + LOCK_MS).toISOString() : null;
      return db.run('UPDATE users SET failed_logins = failed_logins + 1, locked_until = ? WHERE id = ?', [lockedUntil, user.id]);
    },

    recordSuccessfulLogin: (id) =>
      db.run('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', [new Date().toISOString(), id]),
  };
}
