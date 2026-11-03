// Builds the web images in public/brand from the originals in ../assets/brand.
// Run it again after replacing an original: `npm run brand`.
//
// The logo arrives as copper on black. The black is turned into transparency (the brightest
// channel becomes the alpha, and the colour is un-premultiplied), so the same file sits cleanly
// on any dark background, with its soft glow intact.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SOURCE = path.resolve(import.meta.dirname, '../../assets/brand');
const OUT = path.resolve(import.meta.dirname, '../public/brand');
const BLACK_POINT = 14;   // anything darker is fully transparent (JPEG noise)
const EMBLEM_ROWS = [96, 940];
const WORDMARK_ROWS = [946, 1124];
const DARK = { r: 12, g: 8, b: 7 };
const INK = { r: 28, g: 23, b: 20 };

async function transparentLogo() {
  const { data, info } = await sharp(path.join(SOURCE, 'logo-on-black.jpg')).raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 4);
  for (let p = 0, q = 0; p < data.length; p += 3, q += 4) {
    const peak = Math.max(data[p], data[p + 1], data[p + 2]);
    const alpha = Math.max(0, Math.min(255, Math.round(((peak - BLACK_POINT) * 255) / (255 - BLACK_POINT))));
    const scale = alpha ? 255 / Math.max(peak, 1) : 0;
    out[q] = Math.min(255, Math.round(data[p] * scale));
    out[q + 1] = Math.min(255, Math.round(data[p + 1] * scale));
    out[q + 2] = Math.min(255, Math.round(data[p + 2] * scale));
    out[q + 3] = alpha;
  }
  return { raw: out, width: info.width, height: info.height };
}

// Extract and trim are separate passes: in one pipeline sharp would trim first.
async function cropRows(logo, [top, bottom]) {
  const band = await sharp(logo.raw, { raw: { width: logo.width, height: logo.height, channels: 4 } })
    .extract({ left: 0, top, width: logo.width, height: bottom - top }).png().toBuffer();
  return sharp(band).trim({ threshold: 1 });
}

async function writeLogos(logo) {
  const emblem = await (await cropRows(logo, EMBLEM_ROWS)).png().toBuffer();
  const wordmark = await (await cropRows(logo, WORDMARK_ROWS)).png().toBuffer();
  const full = await (await cropRows(logo, [EMBLEM_ROWS[0], WORDMARK_ROWS[1]])).png().toBuffer();
  await sharp(emblem).resize({ height: 360 }).webp({ quality: 88, alphaQuality: 90 }).toFile(path.join(OUT, 'emblem.webp'));
  await sharp(emblem).resize({ height: 96 }).png({ compressionLevel: 9 }).toFile(path.join(OUT, 'emblem-96.png'));
  await sharp(wordmark).resize({ width: 640 }).webp({ quality: 90, alphaQuality: 92 }).toFile(path.join(OUT, 'wordmark.webp'));
  await sharp(full).resize({ width: 720 }).webp({ quality: 88, alphaQuality: 90 }).toFile(path.join(OUT, 'logo.webp'));
  // Solid ink versions for the light pages: the logo's shape, one flat colour.
  await inkVersion(emblem, { height: 120 }, 'emblem-ink.webp');
  await inkVersion(wordmark, { width: 640 }, 'wordmark-ink.webp');
  await inkVersion(full, { width: 480 }, 'logo-ink.webp');
  return { emblem, full };
}

async function inkVersion(source, size, name) {
  const resized = await sharp(source).resize(size).toBuffer();
  const { width, height } = await sharp(resized).metadata();
  // Faint glow pixels would print as grey haze; the alpha is pushed towards solid shapes.
  const alpha = await sharp(resized).extractChannel(3).linear(1.6, -40).toBuffer();
  await sharp({ create: { width, height, channels: 3, background: INK } })
    .joinChannel(alpha).webp({ quality: 90, alphaQuality: 95 }).toFile(path.join(OUT, name));
}

async function writeIcons(emblem) {
  for (const size of [180, 192, 512]) {
    const inner = Math.round(size * 0.72);
    const mark = await sharp(emblem).resize({ height: inner, width: inner, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
    await sharp({ create: { width: size, height: size, channels: 4, background: { ...DARK, alpha: 1 } } })
      .composite([{ input: mark, gravity: 'center' }])
      .png({ compressionLevel: 9 })
      .toFile(path.join(OUT, `icon-${size}.png`));
  }
}

// The picture shown when a link to the shop is shared on WhatsApp, Instagram or Facebook.
async function writeShareImage(full) {
  const logo = await sharp(full).resize({ height: 470 }).toBuffer();
  const glow = Buffer.from(`<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <defs><radialGradient id="g" cx="50%" cy="58%" r="60%"><stop offset="0" stop-color="#3a1d12"/><stop offset="1" stop-color="#0c0807"/></radialGradient></defs>
    <rect width="1200" height="630" fill="url(#g)"/></svg>`);
  await sharp(glow).composite([{ input: logo, gravity: 'center' }]).jpeg({ quality: 86, mozjpeg: true })
    .toFile(path.join(OUT, 'share.jpg'));
}

async function writePhotos() {
  const photos = { horizon: 'horizon.jpg', silhouette: 'silhouette.jpg', terracotta: 'logo-terracotta.jpg' };
  for (const [name, file] of Object.entries(photos)) {
    for (const width of [640, 1200]) {
      await sharp(path.join(SOURCE, file)).resize({ width, withoutEnlargement: true }).webp({ quality: 80 })
        .toFile(path.join(OUT, `${name}-${width}.webp`));
    }
  }
}

fs.mkdirSync(OUT, { recursive: true });
const logo = await transparentLogo();
const { emblem, full } = await writeLogos(logo);
await writeIcons(emblem);
await writeShareImage(full);
await writePhotos();
console.log(`Brand images written to ${OUT}`);
