export function canvasColor(value) {
  if (/^[1-6]$/.test(value)) return `var(--canvas-color-${value})`;
  return /^#[\da-f]{6}$/i.test(value) ? value : 'var(--color-border)';
}

export function canvasFilePath(value) {
  const path = String(value ?? '').replace(/\\/g, '/');
  if (!path || path.length > 4096 || /^[/]|[\0?#]|^[a-z][a-z\d+.-]*:/i.test(path)
    || path.split('/').some((part) => !part || part.startsWith('.'))) return null;
  return path;
}

export function canvasLinkUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function connectionPoint(node, side) {
  const center = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
  const directions = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };
  const [dx, dy] = directions[side];
  return { x: center.x + dx * node.width / 2, y: center.y + dy * node.height / 2, dx, dy };
}

export function canvasSideAtPoint(node, point) {
  return [
    ['left', Math.abs(point.x - node.x)], ['right', Math.abs(point.x - node.x - node.width)],
    ['top', Math.abs(point.y - node.y)], ['bottom', Math.abs(point.y - node.y - node.height)],
  ].sort((a, b) => a[1] - b[1])[0][0];
}

export function canvasEdgeGeometry(edge, nodes) {
  const from = nodes.get(edge.fromNode);
  const to = nodes.get(edge.toNode);
  if (!from || !to) return null;
  const dx = to.x + to.width / 2 - from.x - from.width / 2;
  const dy = to.y + to.height / 2 - from.y - from.height / 2;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const start = connectionPoint(from, edge.fromSide || (horizontal ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'bottom' : 'top')));
  const end = connectionPoint(to, edge.toSide || (horizontal ? (dx >= 0 ? 'left' : 'right') : (dy >= 0 ? 'top' : 'bottom')));
  const distance = Math.max(40, Math.hypot(end.x - start.x, end.y - start.y) / 3);
  return {
    path: `M ${start.x} ${start.y} C ${start.x + start.dx * distance} ${start.y + start.dy * distance}, ${end.x + end.dx * distance} ${end.y + end.dy * distance}, ${end.x} ${end.y}`,
    x: (start.x + end.x) / 2, y: (start.y + end.y) / 2,
  };
}
