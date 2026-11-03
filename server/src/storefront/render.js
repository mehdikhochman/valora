// Builds the storefront pages from the database.
//
// There is one document: the home page. A perfume's own address (/parfum/<slug>) serves the same
// document with that perfume's title, description, share picture and structured data, and the
// script opens its sheet. So a link sent on WhatsApp shows a rich preview, search engines index
// every perfume, and browsing stays instant.
//
// Each page is rendered once, compressed once (Brotli + gzip) and kept in memory.
// Any admin change calls invalidate(); the next visitor triggers one rebuild (a few ms).
import fs from 'node:fs';
import zlib from 'node:zlib';
import { config } from '../config.js';
import { escapeHtml, html, jsonForScript } from '../lib/html.js';
import { sha256, sha256Base64 } from '../lib/crypto.js';
import { mediaUrl } from '../lib/media.js';
import { formatMoney } from '../lib/format.js';
import { IMG_SOURCES } from '../plugins/security-headers.js';
import { AUDIENCE_LABELS, CONCENTRATION_LABELS, FAMILY_LABELS } from '../lib/perfume-labels.js';

const TEMPLATE = fs.readFileSync(new URL('./template.html', import.meta.url), 'utf8');
const SCRIPT = fs.readFileSync(new URL('./storefront.js', import.meta.url), 'utf8');
const SHARE_IMAGE = '/assets/brand/share.jpg';
const MAX_CACHED_PERFUME_PAGES = 200;

const SCHEMA_AVAILABILITY = {
  in_stock: 'https://schema.org/InStock',
  low_stock: 'https://schema.org/LimitedAvailability',
  preorder: 'https://schema.org/PreOrder',
  sold_out: 'https://schema.org/OutOfStock',
};

// Several server instances may run at once (Vercel starts more under load). Each keeps its own
// copy of the pages and compares it with catalogue_version, which every admin change increases.
export function createStorefront({ repos }) {
  let cache = { version: -1, pages: new Map(), data: null };
  let building = null;

  async function data() {
    const version = await repos.settings.catalogueVersion();
    if (cache.version === version) return cache;
    building ??= loadData(repos).then((loaded) => ({ version, pages: new Map(), data: loaded })).finally(() => { building = null; });
    cache = await building;
    return cache;
  }

  return {
    // slug = '' for the home page. Returns null when no published perfume has that slug.
    async getPage(slug = '') {
      const current = await data();
      if (current.pages.has(slug)) return current.pages.get(slug);
      const perfume = slug ? current.data.catalogue.perfumes.find((p) => p.slug === slug) : null;
      if (slug && !perfume) return null;
      const page = compress(renderDocument(current.data, perfume));
      if (current.pages.size < MAX_CACHED_PERFUME_PAGES) current.pages.set(slug, page);
      return page;
    },
    async sitemap() {
      const { data: loaded } = await data();
      const urls = ['/', ...loaded.catalogue.perfumes.map((p) => `/parfum/${p.slug}`)];
      return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
        urls.map((url) => `  <url><loc>${escapeHtml(config.publicOrigin + url)}</loc></url>`).join('\n')}\n</urlset>\n`;
    },
    async manifest() {
      const { data: loaded } = await data();
      return webManifest(loaded.settings);
    },
    async invalidate() {
      cache = { version: -1, pages: new Map(), data: null };
      await repos.settings.bumpCatalogueVersion();
    },
  };
}

async function loadData(repos) {
  const settings = await repos.settings.getAll();
  const [catalogue, guideEntries] = await Promise.all([buildCatalogue(repos, settings), repos.guide.listVisible()]);
  return { settings, catalogue, guideEntries };
}

function compress(document) {
  const buffer = Buffer.from(document);
  return {
    html: buffer,
    br: zlib.brotliCompressSync(buffer, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 10, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buffer.length },
    }),
    gzip: zlib.gzipSync(buffer, { level: 9 }),
    etag: `"${sha256(document).slice(0, 20)}"`,
    csp: contentSecurityPolicy(document),
  };
}

// The inline script is allowed by its exact hash, so injected scripts can never run.
// JSON blocks (catalogue, structured data) are data, not scripts, and need no hash.
function contentSecurityPolicy(document) {
  const hashes = [...document.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => `'sha256-${sha256Base64(match[1])}'`);
  return [
    "default-src 'self'",
    `script-src ${hashes.join(' ')}`,
    // Inline style attributes carry per-perfume colours. Styles cannot run code.
    "style-src 'self' 'unsafe-inline'",
    IMG_SOURCES,
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'", // the offline service worker (/sw.js)
    "manifest-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join('; ');
}

// {{name}} inserts an escaped value; {{{name}}} inserts HTML we built ourselves.
// A list of HTML parts is joined with nothing between them (String() would put commas).
function fillTemplate(template, values) {
  return template.replace(/\{\{(\{?)(\w+)\}?\}\}/g, (match, isRaw, key) => {
    if (!(key in values)) throw new Error(`Storefront template uses unknown value "${key}"`);
    return isRaw ? [values[key]].flat().join('') : escapeHtml(values[key]);
  });
}

function imageFor(row) {
  return { s: mediaUrl(row, 480), l: mediaUrl(row, 1200), w: row.width, h: row.height };
}

const splitNotes = (text) => text.split(/[,\n·]+/).map((note) => note.trim()).filter(Boolean);

function toPublicPerfume(perfume) {
  const cutout = perfume.images.find((image) => image.role === 'cutout');
  const sizes = perfume.sizes.map((size) => ({ l: size.label, p: size.price_cents ?? perfume.price_cents }));
  const prices = (sizes.length ? sizes.map((size) => size.p) : [perfume.price_cents]).filter((price) => price !== null);
  return {
    id: perfume.id,
    slug: perfume.slug,
    name: perfume.name,
    house: perfume.house,
    cat: perfume.category_slug,
    aud: perfume.audience,
    fam: perfume.family,
    conc: perfume.concentration,
    int: perfume.intensity,
    mom: perfume.moment,
    top: splitNotes(perfume.notes_top),
    heart: splitNotes(perfume.notes_heart),
    base: splitNotes(perfume.notes_base),
    line: perfume.tagline,
    badge: perfume.badge,
    isNew: Boolean(perfume.is_new),
    desc: perfume.description,
    price: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
    was: perfume.compare_at_cents,
    sizes,
    avail: perfume.availability,
    hue: perfume.hue,
    cut: cutout ? imageFor(cutout) : null,
    photos: perfume.images.filter((image) => image.role === 'photo').map(imageFor),
    cols: perfume.collectionSlugs,
    ig: perfume.instagram_url,
    added: perfume.created_at,
  };
}

async function buildCatalogue(repos, settings) {
  const [published, categories, collections] = await Promise.all([
    repos.perfumes.listPublished(), repos.categories.list(), repos.collections.list(),
  ]);
  const perfumes = published.map(toPublicPerfume);
  const usedCategories = new Set(perfumes.map((perfume) => perfume.cat));
  const usedCollections = new Set(perfumes.flatMap((perfume) => perfume.cols));
  const money = (key) => (settings[key] === '' ? null : Number(settings[key]));

  return {
    perfumes,
    categories: categories.filter((c) => usedCategories.has(c.slug)).map(({ slug, name }) => ({ slug, name })),
    collections: collections.filter((c) => c.is_visible && usedCollections.has(c.slug))
      .map(({ slug, name, description }) => ({ slug, name, desc: description })),
    labels: { families: FAMILY_LABELS, concentrations: CONCENTRATION_LABELS, audiences: AUDIENCE_LABELS },
    settings: {
      brand: settings.brand_name,
      title: settings.seo_title,
      currency: settings.currency,
      deliveryCents: money('delivery_fee'),
      freeFromCents: money('free_delivery_from'),
      pickup: settings.pickup_address,
      ordersOpen: settings.orders_open === '1',
      closedMessage: settings.orders_closed_message,
      whatsapp: settings.whatsapp_number,
      greeting: settings.whatsapp_greeting,
      confirmation: settings.order_confirmation_note,
      payment: settings.payment_note,
    },
  };
}

function renderDocument({ settings, catalogue, guideEntries }, perfume) {
  const withScript = TEMPLATE.replace('/*STOREFRONT_SCRIPT*/', () => SCRIPT);
  return fillTemplate(withScript, pageValues(settings, catalogue, guideEntries, perfume));
}

function perfumeMeta(perfume, settings) {
  const label = CONCENTRATION_LABELS[perfume.conc];
  const notes = [...perfume.top, ...perfume.heart, ...perfume.base].slice(0, 5).join(', ');
  const from = perfume.price === null ? '' : ` · dès ${formatMoney(perfume.price, settings.currency)}`;
  const photo = perfume.photos[0] ?? perfume.cut;
  return {
    title: `${perfume.name} · ${label} · ${settings.brand_name}`,
    description: (perfume.line || perfume.desc || `${label} aux notes de ${notes}.`).slice(0, 150) + from,
    canonical: `${config.publicOrigin}/parfum/${perfume.slug}`,
    image: photo ? `${config.publicOrigin}${photo.l}` : `${config.publicOrigin}${SHARE_IMAGE}`,
  };
}

function structuredData(settings, catalogue, perfume) {
  const store = {
    '@type': 'Store',
    '@id': `${config.publicOrigin}/#store`,
    name: settings.brand_name,
    url: `${config.publicOrigin}/`,
    image: `${config.publicOrigin}${SHARE_IMAGE}`,
    logo: `${config.publicOrigin}/assets/brand/icon-512.png`,
    address: settings.boutique_address,
    openingHours: settings.opening_hours,
    ...(settings.whatsapp_number && { telephone: `+${settings.whatsapp_number}` }),
    sameAs: [
      settings.instagram_handle && `https://www.instagram.com/${settings.instagram_handle}/`,
      settings.tiktok_handle && `https://www.tiktok.com/@${settings.tiktok_handle}`,
    ].filter(Boolean),
  };
  if (!perfume) {
    return {
      '@context': 'https://schema.org',
      '@graph': [store, {
        '@type': 'WebSite', url: `${config.publicOrigin}/`, name: settings.brand_name,
        potentialAction: { '@type': 'SearchAction', target: `${config.publicOrigin}/?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
      }, {
        '@type': 'ItemList',
        itemListElement: catalogue.perfumes.map((p, index) => ({ '@type': 'ListItem', position: index + 1, url: `${config.publicOrigin}/parfum/${p.slug}`, name: p.name })),
      }],
    };
  }
  const meta = perfumeMeta(perfume, settings);
  const priced = perfume.price !== null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: perfume.name,
    description: perfume.desc || perfume.line,
    image: meta.image,
    url: meta.canonical,
    brand: { '@type': 'Brand', name: perfume.house || settings.brand_name },
    category: CONCENTRATION_LABELS[perfume.conc],
    ...(priced && {
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: settings.currency,
        lowPrice: perfume.price / 100,
        highPrice: perfume.maxPrice / 100,
        offerCount: Math.max(1, perfume.sizes.length),
        availability: SCHEMA_AVAILABILITY[perfume.avail],
        seller: { '@id': `${config.publicOrigin}/#store` },
      },
    }),
  };
}

function pageValues(settings, catalogue, guideEntries, perfume) {
  const meta = perfume ? perfumeMeta(perfume, settings) : {
    title: settings.seo_title,
    description: settings.seo_description,
    canonical: `${config.publicOrigin}/`,
    image: `${config.publicOrigin}${SHARE_IMAGE}`,
  };
  return {
    ...settings,
    page_title: meta.title,
    page_description: meta.description,
    canonical_url: meta.canonical,
    og_image: meta.image,
    og_type: perfume ? 'product' : 'website',
    initial_slug: perfume?.slug ?? '',
    hero_title_html: escapeHtml(settings.hero_title).replace(/\*([^*]+)\*/g, '<em>$1</em>'),
    structured_data: jsonForScript(structuredData(settings, catalogue, perfume)),
    announcement_bar: settings.announcement
      ? html`<div class="announce" role="note"><p>${settings.announcement}</p></div>` : '',
    nav_category_links: catalogue.categories.map((c) => html`<a href="/#collection" data-cat="${c.slug}">${c.name}</a>`),
    footer_category_links: catalogue.categories.map((c) => html`<li><a href="/#collection" data-cat="${c.slug}">${c.name}</a></li>`),
    promise_blocks: [1, 2, 3]
      .filter((n) => settings[`about_${n}_title`])
      .map((n) => html`<li><span class="promise-n">0${n}</span><h3>${settings[`about_${n}_title`]}</h3><p>${settings[`about_${n}_text`]}</p></li>`),
    guide_section: guideSection(guideEntries),
    contact_links: contactLinks(settings),
    city_options: settings.cities.split('\n').map((city) => city.trim()).filter(Boolean).map((city) => html`<option value="${city}">`),
    whatsapp_href: settings.whatsapp_number
      ? `https://wa.me/${settings.whatsapp_number}?text=${encodeURIComponent(`${settings.whatsapp_greeting} j’aimerais un conseil parfum.`)}` : '#guide',
    catalogue_json: jsonForScript(catalogue),
    year: String(new Date().getFullYear()),
  };
}

function guideSection(entries) {
  if (!entries.length) return '';
  const paragraphs = (text) => text.split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => html`<p>${line}</p>`);
  return html`
    <section class="sec" id="guide" aria-labelledby="guide-h">
      <div class="wrap narrow">
        <header class="sec-head"><div><p class="kicker">Questions fréquentes</p><h2 id="guide-h">Le guide</h2></div></header>
        <div class="guide">${entries.map((entry) => html`
          <details class="acc">
            <summary><span>${entry.question}</span><svg class="i" aria-hidden="true"><use href="#i-plus"/></svg></summary>
            <div class="acc-body">${paragraphs(entry.answer)}</div>
          </details>`)}
        </div>
      </div>
    </section>`;
}

function contactLinks(settings) {
  const links = [];
  if (settings.whatsapp_number) links.push(html`<li><a href="https://wa.me/${settings.whatsapp_number}" target="_blank" rel="noopener">WhatsApp · +${settings.whatsapp_number}</a></li>`);
  if (settings.instagram_handle) {
    links.push(html`<li><a href="https://www.instagram.com/${settings.instagram_handle}/" target="_blank" rel="noopener">Instagram · @${settings.instagram_handle}</a></li>`);
  }
  if (settings.tiktok_handle) {
    links.push(html`<li><a href="https://www.tiktok.com/@${settings.tiktok_handle}" target="_blank" rel="noopener">TikTok · @${settings.tiktok_handle}</a></li>`);
  }
  if (settings.contact_email) links.push(html`<li><a href="mailto:${settings.contact_email}">${settings.contact_email}</a></li>`);
  if (settings.boutique_address) links.push(html`<li>${settings.boutique_address}</li>`);
  if (settings.opening_hours) links.push(html`<li>${settings.opening_hours}</li>`);
  return links;
}

function webManifest(settings) {
  return JSON.stringify({
    name: settings.brand_name,
    short_name: settings.brand_name,
    description: settings.seo_description,
    lang: 'fr',
    start_url: '/?source=app',
    scope: '/',
    display: 'standalone',
    background_color: '#0c0807',
    theme_color: '#0c0807',
    icons: [
      { src: '/assets/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/assets/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/assets/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  });
}
