import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

import { mml2omml } from 'mathml2omml';

const converterRequire = createRequire(import.meta.resolve('@turbodocx/html-to-docx'));
const { create, builder } = converterRequire('xmlbuilder2');
const { decode } = converterRequire('html-entities');
export const MATH_NAMESPACE = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const SCRIPT_VARIANTS = new Set(['double-struck', 'fraktur', 'monospace', 'sans-serif', 'script']);
const TOKEN_ELEMENTS = new Set(['mi', 'mn', 'mo', 'mtext']);

// xmlbuilder2's XML reader leaves entity references in DOM values. Decode
// them once so its writer can escape both existing and newly inserted text.
export function parseDocxXml(xml) {
  const tree = create(xml);
  for (const element of tree.node.getElementsByTagName('*')) {
    for (const attribute of element.attributes) {
      if (attribute.value.includes('&')) attribute.value = decode(attribute.value, { level: 'xml' });
    }
    for (const child of element.childNodes) {
      if (child.nodeType === 3 && child.data.includes('&')) child.data = decode(child.data, { level: 'xml' });
    }
  }
  return tree;
}

function mathElement(document, name, value) {
  const element = document.createElementNS(MATH_NAMESPACE, `m:${name}`);
  if (value !== undefined) element.setAttributeNS(MATH_NAMESPACE, 'm:val', String(value));
  return element;
}

function textRun(document, text) {
  const run = mathElement(document, 'r');
  const content = mathElement(document, 't');
  content.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
  content.textContent = text;
  run.appendChild(content);
  return run;
}

function convertStructure(source, replacements) {
  // The converter serializes text verbatim. Keep XML entities encoded across
  // the conversion, including spaces the converter would trim from text runs.
  const markup = builder(source).toString().replace(/\u00a0/g, '&#160;').replace(/\u2009/g, '&#8201;');
  const document = parseDocxXml(mml2omml(markup, { disableDecode: true })).node;
  for (const run of Array.from(document.getElementsByTagName('m:r'))) {
    const replacement = replacements.get(run.textContent);
    if (replacement) {
      run.replaceWith(document.importNode(replacement, true));
      continue;
    }
    // mathml2omml emits Word run properties before math properties, and
    // combines mutually exclusive normal-text and math-style settings.
    const wordStyle = run.getElementsByTagName('w:rPr')[0];
    if (wordStyle) {
      const props = run.getElementsByTagName('m:rPr')[0];
      const bold = wordStyle.getElementsByTagName('w:b').length;
      const italic = wordStyle.getElementsByTagName('w:i').length;
      props.textContent = '';
      props.appendChild(mathElement(document, 'sty', (bold ? 'b' : '') + (italic ? 'i' : '') || 'p'));
      wordStyle.remove();
    }
  }
  for (const props of Array.from(document.getElementsByTagName('m:argPr'))) {
    const level = props.firstElementChild?.getAttribute('m:val');
    if (props.previousElementSibling?.tagName === 'm:argPr') props.remove();
    else if (level) props.firstElementChild.replaceWith(mathElement(document, 'argSz', -Number(level)));
  }
  for (const chr of Array.from(document.getElementsByTagName('m:chr'))) {
    if (chr.hasAttribute('m:pos')) {
      chr.after(mathElement(document, 'pos', chr.getAttribute('m:pos')));
      chr.removeAttribute('m:pos');
    }
  }
  // Following a large operator, the converter can append the rest of an
  // integrand as bare text inside the argument. Word reads text only in runs.
  for (const arg of Array.from(document.getElementsByTagName('m:e'))) {
    for (const child of Array.from(arg.childNodes)) {
      if (child.nodeType === 3) child.replaceWith(textRun(document, child.data));
    }
  }
  return document.documentElement;
}

export function convertDocxEquation(mml) {
  let tex = '';
  try {
    const input = parseDocxXml(mml.replace(/&nbsp;/g, '&#160;')).node;
    const math = input.documentElement;
    const annotation = math.getElementsByTagName('annotation')[0];
    tex = annotation?.textContent.trim() || '';
    annotation?.remove();
    const replacements = new Map();
    const prefix = randomUUID();
    // Keep our custom runs separate while the converter builds fractions,
    // limits, matrices and other enclosing structures.
    for (const node of Array.from(math.getElementsByTagName('*')).reverse()) {
      const variant = node.getAttribute('mathvariant');
      let replacement;
      if (node.localName === 'mpadded') {
        node.replaceWith(...Array.from(node.childNodes));
      } else if (TOKEN_ELEMENTS.has(node.localName) && node.firstElementChild) {
        const group = input.createElementNS(math.namespaceURI, 'mrow');
        group.append(...Array.from(node.childNodes));
        node.replaceWith(group);
      } else if (TOKEN_ELEMENTS.has(node.localName) && SCRIPT_VARIANTS.has(variant)) {
        replacement = textRun(input, node.textContent);
        const props = mathElement(input, 'rPr');
        props.append(mathElement(input, 'scr', variant), mathElement(input, 'sty', 'p'));
        replacement.prepend(props);
      } else if (node.localName === 'mphantom') {
        const inner = input.createElementNS(math.namespaceURI, 'math');
        inner.append(...Array.from(node.childNodes));
        const argument = mathElement(input, 'e');
        for (const child of Array.from(convertStructure(inner, replacements).childNodes)) {
          argument.appendChild(input.importNode(child, true));
        }
        replacement = mathElement(input, 'phant');
        const props = mathElement(input, 'phantPr');
        props.appendChild(mathElement(input, 'show', '0'));
        const padding = node.parentElement;
        if (padding?.getAttribute('width') === '0px') props.appendChild(mathElement(input, 'zeroWid', '1'));
        if (padding?.getAttribute('height') === '0px') props.appendChild(mathElement(input, 'zeroAsc', '1'));
        if (padding?.getAttribute('depth') === '0px') props.appendChild(mathElement(input, 'zeroDesc', '1'));
        replacement.append(props, argument);
      }
      if (replacement) {
        const key = `${prefix}-${replacements.size}`;
        replacements.set(key, replacement);
        const group = input.createElementNS(math.namespaceURI, 'mrow');
        const token = input.createElementNS(math.namespaceURI, 'mtext');
        token.textContent = key;
        group.appendChild(token);
        node.replaceWith(group);
      }
    }
    return { equation: convertStructure(math, replacements), tex };
  } catch {
    return { equation: null, tex };
  }
}
