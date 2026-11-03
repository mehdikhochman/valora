# Vallora shop server

The storefront customers order from, plus the admin the team runs the shop with.

- How it is built and why: [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)
- Rules every change follows: [`../docs/CODING_RULES.md`](../docs/CODING_RULES.md)

It runs in two places with the same code:

| | Database | Photos |
|---|---|---|
| **Vercel** (production) | Turso (hosted SQLite) | Vercel Blob |
| **Your computer / a VPS** | SQLite file in `DATA_DIR` | `DATA_DIR/media` folder |

## Deploy on Vercel

Vercel functions keep nothing on disk between requests, so the database and the photos live in
two Vercel-connected services. Set them up once:

1. **Project settings → General**
   - Root Directory: `server`
   - Framework Preset: Other
2. **Storage → Create Database → Turso** → connect it to this project.
   This adds `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.
   If your integration names them differently, add them under these names.
3. **Storage → Create → Blob** → connect it to this project. This adds `BLOB_READ_WRITE_TOKEN`.
4. **Settings → Environment Variables**, add for **Production and Preview**:
   - `OWNER_EMAIL`: your email, for the first admin account
   - `OWNER_PASSWORD`: at least 12 characters

   A branch other than `main` deploys as a *Preview*, so variables set for Production only are
   not visible there.
   - `OWNER_NAME` (optional)
   - `PUBLIC_ORIGIN`: only if you use a custom domain, e.g. `https://vallora.ci`
   - `WHATSAPP_NUMBER` (optional): the number that receives orders, digits only, e.g. `2250700000000`
5. **Redeploy.** The build runs `npm run vercel-build` (`scripts/setup.js`), which:
   - creates or updates the tables;
   - loads the 16 starter perfumes and the guide (once; an interrupted import finishes on the
     next deploy, and perfumes you delete later never come back);
   - creates your owner account;
   - sets the WhatsApp number from `WHATSAPP_NUMBER`, if you added it and the admin has none yet.

   The build log shows each step as a `[setup]` line.
6. Open `https://<your-project>.vercel.app/admin` and log in. Then delete `OWNER_PASSWORD` from the
   environment variables. It is only used to create the account.

If something is missing, the site says which setting to add instead of showing a blank error.

## Run it on your computer

Needs Node.js 22.9 or newer.

```bash
cd server
npm install
cp .env.example .env              # defaults are fine for local use
npm run setup                     # tables + starting catalogue
npm run create-owner -- "you@example.com" "Your Name"   # prints a password once
npm run dev                       # http://localhost:3000 and http://localhost:3000/admin
```

Open the site at the exact address in `PUBLIC_ORIGIN` (by default `http://localhost:3000`).
For example, `127.0.0.1:3000` would fail the admin's same-site check.

To work against the real Vercel database from your computer, copy the Turso and Blob variables
into `.env` (`vercel env pull .env` does this).

## Checks

```bash
npm test        # 56 tests: security rules, ordering and WhatsApp messages, storefront, analytics, admin, serverless
npm run bench   # response times of the shop page (server must be running)
```

## The admin at a glance

| Page | What you do there |
|---|---|
| Dashboard | "Before launch" checklist, new orders, sales, most ordered perfumes, visitor funnel (visit → view → add → order → WhatsApp), most looked-at perfumes, pause/resume orders |
| Orders | Every order sent from the site, with its number (VL-1001…). Filter and search. Each order shows the customer, a WhatsApp/Call button, delivery or pick-up, the address and the map pin. Move it through *New → Confirmed → Being prepared → Out for delivery → Delivered*. Private notes, delivery slip, CSV export |
| Perfumes | Add, edit, duplicate, archive. Sizes with their own prices, former price, notes, family, sillage, moment, stock level, badges, "Nouveautés", collections, photos (resized in the browser before upload), order in the shop, bulk actions |
| Categories / Collections | The shop's menu and filters |
| Guide | The questions customers ask: ordering, delivery, payment, authenticity, care |
| Settings | Announcement, hero texts, currency (F CFA by default), delivery fee and free-delivery threshold, pick-up address, payment note, WhatsApp number and greeting, policies, SEO *(owners)* |
| Team | Add people as *owner* or *editor*, reset passwords *(owners)* |
| Activity | Who changed what, and when |
| Backup | Download everything as JSON and the orders spreadsheet *(owners)* |

Keyboard: **Ctrl/⌘ + S** saves the perfume or settings form you are on.
