// Stores uploaded images. Every upload is decoded and re-encoded by sharp, which
// strips EXIF/GPS data and makes sure the file really is an image, then saved as
// WebP in two widths under a content-hash name (so URLs can be cached forever).
//
// Two places to keep the files:
//   local - the DATA_DIR/media folder, served by this app at /media (development, VPS)
//   blob  - Vercel Blob (Vercel deployments, whose disk is temporary):
//           a public store serves photos from its own CDN address;
//           a private store cannot, so this app serves them at /media and Vercel's CDN caches them.
import fs from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import * as vercelBlob from '@vercel/blob';
import { sha256 } from './crypto.js';
import { badRequest } from './http-error.js';

export const IMAGE_WIDTHS = [480, 1200];
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'];
export const LOCAL_BASE_URL = '/media';
const MAX_INPUT_PIXELS = 50_000_000;
const FILE_KEY_LENGTH = 20;
const fileName = (fileKey, width) => `${fileKey}-${width}.webp`;

export function mediaUrl(image, width) {
  return `${image.base_url ?? LOCAL_BASE_URL}/${fileName(image.file_key, width)}`;
}

async function encode(buffer) {
  let metadata;
  let isOpaque;
  try {
    const input = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
    [metadata, { isOpaque }] = await Promise.all([input.metadata(), input.stats()]);
  } catch {
    throw badRequest('This file could not be read as an image. Use a JPEG, PNG or WebP photo.');
  }
  const versions = await Promise.all(IMAGE_WIDTHS.map(async (width) => {
    const { data, info } = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate() // apply the phone's orientation flag before it is stripped
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 80, alphaQuality: 90, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    return { width, data, info };
  }));
  const largest = versions.at(-1).info;
  return {
    fileKey: sha256(buffer).slice(0, FILE_KEY_LENGTH),
    width: largest.width ?? metadata.width,
    height: largest.height ?? metadata.height,
    hasAlpha: !isOpaque,
    versions,
  };
}

function localStore(mediaDir) {
  mkdirSync(mediaDir, { recursive: true });
  return {
    dir: mediaDir,
    // Returns the file's bytes, or null. Callers have already checked the name's pattern.
    async read(name) {
      try {
        return await fs.readFile(path.join(mediaDir, name));
      } catch {
        return null;
      }
    },
    async save(buffer) {
      const { versions, ...image } = await encode(buffer);
      await Promise.all(versions.map((v) => fs.writeFile(path.join(mediaDir, fileName(image.fileKey, v.width)), v.data)));
      return { ...image, baseUrl: LOCAL_BASE_URL };
    },
    async remove(image) {
      await Promise.all(IMAGE_WIDTHS.map((width) => fs.rm(path.join(mediaDir, fileName(image.file_key, width)), { force: true })));
    },
  };
}

const PRIVATE_STORE_ERROR = /private store|configured with private access/i;

// `blob` is the @vercel/blob module; tests pass a stand-in.
export function blobStore(token, blob = vercelBlob) {
  // Stores are created public or private and the setting cannot be read up front, so start with
  // public and switch for good the first time the store says it is private.
  let access = 'public';

  async function upload(pathname, data) {
    const options = {
      token, // undefined means: sign in with BLOB_STORE_ID and Vercel's OIDC token
      contentType: 'image/webp',
      addRandomSuffix: false, // the name is already a content hash
      allowOverwrite: true,
      cacheControlMaxAge: 365 * 24 * 60 * 60,
    };
    // Uploads run in parallel, so judge each failure by the access *this* upload tried.
    const tried = access;
    try {
      return await blob.put(pathname, data, { ...options, access: tried });
    } catch (error) {
      if (tried !== 'public' || !PRIVATE_STORE_ERROR.test(error.message)) throw error;
      access = 'private';
      return blob.put(pathname, data, { ...options, access: 'private' });
    }
  }

  return {
    dir: null,
    async save(buffer) {
      const { versions, ...image } = await encode(buffer);
      const uploads = await Promise.all(versions.map((v) => upload(`media/${fileName(image.fileKey, v.width)}`, v.data)));
      // Public files are linked to directly; private ones go through this app's /media route.
      const baseUrl = access === 'public' ? uploads[0].url.slice(0, uploads[0].url.lastIndexOf('/')) : LOCAL_BASE_URL;
      return { ...image, baseUrl };
    },
    // Only private photos are read through the app; public ones never reach this.
    async read(name) {
      const result = await blob.get(`media/${name}`, { access: 'private', token });
      if (!result?.stream) return null;
      return Buffer.from(await new Response(result.stream).arrayBuffer());
    },
    async remove(image) {
      await blob.del(IMAGE_WIDTHS.map((width) => `media/${fileName(image.file_key, width)}`), { token });
    },
  };
}

export function createMediaStore({ driver, mediaDir, blobToken }) {
  return driver === 'blob' ? blobStore(blobToken) : localStore(mediaDir);
}
