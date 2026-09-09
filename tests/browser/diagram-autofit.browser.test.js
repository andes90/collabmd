import { expect, it } from 'vitest';

import '../../src/client/styles/style.css';
import '../../src/client/styles/features/diagram-preview.css';
import { DiagramChrome } from '../../src/client/application/diagram-chrome.js';

it('settles auto-fit when a diagram is near the vertical scrollbar threshold', async () => {
  const style = document.createElement('style');
  style.textContent = `
    .diagram-preview-frame { max-height: 324px; scrollbar-width: auto; }
    .diagram-preview-frame::-webkit-scrollbar { display: block; width: 15px; height: 15px; }
  `;
  document.body.append(style);
  const shell = document.createElement('div');
  shell.className = 'mermaid-shell diagram-preview-shell';
  shell.style.width = '400px';
  document.body.append(shell);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 400 330');
  const chrome = new DiagramChrome();
  try {
    chrome.mount(shell, {
      baseHeight: 330,
      baseWidth: 400,
      diagramElement: svg,
      kind: 'mermaid',
      sourceSelector: '.mermaid-source',
    });
    const widths = [];
    for (let frame = 0; frame < 30; frame += 1) {
      await new Promise(requestAnimationFrame);
      if (frame >= 20) widths.push(svg.getBoundingClientRect().width);
    }
    const frame = shell.querySelector('.diagram-preview-frame');
    expect(frame.offsetWidth - frame.clientWidth).toBeGreaterThan(0);
    expect(widths[0]).toBeGreaterThan(0);
    expect(new Set(widths).size).toBe(1);
  } finally {
    chrome.destroy();
    shell.remove();
    style.remove();
  }
});
