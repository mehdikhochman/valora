// One place decides what a failure looks like: JSON for the API, a page for humans.
// Expected errors (HttpError, validation, rate limit) show their message;
// anything else is logged in full and shown as a generic sentence.
import { html } from '../lib/html.js';

const GENERIC_MESSAGE = 'Something went wrong on our side. Please try again in a moment.';

function messageFor(error) {
  if (error.validation) return 'Some of the information sent is not valid.';
  if (error.statusCode === 429) return 'Too many attempts. Please wait a few minutes and try again.';
  if (error.expose || (error.statusCode >= 400 && error.statusCode < 500)) return error.message;
  return GENERIC_MESSAGE;
}

function errorPage(statusCode, message, isAdmin) {
  const backLink = isAdmin ? html`<a href="/admin">Back to the dashboard</a>` : html`<a href="/">Back to the shop</a>`;
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${statusCode === 404 ? 'Not found' : 'Error'} · Ōkeanós</title>
    <link rel="stylesheet" href="/assets/error.css"></head>
    <body><main><p class="code">${statusCode}</p><h1>${message}</h1><p>${backLink}</p></main></body></html>`.toString();
}

function send(request, reply, statusCode, message) {
  reply.code(statusCode);
  if (request.url.startsWith('/api/')) return reply.send({ error: message });
  return reply.type('text/html; charset=utf-8').send(errorPage(statusCode, message, request.url.startsWith('/admin')));
}

export function registerErrorHandling(app) {
  app.setErrorHandler((error, request, reply) => {
    const statusCode = error.validation ? 400 : (error.statusCode ?? 500);
    if (statusCode >= 500) request.log.error({ err: error }, 'Unhandled error');
    return send(request, reply, statusCode, messageFor({ ...error, message: error.message, statusCode }));
  });

  app.setNotFoundHandler((request, reply) => send(request, reply, 404, 'This page does not exist.'));
}
