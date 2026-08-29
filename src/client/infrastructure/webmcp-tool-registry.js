import {
  listWebMcpToolDefinitions,
  toWebMcpToolName,
} from '../../domain/agent-tool-definitions.js';
import { createExcalidrawExportOptions } from '../domain/excalidraw-scene.js';

const MAX_RENDER_DIMENSION = 4096;

async function renderExactExcalidrawScene(scene, {
  format = 'png',
  padding = 32,
  scale = 1,
} = {}) {
  const {
    exportToBlob,
    exportToSvg,
  } = await import('@excalidraw/excalidraw');
  const options = createExcalidrawExportOptions(scene, { padding, scale });
  let data;
  let height;
  let mimeType;
  let width;
  if (format === 'svg') {
    const svg = await exportToSvg(options);
    const markup = svg.outerHTML;
    data = new TextEncoder().encode(markup).toBase64();
    height = Math.max(1, Math.ceil(Number.parseFloat(svg.getAttribute('height')) || 1));
    mimeType = 'image/svg+xml';
    width = Math.max(1, Math.ceil(Number.parseFloat(svg.getAttribute('width')) || 1));
  } else {
    const blob = await exportToBlob({
      ...options,
      maxWidthOrHeight: MAX_RENDER_DIMENSION,
      mimeType: 'image/png',
    });
    const bitmap = await createImageBitmap(blob);
    data = new Uint8Array(await blob.arrayBuffer()).toBase64();
    height = bitmap.height;
    mimeType = 'image/png';
    width = bitmap.width;
    bitmap.close();
  }
  return {
    format,
    height,
    image: { data, encoding: 'base64', mimeType },
    mimeType,
    renderer: 'excalidraw-official-browser',
    rendererVersion: 'bundled',
    scale,
    warnings: [],
    width,
  };
}

function stripSceneSnapshots(result) {
  if (!result || typeof result !== 'object') return result;
  const cleanResult = { ...result };
  delete cleanResult.scene;
  if (!cleanResult.verification?.scene) return cleanResult;
  const verification = { ...cleanResult.verification };
  delete verification.scene;
  return { ...cleanResult, verification };
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('Tool execution was cancelled', 'AbortError');
  }
}

async function replaceSnapshotRendering(result, renderScene) {
  const scene = result?.verification?.scene ?? result?.scene;
  if (!scene) return result;
  const renderOptions = result.verification?.scene ? result.verification : result;
  try {
    const rendered = await renderScene(scene, renderOptions);
    const cleanResult = stripSceneSnapshots(result);
    if (result.verification?.scene) {
      const { image, ...metadata } = rendered;
      return {
        ...cleanResult,
        image,
        verification: {
          ...cleanResult.verification,
          ...metadata,
        },
      };
    }
    return {
      ...cleanResult,
      ...rendered,
    };
  } catch (error) {
    console.error('[webmcp] Exact Excalidraw rendering failed:', error.message);
    return stripSceneSnapshots(result);
  }
}

export class WebMcpToolRegistry {
  constructor({
    callTool,
    getIsTabActive,
    modelContext = globalThis.document?.modelContext ?? null,
    onDidMutate = null,
    renderExcalidrawScene = renderExactExcalidrawScene,
  }) {
    this.callTool = callTool;
    this.getIsTabActive = getIsTabActive;
    this.modelContext = modelContext;
    this.onDidMutate = onDidMutate;
    this.renderExcalidrawScene = renderExcalidrawScene;
    this.registration = null;
  }

  async refresh() {
    if (
      typeof this.modelContext?.registerTool !== 'function'
      || typeof this.callTool !== 'function'
      || !this.getIsTabActive()
    ) {
      this.unregister();
      return false;
    }
    if (this.registration) return true;

    const controller = new AbortController();
    const registration = { controller };
    this.registration = registration;

    try {
      await Promise.all(listWebMcpToolDefinitions().map((definition) => (
        this.modelContext.registerTool({
          annotations: {
            readOnlyHint: definition.annotations.readOnlyHint,
            untrustedContentHint: Boolean(definition.untrustedContentHint),
          },
          description: definition.description,
          execute: async (input = {}, { signal } = {}) => {
            throwIfAborted(signal);
            const serverResult = await this.callTool(definition.name, input, { signal });
            const result = await replaceSnapshotRendering(serverResult, this.renderExcalidrawScene);
            throwIfAborted(signal);
            if (!definition.annotations.readOnlyHint) {
              try {
                this.onDidMutate?.({ name: definition.name, result });
              } catch (error) {
                console.error('[webmcp] Failed to report an applied mutation:', error.message);
              }
            }
            return result;
          },
          inputSchema: definition.inputSchema,
          name: toWebMcpToolName(definition.name),
        }, { signal: controller.signal })
      )));
      return true;
    } catch (error) {
      if (!controller.signal.aborted) {
        controller.abort();
        console.error('[webmcp] Failed to register tools:', error.message);
      }
      if (this.registration === registration) {
        this.registration = null;
      }
      return false;
    }
  }

  unregister() {
    this.registration?.controller.abort();
    this.registration = null;
  }
}
