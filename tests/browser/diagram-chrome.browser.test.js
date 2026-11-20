import { afterEach, describe, expect, it, vi } from 'vitest';

import { DiagramChrome } from '../../src/client/application/diagram-chrome.js';

function createSvg({ height = 80, label = 'Diagram', width = 120 } = {}) {
  const shell = document.createElement('div');
  shell.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><text x="4" y="20">${label}</text></svg>`;
  return shell.querySelector('svg');
}

function dispatchTouchEvent(target, type, touches) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: touches });
  target.dispatchEvent(event);
  return event;
}

function mountDiagram(chrome, kind, {
  baseHeight = 80,
  baseWidth = 120,
  label = kind,
} = {}) {
  const shell = document.createElement('div');
  shell.className = `${kind}-shell diagram-preview-shell`;
  const source = document.createElement('span');
  source.className = `${kind}-source`;
  source.hidden = true;
  source.textContent = `${kind} source`;
  shell.append(source);
  document.body.append(shell);

  chrome.mount(shell, {
    baseHeight,
    baseWidth,
    diagramElement: createSvg({ height: baseHeight, label, width: baseWidth }),
    exportFileNames: () => ({ pngFileName: `${kind}.png`, svgFileName: `${kind}.svg` }),
    exportSvgMarkup: () => '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    kind,
    sourceSelector: `.${kind}-source`,
  });

  return shell;
}

describe('DiagramChrome', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.body.className = '';
    vi.restoreAllMocks();
  });

  it('mounts Mermaid chrome with existing diagram-specific classes', () => {
    const chrome = new DiagramChrome();
    const shell = mountDiagram(chrome, 'mermaid', { label: 'Start' });

    expect(shell.querySelector('.mermaid-toolbar.diagram-preview-toolbar')).not.toBeNull();
    expect(shell.querySelector('.mermaid-frame.diagram-preview-frame svg')).not.toBeNull();
    expect(shell.querySelector('.mermaid-zoom-btn[aria-label="Zoom in"]')).not.toBeNull();
    expect(shell.querySelector('.mermaid-zoom-btn[aria-label="Download SVG"]')).not.toBeNull();
    expect(shell.querySelector('.mermaid-source')?.textContent).toBe('mermaid source');
  });

  it('sizes a replacement SVG before swapping mounted diagram output', () => {
    const chrome = new DiagramChrome();
    const shell = mountDiagram(chrome, 'mermaid', { label: 'Start' });
    const replacement = createSvg({ height: 180, label: 'Updated', width: 240 });

    chrome.mount(shell, {
      baseHeight: 180,
      baseWidth: 240,
      diagramElement: replacement,
      exportFileNames: () => ({ pngFileName: 'diagram.png', svgFileName: 'diagram.svg' }),
      exportSvgMarkup: () => '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      kind: 'mermaid',
      sourceSelector: '.mermaid-source',
    });

    expect(replacement.style.width).not.toBe('');
    expect(replacement.style.height).not.toBe('');
    expect(shell.querySelector('.mermaid-frame svg')).toBe(replacement);
  });

  it('zooms diagrams with ctrl-wheel while leaving regular wheel scrolling alone', async () => {
    const frameStyle = document.createElement('style');
    frameStyle.textContent = '.diagram-preview-frame { width: 240px; height: 120px; overflow: auto; }';
    document.body.append(frameStyle);
    const chrome = new DiagramChrome();
    const shell = mountDiagram(chrome, 'mermaid');
    const frame = shell.querySelector('.mermaid-frame');
    const initialZoom = shell.querySelector('.mermaid-zoom-label')?.textContent;

    const regularWheelEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: -100,
    });
    frame.dispatchEvent(regularWheelEvent);

    expect(regularWheelEvent.defaultPrevented).toBe(false);
    expect(shell.querySelector('.mermaid-zoom-label')?.textContent).toBe(initialZoom);

    const zoomInEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -40,
    });
    frame.dispatchEvent(zoomInEvent);

    expect(zoomInEvent.defaultPrevented).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(shell.querySelector('.mermaid-zoom-label')?.textContent).not.toBe(initialZoom);
  });

  it('pinches diagrams without taking over one-finger scrolling', () => {
    const frameStyle = document.createElement('style');
    frameStyle.textContent = '.diagram-preview-frame { width: 240px; height: 120px; overflow: auto; }';
    document.body.append(frameStyle);
    const chrome = new DiagramChrome();
    const shell = mountDiagram(chrome, 'mermaid');
    const frame = shell.querySelector('.mermaid-frame');
    const initialZoom = shell.querySelector('.mermaid-zoom-label')?.textContent;

    dispatchTouchEvent(frame, 'touchstart', [
      { clientX: 60, clientY: 60 },
      { clientX: 180, clientY: 60 },
    ]);
    const pinchMove = dispatchTouchEvent(frame, 'touchmove', [
      { clientX: 40, clientY: 60 },
      { clientX: 200, clientY: 60 },
    ]);

    expect(pinchMove.defaultPrevented).toBe(true);
    expect(shell.querySelector('.mermaid-zoom-label')?.textContent).not.toBe(initialZoom);

    dispatchTouchEvent(frame, 'touchend', [{ clientX: 40, clientY: 60 }]);
    const oneFingerMove = dispatchTouchEvent(frame, 'touchmove', [{ clientX: 40, clientY: 80 }]);
    expect(oneFingerMove.defaultPrevented).toBe(false);
  });

  it('leaves Mermaid and PlantUML pointer input available for native selection and scrolling', () => {
    const frameStyle = document.createElement('style');
    frameStyle.textContent = '.diagram-preview-frame { width: 40px; height: 40px; overflow: auto; }';
    document.body.append(frameStyle);

    for (const [index, kind] of ['mermaid', 'plantuml'].entries()) {
      const chrome = new DiagramChrome();
      const shell = mountDiagram(chrome, kind);
      const frame = shell.querySelector(`.${kind}-frame`);
      const text = frame.querySelector('text');
      const pointerDown = new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: index + 1,
      });

      text.dispatchEvent(pointerDown);

      expect(pointerDown.defaultPrevented).toBe(false);
    }
  });

  it('keeps rapid ctrl-wheel zoom events on one animation loop', () => {
    const scheduledFrames = new Map();
    const cancelledFrames = [];
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
    let nextFrameId = 1;
    const windowRef = {
      addEventListener: () => {},
      cancelAnimationFrame: (frameId) => {
        cancelledFrames.push(frameId);
        scheduledFrames.delete(frameId);
      },
      removeEventListener: () => {},
      requestAnimationFrame: (callback) => {
        const frameId = nextFrameId;
        nextFrameId += 1;
        scheduledFrames.set(frameId, callback);
        return frameId;
      },
    };
    const chrome = new DiagramChrome({ windowRef });
    const shell = mountDiagram(chrome, 'mermaid');
    const frame = shell.querySelector('.mermaid-frame');
    scheduledFrames.clear();
    cancelledFrames.length = 0;

    for (let index = 0; index < 4; index += 1) {
      frame.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -40,
      }));
    }

    expect(cancelledFrames).toHaveLength(0);
    expect(scheduledFrames).toHaveLength(1);

    const [frameId, frameCallback] = scheduledFrames.entries().next().value;
    scheduledFrames.delete(frameId);
    nowSpy.mockReturnValue(160);
    frameCallback(160);

    expect(shell.querySelector('.mermaid-zoom-label')?.textContent).toBe('120%');
  });

  it('does not queue a second fit pass when replacing visible diagram output', () => {
    const scheduledFrames = [];
    const windowRef = {
      addEventListener: () => {},
      cancelAnimationFrame: () => {},
      removeEventListener: () => {},
      requestAnimationFrame: (callback) => {
        scheduledFrames.push(callback);
        return scheduledFrames.length;
      },
    };
    const chrome = new DiagramChrome({ windowRef });
    const shell = mountDiagram(chrome, 'mermaid');
    shell.querySelector('.mermaid-frame').style.width = '640px';
    scheduledFrames.length = 0;

    chrome.mount(shell, {
      baseHeight: 120,
      baseWidth: 180,
      diagramElement: createSvg({ height: 120, width: 180 }),
      exportFileNames: () => ({ pngFileName: 'diagram.png', svgFileName: 'diagram.svg' }),
      exportSvgMarkup: () => '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      kind: 'mermaid',
      sourceSelector: '.mermaid-source',
    });

    expect(scheduledFrames).toHaveLength(0);
  });

  it('preserves zoom and scroll position without dropping the visible frame', async () => {
    const frameStyle = document.createElement('style');
    frameStyle.textContent = '.diagram-preview-frame { width: 240px; height: 120px; overflow: auto; }';
    document.body.append(frameStyle);
    const chrome = new DiagramChrome();
    const shell = mountDiagram(chrome, 'mermaid', { baseHeight: 600, baseWidth: 1200 });
    const frame = shell.querySelector('.mermaid-frame');

    shell.querySelector('.mermaid-zoom-btn[aria-label="Zoom in"]').click();
    await new Promise((resolve) => setTimeout(resolve, 250));
    frame.scrollLeft = 90;
    frame.scrollTop = 70;
    expect(frame.scrollLeft).toBe(90);
    expect(frame.scrollTop).toBe(70);
    const previousZoom = shell.querySelector('.mermaid-zoom-label')?.textContent;
    chrome.captureShellViewState(shell);
    const parent = shell.parentElement;
    parent.removeChild(shell);
    parent.append(shell);

    chrome.mount(shell, {
      baseHeight: 600,
      baseWidth: 1200,
      diagramElement: createSvg({ height: 600, label: 'Updated', width: 1200 }),
      exportFileNames: () => ({ pngFileName: 'diagram.png', svgFileName: 'diagram.svg' }),
      exportSvgMarkup: () => '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      kind: 'mermaid',
      sourceSelector: '.mermaid-source',
    });

    expect(frame.isConnected).toBe(true);
    expect(getComputedStyle(frame).visibility).toBe('visible');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const nextFrame = shell.querySelector('.mermaid-frame');
    expect(nextFrame).not.toBe(frame);
    expect(shell.querySelectorAll('.mermaid-frame')).toHaveLength(1);
    expect(shell.querySelector('.mermaid-zoom-label')?.textContent).toBe(previousZoom);
    expect(nextFrame.scrollLeft).toBe(90);
    expect(nextFrame.scrollTop).toBe(70);
    expect(nextFrame.style.visibility).toBe('');
  });

  it('cancels deferred scroll restoration when a hidden diagram is destroyed', () => {
    const queue = new Map();
    let nextId = 0;
    const windowRef = {
      addEventListener() {},
      cancelAnimationFrame: (id) => queue.delete(id),
      removeEventListener() {},
      requestAnimationFrame(callback) {
        queue.set(++nextId, callback);
        return nextId;
      },
    };
    const chrome = new DiagramChrome({ windowRef });
    const shell = mountDiagram(chrome, 'mermaid');
    shell.style.display = 'none';
    chrome.shellViewStates.set(shell, { scrollLeft: 20, scrollTop: 20, zoom: 1 });
    chrome.mount(shell, {
      baseHeight: 600,
      baseWidth: 1200,
      diagramElement: createSvg({ height: 600, width: 1200 }),
      kind: 'mermaid',
    });
    expect(queue.size).toBeGreaterThan(0);
    chrome.destroy();
    expect(queue.size).toBe(0);
  });

  it('maximizes one diagram at a time across Mermaid and PlantUML', () => {
    const chrome = new DiagramChrome();
    const mermaidShell = mountDiagram(chrome, 'mermaid');
    const plantUmlShell = mountDiagram(chrome, 'plantuml');

    mermaidShell.querySelector('.mermaid-maximize-btn')?.click();

    expect(document.body.classList.contains('mermaid-maximized-open')).toBe(true);
    expect(document.querySelector('[data-mermaid-maximized-root="true"] .mermaid-shell.is-maximized')).toBe(mermaidShell);
    expect(mermaidShell.querySelector('.mermaid-maximize-btn')?.getAttribute('aria-label')).toBe('Restore diagram size');

    plantUmlShell.querySelector('.plantuml-maximize-btn')?.click();

    expect(mermaidShell.classList.contains('is-maximized')).toBe(false);
    expect(document.body.classList.contains('mermaid-maximized-open')).toBe(false);
    expect(document.body.classList.contains('plantuml-maximized-open')).toBe(true);
    expect(document.querySelector('[data-plantuml-maximized-root="true"] .plantuml-shell.is-maximized')).toBe(plantUmlShell);
    expect(mermaidShell.querySelector('.mermaid-maximize-btn')?.getAttribute('aria-label')).toBe('Maximize diagram');

    plantUmlShell.querySelector('.plantuml-maximize-btn')?.click();

    expect(plantUmlShell.classList.contains('is-maximized')).toBe(false);
    expect(document.body.classList.contains('plantuml-maximized-open')).toBe(false);
    expect(plantUmlShell.querySelector('.plantuml-maximize-btn')?.getAttribute('aria-label')).toBe('Maximize diagram');
  });

  it('renders a PlantUML reload action when supplied by the adapter', () => {
    const onReload = vi.fn();
    const chrome = new DiagramChrome();
    const shell = document.createElement('div');
    shell.className = 'plantuml-shell diagram-preview-shell';
    document.body.append(shell);

    chrome.mount(shell, {
      baseHeight: 80,
      baseWidth: 120,
      diagramElement: createSvg(),
      exportFileNames: () => ({ pngFileName: 'diagram.png', svgFileName: 'diagram.svg' }),
      exportSvgMarkup: () => '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      kind: 'plantuml',
      onReload,
    });

    shell.querySelector('.plantuml-tool-btn[aria-label="Reload diagram"]')?.click();

    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
