import { afterEach, describe, expect, it, vi } from 'vitest';

import { StructurizrPreviewController } from '../../src/client/application/structurizr-preview-controller.js';

describe('StructurizrPreviewController', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.body.className = '';
    vi.restoreAllMocks();
  });

  it('prepares a loaded iframe without adding inline styles', () => {
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    const stylesheet = iframe.contentDocument.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = '/api/structurizr/embed.css';
    iframe.contentDocument.head.append(stylesheet);
    const controller = new StructurizrPreviewController({
      enabled: true,
      syncWorkspace: vi.fn(),
    });
    const scheduleFrameFit = vi.spyOn(controller, 'scheduleFrameFit').mockImplementation(() => {});

    controller.prepareFrame(iframe);

    expect(iframe.contentDocument.querySelector('style')).toBeNull();
    expect(iframe.contentDocument.querySelector('link[rel="stylesheet"]')).toBe(stylesheet);
    expect(scheduleFrameFit).toHaveBeenCalledWith(iframe, null);

    controller.reset();
  });

  it('keeps the current iframe mounted until the replacement diagram renders', async () => {
    const renderHost = document.createElement('div');
    document.body.append(renderHost);
    const controller = new StructurizrPreviewController({
      enabled: true,
      syncWorkspace: vi.fn(async () => ({ version: 'v2' })),
    });
    controller.mount(renderHost, 'workspace.dsl');

    const currentIframe = document.createElement('iframe');
    currentIframe.className = 'structurizr-preview-iframe';
    controller.frameHost.append(currentIframe);
    currentIframe.contentDocument.body.innerHTML = '<div id="diagram-viewport" style="width: 200px; height: 120px; overflow: auto"><div id="diagram-canvas" style="width: 800px; height: 600px"><div class="joint-layers" style="transform: matrix(0.5, 0, 0, 0.5, 0, 0)"></div></div></div>';
    const currentViewport = currentIframe.contentDocument.querySelector('#diagram-viewport');
    currentViewport.scrollLeft = 40;
    currentViewport.scrollTop = 30;
    controller.iframe = currentIframe;
    controller.lastVersion = 'v1';
    const createIframe = controller.createIframe.bind(controller);
    vi.spyOn(controller, 'createIframe').mockImplementation(() => {
      const iframe = createIframe();
      Object.defineProperty(iframe, 'src', { set() {} });
      return iframe;
    });

    await controller.syncNow({ filePath: 'workspace.dsl', source: 'updated' });

    const replacementIframe = Array.from(renderHost.querySelectorAll('iframe'))
      .find((iframe) => iframe !== currentIframe);
    expect(replacementIframe?.style.visibility).toBe('hidden');
    expect(controller.iframe).toBe(currentIframe);
    expect(currentIframe.isConnected).toBe(true);

    currentIframe.contentDocument.querySelector('.joint-layers').style.transform = 'matrix(0.8, 0, 0, 0.8, 0, 0)';
    currentViewport.scrollLeft = 150;
    currentViewport.scrollTop = 90;
    replacementIframe.contentDocument.body.innerHTML = '<div id="diagram-viewport" style="width: 200px; height: 120px; overflow: auto"><div id="diagram-canvas" style="width: 800px; height: 600px"></div></div>';
    const replacementViewport = replacementIframe.contentDocument.querySelector('#diagram-viewport');
    const zoomTo = vi.fn();
    replacementIframe.contentWindow.structurizr = { diagram: { zoomTo } };
    const canvas = replacementIframe.contentDocument.querySelector('#diagram-canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ width: 200, height: 120 });
    expect(controller.fitFrameToCanvas(replacementIframe)).toBe(false);
    expect(controller.iframe).toBe(currentIframe);

    controller.prepareFrame(replacementIframe);
    canvas.append(Object.assign(document.createElement('div'), { className: 'joint-layers' }));
    await vi.waitFor(() => expect(controller.iframe).toBe(replacementIframe));

    expect(currentIframe.isConnected).toBe(false);
    expect(zoomTo).toHaveBeenCalledWith(0.8);
    expect(replacementViewport.scrollLeft).toBe(150);
    expect(replacementViewport.scrollTop).toBe(90);
    controller.reset();
  });
});
