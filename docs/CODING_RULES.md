# Coding rules

These rules apply to everything in `server/`. They exist so that any developer can
open a file, understand it in one read, and change it without fear. When a rule and
a deadline disagree, the rule wins; when two rules disagree, security wins, then
correctness, then speed, then convenience.

## 1. Readability

1. **Plain modern JavaScript (ES modules, Node 22).** No build step, no transpiler.
   What runs is what you read.
2. **Name things by what they mean to the business**: `perfume`, `orderRequest`,
   `perfumeSize`, not `item`, `obj`, `data2`.
3. **Functions do one thing and fit on a screen** (aim for < 40 lines). If you need
   a comment to separate "steps" inside a function, those steps are functions.
4. **Files are organised by feature, not by kind** of code: everything about
   perfumes lives in `repositories/perfumes.js`, `routes/admin/perfumes.js` and
   `admin-ui/views/perfumes.js`.
5. **Comments explain *why*, never *what*.** The code says what. A comment is for a
   decision, a constraint, or a trap ("SQLite has no boolean; 0/1 is used").
6. **No clever one-liners.** Prefer an extra variable with a good name over a
   nested ternary.
7. **Early returns** over nested `if`/`else`.
8. **Constants in UPPER_SNAKE_CASE** at the top of the file, with their unit in the
   name: `SESSION_IDLE_MS`, `MAX_UPLOAD_BYTES`.
9. **Formatting:** 2-space indent, single quotes, semicolons, trailing commas,
   max ~100 characters per line.
10. **Dependencies are a cost.** Add one only if it replaces a lot of code or
    security-critical code. Every dependency is listed with its reason in
    `docs/BACKEND.md`.

## 2. Structure

| Layer | Folder | May talk to | Never does |
|---|---|---|---|
| Entry | `src/server.js` | `app.js` | business logic |
| App wiring | `src/app.js` | plugins, routes | SQL |
| Routes | `src/routes/**` | repositories, views, lib | SQL, HTML strings > 3 lines |
| Repositories | `src/repositories/**` | `db` | HTTP, HTML |
| Views | `src/admin-ui/**`, `src/storefront/**` | `lib/html.js` | SQL, HTTP |
| Library | `src/lib/**` | Node built-ins | import from routes |

- One SQL statement lives in exactly one repository function.
- Routes stay thin: **parse → validate → call repository → render or redirect**.

## 3. Security (non-negotiable)

1. **Every SQL query uses prepared statements with parameters.** Never build SQL
   with string concatenation, even for numbers.
2. **Every HTML output goes through the `html` tagged template** in `lib/html.js`,
   which escapes interpolated values. Raw HTML is only allowed through
   `raw()` on strings we built ourselves, never on user input.
3. **Validate all input at the edge** (route level) against an explicit
   allow-list: type, length, format, enum. Reject, don't "clean".
4. **Passwords:** scrypt with a per-user salt (`lib/passwords.js`), compared in
   constant time. Minimum 12 characters. Never logged, never returned.
5. **Sessions:** 256-bit random id in an `HttpOnly; Secure; SameSite=Strict`
   cookie scoped to `/admin`; only its SHA-256 hash is stored. Idle timeout 12 h,
   absolute lifetime 7 days, rotated at login, destroyed at logout.
6. **CSRF:** every state-changing admin request is a POST carrying the session's
   CSRF token, *and* its `Origin` must match the site. GET requests never change
   data.
7. **Brute force:** login is rate-limited per IP and locks an account for 15 min
   after 5 failures. Error messages never reveal whether the email exists.
8. **Uploads:** size-limited, decoded and **re-encoded** by sharp (strips EXIF/GPS,
   kills polyglot files), stored under random names outside the code folder.
9. **Headers:** strict Content-Security-Policy (scripts only by hash or same
   origin), `frame-ancestors 'none'`, HSTS in production, `nosniff`,
   strict referrer policy, restrictive Permissions-Policy.
10. **Least privilege:** two roles. `editor` manages content and orders; `owner`
    also manages users, settings and backups. Checks happen in the route, not the
    view.
11. **Secrets come from environment variables**, never from the repository.
    `.env` is git-ignored.
12. **Audit:** every admin change writes one line to the activity log (who, what,
    when).
13. **Errors:** users see a generic message; details go to the server log. Stack
    traces never reach the browser in production.

## 4. Speed

1. **The storefront is one HTML document, rendered once and served from memory**,
   pre-compressed with Brotli and gzip, with an ETag. It is rebuilt only when an
   admin saves something.
2. **No network request on click.** The whole catalogue is embedded in the page
   as JSON, so opening a perfume, filtering, sorting, searching and the bag are
   instant. The network is used only to record an order (one request, then
   WhatsApp opens) and for anonymous counters sent with `sendBeacon`.
3. **Images:** WebP in two widths with `srcset`, explicit dimensions, lazy
   loading below the fold, content-hashed names served with
   `Cache-Control: immutable` for one year.
4. **Admin pages are server-rendered HTML** (no framework download). Links are
   prefetched on hover with Speculation Rules, so most clicks open instantly.
5. **Count round trips.** On Turso every query crosses the network: run independent
   queries with `Promise.all`, fetch lists in one query instead of one per row, and
   group writes with `db.batch`. Queries that run on every request must use an index.
6. **Do expensive work once**: at boot or at save time, never per request.
7. **Measure before optimising.** `npm run bench` reports response times.

## 5. Errors and logging

- Throw `HttpError(status, message)` for expected failures; let unexpected ones
  bubble to the central error handler.
- Log with the request id. Never log passwords, session ids, tokens or full
  request bodies.

## 6. Tests

- `npm test` runs the suite with Node's built-in test runner. It must pass before
  every commit.
- Every security rule above has at least one test that would fail if the rule
  were broken (CSRF, auth, escaping, upload validation, rate limit).
- Tests use an in-memory database and never touch real data.

## 7. Git

- Small commits with a message that says *why*.
- No generated files, databases, uploads or `.env` in git.
