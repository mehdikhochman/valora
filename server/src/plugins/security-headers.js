// Security headers for every response. Routes may replace the Content-Security-Policy
// (the storefront does, to allow its inline script by hash) but never remove it.
import { config } from '../config.js';

// Photos come from this app (/media) or, on Vercel, from Vercel Blob's CDN.
export const IMG_SOURCES = "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com";

export const DEFAULT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  IMG_SOURCES,
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

const STATIC_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  // geolocation=(self): the checkout's "use my location" button needs it, nothing else does.
  'permissions-policy': 'camera=(), microphone=(), payment=(), usb=(), geolocation=(self)',
};

export function registerSecurityHeaders(app) {
  app.addHook('onSend', async (request, reply, payload) => {
    for (const [name, value] of Object.entries(STATIC_HEADERS)) reply.header(name, value);
    if (!reply.hasHeader('content-security-policy')) reply.header('content-security-policy', DEFAULT_CSP);
    if (config.isProduction) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    return payload;
  });
}
