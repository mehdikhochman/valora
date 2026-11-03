import { html } from '../../lib/html.js';
import { bareLayout } from '../layout.js';

export function loginPage({ error, email = '', next = '/admin' }) {
  return bareLayout({
    title: 'Log in',
    body: html`<form class="login" method="post" action="/admin/login">
      <p class="brand">OKEANÓS <span>admin</span></p>
      <h1>Log in</h1>
      ${error ? html`<p class="error-summary" role="alert">${error}</p>` : ''}
      <input type="hidden" name="next" value="${next}">
      <div class="field"><label for="f-email">Email</label>
        <input id="f-email" name="email" type="email" autocomplete="username" required value="${email}" autofocus></div>
      <div class="field"><label for="f-password">Password</label>
        <input id="f-password" name="password" type="password" autocomplete="current-password" required></div>
      <button class="button" type="submit">Log in</button>
    </form>`,
  });
}
