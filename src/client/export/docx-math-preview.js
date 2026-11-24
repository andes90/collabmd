import { encodeSvgDataUrl } from '../application/preview-diagram-utils.js';

// Finder's DOCX preview reads pictures but skips Office Math. Paint the same
// KaTeX layout as the export page, including its fonts and stretchy SVG glyphs.
export async function renderDocxMathPreview(mathElement, styles) {
  const visual = mathElement.querySelector('.katex-html');
  if (!visual) return null;

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none';
  host.setAttribute('aria-hidden', 'true');
  const box = document.createElement('span');
  box.style.cssText = 'display:inline-block;padding:2px;font:16px serif;color-scheme:light;color:CanvasText';
  const formula = document.createElement('span');
  formula.className = 'katex';
  formula.append(visual.cloneNode(true));
  box.append(formula);
  host.append(box);
  document.body.append(host);
  try {
    box.getBoundingClientRect(); // Start loading any fonts used only in collapsed content.
    await document.fonts.ready;
    const bounds = box.getBoundingClientRect();
    const width = Math.max(1, Math.ceil(bounds.width));
    const height = Math.max(1, Math.ceil(bounds.height));
    const scale = Math.min(2, 4096 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const context = canvas.getContext('2d');
    if (!context) return null;

    const markup = new XMLSerializer().serializeToString(box);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${width} ${height}"><foreignObject width="${width}" height="${height}"><div xmlns="http://www.w3.org/1999/xhtml"><style>${styles}</style>${markup}</div></foreignObject></svg>`;
    const image = new Image();
    image.src = encodeSvgDataUrl(svg);
    await image.decode();
    context.drawImage(image, 0, 0);
    return { height, src: canvas.toDataURL('image/png'), width };
  } finally {
    host.remove();
  }
}
