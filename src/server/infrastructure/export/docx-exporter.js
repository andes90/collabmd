import { createRequire } from 'node:module';

import { convertDocxEquation, MATH_NAMESPACE, parseDocxXml } from './docx-equation.js';

// Use the converter's own parser dependency so both sides interpret HTML alike.
const converterRequire = createRequire(import.meta.resolve('@turbodocx/html-to-docx'));
const { Parser } = converterRequire('htmlparser2');
const JSZip = converterRequire('jszip');
const MC_NAMESPACE = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const EMBEDDED_IMAGE_PATTERN = /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,[a-z0-9+/]+={0,2}$/i;
const DOCX_MATH_KEY_PATTERN = /^COLLABMD-MATH-\d+$/;
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
  // Current clients send a preview image. Older clients send a text marker.
  const equations = [];
  let current = null;
  const parser = new Parser({
    onopentag(name, attribs = {}) {
      if (current || (name !== 'span' && name !== 'img')) {
        return;
      }

      const classes = String(attribs.class ?? '').split(/\s+/);
      if (!classes.includes('export-math') || !attribs['data-mml']) {
        return;
      }

      try {
        const mml = decodeURIComponent(attribs['data-mml']);
        if (mml.includes('<math')) {
          if (name === 'img') {
            if (DOCX_MATH_KEY_PATTERN.test(attribs.alt)) equations.push({ key: attribs.alt, mml, picture: true });
          } else {
            current = { key: '', mml };
          }
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
        equations.push({ key, mml: current.mml, picture: false });
      }
      current = null;
    },
  }, { decodeEntities: true });
  parser.end(String(html ?? ''));
  return equations;
}

function centerEquationParagraph(run) {
  const paragraph = run.parentElement;
  if (paragraph?.tagName !== 'w:p' || paragraph.getElementsByTagName('w:numPr').length) return;
  if (Array.from(paragraph.childNodes).some((child) => child.nodeType === 1 && child !== run && child.tagName !== 'w:pPr')) return;

  const document = run.ownerDocument;
  const ns = paragraph.namespaceURI;
  let properties = paragraph.getElementsByTagName('w:pPr')[0];
  if (!properties) {
    properties = document.createElementNS(ns, 'w:pPr');
    paragraph.insertBefore(properties, run);
  }
  if (!properties.getElementsByTagName('w:jc').length) {
    const justification = document.createElementNS(ns, 'w:jc');
    justification.setAttributeNS(ns, 'w:val', 'center');
    const next = Array.from(properties.childNodes).find((child) => ['w:rPr', 'w:sectPr', 'w:pPrChange'].includes(child.tagName));
    properties.insertBefore(justification, next ?? null);
  }
}

function replaceMathRun(run, equation) {
  const document = run.ownerDocument;
  // Word selects Office Math. Readers such as Finder Quick Look select the
  // fallback drawing (or the source TeX when preview rendering was unavailable).
  const alternate = document.createElementNS(MC_NAMESPACE, 'mc:AlternateContent');
  const choice = document.createElementNS(MC_NAMESPACE, 'mc:Choice');
  choice.setAttribute('Requires', 'm');
  choice.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:m', MATH_NAMESPACE);
  choice.appendChild(document.importNode(equation, true));
  alternate.appendChild(choice);
  const fallbackElement = document.createElementNS(MC_NAMESPACE, 'mc:Fallback');
  alternate.appendChild(fallbackElement);
  run.parentNode.replaceChild(alternate, run);
  fallbackElement.appendChild(run);
}

async function injectDocxMathEquations(docxBuffer, equations) {
  const zip = await JSZip.loadAsync(docxBuffer);
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) return docxBuffer;

  const xml = parseDocxXml(await documentFile.async('string'));
  const markers = new Map(equations.map((marker) => [marker.key, marker]));
  for (const run of Array.from(xml.node.getElementsByTagName('w:r'))) {
    const picture = run.getElementsByTagName('pic:cNvPr')[0];
    const text = run.getElementsByTagName('w:t')[0];
    const key = picture ? picture.getAttribute('descr') : text?.textContent;
    const marker = markers.get(key);
    if (!marker || marker.picture !== Boolean(picture)) continue;
    markers.delete(key);
    const { equation, tex } = convertDocxEquation(marker.mml);
    if (picture) {
      picture.setAttribute('descr', tex);
      run.getElementsByTagName('wp:docPr')[0]?.setAttribute('descr', tex);
    } else {
      text.textContent = tex || equation?.textContent || 'Equation';
    }
    centerEquationParagraph(run);
    if (equation) replaceMathRun(run, equation);
  }
  zip.file('word/document.xml', xml.end());
  return zip.generateAsync({ compression: 'DEFLATE', type: 'nodebuffer' });
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
