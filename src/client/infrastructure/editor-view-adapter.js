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
import { yCollab } from 'y-codemirror.next';

import { normalizeCommentQuote } from '../../domain/comment-threads.js';
import { createMarkdownToolbarEdit } from '../domain/markdown-formatting.js';
import { wikiLinkCompletions } from '../domain/wiki-link-completions.js';
import { plantUmlLanguage, plantUmlLanguageDescription } from '../domain/plantuml-language.js';

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
      color: 'var(--color-text-muted)',
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

function getSelectionBounds(selection) {
  return {
    from: Math.min(...selection.ranges.map((range) => Math.min(range.from, range.to))),
    to: Math.max(...selection.ranges.map((range) => Math.max(range.from, range.to))),
  };
}

export class EditorViewAdapter {
  constructor({
    editorContainer,
    getFileList,
    initialTheme,
    lineInfoElement,
    lineWrappingEnabled = true,
    onDocChanged = null,
    onSelectionChanged = null,
    onViewportChanged = null,
  }) {
    this.editorContainer = editorContainer;
    this.getFileList = getFileList ?? (() => []);
    this.initialTheme = initialTheme;
    this.lineInfoElement = lineInfoElement;
    this.lineWrappingEnabled = lineWrappingEnabled;
    this.onDocChanged = onDocChanged;
    this.onSelectionChanged = onSelectionChanged;
    this.onViewportChanged = onViewportChanged;
    this.editorView = null;
    this.themeCompartment = new Compartment();
    this.syntaxThemeCompartment = new Compartment();
    this.lineWrappingCompartment = new Compartment();
    this.viewportFrame = 0;
    this.handleScroll = () => {
      if (this.viewportFrame) {
        return;
      }

      this.viewportFrame = requestAnimationFrame(() => {
        this.viewportFrame = 0;
        this.emitViewportChange();
      });
    };
  }

  initialize({ awareness, filePath, undoManager, ytext }) {
    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        this.onDocChanged?.();
      }

      if (update.selectionSet || update.docChanged) {
        this.updateCursorInfo(update.state);
        this.onSelectionChanged?.(update.state);
      }
    });

    const loadingIndicator = this.editorContainer.querySelector('#editorLoading');
    Array.from(this.editorContainer.children).forEach((child) => {
      if (child !== loadingIndicator) {
        child.remove();
      }
    });

    this.editorView = new EditorView({
      parent: this.editorContainer,
      state: EditorState.create({
        doc: ytext.toString(),
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
          EditorView.contentAttributes.of({
            'aria-label': 'Markdown editor',
          }),
          createLanguageExtension(filePath),
          this.themeCompartment.of(createEditorTheme(this.initialTheme)),
          this.syntaxThemeCompartment.of(this.initialTheme === 'dark' ? oneDark : []),
          this.lineWrappingCompartment.of(this.lineWrappingEnabled ? EditorView.lineWrapping : []),
          yCollab(ytext, awareness, { undoManager }),
          updateListener,
        ],
      }),
    });

    this.editorView.scrollDOM.addEventListener('scroll', this.handleScroll, { passive: true });
    this.updateCursorInfo(this.editorView.state);
    this.onSelectionChanged?.(this.editorView.state);
    this.emitViewportChange();
  }

  destroy() {
    if (this.viewportFrame) {
      cancelAnimationFrame(this.viewportFrame);
      this.viewportFrame = 0;
    }
    this.editorView?.scrollDOM?.removeEventListener('scroll', this.handleScroll);
    this.editorView?.destroy();
    this.editorView = null;

    if (this.editorContainer) {
      this.editorContainer.innerHTML = '';
    }
  }

  getText() {
    return this.editorView?.state.doc.toString() ?? '';
  }

  getDoc() {
    return this.editorView?.state.doc ?? null;
  }

  getState() {
    return this.editorView?.state ?? null;
  }

  getScrollContainer() {
    return this.editorView?.scrollDOM ?? null;
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

  requestMeasure() {
    this.editorView?.requestMeasure();
  }

  getViewportState(viewportRatio = 0.35) {
    return {
      topLine: this.getTopVisibleLineNumber(viewportRatio),
      viewportRatio,
    };
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

  getCurrentSelectionLineRange() {
    const state = this.editorView?.state;
    if (!state) {
      return null;
    }

    const { doc, selection } = state;
    const { from, to } = getSelectionBounds(selection);
    const startLine = doc.lineAt(from).number;
    let safeTo = Math.min(Math.max(to, from), doc.length);
    if (safeTo > from && doc.lineAt(safeTo).from === safeTo) {
      safeTo -= 1;
    }

    return {
      endLine: doc.lineAt(safeTo).number,
      startLine,
    };
  }

  getCurrentSelectionCommentAnchor() {
    const state = this.editorView?.state;
    if (!state) {
      return null;
    }

    const { doc, selection } = state;
    const { from, to } = getSelectionBounds(selection);
    const isCollapsed = from === to;

    if (isCollapsed) {
      const line = doc.lineAt(from);
      return {
        anchorKind: 'line',
        anchorQuote: normalizeCommentQuote(line.text),
        endIndex: line.to,
        endLine: line.number,
        startIndex: line.from,
        startLine: line.number,
      };
    }

    let safeTo = Math.min(Math.max(to, from), doc.length);
    if (safeTo > from && doc.lineAt(safeTo).from === safeTo) {
      safeTo -= 1;
    }

    return {
      anchorKind: 'text',
      anchorQuote: normalizeCommentQuote(doc.sliceString(from, to)),
      endIndex: to,
      endLine: doc.lineAt(safeTo).number,
      startIndex: from,
      startLine: doc.lineAt(from).number,
    };
  }

  normalizeLineRange({ endLine, startLine }) {
    const state = this.editorView?.state;
    if (!state) {
      return { endLine: 1, startLine: 1 };
    }

    const lineCount = state.doc.lines;
    const normalizedStart = Math.min(Math.max(Math.round(startLine ?? 1), 1), lineCount);
    const normalizedEnd = Math.min(Math.max(Math.round(endLine ?? normalizedStart), normalizedStart), lineCount);

    return {
      endLine: normalizedEnd,
      startLine: normalizedStart,
    };
  }

  getLineInfoAt(position) {
    const state = this.editorView?.state;
    if (!state) {
      return null;
    }

    const clampedPosition = Math.min(Math.max(position, 0), state.doc.length);
    const line = state.doc.lineAt(clampedPosition);
    return {
      line,
      lineNumber: line.number,
    };
  }

  getAnchorClientRect(anchor) {
    const state = this.editorView?.state;
    const editorView = this.editorView;
    if (!state || !editorView || !anchor) {
      return null;
    }

    const kind = anchor.anchorKind || anchor.kind || 'line';
    const startIndex = Math.min(Math.max(Math.round(anchor.startIndex ?? 0), 0), state.doc.length);
    const endIndex = Math.min(Math.max(Math.round(anchor.endIndex ?? startIndex), startIndex), state.doc.length);

    if (kind === 'text' && endIndex > startIndex) {
      const startCoords = editorView.coordsAtPos(startIndex);
      const endCoords = editorView.coordsAtPos(Math.max(endIndex - 1, startIndex));
      if (startCoords && endCoords) {
        return {
          bottom: Math.max(startCoords.bottom, endCoords.bottom),
          height: Math.max(startCoords.bottom, endCoords.bottom) - Math.min(startCoords.top, endCoords.top),
          left: Math.min(startCoords.left, endCoords.left),
          right: Math.max(startCoords.right, endCoords.right),
          top: Math.min(startCoords.top, endCoords.top),
          width: Math.max(startCoords.right, endCoords.right) - Math.min(startCoords.left, endCoords.left),
        };
      }
    }

    const targetLine = state.doc.line(
      Math.min(Math.max(Math.round(anchor.startLine ?? 1), 1), state.doc.lines),
    );
    const lineBlock = editorView.lineBlockAt(targetLine.from);
    const scrollerRect = editorView.scrollDOM.getBoundingClientRect();
    const scrollTop = editorView.scrollDOM.scrollTop;
    const contentRect = editorView.contentDOM.getBoundingClientRect();
    const left = contentRect.left;
    const right = Math.max(contentRect.right, scrollerRect.right - 8);
    const top = scrollerRect.top + lineBlock.top - scrollTop;

    return {
      bottom: top + lineBlock.height,
      height: lineBlock.height,
      left,
      right,
      top,
      width: Math.max(right - left, 0),
    };
  }

  getSelectionChipClientRect(anchor) {
    const state = this.editorView?.state;
    const editorView = this.editorView;
    if (!state || !editorView || !anchor) {
      return null;
    }

    const startIndex = Math.min(Math.max(Math.round(anchor.startIndex ?? 0), 0), state.doc.length);
    const startLine = state.doc.lineAt(startIndex);
    const lineBlock = editorView.lineBlockAt(startLine.from);
    const scrollerRect = editorView.scrollDOM.getBoundingClientRect();
    const scrollTop = editorView.scrollDOM.scrollTop;
    const contentRect = editorView.contentDOM.getBoundingClientRect();
    const right = Math.max(contentRect.right, scrollerRect.right - 8);
    const top = scrollerRect.top + lineBlock.top - scrollTop;

    return {
      bottom: top + lineBlock.height,
      height: lineBlock.height,
      left: contentRect.left,
      right,
      top,
      width: Math.max(right - contentRect.left, 0),
    };
  }

  scrollToLine(lineNumber, viewportRatio = 0) {
    const state = this.editorView?.state;
    const scroller = this.editorView?.scrollDOM;
    if (!state || !scroller || !this.editorView) {
      return false;
    }

    const targetLineNumber = Math.min(
      Math.max(Math.round(lineNumber), 1),
      state.doc.lines,
    );
    const line = state.doc.line(targetLineNumber);
    const lineBlock = this.editorView.lineBlockAt(line.from);
    const maxScrollTop = Math.max(scroller.scrollHeight - scroller.clientHeight, 0);
    const viewportOffset = viewportRatio > 0 ? scroller.clientHeight * viewportRatio : 8;
    const nextScrollTop = Math.min(
      Math.max(lineBlock.top - viewportOffset, 0),
      maxScrollTop,
    );

    scroller.scrollTo({ top: nextScrollTop });
    return true;
  }

  scrollToPosition(position, alignment = 'center') {
    const state = this.editorView?.state;
    const scroller = this.editorView?.scrollDOM;
    if (!state || !scroller || !this.editorView) {
      return false;
    }

    const targetPosition = Math.min(Math.max(Math.round(position), 0), state.doc.length);
    const lineBlock = this.editorView.lineBlockAt(targetPosition);
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

  updateCursorInfo(state) {
    if (!this.lineInfoElement) {
      return;
    }

    const position = state.selection.main.head;
    const line = state.doc.lineAt(position);
    const column = position - line.from + 1;
    this.lineInfoElement.textContent = `Ln ${line.number}, Col ${column}`;
  }

  emitViewportChange() {
    this.onViewportChanged?.(this.getViewportState());
  }
}
