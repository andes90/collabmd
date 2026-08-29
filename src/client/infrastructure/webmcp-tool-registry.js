import {
  listWebMcpToolDefinitions,
  toWebMcpToolName,
} from '../../domain/agent-tool-definitions.js';

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('Tool execution was cancelled', 'AbortError');
  }
}

export class WebMcpToolRegistry {
  constructor({
    callTool,
    getIsTabActive,
    modelContext = globalThis.document?.modelContext ?? null,
    onDidMutate = null,
  }) {
    this.callTool = callTool;
    this.getIsTabActive = getIsTabActive;
    this.modelContext = modelContext;
    this.onDidMutate = onDidMutate;
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
            const result = await this.callTool(definition.name, input, { signal });
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
