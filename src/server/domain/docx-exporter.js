import { createRequire } from 'node:module';

// Use the converter's own parser dependency so both sides interpret HTML alike.
const converterRequire = createRequire(import.meta.resolve('@turbodocx/html-to-docx'));
const { Parser } = converterRequire('htmlparser2');
const EMBEDDED_IMAGE_PATTERN = /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,[a-z0-9+/]+={0,2}$/i;

const DOCX_EXPORTER_CREATOR = 'CollabMD';
let converterPromise = null;

function validateEmbeddedImages(html) {
  let name = '';
  const parser = new Parser({
    onopentagname(tagName) {
      name = tagName;
    },
    onattribute(attribute, value) {
      // Inspect duplicates too: the converter preserves attribute case.
      const isImageReference = attribute === 'src'
        || ((name === 'image' || name === 'use') && (attribute === 'href' || attribute === 'xlink:href'));
      if (isImageReference && !EMBEDDED_IMAGE_PATTERN.test(value) && !(name === 'use' && value.startsWith('#'))) {
        const error = new Error('DOCX images must be embedded data URLs');
        error.statusCode = 400;
        throw error;
      }
    },
  }, { decodeEntities: true });
  parser.end(html);
}

function normalizeDocxBuffer(result) {
  if (Buffer.isBuffer(result)) {
    return result;
  }

  if (result instanceof ArrayBuffer) {
    return Buffer.from(result);
  }

  if (ArrayBuffer.isView(result)) {
    return Buffer.from(result.buffer, result.byteOffset, result.byteLength);
  }

  throw new Error('DOCX exporter returned an unsupported payload');
}

async function ensureConverter() {
  if (!converterPromise) {
    converterPromise = import('@turbodocx/html-to-docx').then((module) => {
      const converter = module?.default ?? module?.HTMLToDOCX ?? module;
      if (typeof converter !== 'function') {
        throw new Error('DOCX converter failed to load');
      }
      return converter;
    });
  }

  return converterPromise;
}

export async function renderDocx({
  html,
  title = '',
} = {}) {
  const content = String(html ?? '');
  validateEmbeddedImages(content);
  const converter = await ensureConverter();
  const result = await converter(content, null, {
    creator: DOCX_EXPORTER_CREATOR,
    font: 'Arial',
    footer: false,
    pageNumber: false,
    // Avoid a second HTML/CSS preprocessing pass after validation.
    preprocessing: { skipHTMLMinify: true },
    table: {
      row: {
        cantSplit: true,
      },
    },
    title: String(title ?? ''),
  });

  return normalizeDocxBuffer(result);
}
