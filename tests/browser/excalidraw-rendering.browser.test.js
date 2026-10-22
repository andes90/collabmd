import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import { afterEach, describe, expect, it } from 'vitest';

import { WebMcpToolRegistry } from '../../src/client/infrastructure/webmcp-tool-registry.js';
import { GitDiffViewController } from '../../src/client/presentation/git-diff-view-controller.js';

function createScene() {
  return {
    appState: { gridSize: null, viewBackgroundColor: '#123456' },
    elements: convertToExcalidrawElements([
      { height: 80, type: 'rectangle', width: 120, x: 10, y: 10 },
    ]),
    files: {},
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Excalidraw browser rendering', () => {
  it('renders git diff previews with the bundled runtime', async () => {
    document.body.innerHTML = '<div id="diffContent"><div data-diff-excalidraw-preview="scene"></div></div>';
    const controller = new GitDiffViewController();
    controller.excalidrawPreviewPayloads.set('scene', createScene());

    await controller.hydrateExcalidrawPreviews();

    const preview = document.querySelector('[data-diff-excalidraw-preview="scene"]');
    expect(preview.classList.contains('is-ready')).toBe(true);
    expect(preview.querySelector('svg')).not.toBeNull();
    expect(preview.innerHTML).toContain('#123456');
  });

  it.each(['svg', 'png'])('renders WebMCP %s verification with the bundled runtime', async (format) => {
    const tools = new Map();
    const registry = new WebMcpToolRegistry({
      callTool: async () => ({ format, scene: createScene() }),
      getIsTabActive: () => true,
      modelContext: { registerTool: (tool) => tools.set(tool.name, tool) },
    });
    await registry.refresh();

    try {
      const result = await tools.get('collabmd_verify_excalidraw').execute({
        format,
        padding: 12,
        path: 'scene.excalidraw',
        scale: 2,
      });

      expect(result.warnings).toEqual([]);
      expect(result.renderer).toBe('excalidraw-official-browser');
      expect(result.image.mimeType).toBe(format === 'svg' ? 'image/svg+xml' : 'image/png');
      expect(result.width).toBe(288);
      expect(result.height).toBe(208);
      expect(Object.hasOwn(result, 'scene')).toBe(false);
      const bytes = Uint8Array.fromBase64(result.image.data);
      if (format === 'svg') {
        expect(new TextDecoder().decode(bytes)).toContain('#123456');
      } else {
        expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        expect(bitmap.width).toBeLessThanOrEqual(4096);
        expect(bitmap.height).toBeLessThanOrEqual(4096);
        bitmap.close();
      }
    } finally {
      registry.unregister();
    }
  });
});
