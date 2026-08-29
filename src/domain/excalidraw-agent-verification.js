const BASIC_SHAPE_TYPES = new Set(['diamond', 'ellipse', 'rectangle']);
const LINEAR_TYPES = new Set(['arrow', 'freedraw', 'line']);
const RENDERED_TYPES = new Set([...BASIC_SHAPE_TYPES, ...LINEAR_TYPES, 'text']);
const MAX_SUMMARY_ELEMENTS = 500;
const MAX_WARNINGS = 200;
const MAX_RENDER_DIMENSION = 4096;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function elementBounds(element) {
  const x = finiteNumber(element?.x);
  const y = finiteNumber(element?.y);
  if (LINEAR_TYPES.has(element?.type) && Array.isArray(element.points) && element.points.length > 0) {
    const points = element.points
      .filter((point) => Array.isArray(point) && point.length === 2)
      .map(([pointX, pointY]) => [x + finiteNumber(pointX), y + finiteNumber(pointY)]);
    if (points.length === 0) return null;
    const xs = points.map(([pointX]) => pointX);
    const ys = points.map(([, pointY]) => pointY);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return {
      height: Math.max(1, Math.max(...ys) - top),
      width: Math.max(1, Math.max(...xs) - left),
      x: left,
      y: top,
    };
  }
  const width = finiteNumber(element?.width, Number.NaN);
  const height = finiteNumber(element?.height, Number.NaN);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return {
    height: Math.abs(height),
    width: Math.abs(width),
    x: width < 0 ? x + width : x,
    y: height < 0 ? y + height : y,
  };
}

function mergeBounds(boxes) {
  if (boxes.length === 0) return { height: 0, width: 0, x: 0, y: 0 };
  const left = Math.min(...boxes.map(({ x }) => x));
  const top = Math.min(...boxes.map(({ y }) => y));
  const right = Math.max(...boxes.map(({ width, x }) => x + width));
  const bottom = Math.max(...boxes.map(({ height, y }) => y + height));
  return { height: bottom - top, width: right - left, x: left, y: top };
}

function boxesOverlap(left, right) {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function boxContains(outer, inner) {
  return outer.x <= inner.x
    && outer.y <= inner.y
    && outer.x + outer.width >= inner.x + inner.width
    && outer.y + outer.height >= inner.y + inner.height;
}

function summarizeElement(element) {
  const bounds = elementBounds(element) ?? { height: 0, width: 0, x: 0, y: 0 };
  const summary = {
    height: bounds.height,
    id: String(element?.id ?? ''),
    type: String(element?.type ?? 'unknown'),
    width: bounds.width,
    x: bounds.x,
    y: bounds.y,
  };
  if (element?.type === 'text') summary.text = String(element.text ?? '');
  if (element?.startBinding?.elementId) summary.startElementId = String(element.startBinding.elementId);
  if (element?.endBinding?.elementId) summary.endElementId = String(element.endBinding.elementId);
  return summary;
}

function warning(code, message, elementIds = []) {
  return { code, elementIds, message };
}

function textOverflowWarning(element, bounds, id) {
  if (element?.type !== 'text' || !bounds) return null;
  const text = String(element.text ?? '');
  const fontSize = finiteNumber(element.fontSize, 20);
  const lines = text.split('\n');
  const expectedWidth = Math.max(1, ...lines.map((line) => line.length)) * fontSize * 0.6;
  const expectedHeight = Math.max(1, lines.length) * fontSize * finiteNumber(element.lineHeight, 1.25);
  return bounds.width + 1 < expectedWidth || bounds.height + 1 < expectedHeight
    ? warning('text-overflow', `Text element ${id} may be clipped by its bounds.`, [id])
    : null;
}

function collectElementWarnings(element, activeIds, seenIds) {
  const warnings = [];
  const id = String(element?.id ?? '');
  if (!id) warnings.push(warning('missing-id', 'Element has no id.'));
  else if (seenIds.has(id)) warnings.push(warning('duplicate-id', `Element id ${id} is duplicated.`, [id]));
  seenIds.add(id);

  const bounds = elementBounds(element);
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    warnings.push(warning('invalid-bounds', `Element ${id || '(missing id)'} has invalid or zero-size bounds.`, id ? [id] : []));
  }
  if (!RENDERED_TYPES.has(element?.type)) {
    warnings.push(warning('unsupported-render-type', `Element ${id || '(missing id)'} uses unsupported render type ${element?.type}.`, id ? [id] : []));
  }
  for (const binding of [element?.startBinding, element?.endBinding]) {
    if (binding?.elementId && !activeIds.has(binding.elementId)) {
      warnings.push(warning('missing-binding-target', `Element ${id} binds to missing element ${binding.elementId}.`, [id, String(binding.elementId)]));
    }
  }
  const overflow = textOverflowWarning(element, bounds, id);
  if (overflow) warnings.push(overflow);
  return warnings;
}

function collectWarnings(elements) {
  const warnings = [];
  const push = (entry) => {
    if (warnings.length < MAX_WARNINGS) warnings.push(entry);
  };
  const activeIds = new Set(elements.map(({ id }) => id));
  const seenIds = new Set();
  for (const element of elements) {
    collectElementWarnings(element, activeIds, seenIds).forEach(push);
  }

  const shapes = elements
    .filter((element) => BASIC_SHAPE_TYPES.has(element?.type))
    .map((element) => ({ bounds: elementBounds(element), id: String(element.id ?? '') }))
    .filter(({ bounds }) => bounds && bounds.width > 0 && bounds.height > 0)
    .slice(0, MAX_SUMMARY_ELEMENTS);
  for (let leftIndex = 0; leftIndex < shapes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < shapes.length; rightIndex += 1) {
      const left = shapes[leftIndex];
      const right = shapes[rightIndex];
      if (
        boxesOverlap(left.bounds, right.bounds)
        && !boxContains(left.bounds, right.bounds)
        && !boxContains(right.bounds, left.bounds)
      ) {
        push(warning('shape-overlap', `Shapes ${left.id} and ${right.id} overlap.`, [left.id, right.id]));
      }
    }
  }
  return warnings;
}

export function inspectAgentExcalidrawScene(scene = {}) {
  const activeElements = (Array.isArray(scene?.elements) ? scene.elements : [])
    .filter((element) => element && !element.isDeleted);
  const boxes = activeElements.map(elementBounds).filter(Boolean);
  const warnings = collectWarnings(activeElements);
  return {
    bounds: mergeBounds(boxes),
    elementCount: activeElements.length,
    elements: activeElements.slice(0, MAX_SUMMARY_ELEMENTS).map(summarizeElement),
    truncated: activeElements.length > MAX_SUMMARY_ELEMENTS || warnings.length >= MAX_WARNINGS,
    warnings,
  };
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function safeColor(value, fallback) {
  const color = String(value ?? '').trim();
  return /^(?:#[\da-f]{3,8}|transparent)$/iu.test(color) ? color : fallback;
}

function strokeAttributes(element) {
  const dash = element?.strokeStyle === 'dashed'
    ? ' stroke-dasharray="12 8"'
    : element?.strokeStyle === 'dotted' ? ' stroke-dasharray="3 6"' : '';
  return `stroke="${safeColor(element?.strokeColor, '#1e1e1e')}" stroke-width="${Math.max(0.5, finiteNumber(element?.strokeWidth, 2))}" stroke-linecap="round" stroke-linejoin="round"${dash} opacity="${Math.min(1, Math.max(0, finiteNumber(element?.opacity, 100) / 100))}"`;
}

function rotationAttribute(element, bounds) {
  const angle = finiteNumber(element?.angle);
  if (!angle) return '';
  const degrees = angle * (180 / Math.PI);
  return ` transform="rotate(${degrees} ${bounds.x + (bounds.width / 2)} ${bounds.y + (bounds.height / 2)})"`;
}

function renderText(element, bounds) {
  const lines = String(element?.text ?? '').split('\n');
  const fontSize = Math.max(1, finiteNumber(element?.fontSize, 20));
  const lineHeight = fontSize * finiteNumber(element?.lineHeight, 1.25);
  const startY = bounds.y + (bounds.height / 2) - ((lines.length - 1) * lineHeight / 2);
  const spans = lines.map((line, index) => `<tspan x="${bounds.x + (bounds.width / 2)}" y="${startY + (index * lineHeight)}">${escapeXml(line)}</tspan>`).join('');
  return `<text text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="${fontSize}" fill="${safeColor(element?.strokeColor, '#1e1e1e')}"${rotationAttribute(element, bounds)}>${spans}</text>`;
}

function renderLinearElement(element) {
  const originX = finiteNumber(element?.x);
  const originY = finiteNumber(element?.y);
  const points = Array.isArray(element?.points) ? element.points : [];
  const coordinates = points
    .filter((point) => Array.isArray(point) && point.length === 2)
    .map(([x, y]) => [originX + finiteNumber(x), originY + finiteNumber(y)]);
  if (coordinates.length < 2) return '';
  const path = coordinates.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
  const markerStart = element?.startArrowhead ? ' marker-start="url(#arrow-start)"' : '';
  const markerEnd = element?.type === 'arrow' && element?.endArrowhead !== null ? ' marker-end="url(#arrow-end)"' : '';
  return `<path d="${path}" fill="none" ${strokeAttributes(element)}${markerStart}${markerEnd}/>`;
}

function renderElement(element) {
  const bounds = elementBounds(element);
  if (!bounds) return '';
  if (element.type === 'text') return renderText(element, bounds);
  if (LINEAR_TYPES.has(element.type)) return renderLinearElement(element);
  const fill = safeColor(element.backgroundColor, 'transparent');
  const rotation = rotationAttribute(element, bounds);
  if (element.type === 'ellipse') {
    return `<ellipse cx="${bounds.x + (bounds.width / 2)}" cy="${bounds.y + (bounds.height / 2)}" rx="${bounds.width / 2}" ry="${bounds.height / 2}" fill="${fill}" ${strokeAttributes(element)}${rotation}/>`;
  }
  if (element.type === 'diamond') {
    const centerX = bounds.x + (bounds.width / 2);
    const centerY = bounds.y + (bounds.height / 2);
    const points = `${centerX},${bounds.y} ${bounds.x + bounds.width},${centerY} ${centerX},${bounds.y + bounds.height} ${bounds.x},${centerY}`;
    return `<polygon points="${points}" fill="${fill}" ${strokeAttributes(element)}${rotation}/>`;
  }
  if (element.type === 'rectangle') {
    return `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" rx="8" fill="${fill}" ${strokeAttributes(element)}${rotation}/>`;
  }
  return '';
}

export function renderAgentExcalidrawSvg(scene, {
  padding = 32,
  scale = 1,
} = {}) {
  const activeElements = (Array.isArray(scene?.elements) ? scene.elements : [])
    .filter((element) => element && !element.isDeleted);
  const bounds = mergeBounds(activeElements.map(elementBounds).filter(Boolean));
  const inset = Math.min(100, Math.max(0, finiteNumber(padding, 32)));
  const sceneWidth = Math.max(1, bounds.width + (inset * 2));
  const sceneHeight = Math.max(1, bounds.height + (inset * 2));
  const requestedScale = Math.min(4, Math.max(0.25, finiteNumber(scale, 1)));
  const appliedScale = Math.min(
    requestedScale,
    MAX_RENDER_DIMENSION / sceneWidth,
    MAX_RENDER_DIMENSION / sceneHeight,
  );
  const width = Math.max(1, Math.ceil(sceneWidth * appliedScale));
  const height = Math.max(1, Math.ceil(sceneHeight * appliedScale));
  const viewX = bounds.x - inset;
  const viewY = bounds.y - inset;
  const elements = activeElements.map(renderElement).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewX} ${viewY} ${sceneWidth} ${sceneHeight}"><defs><marker id="arrow-end" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="#1e1e1e"/></marker><marker id="arrow-start" markerWidth="10" markerHeight="10" refX="1" refY="3" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M9,0 L9,6 L0,3 z" fill="#1e1e1e"/></marker></defs><rect x="${viewX}" y="${viewY}" width="${sceneWidth}" height="${sceneHeight}" fill="#ffffff"/>${elements}</svg>`;
  return {
    elementCount: activeElements.length,
    height,
    scale: appliedScale,
    svg,
    width,
  };
}
