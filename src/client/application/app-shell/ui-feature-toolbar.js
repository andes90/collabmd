import { isMarkdownFilePath } from '../../../domain/file-kind.js';
import {
  getMarkdownBlockActionLabel,
  getMarkdownBlockMenuActions,
  getMarkdownToolbarAction,
  getMarkdownToolbarIcons,
  isMarkdownBlockAction,
  markdownToolbarLayout,
} from '../../domain/markdown-toolbar-actions.js';

const IMAGE_FILE_PICKER_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
const DEFAULT_BLOCK_ACTION = 'paragraph';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function normalizeToolbarAction(action) {
  if (action === 'heading') {
    return 'heading-2';
  }

  return String(action ?? '').trim();
}

function renderToolbarButtons(actions) {
  return actions.map((item) => (
    `<button type="button" class="ui-icon-button ui-icon-button--toolbar ui-toolbar-action" data-markdown-action="${escapeHtml(item.action)}" aria-label="${escapeHtml(item.label)}" title="${escapeHtml(item.title)}">${item.icon}</button>`
  )).join('');
}

function renderBlockMenuMarkup(activeAction) {
  const triggerLabel = escapeHtml(getMarkdownBlockActionLabel(activeAction));
  const icons = getMarkdownToolbarIcons();

  return `
    <div class="markdown-toolbar-block-menu-shell">
      <button
        type="button"
        class="ui-button btn btn-ghost markdown-toolbar-block-trigger"
        data-markdown-block-menu-toggle
        aria-haspopup="menu"
        aria-expanded="false"
        title="Block formatting"
      >
        <span class="markdown-toolbar-block-trigger-label" data-markdown-block-trigger-label>${triggerLabel}</span>
        <span class="markdown-toolbar-block-trigger-icon" aria-hidden="true">${icons.chevronDown}</span>
      </button>
    </div>
  `;
}

function renderBlockMenuItemsMarkup(activeAction) {
  return getMarkdownBlockMenuActions().map((item) => {
    const isActive = item.action === activeAction;
    return `
      <button
        type="button"
        class="markdown-toolbar-menu-item${isActive ? ' is-active' : ''}"
        data-markdown-block-action="${escapeHtml(item.action)}"
        role="menuitemradio"
        aria-checked="${isActive ? 'true' : 'false'}"
        title="${escapeHtml(item.title)}"
      >
        <span class="markdown-toolbar-menu-item-label">${escapeHtml(item.label)}</span>
        <span class="markdown-toolbar-menu-item-shortcut">${escapeHtml(item.shortLabel)}</span>
      </button>
    `;
  }).join('');
}

function renderMarkdownToolbarMarkup(activeAction) {
  return markdownToolbarLayout.map((group) => {
    if (group.kind === 'block-menu') {
      return renderBlockMenuMarkup(activeAction);
    }

    return `
      <div class="markdown-toolbar-group" role="group" aria-label="${escapeHtml(group.groupLabel)}">
        ${renderToolbarButtons(group.actions)}
      </div>
    `;
  }).join('');
}

/**
 * @typedef {object} UiToolbarContext
 * @property {string | null} currentFilePath
 * @property {{ markdownToolbar?: HTMLElement | null }} elements
 * @property {Document} document
 * @property {{ refresh(): Promise<void> }} fileExplorer
 * @property {{ show(message: string): void }} toastController
 * @property {{ uploadImageAttachment(payload: { file: File, fileName: string, sourcePath: string }): Promise<{ markdown?: string, path?: string }>} } vaultApiClient
 * @property {{ applyMarkdownToolbarAction(action: string): boolean, insertText(text: string): void } | null} session
 * @property {() => Promise<File | null>} pickImageFile
 * @property {(file: File) => Promise<boolean>} handleEditorImageInsert
 * @property {() => Promise<void>} handleToolbarImageInsert
 */

/** @this {UiToolbarContext} */
function getActiveMarkdownBlockAction() {
  const action = normalizeToolbarAction(this._activeMarkdownBlockAction || DEFAULT_BLOCK_ACTION);
  return isMarkdownBlockAction(action) ? action : DEFAULT_BLOCK_ACTION;
}

/** @this {UiToolbarContext} */
function renderMarkdownToolbar() {
  const root = this.elements?.markdownToolbar;
  if (!root) {
    return;
  }

  const activeAction = this.getActiveMarkdownBlockAction();
  root.innerHTML = renderMarkdownToolbarMarkup(activeAction);
  this.renderMarkdownBlockMenuPopover();
  this.syncMarkdownToolbarBlockUi();
}

/** @this {UiToolbarContext} */
function getMarkdownBlockMenuPopover() {
  return this._markdownBlockMenuPopover ?? null;
}

/** @this {UiToolbarContext} */
function renderMarkdownBlockMenuPopover() {
  const mountTarget = this.elements?.editorContainer ?? document.body;
  let popover = this.getMarkdownBlockMenuPopover();
  if (!popover) {
    popover = document.createElement('div');
    popover.className = 'markdown-toolbar-popover hidden';
    popover.innerHTML = '<div class="markdown-toolbar-menu" data-markdown-block-menu role="menu" aria-label="Block formatting"></div>';
    popover.addEventListener('click', (event) => {
      this.handleMarkdownToolbarClick?.(event);
    });
    popover.addEventListener('keydown', (event) => {
      this.handleMarkdownToolbarKeydown?.(event);
    });
    mountTarget?.appendChild(popover);
    this._markdownBlockMenuPopover = popover;
  } else if (popover.parentElement !== mountTarget) {
    mountTarget?.appendChild(popover);
  }

  const menu = popover.querySelector('[data-markdown-block-menu]');
  if (menu) {
    menu.innerHTML = renderBlockMenuItemsMarkup(this.getActiveMarkdownBlockAction());
  }
}

/** @this {UiToolbarContext} */
function syncMarkdownToolbarBlockUi() {
  const root = this.elements?.markdownToolbar;
  if (!root) {
    return;
  }

  const activeAction = this.getActiveMarkdownBlockAction();
  const actionMeta = getMarkdownToolbarAction(activeAction);
  const label = root.querySelector('[data-markdown-block-trigger-label]');
  if (label) {
    label.textContent = getMarkdownBlockActionLabel(activeAction);
  }

  const toggle = root.querySelector('[data-markdown-block-menu-toggle]');
  if (toggle && actionMeta) {
    toggle.setAttribute('aria-label', `${actionMeta.label}. Block formatting`);
    toggle.setAttribute('title', `${actionMeta.label}. Block formatting`);
  }

  const popoverItems = Array.from(
    this.getMarkdownBlockMenuPopover()?.querySelectorAll('[data-markdown-block-action]') ?? [],
  );
  const blockActionItems = [
    ...root.querySelectorAll('[data-markdown-block-action]'),
    ...popoverItems,
  ];
  blockActionItems.forEach((item) => {
    const itemAction = item.getAttribute('data-markdown-block-action');
    const isActive = itemAction === activeAction;
    item.classList.toggle('is-active', isActive);
    item.setAttribute('aria-checked', isActive ? 'true' : 'false');
  });
}

/** @this {UiToolbarContext} */
function setActiveMarkdownBlockAction(action) {
  const normalized = normalizeToolbarAction(action);
  if (!isMarkdownBlockAction(normalized)) {
    return;
  }

  this._activeMarkdownBlockAction = normalized;
  this.syncMarkdownToolbarBlockUi();
}

/** @this {UiToolbarContext} */
function isMarkdownBlockMenuOpen() {
  return Boolean(this.elements?.markdownToolbar?.classList.contains('is-menu-open'));
}

/** @this {UiToolbarContext} */
function positionMarkdownBlockMenu() {
  const popover = this.getMarkdownBlockMenuPopover();
  const toggle = this.elements?.markdownToolbar?.querySelector('[data-markdown-block-menu-toggle]');
  const mountTarget = popover?.parentElement;
  if (!popover || !toggle || !(mountTarget instanceof HTMLElement)) {
    return;
  }

  const toggleRect = toggle.getBoundingClientRect();
  const mountRect = mountTarget.getBoundingClientRect();
  const menuRect = popover.getBoundingClientRect();
  const menuWidth = menuRect.width || 176;
  const menuHeight = menuRect.height || 240;
  const horizontalPadding = 8;
  const verticalGap = 6;
  const preferredLeft = toggleRect.left - mountRect.left;
  const maxLeft = Math.max(horizontalPadding, mountRect.width - menuWidth - horizontalPadding);
  const preferredTop = (toggleRect.bottom - mountRect.top) + verticalGap;
  const fitsBelow = preferredTop + menuHeight <= mountRect.height - horizontalPadding;

  popover.style.left = `${Math.max(horizontalPadding, Math.min(preferredLeft, maxLeft))}px`;
  popover.style.top = `${fitsBelow
    ? preferredTop
    : Math.max(horizontalPadding, (toggleRect.top - mountRect.top) - menuHeight - verticalGap)}px`;
}

/** @this {UiToolbarContext} */
function openMarkdownBlockMenu() {
  const root = this.elements?.markdownToolbar;
  if (!root) {
    return;
  }

  this.renderMarkdownBlockMenuPopover();
  root.classList.add('is-menu-open');
  const popover = this.getMarkdownBlockMenuPopover();
  popover?.classList.remove('hidden');
  root.querySelector('[data-markdown-block-menu-toggle]')?.setAttribute('aria-expanded', 'true');
  this.positionMarkdownBlockMenu();
}

/** @this {UiToolbarContext} */
function closeMarkdownBlockMenu() {
  const root = this.elements?.markdownToolbar;
  if (!root) {
    return;
  }

  root.classList.remove('is-menu-open');
  this.getMarkdownBlockMenuPopover()?.classList.add('hidden');
  root.querySelector('[data-markdown-block-menu-toggle]')?.setAttribute('aria-expanded', 'false');
}

/** @this {UiToolbarContext} */
function toggleMarkdownBlockMenu() {
  if (this.isMarkdownBlockMenuOpen()) {
    this.closeMarkdownBlockMenu();
    return;
  }

  this.openMarkdownBlockMenu();
}

/** @this {UiToolbarContext} */
function handleMarkdownToolbarClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) {
    return;
  }

  const blockMenuToggle = target.closest('[data-markdown-block-menu-toggle]');
  if (blockMenuToggle) {
    event.preventDefault();
    this.toggleMarkdownBlockMenu();
    return;
  }

  const blockActionButton = target.closest('[data-markdown-block-action]');
  if (blockActionButton) {
    event.preventDefault();
    const action = blockActionButton.getAttribute('data-markdown-block-action');
    this.closeMarkdownBlockMenu();
    if (action) {
      this.applyMarkdownToolbarAction(action);
    }
    return;
  }

  const button = target.closest('[data-markdown-action]');
  const action = button?.getAttribute('data-markdown-action');
  if (!action) {
    return;
  }

  this.applyMarkdownToolbarAction(action);
}

/** @this {UiToolbarContext} */
function handleMarkdownToolbarKeydown(event) {
  if (!this.isMarkdownBlockMenuOpen()) {
    const toggle = event.target instanceof Element
      ? event.target.closest('[data-markdown-block-menu-toggle]')
      : null;
    if (toggle && ['ArrowDown', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      this.openMarkdownBlockMenu();
      this.getMarkdownBlockMenuPopover()?.querySelector('[data-markdown-block-action]')?.focus();
    }
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    this.closeMarkdownBlockMenu();
    this.elements?.markdownToolbar?.querySelector('[data-markdown-block-menu-toggle]')?.focus();
    return;
  }

  const menuItems = Array.from(this.getMarkdownBlockMenuPopover()?.querySelectorAll('[data-markdown-block-action]') ?? []);
  if (menuItems.length === 0) {
    return;
  }

  const currentIndex = menuItems.findIndex((item) => item === event.target);
  if (currentIndex < 0) {
    return;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    menuItems[(currentIndex + 1) % menuItems.length]?.focus();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    menuItems[(currentIndex - 1 + menuItems.length) % menuItems.length]?.focus();
  }
}

/** @this {UiToolbarContext} */
function handleMarkdownToolbarDocumentPointerDown(event) {
  if (!this.isMarkdownBlockMenuOpen()) {
    return;
  }

  if (
    this.elements?.markdownToolbar?.contains(event.target)
    || this.getMarkdownBlockMenuPopover()?.contains(event.target)
  ) {
    return;
  }

  this.closeMarkdownBlockMenu();
}

/** @this {UiToolbarContext} */
function applyMarkdownToolbarAction(action) {
  if (!this.session || !isMarkdownFilePath(this.currentFilePath)) {
    return;
  }

  if (action === 'image') {
    void this.handleToolbarImageInsert();
    return;
  }

  const normalizedAction = normalizeToolbarAction(action);
  const applied = this.session.applyMarkdownToolbarAction(normalizedAction);
  if (!applied) {
    this.toastController.show('Formatting action is unavailable');
    return;
  }

  if (isMarkdownBlockAction(normalizedAction)) {
    this.setActiveMarkdownBlockAction(normalizedAction);
  }
}

/** @this {UiToolbarContext} */
async function handleToolbarImageInsert() {
  const file = await this.pickImageFile();
  if (!file) {
    return;
  }

  await this.handleEditorImageInsert(file);
}

/** @this {UiToolbarContext} */
function pickImageFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = IMAGE_FILE_PICKER_ACCEPT;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    let settled = false;
    let focusTimer = null;

    const cleanup = (value) => {
      if (settled) {
        return;
      }

      settled = true;
      if (focusTimer) {
        window.clearTimeout(focusTimer);
      }
      window.removeEventListener('focus', handleWindowFocus);
      input.remove();
      resolve(value);
    };

    const handleWindowFocus = () => {
      focusTimer = window.setTimeout(() => {
        if (settled || input.files?.length) {
          return;
        }

        cleanup(null);
      }, 250);
    };

    input.addEventListener('change', () => {
      cleanup(input.files?.[0] ?? null);
    }, { once: true });

    input.addEventListener('cancel', () => {
      cleanup(null);
    }, { once: true });

    window.addEventListener('focus', handleWindowFocus, { once: true });
    input.click();
  });
}

/** @this {UiToolbarContext} */
async function handleEditorImageInsert(file) {
  if (!this.session || !isMarkdownFilePath(this.currentFilePath)) {
    console.warn('[ui] Ignoring image insert because there is no active markdown session.', {
      currentFilePath: this.currentFilePath,
      hasSession: Boolean(this.session),
    });
    return false;
  }

  const activeFilePath = this.currentFilePath;
  const activeSession = this.session;

  try {
    console.debug('[ui] Uploading image attachment.', {
      fileName: file?.name || '',
      size: file?.size ?? null,
      sourcePath: activeFilePath,
      type: file?.type || '',
    });
    const result = await this.vaultApiClient.uploadImageAttachment({
      file,
      fileName: file?.name || '',
      sourcePath: activeFilePath,
    });

    await this.fileExplorer.refresh();

    if (
      this.currentFilePath === activeFilePath
      && this.session
      && this.session === activeSession
      && typeof result?.markdown === 'string'
    ) {
      console.debug('[ui] Inserting uploaded image markdown into the editor.', {
        sourcePath: activeFilePath,
        storedPath: result.path ?? '',
      });
      this.session.insertText(result.markdown);
    }

    return true;
  } catch (error) {
    console.error('[ui] Failed to insert image attachment:', error);
    this.toastController.show(error.message || 'Failed to upload image');
    return false;
  }
}

/** @this {UiToolbarContext} */
async function copyCurrentLink() {
  try {
    await navigator.clipboard.writeText(window.location.href);
    this.toastController.show('Link copied');
  } catch {
    this.toastController.show('Failed to copy link');
  }
}

export const uiFeatureToolbarMethods = {
  applyMarkdownToolbarAction,
  copyCurrentLink,
  closeMarkdownBlockMenu,
  getActiveMarkdownBlockAction,
  getMarkdownBlockMenuPopover,
  handleEditorImageInsert,
  handleMarkdownToolbarClick,
  handleMarkdownToolbarDocumentPointerDown,
  handleMarkdownToolbarKeydown,
  handleToolbarImageInsert,
  isMarkdownBlockMenuOpen,
  openMarkdownBlockMenu,
  positionMarkdownBlockMenu,
  renderMarkdownBlockMenuPopover,
  pickImageFile,
  renderMarkdownToolbar,
  setActiveMarkdownBlockAction,
  syncMarkdownToolbarBlockUi,
  toggleMarkdownBlockMenu,
};
