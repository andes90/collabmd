import { getCollabMdSyntaxGuide, listCollabMdContentCapabilities } from '../../domain/collabmd-content-capabilities.js';
import { createEditableContentRevision } from '../../domain/editable-content-revision.js';
import { validateExactTextReplacements } from '../../domain/exact-text-edits.js';
import { getVaultFileKind } from '../../domain/file-kind.js';

const MAX_DOCUMENT_CHARACTERS = 200_000;
const MAX_REPLACEMENTS = 20;
const MAX_REPLACEMENT_CHARACTERS = 50_000;
const SUPPORTED_FILE_KINDS = new Set(['markdown', 'mermaid', 'plantuml', 'structurizr']);

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('Tool execution was cancelled', 'AbortError');
  }
}

export class WebMcpToolRegistry {
  constructor({
    getActiveFilePath,
    getIsTabActive,
    getSession,
    modelContext = globalThis.document?.modelContext ?? null,
    onDidEdit = null,
  }) {
    this.getActiveFilePath = getActiveFilePath;
    this.getIsTabActive = getIsTabActive;
    this.getSession = getSession;
    this.modelContext = modelContext;
    this.onDidEdit = onDidEdit;
    this.registration = null;
  }

  getActiveContext({ expectedPath = null } = {}) {
    const path = this.getActiveFilePath();
    const kind = getVaultFileKind(path);
    const session = this.getSession();
    if (
      !this.getIsTabActive()
      || !path
      || (expectedPath && path !== expectedPath)
      || !SUPPORTED_FILE_KINDS.has(kind)
      || !session
      || !session.isInitialSyncComplete?.()
    ) {
      throw new Error('No supported, synchronized CollabMD document is active');
    }
    return { kind, path, session };
  }

  async refresh() {
    if (typeof this.modelContext?.registerTool !== 'function') {
      return false;
    }

    let context;
    try {
      context = this.getActiveContext();
    } catch {
      this.unregister();
      return false;
    }

    if (this.registration?.path === context.path && this.registration.session === context.session) {
      return true;
    }

    this.unregister();
    const controller = new AbortController();
    const registration = {
      controller,
      path: context.path,
      session: context.session,
    };
    this.registration = registration;

    try {
      await Promise.all([
        this.modelContext.registerTool({
          name: 'collabmd_read_active_document',
          description: 'Read the active synchronized CollabMD text document before proposing edits.',
          inputSchema: {
            additionalProperties: false,
            type: 'object',
          },
          annotations: {
            readOnlyHint: true,
            untrustedContentHint: true,
          },
          execute: async (_input, { signal } = {}) => {
            throwIfAborted(signal);
            const { kind, path, session } = this.getActiveContext({ expectedPath: registration.path });
            const content = session.getText();
            if (content.length > MAX_DOCUMENT_CHARACTERS) {
              throw new Error(`Documents larger than ${MAX_DOCUMENT_CHARACTERS} characters are not available to agents`);
            }
            const revision = await createEditableContentRevision(content);
            throwIfAborted(signal);
            const current = this.getActiveContext({ expectedPath: path });
            if (current.session !== session || current.session.getText() !== content) {
              throw new Error('The active document changed while it was being read');
            }
            return { content, kind, path, revision };
          },
        }, { signal: controller.signal }),
        this.modelContext.registerTool({
          name: 'collabmd_get_supported_syntax',
          description: 'Describe CollabMD-supported file kinds, extensions, syntax, and agent write support.',
          inputSchema: {
            additionalProperties: false,
            properties: {
              kind: {
                description: 'Optional content kind. Omit to list all capabilities.',
                type: 'string',
              },
            },
            type: 'object',
          },
          annotations: {
            readOnlyHint: true,
          },
          execute: async (input = {}, { signal } = {}) => {
            throwIfAborted(signal);
            if (!input.kind) return { capabilities: listCollabMdContentCapabilities() };
            const syntax = getCollabMdSyntaxGuide(input.kind);
            if (!syntax) throw new Error('Unknown CollabMD content kind');
            return syntax;
          },
        }, { signal: controller.signal }),
        this.modelContext.registerTool({
          name: 'collabmd_apply_text_edits',
          description: 'Apply bounded exact-text replacements to the active synchronized CollabMD document as the logged-in collaborator.',
          inputSchema: {
            additionalProperties: false,
            properties: {
              path: {
                description: 'Active Vault-relative path returned by collabmd_read_active_document.',
                maxLength: 1024,
                minLength: 1,
                type: 'string',
              },
              replacements: {
                description: 'One to 20 exact text replacements; each oldText must resolve unambiguously.',
                items: {
                  additionalProperties: false,
                  properties: {
                    newText: {
                      description: 'Replacement text.',
                      type: 'string',
                    },
                    oldText: {
                      description: 'Exact current text to replace.',
                      minLength: 1,
                      type: 'string',
                    },
                  },
                  required: ['oldText', 'newText'],
                  type: 'object',
                },
                maxItems: MAX_REPLACEMENTS,
                minItems: 1,
                type: 'array',
              },
              revision: {
                description: 'Lowercase SHA-256 revision returned by collabmd_read_active_document.',
                pattern: '^[a-f0-9]{64}$',
                type: 'string',
              },
            },
            required: ['path', 'revision', 'replacements'],
            type: 'object',
          },
          execute: async (input, { signal } = {}) => {
            throwIfAborted(signal);
            if (!input || typeof input.path !== 'string' || typeof input.revision !== 'string') {
              throw new Error('path, revision, and replacements are required');
            }
            const replacements = validateExactTextReplacements(input.replacements, {
              maxCharacters: MAX_REPLACEMENT_CHARACTERS,
              maxReplacements: MAX_REPLACEMENTS,
            });
            const { path, session } = this.getActiveContext({ expectedPath: input.path });
            const content = session.getText();
            if (content.length > MAX_DOCUMENT_CHARACTERS) {
              throw new Error(`Documents larger than ${MAX_DOCUMENT_CHARACTERS} characters cannot be edited by agents`);
            }
            const revision = await createEditableContentRevision(content);
            throwIfAborted(signal);
            const current = this.getActiveContext({ expectedPath: path });
            if (
              current.session !== session
              || current.session.getText() !== content
              || revision !== input.revision
            ) {
              throw new Error('The active document changed; read it again before editing');
            }

            const replacementCount = session.applyTextReplacements(replacements);
            const nextRevision = await createEditableContentRevision(session.getText());
            try {
              this.onDidEdit?.({ path, replacementCount });
            } catch (error) {
              console.error('[webmcp] Failed to report an applied edit:', error.message);
            }
            return { path, replacementCount, revision: nextRevision };
          },
        }, { signal: controller.signal }),
      ]);
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
