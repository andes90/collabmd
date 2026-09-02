import {
  getCollabMdContentCapability,
  getCollabMdSyntaxGuide,
  isAgentCreatablePath,
  isAgentEditablePath,
  isAgentReadablePath,
  listCollabMdContentCapabilities,
} from '../../domain/collabmd-content-capabilities.js';
import { listRenderableDiagrams, resolveRenderableDiagram } from '../../domain/diagram-source.js';
import { createEditableContentRevision } from '../../domain/editable-content-revision.js';
import { normalizeEditableText } from '../../domain/editable-text.js';
import { applyExactTextChanges, resolveExactTextChanges } from '../../domain/exact-text-edits.js';
import {
  applyAgentExcalidrawEditsWithSummary,
  createAgentExcalidrawScene,
} from '../../domain/excalidraw-agent-scene.js';
import { inspectAgentExcalidrawScene, renderAgentExcalidrawSvg } from '../../domain/excalidraw-agent-verification.js';
import { getVaultFileKind, isBaseFilePath } from '../../domain/file-kind.js';
import { isWholeWordMatch } from '../../domain/literal-text-search.js';
import { createWikiTargetIndex } from '../../domain/wiki-link-resolver.js';
import {
  classifyPublicVideoEmbed,
  isPublicVideoEmbedCandidate,
} from '../../domain/video-embed.js';
import { isPlainObject, parseBaseSource } from '../domain/bases/base-definition.js';
import {
  collectMarkdownImageSources,
  collectMarkdownReferences,
} from '../domain/markdown-reference-extractor.js';
import { compareWorkspacePaths, normalizeWorkspacePath } from '../domain/workspace-state.js';

const MAX_DOCUMENT_CHARACTERS = 200_000;
const MAX_AGENT_READ_SOURCE_CHARACTERS = 1_000_000;
const MAX_READ_CHARACTERS = 100_000;
const MAX_READ_LINES = 500;
const MAX_REPLACEMENTS = 20;
const MAX_REPLACEMENT_CHARACTERS = 50_000;
const EMBEDDABLE_KINDS = new Set(['base', 'drawio', 'excalidraw', 'image', 'mermaid', 'plantuml']);

function assertValidAgentBaseContent(path, content) {
  if (!isBaseFilePath(path)) return;
  try {
    const raw = parseBaseSource(content);
    if (raw != null && !isPlainObject(raw)) {
      throw new Error('Base source must be a YAML object');
    }
  } catch (error) {
    throw createAgentContentError('AGENT_INVALID_BASE', error.message || 'Base source is invalid', 400);
  }
}

function toAgentBaseQueryResult(path, { columns, rows, view }, limit) {
  return {
    columns: columns.map(({ id, label }) => ({ id, label })),
    path,
    rows: rows.slice(0, limit).map((row) => ({
      cells: Object.fromEntries(columns.map(({ id }) => [id, String(row.cells[id]?.text ?? '')])),
      path: row.path,
    })),
    totalRows: rows.length,
    truncated: rows.length > limit,
    view: {
      name: view.name,
      type: view.type,
    },
  };
}

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

function createInlineExcalidrawVerification(scene, options, { deferRender = false } = {}) {
  const verification = {
    inspection: inspectAgentExcalidrawScene(scene, {
      includeElements: false,
      inspectOcclusion: options.inspectOcclusion ?? true,
    }),
  };
  if (options.render) {
    if (deferRender) {
      verification.elementCount = verification.inspection.elementCount;
      verification.scene = scene;
    } else {
      Object.assign(verification, {
        ...renderAgentExcalidrawSvg(scene, {
          padding: options.padding ?? 32,
          scale: options.scale ?? 1,
        }),
        format: options.format ?? 'png',
        scene,
      });
    }
  }
  return verification;
}

function searchLiveText(content, query, maxSnippets = 5, wholeWord = false) {
  const normalizedQuery = query.toLocaleLowerCase();
  const snippets = [];
  let matchCount = 0;
  String(content).split('\n').forEach((lineText, lineIndex) => {
    const normalizedLine = lineText.toLocaleLowerCase();
    let start = normalizedLine.indexOf(normalizedQuery);
    while (start >= 0) {
      if (!wholeWord || isWholeWordMatch(normalizedLine, start, start + normalizedQuery.length)) {
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
      }
      start = normalizedLine.indexOf(normalizedQuery, start + Math.max(query.length, 1));
    }
  });
  return { matchCount, snippets, truncated: matchCount > snippets.length };
}

export class AgentContentService {
  constructor({
    backlinkIndex = null,
    baseQueryService = null,
    plantUmlRenderer = null,
    roomRegistry,
    searchService,
    vaultFileStore,
    workspaceMutationCoordinator,
  }) {
    this.backlinkIndex = backlinkIndex;
    this.baseQueryService = baseQueryService;
    this.plantUmlRenderer = plantUmlRenderer;
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

  async readMatchingContent(path, matches) {
    try {
      const content = await this.readCurrentContent(path);
      return matches(content) ? content : null;
    } catch {
      return null;
    }
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


  async verifyExcalidraw(actor, {
    format = 'png',
    inspectOcclusion = true,
    padding = 32,
    path,
    render = true,
    scale = 1,
  } = {}) {
    const current = await this.readExcalidrawScene(actor, path);
    const inspection = inspectAgentExcalidrawScene(current.scene, {
      includeElements: false,
      inspectOcclusion,
    });
    const result = {
      elementCount: inspection.elementCount,
      format,
      inspection,
      layout: inspection.layout,
      path: current.path,
      revision: current.revision,
      valid: inspection.valid,
    };
    if (!render) return result;

    result.scene = current.scene;
    if (actor.origin !== 'webmcp') {
      Object.assign(result, renderAgentExcalidrawSvg(current.scene, { padding, scale }));
    }
    return result;
  }

  listWorkspaceEntries(actor, {
    cursor = '',
    kinds = [],
    limit = 100,
    prefix = '',
    pathQuery = '',
  } = {}) {
    requireScope(actor, 'vault:read');
    const normalizedPrefix = normalizeWorkspacePath(prefix);
    const normalizedPathQuery = String(pathQuery).trim().toLocaleLowerCase();
    const kindFilter = new Set(Array.isArray(kinds) ? kinds : []);
    const state = this.workspaceMutationCoordinator?.workspaceState;
    const entries = Array.from(state?.entries?.values?.() ?? [])
      .filter((entry) => !normalizedPrefix || entry.path === normalizedPrefix || entry.path.startsWith(`${normalizedPrefix}/`))
      .filter((entry) => kindFilter.size === 0 || kindFilter.has(getVaultFileKind(entry.path)))
      .filter((entry) => !normalizedPathQuery || entry.path.toLocaleLowerCase().includes(normalizedPathQuery))
      .sort((left, right) => compareWorkspacePaths(left.path, right.path));
    let start = 0;
    if (cursor) {
      const cursorIndex = entries.findIndex((entry) => entry.path === cursor);
      if (cursorIndex < 0) {
        throw createAgentContentError('AGENT_CURSOR_INVALID', 'Pagination cursor is no longer valid', 400);
      }
      start = cursorIndex + 1;
    }
    const pageSize = clampInteger(limit, 100, 1, 200);
    const page = entries.slice(start, start + pageSize).map((entry) => {
      const isDirectory = entry.nodeType === 'directory';
      const kind = isDirectory ? null : getVaultFileKind(entry.path);
      const capability = kind ? getCollabMdContentCapability(kind) : null;
      const metadata = state?.metadata?.get?.(entry.path);
      return {
        agentEditable: Boolean(capability?.agentEditable),
        embeddable: EMBEDDABLE_KINDS.has(kind),
        kind,
        mtimeMs: Number(metadata?.mtimeMs ?? entry.mtimeMs ?? 0),
        nodeType: isDirectory ? 'directory' : 'file',
        path: entry.path,
        readable: Boolean(capability?.readable),
        size: Number(metadata?.size ?? 0),
      };
    });
    const truncated = start + page.length < entries.length;
    return {
      entries: page,
      nextCursor: truncated ? page.at(-1)?.path ?? null : null,
      truncated,
    };
  }


  async searchVault(actor, {
    kinds = [],
    limit = 50,
    maxSnippetsPerFile = 5,
    prefix = '',
    query = '',
    wholeWord = false,
    signal = null,
  } = {}) {
    requireScope(actor, 'vault:read');
    const normalizedQuery = String(query ?? '').trim().slice(0, 500);
    const normalizedPrefix = normalizeWorkspacePath(prefix);
    const kindFilter = new Set(Array.isArray(kinds) ? kinds : []);
    const snippetLimit = clampInteger(maxSnippetsPerFile, 5, 1, 10);
    const result = await this.searchService.search({
      kinds: [...kindFilter],
      limit,
      maxSnippetsPerFile: snippetLimit,
      prefix: normalizedPrefix,
      query: normalizedQuery,
      wholeWord,
      signal,
    });
    if (normalizedQuery.length < 2) return result;

    const liveFiles = [];
    for (const [path, room] of this.roomRegistry?.getRooms?.() ?? []) {
      const kind = getVaultFileKind(path);
      if (
        !isAgentReadablePath(path)
        || !room.isHydrated?.()
        || (normalizedPrefix && path !== normalizedPrefix && !path.startsWith(`${normalizedPrefix}/`))
        || (kindFilter.size > 0 && !kindFilter.has(kind))
      ) continue;
      const content = room.readEditableContent?.();
      if (content === null || content === undefined) continue;
      if (content.length > MAX_AGENT_READ_SOURCE_CHARACTERS) continue;
      const live = searchLiveText(content, normalizedQuery, snippetLimit, wholeWord);
      if (live.matchCount > 0) {
        liveFiles.push({ file: path, kind, ...live });
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
  async inspectDocumentReferences(actor, { path } = {}) {
    requireScope(actor, 'vault:read');
    const normalizedPath = normalizeWorkspacePath(path);
    if (getVaultFileKind(normalizedPath) !== 'markdown') {
      throw createAgentContentError('AGENT_UNSUPPORTED_DOCUMENT', 'Reference inspection requires a Markdown document', 400);
    }
    const content = await this.readCurrentContent(normalizedPath);
    if (content.length > MAX_AGENT_READ_SOURCE_CHARACTERS) {
      throw createAgentContentError('AGENT_DOCUMENT_TOO_LARGE', 'Document is too large for agent inspection', 413);
    }
    const entries = Array.from(this.workspaceMutationCoordinator?.workspaceState?.entries?.values?.() ?? []);
    const filePaths = entries
      .filter((entry) => entry.nodeType !== 'directory')
      .map((entry) => entry.path);
    const references = collectMarkdownReferences(content, {
      sourceFilePath: normalizedPath,
      wikiTargetIndex: createWikiTargetIndex(filePaths),
    });
    const toPublicReference = (reference) => ({
      exists: Boolean(reference.resolvedPath),
      kind: getVaultFileKind(reference.resolvedPath || reference.targetPath),
      line: reference.line,
      rawTarget: reference.rawTarget,
      resolvedPath: reference.resolvedPath || null,
      targetPath: reference.targetPath,
    });
    const videos = collectMarkdownImageSources(content)
      .filter(({ source }) => isPublicVideoEmbedCandidate(source))
      .map(({ line, source }) => {
        const video = classifyPublicVideoEmbed(source);
        return {
          kind: video?.type ?? null,
          line,
          mimeType: video?.mimeType ?? null,
          source,
          supported: Boolean(video),
          url: video?.embedUrl ?? video?.sourceUrl ?? null,
        };
      });
    return {
      backlinks: await this.backlinkIndex?.getBacklinks?.(normalizedPath) ?? [],
      embeds: references.filter(({ isEmbed }) => isEmbed).map(toPublicReference),
      path: normalizedPath,
      revision: await createEditableContentRevision(content),
      videos,
      wikiLinks: references.filter(({ isEmbed }) => !isEmbed).map(toPublicReference),
    };
  }

  async validateDocument(actor, { path } = {}) {
    const inspected = await this.inspectDocumentReferences(actor, { path });
    const issues = [];
    inspected.wikiLinks.filter(({ exists }) => !exists).forEach((reference) => {
      issues.push({
        code: 'REFERENCE_TARGET_NOT_FOUND',
        line: reference.line,
        message: `Wiki-link target not found: ${reference.rawTarget}`,
        target: reference.rawTarget,
      });
    });
    inspected.embeds.filter(({ exists }) => !exists).forEach((reference) => {
      issues.push({
        code: 'EMBED_TARGET_NOT_FOUND',
        line: reference.line,
        message: `Embed target not found: ${reference.rawTarget}`,
        target: reference.rawTarget,
      });
    });
    inspected.videos.filter(({ supported }) => !supported).forEach((video) => {
      issues.push({
        code: 'VIDEO_EMBED_UNSUPPORTED',
        line: video.line,
        message: `Unsupported public video embed: ${video.source}`,
        target: video.source,
      });
    });
    return {
      issues,
      path: inspected.path,
      revision: inspected.revision,
      valid: issues.length === 0,
    };
  }

  async queryBase(actor, { limit = 50, path, search = '', view = '' } = {}) {
    requireScope(actor, 'vault:read');
    const normalizedPath = normalizeWorkspacePath(path);
    if (!isBaseFilePath(normalizedPath)) {
      throw createAgentContentError('AGENT_UNSUPPORTED_DOCUMENT', 'Base queries require a .base path', 400);
    }
    const content = await this.readCurrentContent(normalizedPath);
    if (!this.baseQueryService?.query) {
      throw createAgentContentError('AGENT_BASE_QUERY_UNAVAILABLE', 'Bases query service is unavailable', 503);
    }
    const pageSize = clampInteger(limit, 50, 1, 200);
    try {
      const result = await this.baseQueryService.query({
        basePath: normalizedPath,
        search,
        source: content,
        sourcePath: normalizedPath,
        view,
      });
      return toAgentBaseQueryResult(normalizedPath, result, pageSize);
    } catch (error) {
      if (error?.code?.startsWith('AGENT_')) throw error;
      throw createAgentContentError('AGENT_BASE_QUERY_FAILED', error.message || 'Failed to query base', 400);
    }
  }

  async renderDiagram(actor, { format = 'png', path, startLine } = {}) {
    requireScope(actor, 'vault:read');
    const normalizedPath = normalizeWorkspacePath(path);
    const kind = getVaultFileKind(normalizedPath);
    if (kind !== 'markdown' && kind !== 'mermaid' && kind !== 'plantuml') {
      throw createAgentContentError('AGENT_UNSUPPORTED_DOCUMENT', 'Diagram rendering requires Markdown, Mermaid, or PlantUML content', 400);
    }
    const content = await this.readCurrentContent(normalizedPath);
    if (content.length > MAX_AGENT_READ_SOURCE_CHARACTERS) {
      throw createAgentContentError('AGENT_DOCUMENT_TOO_LARGE', 'Document is too large for diagram rendering', 413);
    }
    const diagram = resolveRenderableDiagram(content, normalizedPath, { startLine });
    if (!diagram) {
      const count = listRenderableDiagrams(content, normalizedPath).length;
      const message = count > 1 && !startLine
        ? 'Document contains multiple diagrams; provide the opening fence startLine'
        : 'Renderable diagram not found at the requested path and line';
      throw createAgentContentError('AGENT_DIAGRAM_NOT_FOUND', message, 400);
    }
    if (diagram.kind === 'mermaid') {
      throw createAgentContentError(
        'AGENT_BROWSER_RENDER_REQUIRED',
        'Mermaid rendering requires WebMCP in an active CollabMD browser tab',
        400,
      );
    }
    if (!this.plantUmlRenderer?.renderSvg) {
      throw createAgentContentError('AGENT_RENDER_UNAVAILABLE', 'PlantUML rendering is unavailable', 503);
    }
    let svg;
    try {
      svg = await this.plantUmlRenderer.renderSvg(diagram.source);
    } catch {
      throw createAgentContentError('AGENT_DIAGRAM_RENDER_FAILED', 'PlantUML rendering failed', 502);
    }
    return {
      endLine: diagram.endLine,
      format,
      kind: diagram.kind,
      path: normalizedPath,
      renderer: 'plantuml-server',
      revision: await createEditableContentRevision(content),
      startLine: diagram.startLine,
      svg,
      warnings: [],
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
      const nextContent = applyExactTextChanges(content, changes);
      assertValidAgentBaseContent(normalizedPath, nextContent);
      const room = this.roomRegistry?.get?.(normalizedPath);
      if (room) {
        room.applyExactTextChanges(changes, {
          origin: createCollaborationOrigin(actor),
        });
      } else {
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
        revision: await createEditableContentRevision(room ? room.readEditableContent() : nextContent),
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
    let content = JSON.stringify(scene);
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
      if (!result.ok) {
        const rawById = new Map(elements.map((element) => [String(element.id), element]));
        const existingContent = await this.readMatchingContent(normalizedPath, (candidate) => {
          const existingScene = JSON.parse(candidate);
          const existingById = new Map(existingScene.elements?.map((element) => [element.id, element]) ?? []);
          const comparableScene = {
            ...scene,
            elements: scene.elements.map((element) => (
              Object.hasOwn(rawById.get(element.id) ?? {}, 'updated')
                ? element
                : { ...element, updated: existingById.get(element.id)?.updated }
            )),
          };
          return JSON.stringify(existingScene) === JSON.stringify(comparableScene);
        });
        if (existingContent === null) {
          throw createAgentContentError('AGENT_CREATE_FAILED', result.error, 409);
        }
        scene = JSON.parse(existingContent);
        content = existingContent;
      }
      const response = {
        elementCount: scene.elements.length,
        path: normalizedPath,
        revision: await createEditableContentRevision(content),
      };
      if (verify !== null) {
        response.verification = createInlineExcalidrawVerification(scene, verify, {
          deferRender: actor.origin === 'webmcp',
        });
      }
      return response;
    });
  }

  async editExcalidraw(actor, {
    create = [],
    delete: remove = [],
    normalizeTextPlacement,
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
      let edit;
      try {
        edit = applyAgentExcalidrawEditsWithSummary(JSON.parse(content), {
          create,
          delete: remove,
          normalizeTextPlacement,
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
      const { reflowed, scene } = edit;
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
        reflowed,
        replaced: replace.length,
        revision: await createEditableContentRevision(nextContent),
        translated: translate?.ids?.length ?? 0,
        updated: update.length,
      };
      if (verify !== null) {
        result.verification = createInlineExcalidrawVerification(storedScene, verify, {
          deferRender: actor.origin === 'webmcp',
        });
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
    assertValidAgentBaseContent(normalizedPath, normalizedContent);
    return this.runForPath(normalizedPath, async () => {
      const result = await this.workspaceMutationCoordinator.createFile({
        content: normalizedContent,
        origin: getMutationOrigin(actor),
        path: normalizedPath,
        requestId: actor.requestId,
        sourceRef: createAgentSourceRef(actor),
      });
      if (!result.ok) {
        const existingContent = await this.readMatchingContent(
          normalizedPath,
          (candidate) => candidate === normalizedContent,
        );
        if (existingContent === null) {
          throw createAgentContentError('AGENT_CREATE_FAILED', result.error, 409);
        }
      }
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
