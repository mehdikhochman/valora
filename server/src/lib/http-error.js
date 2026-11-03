// Expected failures (bad input, not found, forbidden). The central error handler
// shows `message` to the user; anything else is logged and shown as a generic error.
export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.expose = true;
  }
}

export const notFound = (what = 'Page') => new HttpError(404, `${what} not found.`);
export const forbidden = () => new HttpError(403, 'You do not have access to this page.');
export const badRequest = (message) => new HttpError(400, message);
