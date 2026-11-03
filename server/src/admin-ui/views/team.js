// Team members (owner only) and each person's own account page.
import { html } from '../../lib/html.js';
import { formatDate } from '../../lib/format.js';
import { MIN_PASSWORD_LENGTH } from '../../lib/crypto.js';
import { layout } from '../layout.js';
import { actionButton, csrfField, errorSummary, input, select } from '../components.js';

const ROLE_OPTIONS = [['editor', 'Editor: perfumes, content and orders'], ['owner', 'Owner: everything, including settings and team']];

export function usersPage({ ctx, users, errors = {}, values = {} }) {
  const csrf = ctx.admin.csrf_token;
  return layout({
    ctx, title: 'Team', active: 'users',
    body: html`
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last login</th><th><span class="visually-hidden">Actions</span></th></tr></thead>
        <tbody>${users.map((user) => {
          const isMe = user.id === ctx.admin.user_id;
          return html`<tr>
            <td>${user.name}${isMe ? html` <span class="tag">You</span>` : ''}</td>
            <td>${user.email}</td>
            <td>${isMe ? user.role : html`<form method="post" action="/admin/users/${user.id}/role" class="inline-form" data-autosubmit>
              ${csrfField(csrf)}
              <label class="visually-hidden" for="role-${user.id}">Role for ${user.name}</label>
              <select id="role-${user.id}" name="role">${['editor', 'owner'].map((role) => html`<option value="${role}" ${role === user.role ? 'selected' : ''}>${role}</option>`)}</select>
              <button class="button secondary small" type="submit">Change</button></form>`}</td>
            <td>${formatDate(user.last_login_at)}</td>
            <td>${isMe ? '' : html`
              ${actionButton({ action: `/admin/users/${user.id}/reset-password`, csrf, label: 'New password', confirm: `Create a new password for ${user.name}? Their current password stops working.` })}
              ${actionButton({ action: `/admin/users/${user.id}/delete`, csrf, label: 'Remove', className: 'link-button danger', confirm: `Remove ${user.name} from the team?` })}`}</td>
          </tr>`;
        })}</tbody></table></div>
      <form method="post" action="/admin/users" class="panel stack narrow">
        ${csrfField(csrf)}
        <h2>Add someone</h2>
        ${errorSummary(errors)}
        ${input({ name: 'name', label: 'Name', value: values.name, required: true, max: 60, error: errors.name })}
        ${input({ name: 'email', label: 'Email', type: 'email', value: values.email, required: true, max: 120, error: errors.email })}
        ${select({ name: 'role', label: 'Role', value: values.role ?? 'editor', options: ROLE_OPTIONS })}
        <p class="help">A password is created for them and shown once. Send it to them privately; they can change it on their account page.</p>
        <button class="button" type="submit">Add to team</button>
      </form>`,
  });
}

export function passwordCreatedPage({ ctx, user, password }) {
  return layout({
    ctx, title: 'Password created', active: 'users',
    body: html`<section class="panel narrow">
      <p>This is the password for <b>${user.name}</b> (${user.email}). It is shown only once.</p>
      <p class="secret"><code id="new-password">${password}</code> <button class="button secondary small" type="button" data-copy="#new-password">Copy</button></p>
      <p class="help">Send it privately (not in a group chat). They should change it after logging in, on their account page.</p>
      <p><a class="button" href="/admin/users">Done</a></p>
    </section>`,
  });
}

export function accountPage({ ctx, errors = {}, sessionCount }) {
  const csrf = ctx.admin.csrf_token;
  return layout({
    ctx, title: 'My account', active: '',
    body: html`
      <section class="panel narrow">
        <p><b>${ctx.admin.name}</b> · ${ctx.admin.email} · ${ctx.admin.role}</p>
      </section>
      <form method="post" action="/admin/account/password" class="panel stack narrow">
        ${csrfField(csrf)}
        <h2>Change password</h2>
        ${errorSummary(errors)}
        ${input({ name: 'current_password', label: 'Current password', type: 'password', required: true, error: errors.current_password, attrs: html`autocomplete="current-password"` })}
        ${input({ name: 'new_password', label: 'New password', type: 'password', required: true, error: errors.new_password,
          help: `At least ${MIN_PASSWORD_LENGTH} characters. A short sentence is easy to remember and hard to guess.`, attrs: html`autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}"` })}
        ${input({ name: 'confirm_password', label: 'New password again', type: 'password', required: true, error: errors.confirm_password, attrs: html`autocomplete="new-password"` })}
        <button class="button" type="submit">Change password</button>
      </form>
      <section class="panel narrow">
        <h2>Devices</h2>
        <p>You are logged in on ${sessionCount} ${sessionCount === 1 ? 'device' : 'devices'}.</p>
        ${sessionCount > 1 ? actionButton({ action: '/admin/account/sessions', csrf, label: 'Log out everywhere else', className: 'button secondary' }) : ''}
      </section>`,
  });
}
