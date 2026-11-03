import { html } from '../../lib/html.js';
import { formatDate, formatMoney, timeAgo, whatsAppDigits } from '../../lib/format.js';
import { ORDER_STATUSES, ORDER_STATUS_LABELS } from '../../repositories/orders.js';
import { layout } from '../layout.js';
import { actionButton, csrfField, emptyState, pagination, statusPill } from '../components.js';

export function ordersListPage({ ctx, orders, counts, filters, page, pageCount }) {
  const tabs = [['', 'All'], ...ORDER_STATUSES.map((status) => [status, ORDER_STATUS_LABELS[status]])];
  const query = (overrides) => {
    const params = new URLSearchParams({ ...filters, ...overrides });
    for (const [key, value] of [...params]) if (!value || value === '1' && key === 'page') params.delete(key);
    const text = params.toString();
    return `/admin/orders${text ? `?${text}` : ''}`;
  };

  return layout({
    ctx, title: 'Orders', active: 'orders',
    actions: html`<a class="button secondary" href="/admin/orders.csv" data-no-prefetch>Download CSV</a>`,
    body: html`
      <nav class="tabs" aria-label="Filter by status">
        ${tabs.map(([status, label]) => html`<a href="${query({ status, page: '' })}" ${filters.status === status ? 'aria-current="page"' : ''}>
          ${label}${status ? html` <span class="count">${counts[status]}</span>` : ''}</a>`)}
      </nav>
      <form class="search" method="get" action="/admin/orders" role="search">
        <input type="hidden" name="status" value="${filters.status}">
        <label class="visually-hidden" for="order-search">Search orders</label>
        <input id="order-search" name="q" type="search" value="${filters.q}" placeholder="Order number, name, phone or city">
        <button class="button secondary" type="submit">Search</button>
      </form>
      ${orders.length ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th>Order</th><th>Placed</th><th>Customer</th><th>Phone</th><th>City</th><th class="num">Perfumes</th><th class="num">Total</th><th>Status</th></tr></thead>
        <tbody>${orders.map((order) => html`<tr>
          <td><a href="/admin/orders/${order.id}"><b>${order.number}</b></a></td>
          <td title="${formatDate(order.created_at)}">${timeAgo(order.created_at)}</td>
          <td>${order.customer_name}</td>
          <td><a href="tel:${order.phone.replace(/[^\d+]/g, '')}">${order.phone}</a></td>
          <td>${order.city}</td>
          <td class="num">${order.item_count}</td>
          <td class="num">${formatMoney(order.total_cents, order.currency)}</td>
          <td>${statusPill(order.status)}</td></tr>`)}
        </tbody></table></div>
        ${pagination({ page, pageCount, buildUrl: (n) => query({ page: String(n) }) })}`
        : emptyState(filters.q || filters.status ? 'No orders match this filter.' : 'No orders yet. Each order a customer sends on WhatsApp from the site appears here with its number.')}`,
  });
}

function customerLinks(order, brandName, countryCode) {
  const wa = whatsAppDigits(order.phone, countryCode);
  const message = encodeURIComponent(`Bonjour ${order.customer_name.split(' ')[0]}, ici ${brandName} au sujet de votre commande ${order.number}.`);
  return html`<div class="quick-contact">
    <a class="button" href="https://wa.me/${wa}?text=${message}" target="_blank" rel="noopener">WhatsApp ${order.customer_name.split(' ')[0]}</a>
    <a class="button secondary" href="tel:${order.phone.replace(/[^\d+]/g, '')}">Call</a>
    ${order.email ? html`<a class="button secondary" href="mailto:${order.email}?subject=${encodeURIComponent(`Your order ${order.number}`)}">Email</a>` : ''}
  </div>`;
}

function deliveryBlock(order) {
  const hasPin = order.latitude !== null && order.longitude !== null;
  const mapUrl = hasPin ? `https://www.google.com/maps/search/?api=1&query=${order.latitude},${order.longitude}` : '';
  return html`<dl class="details">
    <dt>Method</dt><dd>${order.delivery_method === 'pickup' ? 'Pick-up at the boutique' : 'Delivery'}</dd>
    <dt>City</dt><dd>${order.city}</dd>
    <dt>Address</dt><dd class="pre">${order.address}</dd>
    <dt>Location</dt><dd>${hasPin
      ? html`<a href="${mapUrl}" target="_blank" rel="noopener">Open the pin in Google Maps</a> <span class="muted">(within about ${order.location_accuracy_m ?? '?'} m)</span>`
      : html`<span class="muted">Not shared</span>`}</dd>
    ${order.customer_note ? html`<dt>Customer note</dt><dd class="pre">${order.customer_note}</dd>` : ''}
  </dl>`;
}

export function orderDetailPage({ ctx, order, brandName, countryCode }) {
  const csrf = ctx.admin.csrf_token;
  const nextStep = { new: 'confirmed', confirmed: 'preparing', preparing: 'out_for_delivery', out_for_delivery: 'delivered' }[order.status];

  return layout({
    ctx, title: `Order ${order.number}`, active: 'orders',
    actions: html`<button class="button secondary" type="button" data-print>Print delivery slip</button>`,
    body: html`
      <p class="muted">Placed ${formatDate(order.created_at)} · ${statusPill(order.status)}</p>
      <div class="columns">
        <section class="panel">
          <h2>Customer</h2>
          <p class="big">${order.customer_name}</p>
          <p><a href="tel:${order.phone.replace(/[^\d+]/g, '')}">${order.phone}</a>${order.email ? html` · <a href="mailto:${order.email}">${order.email}</a>` : ''}</p>
          ${customerLinks(order, brandName, countryCode)}
          <h2>Delivery</h2>
          ${deliveryBlock(order)}
        </section>
        <section class="panel">
          <h2>Perfumes</h2>
          <table class="table compact">
            <thead><tr><th>Perfume</th><th class="num">Qty</th><th class="num">Price</th></tr></thead>
            <tbody>${order.items.map((item) => html`<tr>
              <td>${item.perfume_name}${item.option_label ? html`<br><span class="muted">${item.option_label}</span>` : ''}</td>
              <td class="num">${item.quantity}</td>
              <td class="num">${formatMoney(item.unit_price_cents === null ? null : item.unit_price_cents * item.quantity, order.currency)}</td></tr>`)}
            </tbody>
            <tfoot>
              <tr><td colspan="2">Perfumes</td><td class="num">${formatMoney(order.subtotal_cents, order.currency)}</td></tr>
              <tr><td colspan="2">Delivery</td><td class="num">${formatMoney(order.delivery_cents, order.currency)}</td></tr>
              <tr class="total"><td colspan="2">Total</td><td class="num">${order.total_cents === null ? 'To confirm' : formatMoney(order.total_cents, order.currency)}</td></tr>
            </tfoot>
          </table>
          ${order.total_cents === null ? html`<p class="help">Some perfumes had no price when ordered. Agree the total with the customer.</p>` : ''}

          <h2>Status</h2>
          ${nextStep ? actionButton({
            action: `/admin/orders/${order.id}/status`, csrf, className: 'button',
            label: `Mark as ${ORDER_STATUS_LABELS[nextStep].toLowerCase()}`, hidden: { status: nextStep },
          }) : ''}
          <form method="post" action="/admin/orders/${order.id}" class="stack" data-dirty-check>
            ${csrfField(csrf)}
            <div class="field"><label for="f-status">Status</label>
              <select id="f-status" name="status">${ORDER_STATUSES.map((status) =>
                html`<option value="${status}" ${status === order.status ? 'selected' : ''}>${ORDER_STATUS_LABELS[status]}</option>`)}</select></div>
            <div class="field"><label for="f-admin_note">Private note <span class="optional">(only the team sees this)</span></label>
              <textarea id="f-admin_note" name="admin_note" rows="3" maxlength="1000">${order.admin_note}</textarea></div>
            <button class="button" type="submit">Save</button>
          </form>
          ${ctx.admin.role === 'owner' ? actionButton({
            action: `/admin/orders/${order.id}/delete`, csrf, label: 'Delete this order', className: 'link-button danger',
            confirm: `Delete order ${order.number}? This cannot be undone. Use "Cancelled" to keep a record instead.`,
          }) : ''}
        </section>
      </div>`,
  });
}
