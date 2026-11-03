# Vallora

The website of Vallora, a perfume house. Customers browse the collection, find their scent and
send their order on WhatsApp in one message. The team manages perfumes, prices and orders in
an admin panel, and sees what visitors look at.

| | |
|---|---|
| Shop | `/` (French), one page per perfume at `/parfum/<name>` |
| Admin | `/admin` (English) |
| Code | [`server/`](server/), run and deploy: [`server/README.md`](server/README.md) |
| How it works | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Design choices | [`docs/DESIGN.md`](docs/DESIGN.md) |
| Rules for every change | [`docs/CODING_RULES.md`](docs/CODING_RULES.md) |
| Brand originals | [`assets/brand/`](assets/brand/) (`npm run brand` turns them into web images) |

## What a customer can do

- Browse by category (Pour elle, Pour lui, Mixte, Huiles précieuses, Coffrets) and filter by
  olfactive family, concentration, sillage, house, budget and stock.
- Search by name or by note ("vanille", "oud"), with or without accents, and with typos.
- Open a perfume: its sizes and prices, notes (top, heart, base), sillage, the best moment to
  wear it, and similar perfumes.
- Take the four-question scent finder, which ranks the collection against their answers.
- Build a selection, give their name and address, and send the order on WhatsApp, already
  written, with an order number. Pick-up in the boutique is offered if the shop sets an address.
- Share a perfume's link: WhatsApp, Instagram and Facebook show its name, price and picture.
- Install the shop on their phone's home screen and browse it offline.

## What the team can do

- Add and edit perfumes: sizes with their own prices, notes, family, sillage, stock level,
  former price for promotions, photos.
- Follow every order from *New* to *Delivered*, reply on WhatsApp in one tap, print a delivery
  slip, export to a spreadsheet.
- See the shop's activity: visits, perfumes viewed, added, orders prepared and WhatsApp opened,
  and which perfumes attract attention without being chosen. No cookies, no personal data.
- Work through the "Before launch" list on the dashboard.

## Before going live

The site starts with 16 example perfumes so it is complete on day one. Their names, notes and
prices (in CFA francs) are examples: confirm or replace each one in the admin. Also set:

1. the WhatsApp number that receives orders (Settings → Contact),
2. the delivery fee and the free-delivery threshold, if any,
3. Instagram and TikTok accounts,
4. photos of the bottles (a PNG with a transparent background looks best). Until then the shop
   draws each bottle.

Texts that describe delivery times, payment by Mobile Money, returns and the Abidjan address are
editable defaults, chosen because the shop sells in Côte d'Ivoire. Check them in Settings and Guide.
