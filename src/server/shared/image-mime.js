import { extname } from 'node:path';

export const IMAGE_EXTENSION_TO_MIME_TYPE = Object.freeze({
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
});

export function getImageMimeType(filePath) {
  const extension = extname(String(filePath ?? '').toLowerCase());
  return IMAGE_EXTENSION_TO_MIME_TYPE[extension] ?? 'application/octet-stream';
}
