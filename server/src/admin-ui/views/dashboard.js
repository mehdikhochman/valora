import { html } from '../../lib/html.js';
import { formatMoney, timeAgo } from '../../lib/format.js';
import { layout } from '../layout.js';
import { actionButton, statusPill } from '../components.js';

function stat(label, value, href) {
  const content = html`<span class="stat-value">${value}</span><span class="stat-label">${label}</span>`;
  return href ? html`<a class="stat" href="${href}">${content}</a>` : html`<div class="stat">${content}</div>`;
}

const FUNNEL_STEPS = [
  ['visit', 'Visits'], ['view', 'Perfumes viewed'], ['add', 'Added to a selection'],
  ['checkout', 'Orders prepared'], ['whatsapp', 'WhatsApp opened'],
];

const percent = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');

// Visits per day as small bars: enough to see a trend or the effect of an Instagram post.
function visitsSparkline(daily, days) {
  const byDay = new Map(daily.filter((row) => row.event === 'visit').map((row) => [row.day, row.total]));
  const values = Array.from({ length: days }, (_, index) => {
    const day = new Date(Date.now() - (days - 1 - index) * 86400000).toISOString().slice(0, 10);
    return [day, byDay.get(day) ?? 0];
  });
  const max = Math.max(1, ...values.map(([, value]) => value));
  // Heights are classes of 10% steps: the admin's CSP does not allow inline styles.
  return html`<div class="spark" role="img" aria-label="Visits per day over the last ${days} days">${values.map(([day, value]) =>
    html`<i class="h${Math.round((value / max) * 10)}" title="${day}: ${value}"></i>`)}</div>`;
}

function analyticsPanel({ funnel, daily, interest, days }) {
  const top = funnel.visit || Math.max(...Object.values(funnel), 0);
  return html`<section class="panel">
    <h2>Shop activity, last ${days} days</h2>
    <p class="help">Anonymous counts: no cookies and no personal data. Use them to see what attracts and where visitors stop.</p>
    ${visitsSparkline(daily, days)}
    <div class="funnel">${FUNNEL_STEPS.map(([key, label]) => html`<div class="funnel-row">
      <span>${label}</span>
      <span class="funnel-bar"><i class="w${Math.round(((funnel[key] ?? 0) / Math.max(top, 1)) * 10)}"></i></span>
      <span class="num">${funnel[key] ?? 0}</span></div>`)}</div>
    <p class="help">From visit to WhatsApp: <b>${percent(funnel.whatsapp, funnel.visit)}</b> ·
      Scent finder completed ${funnel.quiz} times · ${funnel.search} searches</p>
    <h2>Most looked at</h2>
    ${interest.length ? html`<table class="table compact"><thead><tr><th>Perfume</th><th class="num">Views</th><th class="num">Added</th><th class="num">Rate</th></tr></thead><tbody>
      ${interest.map((row) => html`<tr><td><a href="/admin/perfumes/${row.id}">${row.name}</a></td><td class="num">${row.views}</td><td class="num">${row.adds}</td><td class="num">${percent(row.adds, row.views)}</td></tr>`)}
    </tbody></table><p class="help">Many views but few additions often means the price or the photo needs attention.</p>`
    : html`<p class="muted">Counts appear as soon as visitors browse the shop.</p>`}
  </section>`;
}

function launchChecklist(settings, launch) {
  const items = [
    [Boolean(settings.whatsapp_number), 'WhatsApp number set: every order is sent there', '/admin/settings'],
    [launch.untouched === 0, launch.untouched
      ? `${launch.untouched} starter perfumes still show example names and prices: open each one to confirm or replace it`
      : 'Every perfume has been reviewed', '/admin/perfumes'],
    [launch.without_photos === 0, launch.without_photos
      ? `${launch.without_photos} perfumes use a drawn bottle: upload a photo (a PNG with a transparent background looks best)`
      : 'Every perfume has a photo', '/admin/perfumes'],
    [settings.delivery_fee !== '', 'Delivery fee set (otherwise it is confirmed on WhatsApp)', '/admin/settings'],
    [Boolean(settings.instagram_handle || settings.tiktok_handle), 'Instagram or TikTok linked', '/admin/settings'],
  ];
  if (items.every(([done]) => done)) return '';
  return html`<section class="panel"><h2>Before launch</h2><ul class="checklist">${items.map(([done, text, href]) => html`<li>
    <span class="state ${done ? 'done' : 'todo'}">${done ? '✓' : '•'}</span>${done ? text : html`<a href="${href}">${text}</a>`}</li>`)}</ul></section>`;
}

export function dashboardPage({ ctx, stats, recentOrders, topPerfumes, activity, settings, analytics, launch }) {
  const ordersOpen = settings.orders_open === '1';
  const shopStatus = html`<section class="panel shop-status ${ordersOpen ? 'open' : 'paused'}">
    <p><b>${ordersOpen ? 'The shop is taking orders.' : 'Orders are paused.'}</b>
      ${ordersOpen ? 'Customers can place orders on the site.' : 'Customers can browse but not order.'}</p>
    ${ctx.admin.role === 'owner' ? actionButton({
      action: '/admin/settings/orders-open', csrf: ctx.admin.csrf_token, className: 'button secondary',
      label: ordersOpen ? 'Pause orders' : 'Resume orders', hidden: { open: ordersOpen ? '0' : '1' },
      confirm: ordersOpen ? 'Pause new orders? Visitors will see your "orders paused" message.' : '',
    }) : ''}
  </section>`;

  return layout({
    ctx, title: 'Dashboard', active: 'dashboard',
    body: html`
      ${shopStatus}
      ${launchChecklist(settings, launch)}
      <div class="stats">
        ${stat('New orders to confirm', stats.newOrders, '/admin/orders?status=new')}
        ${stat('Orders in the last 7 days', stats.week.orders, '/admin/orders')}
        ${stat('Sales in the last 30 days', stats.month.total_cents > 0 ? formatMoney(stats.month.total_cents, settings.currency) : '—')}
        ${stat('Perfumes live in the shop', stats.perfumes.published, '/admin/perfumes?status=published')}
        ${stat('Drafts', stats.perfumes.draft, '/admin/perfumes?status=draft')}
      </div>
      <div class="columns">
        <section class="panel">
          <h2>Latest orders</h2>
          ${recentOrders.length ? html`<table class="table compact"><tbody>
            ${recentOrders.map((order) => html`<tr>
              <td><a href="/admin/orders/${order.id}">${order.number}</a></td>
              <td>${order.customer_name}<br><span class="muted">${order.city}</span></td>
              <td>${statusPill(order.status)}</td>
              <td class="muted">${timeAgo(order.created_at)}</td></tr>`)}
          </tbody></table><p><a href="/admin/orders">All orders</a></p>` : html`<p class="muted">No orders yet. Each order sent on WhatsApp from the site also appears here, with its number.</p>`}
        </section>
        <section class="panel">
          <h2>Most ordered, last 30 days</h2>
          ${topPerfumes.length ? html`<ol class="ranked">${topPerfumes.map((row) => html`<li><span>${row.perfume_name}</span><b>${row.quantity}</b></li>`)}</ol>`
            : html`<p class="muted">Not enough orders yet.</p>`}
          <h2>Recent changes</h2>
          <ul class="activity">${activity.map((entry) => html`<li><b>${entry.user_name ?? 'System'}</b> ${entry.summary} <span class="muted">${timeAgo(entry.created_at)}</span></li>`)}</ul>
        </section>
      </div>
      ${analyticsPanel(analytics)}`,
  });
}
