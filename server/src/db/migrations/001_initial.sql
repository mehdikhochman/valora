-- Initial schema. Times are stored as ISO-8601 UTC text; money as integer cents
-- (for currencies without cents, such as the CFA franc, the shop simply stores amount × 100).
-- SQLite has no boolean type: flags are 0/1 integers with CHECK constraints.

CREATE TABLE users (
  id             INTEGER PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name           TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('owner', 'editor')),
  failed_logins  INTEGER NOT NULL DEFAULT 0,
  locked_until   TEXT,
  last_login_at  TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE sessions (
  id_hash       TEXT PRIMARY KEY,           -- SHA-256 of the cookie value; the cookie itself is never stored
  user_id       INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  csrf_token    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,           -- milliseconds since epoch, compared on every request
  last_seen_at  INTEGER NOT NULL,
  user_agent    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX sessions_user ON sessions (user_id);

-- The shop's main menu: "Pour elle", "Pour lui", "Mixte", "Coffrets"...
CREATE TABLE categories (
  id        INTEGER PRIMARY KEY,
  slug      TEXT NOT NULL UNIQUE,
  name      TEXT NOT NULL,
  position  INTEGER NOT NULL DEFAULT 0
);

-- Editorial groupings: "Signature", "Les Ors", "Nuit d'Orient"...
CREATE TABLE collections (
  id           INTEGER PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  is_visible   INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0, 1)),
  position     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE images (
  id          INTEGER PRIMARY KEY,
  file_key    TEXT NOT NULL UNIQUE,         -- content hash; files are <key>-480.webp and <key>-1200.webp
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  has_alpha   INTEGER NOT NULL DEFAULT 0 CHECK (has_alpha IN (0, 1)),
  base_url    TEXT NOT NULL DEFAULT '/media', -- '/media' (local or private Blob) or the public Blob URL prefix
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE perfumes (
  id              INTEGER PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  house           TEXT NOT NULL DEFAULT '',  -- the brand: "Vallora", or the maison of a selected fragrance
  category_id     INTEGER NOT NULL REFERENCES categories (id),
  audience        TEXT NOT NULL DEFAULT 'unisex' CHECK (audience IN ('women', 'men', 'unisex')),
  family          TEXT NOT NULL DEFAULT 'amber'
                  CHECK (family IN ('amber', 'woody', 'floral', 'fresh', 'citrus', 'gourmand', 'leather', 'aromatic', 'musky', 'chypre')),
  concentration   TEXT NOT NULL DEFAULT 'edp'
                  CHECK (concentration IN ('extrait', 'parfum', 'edp', 'edt', 'edc', 'oil', 'mist', 'home')),
  intensity       INTEGER NOT NULL DEFAULT 3 CHECK (intensity BETWEEN 1 AND 5),   -- sillage, 1 = skin scent
  moment          TEXT NOT NULL DEFAULT 'any' CHECK (moment IN ('day', 'night', 'any')),
  notes_top       TEXT NOT NULL DEFAULT '',  -- comma-separated, in the order they are written on the card
  notes_heart     TEXT NOT NULL DEFAULT '',
  notes_base      TEXT NOT NULL DEFAULT '',
  tagline         TEXT NOT NULL DEFAULT '',  -- one evocative line under the name
  badge           TEXT NOT NULL DEFAULT '',  -- free text: "Best-seller", "Nouveauté"
  is_new          INTEGER NOT NULL DEFAULT 0 CHECK (is_new IN (0, 1)),
  description     TEXT NOT NULL DEFAULT '',
  price_cents     INTEGER CHECK (price_cents IS NULL OR price_cents >= 0), -- used when the perfume has no sizes
  compare_at_cents INTEGER CHECK (compare_at_cents IS NULL OR compare_at_cents >= 0), -- crossed-out price
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  availability    TEXT NOT NULL DEFAULT 'in_stock' CHECK (availability IN ('in_stock', 'low_stock', 'preorder', 'sold_out')),
  hue             INTEGER NOT NULL DEFAULT 24 CHECK (hue BETWEEN 0 AND 360), -- juice colour of the drawn bottle
  instagram_url   TEXT NOT NULL DEFAULT '',
  position        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX perfumes_status_position ON perfumes (status, position);

-- Sizes ("30 ml", "100 ml", "Coffret") each with their own price.
CREATE TABLE perfume_sizes (
  id           INTEGER PRIMARY KEY,
  perfume_id   INTEGER NOT NULL REFERENCES perfumes (id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  price_cents  INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  position     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX perfume_sizes_perfume ON perfume_sizes (perfume_id);

CREATE TABLE perfume_images (
  perfume_id  INTEGER NOT NULL REFERENCES perfumes (id) ON DELETE CASCADE,
  image_id    INTEGER NOT NULL REFERENCES images (id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'photo' CHECK (role IN ('cutout', 'photo')),
  alt         TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (perfume_id, image_id)
);

CREATE TABLE perfume_collections (
  perfume_id     INTEGER NOT NULL REFERENCES perfumes (id) ON DELETE CASCADE,
  collection_id  INTEGER NOT NULL REFERENCES collections (id) ON DELETE CASCADE,
  PRIMARY KEY (perfume_id, collection_id)
);

CREATE TABLE guide_entries (
  id          INTEGER PRIMARY KEY,
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  is_visible  INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0, 1)),
  position    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- Orders sent from the website. The customer finishes the order on WhatsApp; the copy kept here
-- lets the team track it. Customer details, names and prices are copied in at the time of the
-- order, so later catalogue edits never rewrite history.
CREATE TABLE orders (
  id                INTEGER PRIMARY KEY,
  number            TEXT NOT NULL UNIQUE,            -- shown to the customer: VL-1001
  idempotency_key   TEXT NOT NULL UNIQUE,            -- sent by the browser so a double click places one order
  status            TEXT NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled')),
  customer_name     TEXT NOT NULL,
  phone             TEXT NOT NULL,
  email             TEXT NOT NULL DEFAULT '',
  city              TEXT NOT NULL,
  address           TEXT NOT NULL,
  customer_note     TEXT NOT NULL DEFAULT '',
  delivery_method   TEXT NOT NULL DEFAULT 'delivery' CHECK (delivery_method IN ('delivery', 'pickup')),
  latitude          REAL,
  longitude         REAL,
  location_accuracy_m INTEGER,
  currency          TEXT NOT NULL,
  subtotal_cents    INTEGER,                         -- NULL when at least one perfume had no price
  delivery_cents    INTEGER,
  total_cents       INTEGER,
  item_count        INTEGER NOT NULL,
  admin_note        TEXT NOT NULL DEFAULT '',
  ip_hash           TEXT NOT NULL DEFAULT '',        -- keyed hash, for abuse checks only
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX orders_status_created ON orders (status, created_at);
CREATE INDEX orders_created ON orders (created_at);

CREATE TABLE order_items (
  id                INTEGER PRIMARY KEY,
  order_id          INTEGER NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  perfume_id        INTEGER REFERENCES perfumes (id) ON DELETE SET NULL,
  perfume_name      TEXT NOT NULL,
  option_label      TEXT NOT NULL DEFAULT '',        -- the size chosen
  quantity          INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  unit_price_cents  INTEGER
);
CREATE INDEX order_items_order ON order_items (order_id);
CREATE INDEX order_items_perfume ON order_items (perfume_id);

-- Anonymous shop analytics, aggregated per day: no cookies, no IPs, no personal data.
-- One row per (day, event, perfume); perfume_id 0 means "the whole shop".
CREATE TABLE daily_events (
  day         TEXT NOT NULL,                  -- YYYY-MM-DD (UTC)
  event       TEXT NOT NULL CHECK (event IN ('visit', 'view', 'add', 'checkout', 'whatsapp', 'quiz', 'search')),
  perfume_id  INTEGER NOT NULL DEFAULT 0,
  count       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event, perfume_id)
);

CREATE TABLE activity_log (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER REFERENCES users (id) ON DELETE SET NULL,
  action      TEXT NOT NULL,                  -- "perfume.update", "order.status"
  summary     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX activity_log_created ON activity_log (created_at);
