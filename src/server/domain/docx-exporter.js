import { createRequire } from 'node:module';

import { mml2omml } from 'mathml2omml';

// Use the converter's own parser dependency so both sides interpret HTML alike.
const converterRequire = createRequire(import.meta.resolve('@turbodocx/html-to-docx'));
const { Parser } = converterRequire('htmlparser2');
const JSZip = converterRequire('jszip');
const EMBEDDED_IMAGE_PATTERN = /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,[a-z0-9+/]+={0,2}$/i;
const DOCX_MATH_KEY_PATTERN = /^COLLABMD-MATH-\d+$/;
const MATHML_ANNOTATION_PATTERN = /<annotation\b[^>]*>[\s\S]*?<\/annotation>/g;
// mpadded is purely presentational padding with no OMML equivalent; unwrap it
// and let the supported children through instead of dropping the subtree.
const MATHML_PADDED_PATTERN = /<mpadded\b[^>]*>([\s\S]*?)<\/mpadded>/g;
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

function collectDocxMath(html) {
  // Markers are generated markup holding only text, so a flat open/text/close
  // walk is enough; anything unexpected simply fails the key check below.
  const equations = [];
  let current = null;
  const parser = new Parser({
    onopentag(name, attribs = {}) {
      if (current || name !== 'span') {
        return;
      }

      const classes = String(attribs.class ?? '').split(/\s+/);
      if (!classes.includes('export-math') || !attribs['data-mml']) {
        return;
      }

      try {
        const mml = decodeURIComponent(attribs['data-mml']);
        if (mml.includes('<math')) {
          current = { key: '', mml };
        }
      } catch {
        current = null;
      }
    },
    ontext(text) {
      if (current) {
        current.key += text;
      }
    },
    onclosetag(name) {
      if (name !== 'span' || !current) {
        return;
      }

      const key = current.key.trim();
      if (DOCX_MATH_KEY_PATTERN.test(key)) {
        equations.push({ key, mml: current.mml });
      }
      current = null;
    },
  }, { decodeEntities: true });
  parser.end(String(html ?? ''));
  return equations;
}

function escapeDocxXml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// The OMML converter copies text content verbatim, so raw &/</> and HTML-only
// entities such as &nbsp; would reach document.xml unescaped and break Word's
// XML parsing. OMML output only uses m:/w: prefixed tags, so any other <
// starts text.
const OMML_TEXT_RUN_PATTERN = />([^<]*(?:<(?!\/?[A-Za-z][\w]*:)[^<]*)*)/g;

function escapeOmmlTextContent(omml) {
  return String(omml ?? '').replace(OMML_TEXT_RUN_PATTERN, (_match, text) => `>${
    String(text ?? '')
      .replace(/&(?!(?:amp|lt|gt|quot|apos|nbsp);|#\d+;|#x[\da-fA-F]+;)/g, '&amp;')
      .replace(/&nbsp;/g, '&#160;')
      .replace(/</g, '&lt;')
  }`);
}

function extractMathmlAnnotation(mml) {
  const match = String(mml ?? '').match(/<annotation\b[^>]*>([\s\S]*?)<\/annotation>/);
  return match?.[1]?.trim() ?? '';
}

function deduplicateOmmlArgPr(omml) {
  // The converter emits one m:argPr per transparent ancestor (mstyle, mrow),
  // but OOXML allows at most one per argument. Adjacent duplicates are never
  // legitimate, so collapse them; Word drops content after invalid markup.
  // Both elements must be self-contained (self-closing or self-closing
  // children only) so the match can never span a run or close tag.
  const simpleArgPr = '<m:argPr\\b(?![^>]*\\/>)[^>]*>(?:<m:[a-zA-Z]+\\b[^>]*\\/>\\s*)*<\\/m:argPr>|<m:argPr\\b[^>]*\\/>';
  const duplicatePattern = new RegExp(`(${simpleArgPr})\\s*(${simpleArgPr})`, 'g');
  let previous = null;
  let output = omml;
  while (output !== previous) {
    previous = output;
    output = output.replace(duplicatePattern, '$1');
  }
  return output;
}

function convertMathmlToOmml(mml) {
  try {
    return escapeOmmlTextContent(deduplicateOmmlArgPr(mml2omml(
      String(mml ?? '')
        .replace(MATHML_ANNOTATION_PATTERN, '')
        .replace(MATHML_PADDED_PATTERN, (_match, inner) => inner),
    )));
  } catch {
    return null;
  }
}

function findDocxParagraphStart(documentXml, index) {
  // Plain lastIndexOf('<w:p') also matches <w:pPr> and <w:pStyle, so the
  // character after the prefix must end the tag name.
  let start = documentXml.lastIndexOf('<w:p', index);
  while (start !== -1 && !/^[\s>/]/.test(documentXml[start + 4] ?? '')) {
    start = documentXml.lastIndexOf('<w:p', start - 1);
  }
  return start;
}

function enclosingDocxParagraph(documentXml, index) {
  const start = findDocxParagraphStart(documentXml, index);
  if (start === -1) {
    return null;
  }

  if (documentXml.lastIndexOf('</w:p>', index) > start) {
    return null;
  }

  const end = documentXml.indexOf('</w:p>', index);
  if (end === -1) {
    return null;
  }

  const close = end + '</w:p>'.length;
  return { end: close, start, xml: documentXml.slice(start, close) };
}

function isSoleMarkerParagraph(paragraphXml, key) {
  const texts = [...paragraphXml.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)]
    .map((match) => match[1])
    .join('');
  return texts === key;
}

// Display equations render as centered paragraphs: inline oMath shows in
// Word, Docs, and Pages, while oMathPara blocks are dropped by several
// renderers. The justification goes before run/section properties per the
// OOXML paragraph-property order.
const DOCX_CENTER_JUSTIFICATION = '<w:jc w:val="center"/>';

function centerDocxParagraph(paragraphXml) {
  if (/<w:jc\b/.test(paragraphXml)) {
    return paragraphXml;
  }

  if (/<w:pPr\b[^>]*>/.test(paragraphXml)) {
    return paragraphXml.replace(
      /(<w:pPr\b[^>]*>)([\s\S]*?)(<(?:w:rPr|w:sectPr|w:pPrChange)\b|<\/w:pPr>)/,
      `$1$2${DOCX_CENTER_JUSTIFICATION}$3`,
    );
  }

  return paragraphXml.replace(/<w:p\b[^>]*>/, (match) => `${match}<w:pPr>${DOCX_CENTER_JUSTIFICATION}</w:pPr>`);
}

function replaceDocxMathMarker(documentXml, { fallbackTex, key, omml }) {
  const fallbackRun = `<w:r><w:t xml:space="preserve">${escapeDocxXml(fallbackTex || key)}</w:t></w:r>`;
  const runPattern = new RegExp(`<w:r\\b[^>]*>\\s*(?:<w:rPr\\b(?:/>|>[\\s\\S]*?</w:rPr>)\\s*)?<w:t\\b[^>]*>${key}</w:t>\\s*</w:r>`);
  const runMatch = runPattern.exec(documentXml);

  if (runMatch) {
    const paragraph = enclosingDocxParagraph(documentXml, runMatch.index);
    if (
      omml
      && paragraph
      && !/<w:numPr\b/.test(paragraph.xml)
      && isSoleMarkerParagraph(paragraph.xml, key)
    ) {
      const centered = centerDocxParagraph(paragraph.xml);
      const innerMatch = runPattern.exec(centered);
      const withMath = innerMatch
        ? centered.slice(0, innerMatch.index) + omml + centered.slice(innerMatch.index + innerMatch[0].length)
        : centered;
      return documentXml.slice(0, paragraph.start) + withMath + documentXml.slice(paragraph.end);
    }

    const replacement = omml ?? fallbackRun;
    return documentXml.slice(0, runMatch.index) + replacement + documentXml.slice(runMatch.index + runMatch[0].length);
  }

  return documentXml.split(key).join(escapeDocxXml(fallbackTex || key));
}

async function injectDocxMathEquations(docxBuffer, equations) {
  const conversions = equations.map((equation) => ({
    fallbackTex: extractMathmlAnnotation(equation.mml),
    key: equation.key,
    omml: convertMathmlToOmml(equation.mml),
  }));

  const zip = await JSZip.loadAsync(docxBuffer);
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) {
    return docxBuffer;
  }

  let documentXml = await documentFile.async('string');
  for (const conversion of conversions) {
    documentXml = replaceDocxMathMarker(documentXml, conversion);
  }
  zip.file('word/document.xml', documentXml);
  const regenerated = await zip.generateAsync({ compression: 'DEFLATE', type: 'nodebuffer' });
  return Buffer.from(regenerated);
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

  const docxBuffer = normalizeDocxBuffer(result);
  const equations = collectDocxMath(content);
  if (equations.length === 0) {
    return docxBuffer;
  }

  return injectDocxMathEquations(docxBuffer, equations);
}
