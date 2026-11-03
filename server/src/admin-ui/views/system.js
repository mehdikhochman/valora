import { html } from '../../lib/html.js';
import { formatDate } from '../../lib/format.js';
import { layout } from '../layout.js';
import { csrfField, pagination } from '../components.js';

export function activityPage({ ctx, entries, page, pageCount }) {
  return layout({
    ctx, title: 'Activity', active: 'activity',
    body: html`
      <p class="help">Every change made in the admin, newest first.</p>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
        <tbody>${entries.map((entry) => html`<tr>
          <td class="nowrap">${formatDate(entry.created_at)}</td>
          <td>${entry.user_name ?? 'System'}</td>
          <td>${entry.summary}</td></tr>`)}</tbody>
      </table></div>
      ${pagination({ page, pageCount, buildUrl: (n) => `/admin/activity?page=${n}` })}`,
  });
}

export function backupPage({ ctx }) {
  return layout({
    ctx, title: 'Backup', active: 'backup',
    body: html`
      <section class="panel narrow">
        <h2>Download a backup</h2>
        <p>One JSON file with everything: perfumes, orders, customers, settings and the team. Keep it somewhere private: it contains customer details.</p>
        <form method="post" action="/admin/backup/database" data-no-busy>
          ${csrfField(ctx.admin.csrf_token)}
          <button class="button" type="submit">Download backup</button>
        </form>
        <p class="help">Photos are stored separately (Vercel Blob, or the <code>data/media</code> folder when self-hosted). Turso also keeps its own automatic backups of the database.</p>
      </section>
      <section class="panel narrow">
        <h2>Spreadsheets</h2>
        <p><a href="/admin/orders.csv" data-no-prefetch>Download all orders (CSV)</a>. It opens in Excel, Numbers or Google Sheets.</p>
      </section>
      <section class="panel narrow">
        <h2>When was this made?</h2>
        <p class="muted">Server time: ${formatDate(new Date().toISOString())} (shop time zone)</p>
      </section>`,
  });
}
