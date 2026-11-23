import { deflateRawSync } from 'node:zlib';

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const PLANTUML_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

export function encodePlantUmlText(source = '') {
  const compressed = deflateRawSync(Buffer.from(String(source), 'utf-8'));
  const padded = Buffer.alloc(Math.ceil(compressed.length / 3) * 3);
  compressed.copy(padded);
  return padded.toString('base64url').replace(/./gu, (character) => (
    PLANTUML_ALPHABET[BASE64URL_ALPHABET.indexOf(character)]
  ));
}

function normalizeServerUrl(serverUrl) {
  const value = String(serverUrl || '').trim();
  if (!value) {
    return 'https://www.plantuml.com/plantuml';
  }

  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function normalizeSvgPayload(body = '') {
  const normalized = String(body)
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^(?:<\?[\s\S]*?\?>\s*|<!--[\s\S]*?-->\s*)+/i, '');

  return normalized;
}

const SVG_CACHE_LIMIT = 50;

export class PlantUmlRenderer {
  constructor({ fetchImpl = fetch, serverUrl } = {}) {
    this.fetchImpl = fetchImpl;
    this.serverUrl = normalizeServerUrl(serverUrl);
    this.svgCache = new Map();
    this.inflightRequests = new Map();
  }

  async renderSvg(source = '') {
    const cacheKey = String(source);
    const cached = this.svgCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    if (this.inflightRequests.has(cacheKey)) {
      return this.inflightRequests.get(cacheKey);
    }

    const request = this.fetchSvg(cacheKey).finally(() => {
      this.inflightRequests.delete(cacheKey);
    });
    this.inflightRequests.set(cacheKey, request);
    return request;
  }

  storeSvg(source, svgMarkup) {
    if (this.svgCache.has(source)) {
      this.svgCache.delete(source);
    }
    while (this.svgCache.size >= SVG_CACHE_LIMIT) {
      this.svgCache.delete(this.svgCache.keys().next().value);
    }
    this.svgCache.set(source, svgMarkup);
  }

  async fetchSvg(source = '') {
    const encoded = encodePlantUmlText(source);
    const requestUrl = `${this.serverUrl}/svg/${encoded}`;

    const response = await this.fetchImpl(requestUrl, {
      headers: {
        Accept: 'image/svg+xml, text/plain;q=0.9, */*;q=0.1',
      },
      signal: AbortSignal.timeout(20_000),
    });

    const body = await response.text();

    if (!response.ok) {
      const detail = body.trim() || `Upstream renderer returned ${response.status}`;
      const error = new Error(detail);
      error.statusCode = 502;
      throw error;
    }

    const normalizedSvg = normalizeSvgPayload(body);
    if (!normalizedSvg.startsWith('<svg')) {
      const error = new Error('Upstream renderer returned an invalid SVG payload');
      error.statusCode = 502;
      throw error;
    }

    this.storeSvg(source, normalizedSvg);
    return normalizedSvg;
  }
}
