# Design

## Direction: quiet, light, editorial

The first version used the campaign images' dark copper world for the whole page: glowing
lines, gradients, particles, coloured tiles. The client found it heavy and tiring to look at.
The site was redone in the opposite direction:

- **A light page.** Warm white (`#faf8f5`) with a stone tint (`#f2eee9`) behind products. Ink
  text (`#1c1714`). No gradients, no glows, no shadows beyond a hairline.
- **The photography carries the brand.** The silhouette campaign image sits next to the hero
  title; the terracotta monogram illustrates "La maison". They are the only dark and coloured
  areas, so they read as images, not as decoration.
- **Copper only as a trace.** The logo is shown in solid ink on light surfaces (generated from
  the original by `npm run brand`); copper remains in the photographs and the bottle caps.
- **Two typefaces.** Cormorant Garamond for names and headings, Jost for everything else.
  Small uppercase labels are limited to a few places.
- **Black buttons, square corners, one primary action per view.**
- **Motion is minimal**: a short fade when sections appear, nothing that loops.

## Layout

```
Hero (two columns on desktop, image first on phones)
  Title · one line · "Voir la collection" / "Trouver mon parfum" · three promises
Collection
  Sticky bar: categories · Filtrer · Trier        Grid 2 / 3 / 4 columns
  Card: bottle on stone · name · concentration and family · price · +
Trouver votre parfum      four questions → three perfumes with an affinity score
La maison                 monogram photo · text · three promises
Commander                 three steps · WhatsApp link
Le guide                  questions and answers
Footer                    shop · contact · information · install the app
```

The product sheet opens over the page with its own address (`/parfum/<slug>`): picture on one
side; name, family, sillage, moment, sizes, price, add to selection, order now on WhatsApp,
notes pyramid and similar perfumes on the other. On a phone the price and buttons stay pinned
at the bottom.

## Bottles without photos

A new shop rarely has studio photos of every bottle. Each perfume gets a drawn bottle until a
photo is uploaded: the silhouette and cap come from a hash of its name, the juice colour from
the "Bottle colour" field, all in soft, desaturated tones so the grid stays calm.

## What was borrowed from other shops

- **Okeanós** (the client's other site): the architecture, the admin, ordering that ends in a
  WhatsApp conversation, the one-page catalogue with instant product sheets.
- **Perfume retailers in Abidjan such as ZINO**: browsing by *Pour elle / Pour lui / Mixte*,
  prices in F CFA, delivery across Côte d'Ivoire and payment on delivery. zino.ci itself could
  not be opened from the build environment (its address is outside the allowed network), so
  these points come from public descriptions of the shop rather than from its pages.
- **Niche perfume houses**: the notes pyramid, olfactive families, sillage, discovery sets and a
  scent finder that replaces in-store advice.

## Language

Customers read French, with French typography: a space before `:` `?` `!`, the curly apostrophe
(’) and prices written `25 000 F CFA`. The admin is in English.
