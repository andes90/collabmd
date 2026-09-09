import { extname } from 'node:path';

const IMAGE_MIME_TYPES = Object.freeze({
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
});

export function getImageMimeType(filePath) {
  const extension = extname(String(filePath ?? '').toLowerCase());
  return IMAGE_MIME_TYPES[extension] ?? 'application/octet-stream';
}
