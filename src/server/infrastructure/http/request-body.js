import { createRequestError } from './http-errors.js';

export const REQUEST_BODY_LIMIT_BYTES = 8_388_608;

async function readRequestBuffer(req, maxBytes = REQUEST_BODY_LIMIT_BYTES) {
  const chunks = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    if (tooLarge) continue;
    size += chunk.length;
    if (size > maxBytes) {
      chunks.length = 0;
      tooLarge = true;
    } else {
      chunks.push(chunk);
    }
  }
  if (tooLarge) throw createRequestError(413, 'Request body too large');
  return Buffer.concat(chunks);
}

export async function readRequestBody(req, maxBytes = REQUEST_BODY_LIMIT_BYTES) {
  const bodyBuffer = await readRequestBuffer(req, maxBytes);
  return bodyBuffer.toString('utf-8');
}

export async function readBinaryRequestBody(req, maxBytes = REQUEST_BODY_LIMIT_BYTES) {
  return readRequestBuffer(req, maxBytes);
}

export async function parseJsonBody(req, maxBytes = REQUEST_BODY_LIMIT_BYTES) {
  const rawBody = await readRequestBody(req, maxBytes);

  try {
    return JSON.parse(rawBody);
  } catch {
    throw createRequestError(400, 'Invalid JSON payload');
  }
}
