import { getCollabMdSyntaxGuide, isAgentCreatablePath, isAgentEditablePath, isAgentReadablePath, listCollabMdContentCapabilities } from '../../domain/collabmd-content-capabilities.js';
import { createEditableContentRevision } from '../../domain/editable-content-revision.js';
import { normalizeEditableText } from '../../domain/editable-text.js';
import { applyExactTextChanges, resolveExactTextChanges } from '../../domain/exact-text-edits.js';
import { applyAgentExcalidrawEdits, createAgentExcalidrawScene } from '../../domain/excalidraw-agent-scene.js';
import { inspectAgentExcalidrawScene, renderAgentExcalidrawSvg } from '../../domain/excalidraw-agent-verification.js';
import { getVaultFileKind } from '../../domain/file-kind.js';
import { compareWorkspacePaths, normalizeWorkspacePath } from '../domain/workspace-state.js';

const MAX_DOCUMENT_CHARACTERS = 200_000;
const MAX_AGENT_READ_SOURCE_CHARACTERS = 1_000_000;
const MAX_READ_CHARACTERS = 100_000;
const MAX_READ_LINES = 500;
const MAX_REPLACEMENTS = 20;
const MAX_REPLACEMENT_CHARACTERS = 50_000;

function createAgentContentError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function requireScope(actor, scope) {
  if (!actor?.scopes?.includes(scope)) {
    throw createAgentContentError('AGENT_SCOPE_REQUIRED', `Agent Connection requires ${scope}`, 403);
  }
}

function createAgentSourceRef(actor) {
  if (actor.sourceRef) return actor.sourceRef;
  return actor.connectionId === 'anonymous'
    ? 'agent:anonymous'
    : `agent-connection:${actor.connectionId}`;
}

function createCollaborationOrigin(actor) {
  return {
    actor: actor.collaborator ?? null,
    connectionId: actor.connectionId,
    requestId: actor.requestId,
    type: actor.origin ?? 'agent',
  };
}

function getMutationOrigin(actor) {
  return actor.origin ?? 'agent';
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

function requireInlineExcalidrawVerificationOptions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createAgentContentError('AGENT_INPUT_INVALID', 'Excalidraw verification options must be an object', 400);
  }
}

function createInlineExcalidrawVerification(scene, options) {
  const verification = {
    inspection: inspectAgentExcalidrawScene(scene, {
      inspectOcclusion: options.inspectOcclusion ?? true,
    }),
  };
  if (options.render) {
    Object.assign(verification, {
      ...renderAgentExcalidrawSvg(scene, {
        padding: options.padding ?? 32,
        scale: options.scale ?? 1,
      }),
      format: options.format ?? 'png',
      scene,
    });
  }
  return verification;
}

function searchLiveText(content, query, maxSnippets = 5) {
  const normalizedQuery = query.toLocaleLowerCase();
  const snippets = [];
  let matchCount = 0;
  String(content).split('\n').forEach((lineText, lineIndex) => {
    const normalizedLine = lineText.toLocaleLowerCase();
    let start = normalizedLine.indexOf(normalizedQuery);
    while (start >= 0) {
      matchCount += 1;
      if (snippets.length < maxSnippets) {
        const snippetStart = Math.max(0, start - 90);
        const snippetEnd = Math.min(lineText.length, start + query.length + 90);
        snippets.push({
          column: start + 1,
          line: lineIndex + 1,
          matchEnd: start - snippetStart + query.length + (snippetStart > 0 ? 3 : 0),
          matchStart: start - snippetStart + (snippetStart > 0 ? 3 : 0),
          text: `${snippetStart > 0 ? '...' : ''}${lineText.slice(snippetStart, snippetEnd)}${snippetEnd < lineText.length ? '...' : ''}`,
        });
      }
      start = normalizedLine.indexOf(normalizedQuery, start + Math.max(query.length, 1));
    }
  });
  return { matchCount, snippets, truncated: matchCount > snippets.length };
}

export class AgentContentService {
  constructor({ roomRegistry, searchService, vaultFileStore, workspaceMutationCoordinator }) {
    this.roomRegistry = roomRegistry;
    this.searchService = searchService;
    this.vaultFileStore = vaultFileStore;
    this.workspaceMutationCoordinator = workspaceMutationCoordinator;
    this.pathQueues = new Map();
  }

  runForPath(path, operation) {
    const previous = this.pathQueues.get(path) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.pathQueues.set(path, current);
    return current.finally(() => {
      if (this.pathQueues.get(path) === current) this.pathQueues.delete(path);
    });
  }

  async readCurrentContent(path) {
    const room = this.roomRegistry?.get?.(path);
    if (room) {
      if (!room.isHydrated?.()) {
        throw createAgentContentError('AGENT_DOCUMENT_SYNCING', 'Document is still synchronizing', 409);
      }
      const liveContent = room.readEditableContent?.() ?? room.getPersistedContent?.();
      if (liveContent !== null && liveContent !== undefined) return String(liveContent);
    }
    const content = await this.vaultFileStore.readEditableVaultContent(path);
    if (content === null) {
      throw createAgentContentError('AGENT_DOCUMENT_NOT_FOUND', 'Document not found', 404);
    }
    return content;
  }

  async readExcalidrawScene(actor, path) {
    requireScope(actor, 'vault:read');
    const normalizedPath = normalizeWorkspacePath(path);
    if (getVaultFileKind(normalizedPath) !== 'excalidraw') {
      throw createAgentContentError('AGENT_UNSUPPORTED_DOCUMENT', 'Excalidraw tools require an .excalidraw path', 400);
    }
    const content = await this.readCurrentContent(normalizedPath);
    if (content.length > MAX_DOCUMENT_CHARACTERS) {
      throw createAgentContentError('AGENT_DOCUMENT_TOO_LARGE', 'Document is too large for agent inspection', 413);
    }
    let scene;
    try {
      scene = JSON.parse(content);
    } catch {
      throw createAgentContentError('AGENT_INVALID_EXCALIDRAW', 'Document is not valid Excalidraw JSON', 400);
    }
    if (scene?.type !== 'excalidraw' || !Array.isArray(scene.elements)) {
      throw createAgentContentError('AGENT_INVALID_EXCALIDRAW', 'Document is not a valid Excalidraw scene', 400);
    }
    return {
      path: normalizedPath,
      revision: await createEditableContentRevision(content),
      scene,
    };
  }

  async inspectExcalidraw(actor, { path } = {}) {
    const current = await this.readExcalidrawScene(actor, path);
    return {
      ...inspectAgentExcalidrawScene(current.scene),
      path: current.path,
      revision: current.revision,
    };
  }

  async renderExcalidraw(actor, {
    format = 'png',
    padding = 32,
    path,
    scale = 1,
  } = {}) {
    const current = await this.readExcalidrawScene(actor, path);
    return {
      ...renderAgentExcalidrawSvg(current.scene, { padding, scale }),
      scene: current.scene,
      format,
      path: current.path,
      revision: current.revision,
    };
  }

  async verifyExcalidraw(actor, {
    format = 'png',
    inspectOcclusion = true,
    padding = 32,
    path,
    scale = 1,
  } = {}) {
    const current = await this.readExcalidrawScene(actor, path);
    return {
      ...renderAgentExcalidrawSvg(current.scene, { padding, scale }),
      scene: current.scene,
      format,
      inspection: inspectAgentExcalidrawScene(current.scene, { inspectOcclusion }),
      path: current.path,
      revision: current.revision,
    };
  }

  listDocuments(actor, { cursor = '', kinds = [], limit = 100, prefix = '' } = {}) {
    requireScope(actor, 'vault:read');
    const normalizedPrefix = normalizeWorkspacePath(prefix);
    const kindFilter = new Set(Array.isArray(kinds) ? kinds : []);
    const state = this.workspaceMutationCoordinator?.workspaceState;
    const documents = Array.from(state?.entries?.values?.() ?? [])
      .filter((entry) => entry.nodeType !== 'directory' && isAgentReadablePath(entry.path))
      .filter((entry) => !normalizedPrefix || entry.path === normalizedPrefix || entry.path.startsWith(`${normalizedPrefix}/`))
      .filter((entry) => kindFilter.size === 0 || kindFilter.has(getVaultFileKind(entry.path)))
      .sort((left, right) => compareWorkspacePaths(left.path, right.path));
    const start = cursor ? Math.max(0, documents.findIndex((entry) => entry.path === cursor) + 1) : 0;
    const pageSize = clampInteger(limit, 100, 1, 200);
    const page = documents.slice(start, start + pageSize).map((entry) => {
      const metadata = state?.metadata?.get?.(entry.path);
      return {
        kind: getVaultFileKind(entry.path),
        mtimeMs: Number(metadata?.mtimeMs ?? entry.mtimeMs ?? 0),
        path: entry.path,
        size: Number(metadata?.size ?? 0),
      };
    });
    const truncated = start + page.length < documents.length;
    return {
      documents: page,
      nextCursor: truncated ? page.at(-1)?.path ?? null : null,
      truncated,
    };
  }

  async searchVault(actor, { limit = 50, query = '', signal = null } = {}) {
    requireScope(actor, 'vault:read');
    const normalizedQuery = String(query ?? '').trim().slice(0, 500);
    const result = await this.searchService.search({ limit, query: normalizedQuery, signal });
    if (normalizedQuery.length < 2) return result;

    const liveFiles = [];
    for (const [path, room] of this.roomRegistry?.getRooms?.() ?? []) {
      if (!isAgentReadablePath(path) || !room.isHydrated?.()) continue;
      const content = room.readEditableContent?.();
      if (content === null || content === undefined) continue;
      if (content.length > MAX_AGENT_READ_SOURCE_CHARACTERS) continue;
      const live = searchLiveText(content, normalizedQuery);
      if (live.matchCount > 0) {
        liveFiles.push({ file: path, kind: getVaultFileKind(path), ...live });
      }
    }
    if (liveFiles.length === 0) return result;

    const livePaths = new Set(liveFiles.map(({ file }) => file));
    const files = [...result.files.filter(({ file }) => !livePaths.has(file)), ...liveFiles]
      .sort((left, right) => compareWorkspacePaths(left.file, right.file))
      .slice(0, clampInteger(limit, 50, 1, 50));
    return {
      ...result,
      files,
      matchCount: files.reduce((sum, file) => sum + file.matchCount, 0),
      truncated: result.truncated || files.length < result.files.length + liveFiles.length,
    };
  }

  async readDocument(actor, { lineCount = MAX_READ_LINES, path, startLine = 1 } = {}) {
    requireScope(actor, 'vault:read');
    const normalizedPath = normalizeWorkspacePath(path);
    if (!isAgentReadablePath(normalizedPath)) {
      throw createAgentContentError('AGENT_UNSUPPORTED_DOCUMENT', 'Document type is not readable by agents', 400);
    }
    const content = await this.readCurrentContent(normalizedPath);
    if (content.length > MAX_AGENT_READ_SOURCE_CHARACTERS) {
      throw createAgentContentError('AGENT_DOCUMENT_TOO_LARGE', 'Document is too large for agent reading', 413);
    }
    const lines = content.split('\n');
    const start = clampInteger(startLine, 1, 1, Math.max(lines.length, 1));
    const count = clampInteger(lineCount, MAX_READ_LINES, 1, MAX_READ_LINES);
    let selected = lines.slice(start - 1, start - 1 + count).join('\n');
    let characterTruncated = false;
    let endLine = Math.min(start + count - 1, lines.length);
    if (selected.length > MAX_READ_CHARACTERS) {
      selected = selected.slice(0, MAX_READ_CHARACTERS);
      characterTruncated = true;
      let returnedLineCount = 1;
      for (let index = 0; index < selected.length; index += 1) {
        if (selected.charCodeAt(index) === 10) returnedLineCount += 1;
      }
      if (selected.endsWith('\n')) returnedLineCount -= 1;
      endLine = Math.min(start + Math.max(returnedLineCount, 1) - 1, lines.length);
    }
    return {
      content: selected,
      endLine,
      kind: getVaultFileKind(normalizedPath),
      path: normalizedPath,
      revision: await createEditableContentRevision(content),
      startLine: start,
      totalLines: lines.length,
      truncated: characterTruncated || endLine < lines.length,
    };
  }

  async applyTextEdits(actor, { path, replacements, revision } = {}) {
    requireScope(actor, 'vault:edit');
    const normalizedPath = normalizeWorkspacePath(path);
    if (!isAgentEditablePath(normalizedPath)) {
      throw createAgentContentError('AGENT_UNSUPPORTED_DOCUMENT', 'Document type is not editable by agents', 400);
    }
    return this.runForPath(normalizedPath, async () => {
      const content = await this.readCurrentContent(normalizedPath);
      if (content.length > MAX_DOCUMENT_CHARACTERS) {
        throw createAgentContentError('AGENT_DOCUMENT_TOO_LARGE', 'Document is too large for agent editing', 413);
      }
      const currentRevision = await createEditableContentRevision(content);
      if (revision !== currentRevision) {
        throw createAgentContentError('AGENT_REVISION_CONFLICT', 'Document changed; read it again before editing', 409);
      }
      const normalizedReplacements = replacements?.map((replacement) => ({
        ...replacement,
        newText: normalizeEditableText(replacement?.newText),
      }));
      let changes;
      try {
        changes = resolveExactTextChanges(content, normalizedReplacements, {
          maxCharacters: MAX_REPLACEMENT_CHARACTERS,
          maxReplacements: MAX_REPLACEMENTS,
        });
      } catch (error) {
        error.code = error.code?.startsWith('EXACT_EDIT_') ? 'AGENT_REPLACEMENT_MISMATCH' : error.code;
        throw error;
      }
      const room = this.roomRegistry?.get?.(normalizedPath);
      let nextContent;
      if (room) {
        room.applyExactTextChanges(changes, {
          origin: createCollaborationOrigin(actor),
        });
        nextContent = room.readEditableContent();
      } else {
        nextContent = applyExactTextChanges(content, changes);
        const result = await this.workspaceMutationCoordinator.writeEditableContent({
          content: nextContent,
          origin: getMutationOrigin(actor),
          path: normalizedPath,
          requestId: actor.requestId,
          sourceRef: createAgentSourceRef(actor),
        });
        if (!result.ok) throw createAgentContentError('AGENT_WRITE_FAILED', result.error, 400);
      }
      return {
        path: normalizedPath,
        replacementCount: changes.length,
        revision: await createEditableContentRevision(nextContent),
      };
    });
  }

  async createExcalidraw(actor, { elements, path, verify = null } = {}) {
    requireScope(actor, 'vault:edit');
    const normalizedPath = normalizeWorkspacePath(path);
    if (getVaultFileKind(normalizedPath) !== 'excalidraw') {
      throw createAgentContentError('AGENT_UNSUPPORTED_DOCUMENT', 'Excalidraw tools require an .excalidraw path', 400);
    }
    if (verify !== null) requireInlineExcalidrawVerificationOptions(verify);
    let scene;
    try {
      scene = createAgentExcalidrawScene(elements);
    } catch (error) {
      if (error?.code === 'EXCALIDRAW_SCENE_INVALID') {
        throw createAgentContentError('AGENT_INVALID_EXCALIDRAW', error.message, 400);
      }
      throw error;
    }
    const content = JSON.stringify(scene);
    if (content.length > MAX_DOCUMENT_CHARACTERS) {
      throw createAgentContentError('AGENT_DOCUMENT_TOO_LARGE', 'Document is too large for agent creation', 413);
    }
    return this.runForPath(normalizedPath, async () => {
      const result = await this.workspaceMutationCoordinator.createFile({
        content,
        origin: getMutationOrigin(actor),
        path: normalizedPath,
        requestId: actor.requestId,
        sourceRef: createAgentSourceRef(actor),
      });
      if (!result.ok) throw createAgentContentError('AGENT_CREATE_FAILED', result.error, 409);
      const response = {
        elementCount: scene.elements.length,
        path: normalizedPath,
        revision: await createEditableContentRevision(content),
      };
      if (verify !== null) {
        response.verification = createInlineExcalidrawVerification(scene, verify);
      }
      return response;
    });
  }

  async editExcalidraw(actor, {
    create = [],
    delete: remove = [],
    path,
    reorder = [],
    replace = [],
    revision,
    translate = null,
    update = [],
    verify = null,
  } = {}) {
    requireScope(actor, 'vault:edit');
    const normalizedPath = normalizeWorkspacePath(path);
    if (getVaultFileKind(normalizedPath) !== 'excalidraw') {
      throw createAgentContentError('AGENT_UNSUPPORTED_DOCUMENT', 'Excalidraw tools require an .excalidraw path', 400);
    }
    if (verify !== null) requireInlineExcalidrawVerificationOptions(verify);
    return this.runForPath(normalizedPath, async () => {
      const content = await this.readCurrentContent(normalizedPath);
      if (content.length > MAX_DOCUMENT_CHARACTERS) {
        throw createAgentContentError('AGENT_DOCUMENT_TOO_LARGE', 'Document is too large for agent editing', 413);
      }
      if (revision !== await createEditableContentRevision(content)) {
        throw createAgentContentError('AGENT_REVISION_CONFLICT', 'Document changed; read it again before editing', 409);
      }
      let scene;
      try {
        scene = applyAgentExcalidrawEdits(JSON.parse(content), {
          create,
          delete: remove,
          reorder,
          replace,
          update,
          translate,
        });
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw createAgentContentError('AGENT_INVALID_EXCALIDRAW', 'Document is not valid Excalidraw JSON', 400);
        }
        if (error?.code === 'EXCALIDRAW_SCENE_INVALID') {
          throw createAgentContentError('AGENT_INVALID_EXCALIDRAW', error.message, 400);
        }
        throw error;
      }
      const room = this.roomRegistry?.get?.(normalizedPath);
      let nextContent;
      if (room) {
        room.applyExcalidrawScene(scene, {
          origin: createCollaborationOrigin(actor),
        });
        nextContent = room.getPersistedContent();
      } else {
        const storedScene = {
          ...scene,
          elements: scene.elements.filter((element) => !element.isDeleted),
        };
        nextContent = JSON.stringify(storedScene);
        const result = await this.workspaceMutationCoordinator.writeEditableContent({
          content: nextContent,
          origin: getMutationOrigin(actor),
          path: normalizedPath,
          requestId: actor.requestId,
          sourceRef: createAgentSourceRef(actor),
        });
        if (!result.ok) throw createAgentContentError('AGENT_WRITE_FAILED', result.error, 400);
      }
      const storedScene = JSON.parse(nextContent);
      const result = {
        created: create.length,
        deleted: remove.length,
        elementCount: storedScene.elements.filter((element) => !element.isDeleted).length,
        path: normalizedPath,
        reordered: reorder.length,
        replaced: replace.length,
        revision: await createEditableContentRevision(nextContent),
        translated: translate?.ids?.length ?? 0,
        updated: update.length,
      };
      if (verify !== null) {
        result.verification = createInlineExcalidrawVerification(storedScene, verify);
      }
      return result;
    });
  }

  async createDocument(actor, { content = '', path } = {}) {
    requireScope(actor, 'vault:edit');
    const normalizedPath = normalizeWorkspacePath(path);
    if (!isAgentCreatablePath(normalizedPath)) {
      throw createAgentContentError('AGENT_UNSUPPORTED_DOCUMENT', 'Document type cannot be created by agents', 400);
    }
    const normalizedContent = normalizeEditableText(content);
    if (normalizedContent.length > MAX_DOCUMENT_CHARACTERS) {
      throw createAgentContentError('AGENT_DOCUMENT_TOO_LARGE', 'Document is too large for agent creation', 413);
    }
    return this.runForPath(normalizedPath, async () => {
      const result = await this.workspaceMutationCoordinator.createFile({
        content: normalizedContent,
        origin: getMutationOrigin(actor),
        path: normalizedPath,
        requestId: actor.requestId,
        sourceRef: createAgentSourceRef(actor),
      });
      if (!result.ok) throw createAgentContentError('AGENT_CREATE_FAILED', result.error, 409);
      return {
        kind: getVaultFileKind(normalizedPath),
        path: normalizedPath,
        revision: await createEditableContentRevision(normalizedContent),
      };
    });
  }

  getSyntax(actor, { kind = '' } = {}) {
    requireScope(actor, 'vault:read');
    if (!kind) return { capabilities: listCollabMdContentCapabilities() };
    const syntax = getCollabMdSyntaxGuide(kind);
    if (!syntax) throw createAgentContentError('AGENT_UNSUPPORTED_DOCUMENT', 'Unknown CollabMD content kind', 400);
    return syntax;
  }
}
