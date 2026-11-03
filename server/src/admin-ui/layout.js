// The admin page shell: header, navigation, notices.
import fs from 'node:fs';
import { html } from '../lib/html.js';
import { sha256 } from '../lib/crypto.js';
import { csrfField, notice } from './components.js';

// Asset URLs carry a content hash, so browsers cache them for a year and still get updates instantly.
const ASSETS_DIR = new URL('./assets/', import.meta.url);
const version = (file) => sha256(fs.readFileSync(new URL(file, ASSETS_DIR))).slice(0, 10);
export const ASSET_VERSION = { css: version('admin.css'), js: version('admin.js') };

const NAV = [
  { href: '/admin', label: 'Dashboard', key: 'dashboard' },
  { href: '/admin/orders', label: 'Orders', key: 'orders', badge: 'newOrders' },
  { href: '/admin/perfumes', label: 'Perfumes', key: 'perfumes' },
  { href: '/admin/categories', label: 'Categories', key: 'categories' },
  { href: '/admin/collections', label: 'Collections', key: 'collections' },
  { href: '/admin/guide', label: 'Guide', key: 'guide' },
  { href: '/admin/settings', label: 'Settings', key: 'settings', ownerOnly: true },
  { href: '/admin/users', label: 'Team', key: 'users', ownerOnly: true },
  { href: '/admin/activity', label: 'Activity', key: 'activity' },
  { href: '/admin/backup', label: 'Backup', key: 'backup', ownerOnly: true },
];

function head(title) {
  return html`<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>${title} · Vallora admin</title>
    <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
    <link rel="stylesheet" href="/admin/assets/admin.css?v=${ASSET_VERSION.css}">
    <script src="/admin/assets/admin.js?v=${ASSET_VERSION.js}" defer></script>
  </head>`;
}

export function layout({ ctx, title, active, body, actions = '' }) {
  const { admin, newOrders = 0, notice: noticeKey } = ctx;
  const links = NAV.filter((item) => !item.ownerOnly || admin.role === 'owner');

  return html`<!doctype html><html lang="en">${head(title)}
  <body>
    <a class="skip" href="#main">Skip to content</a>
    <header class="top">
      <a class="brand" href="/admin">VALLORA <span>admin</span></a>
      <div class="top-right">
        <a href="/" target="_blank" rel="noopener">View shop</a>
        <a href="/admin/account">${admin.name}</a>
        <form method="post" action="/admin/logout" class="inline-form">${csrfField(admin.csrf_token)}<button class="link-button" type="submit">Log out</button></form>
      </div>
    </header>
    <div class="shell">
      <nav class="side" aria-label="Admin sections">
        ${links.map((item) => html`<a href="${item.href}" ${item.key === active ? 'aria-current="page"' : ''}>
          ${item.label}${item.badge === 'newOrders' && newOrders ? html` <span class="count">${newOrders}</span>` : ''}</a>`)}
      </nav>
      <main id="main" tabindex="-1">
        ${notice(noticeKey)}
        <div class="page-head"><h1>${title}</h1><div class="page-actions">${actions}</div></div>
        ${body}
      </main>
    </div>
  </body></html>`;
}

// Pages shown before login (login form) use a bare shell.
export function bareLayout({ title, body }) {
  return html`<!doctype html><html lang="en">${head(title)}<body class="bare"><main id="main">${body}</main></body></html>`;
}

export const SPECULATION_RULES = {
  prefetch: [{
    where: {
      and: [
        { href_matches: '/admin/*' },
        { not: { href_matches: '/admin/*.csv' } },
        { not: { selector_matches: '[data-no-prefetch]' } },
      ],
    },
    eagerness: 'moderate', // starts on hover/press, so most clicks open an already-loaded page
  }],
};
