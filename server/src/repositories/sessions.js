// Admin sessions. The browser holds a random token; the database holds only its hash,
// so a leaked database backup cannot be used to log in.
import { randomToken, sha256 } from '../lib/crypto.js';

export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
export const SESSION_MAX_MS = 7 * 24 * 60 * 60 * 1000;
// Writing last_seen_at on every click would cost a write per page; once a minute is enough.
const TOUCH_EVERY_MS = 60 * 1000;

export function createSessionsRepository(db) {
  return {
    async create(userId, userAgent = '') {
      const token = randomToken(32);
      const now = Date.now();
      await db.run(`INSERT INTO sessions (id_hash, user_id, csrf_token, created_at, last_seen_at, user_agent)
                    VALUES (?, ?, ?, ?, ?, ?)`, [sha256(token), userId, randomToken(32), now, now, userAgent.slice(0, 200)]);
      return token;
    },

    // Returns the session with its user, or null if missing or expired.
    async findValid(token, now = Date.now()) {
      if (!token) return null;
      const idHash = sha256(token);
      const session = await db.get(`SELECT s.id_hash, s.csrf_token, s.created_at, s.last_seen_at,
                                           u.id AS user_id, u.email, u.name, u.role
                                    FROM sessions s JOIN users u ON u.id = s.user_id
                                    WHERE s.id_hash = ?`, [idHash]);
      if (!session) return null;
      const expired = now - session.last_seen_at > SESSION_IDLE_MS || now - session.created_at > SESSION_MAX_MS;
      if (expired) {
        await db.run('DELETE FROM sessions WHERE id_hash = ?', [idHash]);
        return null;
      }
      if (now - session.last_seen_at > TOUCH_EVERY_MS) await db.run('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?', [now, idHash]);
      return session;
    },

    destroy: (token) => (token ? db.run('DELETE FROM sessions WHERE id_hash = ?', [sha256(token)]) : null),
    destroyOthers: (userId, idHash) => db.run('DELETE FROM sessions WHERE user_id = ? AND id_hash != ?', [userId, idHash]),
    destroyAllForUser: (userId) => db.run('DELETE FROM sessions WHERE user_id = ?', [userId]),
    countForUser: (userId) => db.value('SELECT COUNT(*) FROM sessions WHERE user_id = ?', [userId]),
    purgeExpired: (now = Date.now()) =>
      db.run('DELETE FROM sessions WHERE last_seen_at < ? OR created_at < ?', [now - SESSION_IDLE_MS, now - SESSION_MAX_MS]),
  };
}
