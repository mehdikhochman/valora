# How the Vallora site works

## Shape

```
Browser ──> Vercel CDN ──> api/index.js (Vercel function) ──> Fastify app (src/app.js)
   │                                                           ├── GET  /                 the shop, rendered once per catalogue change
   │                                                           ├── GET  /parfum/:slug     the same shop, opened on one perfume (own title, preview, schema.org)
   │                                                           ├── POST /api/orders       records the order, returns the WhatsApp message
   │                                                           ├── POST /api/events       anonymous counters (sendBeacon)
   │                                                           ├── /sitemap.xml /manifest.webmanifest /sw.js
   │                                                           └── /admin/*               admin (server-rendered HTML)
   └── WhatsApp (wa.me link) <── the customer sends the order          Turso (hosted SQLite) · Vercel Blob (photos)
```

The same code runs as a plain Node process (`npm start`) with an SQLite file and a photo
folder: development, tests and any VPS use that mode. `src/config.js` picks the mode from the
environment. This structure comes from the Okeanós shop, which runs the same way in production.

## The order, from bag to WhatsApp

Orders are finished on WhatsApp because that is where the customers already talk to the shop.
The site's job is to make that message complete and correct, and to keep a record.

1. The selection lives in the browser (`localStorage`): adding perfumes never touches the network.
2. At checkout the browser sends name, phone, city, address (or pick-up), note, an optional GPS
   point, the perfumes with their sizes, and an **idempotency key**.
3. The server validates the body against a strict schema (unknown fields are rejected, not
   stripped), then re-reads every perfume, size and **price from the database**. A tampered
   browser cannot change a price. Delivery is computed from the settings (fee, free-delivery
   threshold, pick-up).
4. The order and its lines are written in one transaction and get a number (`VL-1001`).
5. The server writes the WhatsApp message from the saved order and returns it with a `wa.me`
   link. The customer taps "Ouvrir WhatsApp et envoyer"; the shop receives:

   ```
   Bonjour Vallora,
   Je souhaite confirmer ma commande *VL-1001* :

   • 2 × Or Sillage · 100 ml — 116 000 F CFA
   • 1 × Coffret Découverte — 20 000 F CFA

   Sous-total : 136 000 F CFA
   Livraison : à confirmer
   *Total : à confirmer*

   Nom : Awa Koné
   Téléphone : 07 07 12 34 56
   Adresse : Riviera 3, villa 12, Abidjan · Cocody
   ```
6. A double tap or a retry with the same key returns the same order, never a second one.
7. **If the server cannot be reached**, the browser writes the same message itself and still
   opens WhatsApp, without a number. An outage never costs a sale.

The order also appears in the admin, with a one-tap WhatsApp reply to the customer.

## Computer-science ideas used, and where

| Idea | Where | Why it matters to the shop |
|---|---|---|
| Render once, serve from memory, cache invalidation by version number | `storefront/render.js` | Pages answer in a few ms; an admin save is visible on the next visit, on every server instance |
| Pre-compression (Brotli, gzip) and ETags | `routes/public.js` | Small downloads on mobile data; repeat visits get `304 Not Modified` |
| Idempotency keys | `routes/place-order.js` | One order per tap, even on a bad connection |
| Single source of truth for prices | `routes/place-order.js` | Prices can't be altered in the browser |
| Transactions and batched queries | `repositories/orders.js`, `perfumes.js` | An order is saved whole or not at all; few network round trips to Turso |
| Vector similarity (cosine) over notes and families | `storefront.js`, "Dans le même esprit" | Relevant suggestions with no tracking and no server |
| Weighted scoring | `storefront.js`, scent finder | Ranks the whole collection against four answers |
| Approximate string matching (Damerau–Levenshtein, accent folding) | `storefront.js`, search | "vanile" finds vanilla; "epice" finds "épicé" |
| Procedural graphics (hash → shape) | `storefront.js`, `bottle()` | Every perfume has a distinct bottle before any photo exists |
| Service worker (network-first pages, cache-first assets) | `storefront/sw.js` | Installable app, instant repeat visits, browsing offline |
| Structured data (schema.org Product, Store, SearchAction), sitemap, Open Graph | `storefront/render.js` | Search engines and rich link previews on WhatsApp |
| Privacy by design: aggregated counters, no cookies, keyed IP hashes | `repositories/events.js` | Useful analytics without personal data or a consent banner |
| Defence in depth (see below) | `plugins/`, `lib/` | A small shop is still a target |

## Security model

| Threat | Defence |
|---|---|
| Stolen admin password | scrypt hashes, 12-character minimum, lockout after 5 failures, rate-limited login |
| Session theft | Random 256-bit token in an `HttpOnly; Secure; SameSite=Strict` cookie scoped to `/admin`; only its hash is stored; idle and absolute expiry |
| CSRF | Per-session token on every admin POST **and** an Origin check |
| XSS | Auto-escaping templates; the shop's CSP allows only its own inline script, by SHA-256 hash |
| SQL injection | Prepared statements only |
| Price tampering | Prices are read from the database at order time |
| Malicious uploads | Parsed only after login; size limit; every file decoded and re-encoded (strips EXIF/GPS); random content-hash names |
| Order spam | Strict schema, honeypot, 5 orders per 10 min per IP, 10 per day (stored as a keyed hash) |
| Counter spam | Strict schema, 60 batches per minute per IP, unknown perfumes counted as the shop |
| Spreadsheet formula injection | CSV cells starting with `= + - @` are prefixed with `'` |
| Clickjacking, sniffing | `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff`, strict referrer and permissions policies, HSTS |

Each row has at least one test in `server/test/` (`npm test`, 56 tests).

## Data

Money is stored as integer "cents" for every currency (25 000 F CFA is `2500000`), so the same
code handles euros. A perfume has sizes, each with its own price; a size without a price uses the
perfume's price. Orders copy names, sizes and prices at the time of the order, so catalogue
edits never rewrite history. Counters are one row per day, event and perfume.

## Dependencies

| Package | Why |
|---|---|
| `fastify` + official plugins | Fast HTTP server with schema validation, cookies, uploads, rate limits |
| `@libsql/client` | One driver for a local SQLite file and for Turso |
| `@vercel/blob` | Photo storage on Vercel |
| `sharp` | Safe image decoding and WebP encoding; also builds the brand images |

The shop page itself loads no framework and no third-party script: fonts are self-hosted, and
the whole page (catalogue included) is about 31 kB compressed with Brotli.
