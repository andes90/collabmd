import {
  listWebMcpToolDefinitions,
  toWebMcpToolName,
} from '../../domain/agent-tool-definitions.js';
import { createExcalidrawExportOptions } from '../domain/excalidraw-scene.js';

const MAX_RENDER_DIMENSION = 4096;
const ACTIVE_CONTEXT_TOOL_NAME = 'collabmd_get_active_context';
const EXCALIDRAW_WORKFLOW_NOTE = 'Call collabmd_get_active_context first. Use create_excalidraw only for a new path; for an existing diagram, inspect_excalidraw then edit_excalidraw with its exact revision and inline verification.';

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

async function replaceSnapshotRendering(result, renderScene, input = {}) {
  const scene = result?.verification?.scene ?? result?.scene;
  if (!scene) return result;
  const renderOptions = {
    ...(result.verification?.scene ? input.verify : input),
    ...(result.verification?.scene ? result.verification : result),
  };
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
    const cleanResult = stripSceneSnapshots(result);
    if (result?.verification?.scene) {
      return {
        ...cleanResult,
        verification: {
          ...cleanResult.verification,
          warnings: [...(cleanResult.verification?.warnings ?? []), 'exact-render-unavailable'],
        },
      };
    }
    return {
      ...cleanResult,
      warnings: [...(cleanResult.warnings ?? []), 'exact-render-unavailable'],
    };
  }
}

function addWebMcpExecution(result, execution) {
  if (!execution || Object.keys(execution).length === 0 || !result || typeof result !== 'object') {
    return result;
  }
  return { ...result, webMcp: execution };
}

function createActiveContextResult(context = {}) {
  const activeDiagramPath = context.activeDiagramPath || null;
  const activePath = context.activePath || null;
  return {
    activeDiagramPath,
    activePath,
    preferredDiagramPath: activeDiagramPath,
    workflow: activeDiagramPath
      ? `Current diagram is ${activeDiagramPath}. Inspect it, edit with the returned exact revision, request inline verification, then use the returned canvas paint acknowledgement.`
      : 'No diagram is active. Use create_excalidraw with a new .excalidraw path and request inline verification. Inspect then revision-edit any existing path; do not retry stale edits without rereading.',
  };
}

function getWebMcpDescription(definition) {
  return definition.name.includes('excalidraw')
    ? `${definition.description} ${EXCALIDRAW_WORKFLOW_NOTE}`
    : definition.description;
}

function runOptionalHook(hook, payload) {
  return typeof hook === 'function' ? hook(payload) : null;
}

async function runAcknowledgementHook(hook, payload) {
  try {
    return await runOptionalHook(hook, payload);
  } catch (error) {
    console.error('[webmcp] Failed to acknowledge an applied mutation:', error.message);
    return { status: 'unavailable' };
  }
}

function createActiveContextTool(getActiveContext) {
  return {
    annotations: {
      readOnlyHint: true,
      untrustedContentHint: false,
    },
    description: 'Return current CollabMD file and active-diagram context plus the safe create-or-edit workflow. Call before Excalidraw tools.',
    execute: async () => createActiveContextResult(getActiveContext?.()),
    inputSchema: {
      additionalProperties: false,
      properties: {},
      required: [],
      type: 'object',
    },
    name: ACTIVE_CONTEXT_TOOL_NAME,
  };
}


export class WebMcpToolRegistry {
  constructor({
    acknowledgeToolCall = null,
    callTool,
    getActiveContext = null,
    getIsTabActive,
    modelContext = globalThis.document?.modelContext ?? null,
    onDidMutate = null,
    prepareToolCall = null,
    renderExcalidrawScene = renderExactExcalidrawScene,
  }) {
    this.acknowledgeToolCall = acknowledgeToolCall;
    this.callTool = callTool;
    this.getActiveContext = getActiveContext;
    this.getIsTabActive = getIsTabActive;
    this.modelContext = modelContext;
    this.onDidMutate = onDidMutate;
    this.prepareToolCall = prepareToolCall;
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
      const tools = listWebMcpToolDefinitions().map((definition) => ({
        annotations: {
          readOnlyHint: definition.annotations.readOnlyHint,
          untrustedContentHint: Boolean(definition.untrustedContentHint),
        },
        description: getWebMcpDescription(definition),
        execute: async (input = {}, { signal } = {}) => {
          throwIfAborted(signal);
          let preparation = null;
          if (typeof this.prepareToolCall === 'function') {
            preparation = await this.prepareToolCall({
              input,
              name: definition.name,
              signal,
            });
            throwIfAborted(signal);
          }
          let serverResult;
          try {
            serverResult = await this.callTool(definition.name, input, { signal });
          } catch (error) {
            throwIfAborted(signal);
            const body = error?.body;
            if (typeof body?.code === 'string' && body.code.startsWith('AGENT_')) {
              return { ...body, isError: true };
            }
            throw error;
          }
          let result = await replaceSnapshotRendering(
            serverResult,
            this.renderExcalidrawScene,
            input,
          );
          throwIfAborted(signal);
          const execution = preparation ? { preparation } : {};
          if (!definition.annotations.readOnlyHint) {
            const acknowledgement = await runAcknowledgementHook(this.acknowledgeToolCall, {
              input,
              name: definition.name,
              preparation,
              result,
              signal,
            });
            if (acknowledgement) execution.acknowledgement = acknowledgement;
            result = addWebMcpExecution(result, execution);
            try {
              this.onDidMutate?.({ name: definition.name, result });
            } catch (error) {
              console.error('[webmcp] Failed to report an applied mutation:', error.message);
            }
          } else {
            result = addWebMcpExecution(result, execution);
          }
          return result;
        },
        inputSchema: definition.inputSchema,
        name: toWebMcpToolName(definition.name),
      }));
      tools.push(createActiveContextTool(this.getActiveContext));
      await Promise.all(tools.map((tool) => (
        this.modelContext.registerTool(tool, { signal: controller.signal })
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
