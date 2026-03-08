import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { Compartment, EditorSelection, EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { WebsocketProvider } from 'y-websocket';
import { yCollab } from 'y-codemirror.next';
import * as Y from 'yjs';

import { plantUmlLanguage, plantUmlLanguageDescription } from '../domain/plantuml-language.js';
import { createMarkdownToolbarEdit } from '../domain/markdown-formatting.js';
import { createRandomUser, normalizeUserName } from '../domain/room.js';
import { wikiLinkCompletions } from '../domain/wiki-link-completions.js';
import {
  createCommentId,
  createCommentThreadSharedType,
  normalizeCommentBody,
  serializeCommentThreads,
  summarizeCommentExcerpt,
} from '../../domain/comment-threads.js';
import { resolveWsBaseUrl } from './runtime-config.js';

const markdownCodeLanguages = [...languages, plantUmlLanguageDescription];

function createEditorTheme(theme) {
  const activeLineBackground = theme === 'dark'
    ? 'oklch(from var(--color-surface-offset) l c h / 0.55)'
    : 'oklch(from var(--color-surface-offset) l c h / 0.75)';
  const activeLineAccent = theme === 'dark'
    ? 'oklch(from var(--color-primary) l c h / 0.28)'
    : 'oklch(from var(--color-primary) l c h / 0.18)';
  const selectionBackground = theme === 'dark'
    ? 'oklch(from var(--color-primary) l c h / 0.4)'
    : 'oklch(from var(--color-primary) l c h / 0.26)';
  const selectionBorder = theme === 'dark'
    ? 'oklch(from var(--color-primary) l c h / 0.65)'
    : 'oklch(from var(--color-primary) l c h / 0.5)';

  return EditorView.theme({
    '&': {
      backgroundColor: 'var(--color-bg)',
      color: 'var(--color-text)',
    },
    '.cm-content': {
      caretColor: 'var(--color-primary)',
      fontFamily: 'var(--font-mono)',
      padding: '16px 0',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--color-primary)',
      borderLeftWidth: '2px',
    },
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--color-surface-dynamic)',
      border: 'none',
      color: 'var(--color-text-muted)',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--color-surface)',
      borderRight: '1px solid var(--color-divider)',
      color: 'var(--color-text-faint)',
      minWidth: '44px',
    },
    '.cm-line': {
      padding: '0 16px',
    },
    '.cm-activeLine': {
      backgroundColor: activeLineBackground,
      boxShadow: `inset 3px 0 0 ${activeLineAccent}`,
    },
    '.cm-activeLineGutter': {
      backgroundColor: activeLineBackground,
      boxShadow: `inset 3px 0 0 ${activeLineAccent}`,
      color: 'var(--color-text-muted)',
    },
    '.cm-matchingBracket': {
      backgroundColor: 'var(--color-primary-highlight)',
      outline: '1px solid var(--color-primary)',
    },
    '.cm-selectionMatch': {
      backgroundColor: 'var(--color-primary-highlight)',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: selectionBackground,
    },
    '&.cm-focused .cm-selectionLayer .cm-selectionBackground': {
      border: `1px solid ${selectionBorder}`,
      borderRadius: '2px',
    },
  }, { dark: theme === 'dark' });
}

function createLanguageExtension(filePath) {
  if (
    typeof filePath === 'string'
    && (filePath.toLowerCase().endsWith('.puml') || filePath.toLowerCase().endsWith('.plantuml'))
  ) {
    return plantUmlLanguage;
  }

  return markdown({ base: markdownLanguage, codeLanguages: markdownCodeLanguages });
}

function createCommentMessage({ body, user }) {
  return {
    body,
    createdAt: Date.now(),
    id: createCommentId('comment'),
    peerId: user?.peerId ?? '',
    userColor: user?.color ?? '',
    userName: user?.name ?? 'Anonymous',
  };
}

export class EditorSession {
  constructor({
    editorContainer,
    lineWrappingEnabled = true,
    initialTheme,
    lineInfoElement,
    onAwarenessChange,
    onConnectionChange,
    onCommentsChange,
    onContentChange,
    preferredUserName,
    localUser,
    getFileList,
  }) {
    this.editorContainer = editorContainer;
    this.lineWrappingEnabled = lineWrappingEnabled;
    this.initialTheme = initialTheme;
    this.lineInfoElement = lineInfoElement;
    this.onAwarenessChange = onAwarenessChange;
    this.onConnectionChange = onConnectionChange;
    this.onCommentsChange = onCommentsChange;
    this.onContentChange = onContentChange;
    this.preferredUserName = preferredUserName;
    this._providedLocalUser = localUser || null;
    this.getFileList = getFileList || (() => []);
    this.editorView = null;
    this.provider = null;
    this.awareness = null;
    this.localUser = null;
    this.themeCompartment = new Compartment();
    this.syntaxThemeCompartment = new Compartment();
    this.lineWrappingCompartment = new Compartment();
    this.ydoc = null;
    this.ytext = null;
    this.commentThreads = null;
    this.handleCommentThreadsChange = null;
    this.wsBaseUrl = '';
  }

  async initialize(filePath) {
    this.wsBaseUrl = resolveWsBaseUrl();
    this.ydoc = new Y.Doc();
    this.ytext = this.ydoc.getText('codemirror');
    this.commentThreads = this.ydoc.getArray('comments');

    const undoManager = new Y.UndoManager(this.ytext);
    const user = this._providedLocalUser ?? createRandomUser(this.preferredUserName);
    const provider = new WebsocketProvider(this.wsBaseUrl, filePath, this.ydoc, {
      disableBc: true,
      maxBackoffTime: 5000,
    });

    this.provider = provider;

    const awareness = provider.awareness;
    this.awareness = awareness;
    this.localUser = user;
    awareness.setLocalStateField('user', user);

    this.trackConnectionStatus();

    let initialSyncDone = false;
    provider.on('sync', (isSynced) => {
      if (!isSynced || initialSyncDone) {
        return;
      }

      initialSyncDone = true;
      this.onContentChange?.();
    });

    awareness.on('change', () => {
      this.onAwarenessChange?.(this.collectUsers(awareness));
    });

    this.handleCommentThreadsChange = () => {
      this.onCommentsChange?.(this.getCommentThreads());
    };
    this.commentThreads.observeDeep(this.handleCommentThreadsChange);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        this.onContentChange?.();
      }

      if (update.selectionSet || update.docChanged) {
        this.updateCursorInfo(update.state);
      }
    });

    this.editorContainer.innerHTML = '';
    this.editorView = new EditorView({
      parent: this.editorContainer,
      state: EditorState.create({
        doc: this.ytext.toString(),
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          foldGutter(),
          drawSelection(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          bracketMatching(),
          closeBrackets(),
          autocompletion({
            override: [wikiLinkCompletions(this.getFileList)],
          }),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            ...foldKeymap,
            indentWithTab,
          ]),
          createLanguageExtension(filePath),
          this.themeCompartment.of(createEditorTheme(this.initialTheme)),
          this.syntaxThemeCompartment.of(this.initialTheme === 'dark' ? oneDark : []),
          this.lineWrappingCompartment.of(this.lineWrappingEnabled ? EditorView.lineWrapping : []),
          yCollab(this.ytext, awareness, { undoManager }),
          updateListener,
        ],
      }),
    });

    this.updateCursorInfo(this.editorView.state);
    this.onAwarenessChange?.(this.collectUsers(awareness));
    this.onCommentsChange?.(this.getCommentThreads());
    this.onContentChange?.();
  }

  applyTheme(theme) {
    if (!this.editorView) {
      return;
    }

    this.editorView.dispatch({
      effects: [
        this.themeCompartment.reconfigure(createEditorTheme(theme)),
        this.syntaxThemeCompartment.reconfigure(theme === 'dark' ? oneDark : []),
      ],
    });
  }

  getText() {
    if (this.ytext) {
      return this.ytext.toString();
    }

    if (this.editorView) {
      return this.editorView.state.doc.toString();
    }

    return '';
  }

  getScrollContainer() {
    return this.editorView?.scrollDOM ?? null;
  }

  getTopVisibleLineNumber(viewportRatio = 0) {
    if (!this.editorView) {
      return 1;
    }

    const scrollerRect = this.editorView.scrollDOM.getBoundingClientRect();
    const viewportOffset = Math.max(scrollerRect.height * viewportRatio, 8);
    const visibleBlock = this.editorView.lineBlockAtHeight(
      (scrollerRect.top + viewportOffset) - this.editorView.documentTop,
    );

    if (!visibleBlock) {
      return 1;
    }

    return this.editorView.state.doc.lineAt(visibleBlock.from).number;
  }

  getLocalUser() {
    return this.localUser;
  }

  getCurrentSelectionLineRange() {
    if (!this.editorView) {
      return null;
    }

    const { doc, selection } = this.editorView.state;
    const from = Math.min(...selection.ranges.map((range) => Math.min(range.from, range.to)));
    const to = Math.max(...selection.ranges.map((range) => Math.max(range.from, range.to)));
    const startLine = doc.lineAt(from).number;
    let safeTo = Math.min(Math.max(to, from), doc.length);
    if (safeTo > from && doc.lineAt(safeTo).from === safeTo) {
      safeTo -= 1;
    }
    const endLine = doc.lineAt(safeTo).number;

    return {
      endLine,
      startLine,
    };
  }

  getCommentThreads() {
    if (!this.commentThreads) {
      return [];
    }

    return serializeCommentThreads(this.commentThreads)
      .map((thread) => this.resolveCommentThread(thread))
      .filter(Boolean);
  }

  createCommentThread({ body, endLine, startLine }) {
    if (!this.editorView || !this.commentThreads || !this.ytext) {
      return null;
    }

    const normalizedBody = normalizeCommentBody(body);
    if (!normalizedBody) {
      return null;
    }

    const range = this.normalizeLineRange({ endLine, startLine });
    const start = this.editorView.state.doc.line(range.startLine);
    const end = this.editorView.state.doc.line(range.endLine);
    const excerpt = summarizeCommentExcerpt(this.editorView.state.doc.sliceString(start.from, end.to));
    const thread = createCommentThreadSharedType({
      anchorEnd: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(this.ytext, end.to)),
      anchorEndLine: range.endLine,
      anchorExcerpt: excerpt,
      anchorStart: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(this.ytext, start.from)),
      anchorStartLine: range.startLine,
      createdAt: Date.now(),
      createdByColor: this.localUser?.color ?? '',
      createdByName: this.localUser?.name ?? 'Anonymous',
      createdByPeerId: this.localUser?.peerId ?? '',
      id: createCommentId('thread'),
      messages: [createCommentMessage({
        body: normalizedBody,
        user: this.localUser,
      })],
    });

    if (!thread) {
      return null;
    }

    this.ydoc.transact(() => {
      this.commentThreads.push([thread]);
    }, 'comment-thread-create');

    return thread.get('id');
  }

  replyToCommentThread(threadId, body) {
    const normalizedBody = normalizeCommentBody(body);
    if (!normalizedBody) {
      return null;
    }

    const thread = this.findSharedCommentThread(threadId);
    const messages = thread?.get('messages');
    if (!(messages instanceof Y.Array)) {
      return null;
    }

    const message = createCommentMessage({
      body: normalizedBody,
      user: this.localUser,
    });

    this.ydoc.transact(() => {
      messages.push([message]);
    }, 'comment-thread-reply');

    return message.id;
  }

  deleteCommentThread(threadId) {
    if (!this.commentThreads) {
      return false;
    }

    const threadIndex = this.findSharedCommentThreadIndex(threadId);
    if (threadIndex < 0) {
      return false;
    }

    this.ydoc.transact(() => {
      this.commentThreads.delete(threadIndex, 1);
    }, 'comment-thread-resolve');

    return true;
  }

  isLineWrappingEnabled() {
    return this.lineWrappingEnabled;
  }

  setLineWrapping(enabled) {
    this.lineWrappingEnabled = Boolean(enabled);

    if (!this.editorView) {
      return this.lineWrappingEnabled;
    }

    this.editorView.dispatch({
      effects: this.lineWrappingCompartment.reconfigure(
        this.lineWrappingEnabled ? EditorView.lineWrapping : [],
      ),
    });

    return this.lineWrappingEnabled;
  }

  scrollToLine(lineNumber, viewportRatio = 0) {
    if (!this.editorView) {
      return false;
    }

    const targetLineNumber = Math.min(
      Math.max(Math.round(lineNumber), 1),
      this.editorView.state.doc.lines,
    );
    const line = this.editorView.state.doc.line(targetLineNumber);
    const scroller = this.editorView.scrollDOM;
    const lineBlock = this.editorView.lineBlockAt(line.from);
    const maxScrollTop = Math.max(scroller.scrollHeight - scroller.clientHeight, 0);
    const viewportOffset = viewportRatio > 0
      ? scroller.clientHeight * viewportRatio
      : 8;
    const nextScrollTop = Math.min(
      Math.max(lineBlock.top - viewportOffset, 0),
      maxScrollTop,
    );

    scroller.scrollTo({ top: nextScrollTop });

    return true;
  }

  getUserCursor(clientId) {
    if (!this.awareness) {
      return null;
    }

    const awarenessState = this.awareness.getStates().get(clientId);
    return this.resolveAwarenessCursor(awarenessState?.cursor);
  }

  scrollToPosition(position, alignment = 'center') {
    if (!this.editorView) {
      return false;
    }

    const targetPosition = Math.min(
      Math.max(Math.round(position), 0),
      this.editorView.state.doc.length,
    );
    const lineBlock = this.editorView.lineBlockAt(targetPosition);
    const scroller = this.editorView.scrollDOM;
    const maxScrollTop = Math.max(scroller.scrollHeight - scroller.clientHeight, 0);
    let nextScrollTop = lineBlock.top;

    if (alignment === 'center') {
      nextScrollTop = lineBlock.top - ((scroller.clientHeight - lineBlock.height) / 2);
    }

    scroller.scrollTo({
      top: Math.min(Math.max(nextScrollTop, 0), maxScrollTop),
    });

    return true;
  }

  scrollToUserCursor(clientId, alignment = 'center') {
    const cursor = this.getUserCursor(clientId);
    if (!cursor) {
      return false;
    }

    return this.scrollToPosition(cursor.cursorHead, alignment)
      || this.scrollToLine(cursor.cursorLine);
  }

  setUserName(name) {
    const normalizedName = normalizeUserName(name);
    if (!normalizedName || !this.awareness || !this.localUser) {
      return null;
    }

    this.localUser = {
      ...this.localUser,
      name: normalizedName,
    };
    this.awareness.setLocalStateField('user', this.localUser);

    return normalizedName;
  }

  requestMeasure() {
    this.editorView?.requestMeasure();
  }

  applyMarkdownToolbarAction(action) {
    if (!this.editorView) {
      return false;
    }

    const { state } = this.editorView;
    const documentText = state.doc.toString();
    let hasChanges = false;

    const transactionSpec = state.changeByRange((range) => {
      const edit = createMarkdownToolbarEdit(documentText, range, action);
      if (!edit) {
        return { range };
      }

      hasChanges = true;
      return {
        changes: {
          from: edit.from,
          insert: edit.insert,
          to: edit.to,
        },
        range: EditorSelection.range(edit.anchor, edit.head),
      };
    });

    if (!hasChanges) {
      return false;
    }

    this.editorView.dispatch(state.update(transactionSpec, {
      scrollIntoView: true,
      userEvent: 'input',
    }));
    this.editorView.focus();

    return true;
  }

  destroy() {
    if (this.commentThreads && this.handleCommentThreadsChange) {
      this.commentThreads.unobserveDeep(this.handleCommentThreadsChange);
    }
    this.commentThreads = null;
    this.handleCommentThreadsChange = null;

    this.provider?.disconnect();
    this.provider?.destroy();
    this.provider = null;
    this.awareness = null;
    this.localUser = null;

    this.editorView?.destroy();
    this.editorView = null;

    this.ydoc?.destroy();
    this.ydoc = null;
    this.ytext = null;

    if (this.editorContainer) {
      this.editorContainer.innerHTML = '';
    }
  }

  trackConnectionStatus() {
    if (!this.provider) {
      return;
    }

    let attempts = 0;
    let hasEverConnected = false;

    this.provider.on('status', ({ status }) => {
      if (status === 'connecting') {
        attempts += 1;
      }

      const firstConnection = status === 'connected' && !hasEverConnected;
      if (status === 'connected') {
        attempts = 0;
        hasEverConnected = true;
      }

      this.onConnectionChange?.({
        attempts,
        firstConnection,
        hasEverConnected,
        status,
        unreachable: !hasEverConnected && attempts >= 3,
        wsBaseUrl: this.wsBaseUrl,
      });
    });
  }

  collectUsers(awareness) {
    const users = [];

    awareness.getStates().forEach((state, clientId) => {
      if (!state.user) {
        return;
      }

      const cursor = this.resolveAwarenessCursor(state.cursor);

      users.push({
        ...(cursor ?? {}),
        ...state.user,
        clientId,
        hasCursor: Boolean(cursor),
        isLocal: clientId === awareness.clientID,
      });
    });

    return users;
  }

  resolveAwarenessCursor(cursor) {
    if (!cursor?.anchor || !cursor?.head || !this.ydoc || !this.editorView || !this.ytext) {
      return null;
    }

    const anchor = Y.createAbsolutePositionFromRelativePosition(cursor.anchor, this.ydoc);
    const head = Y.createAbsolutePositionFromRelativePosition(cursor.head, this.ydoc);
    if (!anchor || !head || anchor.type !== this.ytext || head.type !== this.ytext) {
      return null;
    }

    const line = this.editorView.state.doc.lineAt(head.index);

    return {
      cursorAnchor: anchor.index,
      cursorHead: head.index,
      cursorLine: line.number,
    };
  }

  findSharedCommentThread(threadId) {
    if (!this.commentThreads) {
      return null;
    }

    return this.commentThreads.toArray().find((thread) => (
      thread instanceof Y.Map && thread.get('id') === threadId
    )) ?? null;
  }

  findSharedCommentThreadIndex(threadId) {
    if (!this.commentThreads) {
      return -1;
    }

    return this.commentThreads.toArray().findIndex((thread) => (
      thread instanceof Y.Map && thread.get('id') === threadId
    ));
  }

  normalizeLineRange({ endLine, startLine }) {
    if (!this.editorView) {
      return { endLine: 1, startLine: 1 };
    }

    const lineCount = this.editorView.state.doc.lines;
    const normalizedStart = Math.min(Math.max(Math.round(startLine ?? 1), 1), lineCount);
    const normalizedEnd = Math.min(Math.max(Math.round(endLine ?? normalizedStart), normalizedStart), lineCount);

    return {
      endLine: normalizedEnd,
      startLine: normalizedStart,
    };
  }

  resolveCommentThread(thread) {
    if (!thread || !this.editorView || !this.ydoc) {
      return null;
    }

    const anchorStart = this.resolveCommentPosition(thread.anchorStart);
    const anchorEnd = this.resolveCommentPosition(thread.anchorEnd);
    const startIndex = anchorStart?.index ?? this.editorView.state.doc.line(
      Math.min(Math.max(thread.anchorStartLine ?? 1, 1), this.editorView.state.doc.lines),
    ).from;
    const endIndex = anchorEnd?.index ?? this.editorView.state.doc.line(
      Math.min(Math.max(thread.anchorEndLine ?? thread.anchorStartLine ?? 1, 1), this.editorView.state.doc.lines),
    ).to;
    const startLine = this.editorView.state.doc.lineAt(startIndex).number;
    const endLine = this.editorView.state.doc.lineAt(Math.min(Math.max(endIndex, startIndex), this.editorView.state.doc.length)).number;
    const excerpt = summarizeCommentExcerpt(
      this.editorView.state.doc.sliceString(startIndex, Math.max(endIndex, startIndex)),
    ) || thread.anchorExcerpt;

    return {
      ...thread,
      anchor: {
        endIndex,
        endLine,
        excerpt: excerpt || thread.anchorExcerpt || '',
        startIndex,
        startLine,
      },
    };
  }

  resolveCommentPosition(positionJson) {
    if (!positionJson || !this.ydoc || !this.ytext) {
      return null;
    }

    try {
      const position = Y.createRelativePositionFromJSON(positionJson);
      const absolute = Y.createAbsolutePositionFromRelativePosition(position, this.ydoc);
      if (!absolute || absolute.type !== this.ytext) {
        return null;
      }

      return absolute;
    } catch {
      return null;
    }
  }

  updateCursorInfo(state) {
    if (!this.lineInfoElement) {
      return;
    }

    const position = state.selection.main.head;
    const line = state.doc.lineAt(position);
    const column = position - line.from + 1;

    this.lineInfoElement.textContent = `Ln ${line.number}, Col ${column}`;
  }
}
