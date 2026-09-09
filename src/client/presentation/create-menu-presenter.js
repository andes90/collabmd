import { buttonClassNames } from './components/ui/button.js';

function getDefaultMobileBreakpointQuery() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return { matches: false };
  }

  return window.matchMedia('(max-width: 768px)');
}

function getFocusableItems(container) {
  if (typeof HTMLElement === 'undefined' || !(container instanceof HTMLElement)) {
    return [];
  }

  return Array.from(container.querySelectorAll('.create-menu-item, .file-action-sheet-item:not(:disabled)'));
}

export class CreateMenuPresenter {
  constructor({
    mobileBreakpointQuery = getDefaultMobileBreakpointQuery(),
  } = {}) {
    this.mobileBreakpointQuery = mobileBreakpointQuery;
    this.activeAnchor = null;
    this.desktopMenu = null;
    this.windowResizeHandler = null;
    this.blockingModalHandler = () => this.close();
    this.boundClose = () => this.close();
  }

  isMobileViewport() {
    return Boolean(this.mobileBreakpointQuery?.matches);
  }

  isOpen() {
    return Boolean(this.desktopMenu || this.mobileSheet);
  }

  toggle(options = {}) {
    if (this.isOpen()) {
      this.close();
      return;
    }

    this.open(options);
  }

  open({ anchor = null, items = [], title = 'Create' } = {}) {
    this.close({ restoreFocus: false });

    if (!Array.isArray(items) || items.length === 0) {
      return;
    }

    this.activeAnchor = typeof HTMLElement !== 'undefined' && anchor instanceof HTMLElement ? anchor : null;
    this.activeAnchor?.setAttribute('aria-expanded', 'true');

    if (this.isMobileViewport()) {
      this.openMobileSheet({ items, title });
      return;
    }

    this.openDesktopMenu({ anchor: this.activeAnchor, items, title });
  }

  close({ restoreFocus = true } = {}) {
    if (this.desktopMenu) {
      const menu = this.desktopMenu;
      this.desktopMenu = null;
      menu.remove();
    }

    if (this.mobileSheet) {
      if (this.mobileSheet.open) this.mobileSheet.close();
      this.mobileSheet.remove();
      this.mobileSheet = null;
    }
    document.removeEventListener('collabmd:close-custom-modals', this.blockingModalHandler);

    if (this.windowResizeHandler && typeof window !== 'undefined') {
      window.removeEventListener('resize', this.windowResizeHandler);
      this.windowResizeHandler = null;
    } else {
      this.windowResizeHandler = null;
    }

    const previousAnchor = this.activeAnchor;
    this.activeAnchor?.setAttribute('aria-expanded', 'false');
    this.activeAnchor = null;

    if (restoreFocus) {
      previousAnchor?.focus?.();
    }
  }

  openDesktopMenu({ anchor, items, title }) {
    const menu = document.createElement('div');
    menu.className = 'create-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', title);
    menu.setAttribute('popover', 'auto');

    this.renderMenuItems(menu, items);
    document.body.appendChild(menu);
    menu.showPopover?.();
    this.positionDesktopMenu(menu, anchor);

    menu.addEventListener('keydown', (event) => {
      this.handleDesktopMenuKeyDown(event, menu);
    });
    // Native light-dismiss replaces the deferred pointerdown listener;
    // explicit closes detach the element first, so ignore those toggles.
    menu.addEventListener('toggle', (toggleEvent) => {
      if (toggleEvent.newState === 'closed' && menu.isConnected && this.desktopMenu === menu) {
        this.close();
      }
    });
    this.windowResizeHandler = this.boundClose;
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.windowResizeHandler);
    }

    this.desktopMenu = menu;
    getFocusableItems(menu)[0]?.focus();
  }

  openMobileSheet({ items, title }) {
    const sheet = document.createElement('dialog');
    sheet.className = 'file-action-sheet create-action-sheet';
    sheet.setAttribute('aria-label', title);
    sheet.setAttribute('closedby', 'any');

    const header = document.createElement('div');
    header.className = 'create-action-sheet-header';
    header.textContent = title;
    sheet.appendChild(header);

    this.renderMenuItems(sheet, items, { mobile: true });

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = buttonClassNames({
      variant: 'ghost',
      extra: ['file-action-sheet-item', 'create-action-sheet-cancel'],
    });
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', () => {
      this.close();
    });
    sheet.appendChild(cancelButton);

    sheet.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.close();
    });
    sheet.addEventListener('close', () => {
      if (sheet.isConnected && this.mobileSheet === sheet) {
        this.close();
      }
    });
    sheet.addEventListener('click', (event) => {
      const bounds = sheet.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right
        || event.clientY < bounds.top || event.clientY > bounds.bottom) this.close();
    });

    document.body.append(sheet);
    document.addEventListener('collabmd:close-custom-modals', this.blockingModalHandler);
    this.mobileSheet = sheet;
    sheet.showModal();
    getFocusableItems(sheet)[0]?.focus();
  }

  renderMenuItems(container, items, { mobile = false } = {}) {
    let lastGroup = null;

    items.forEach((item) => {
      if (item.group && item.group !== lastGroup) {
        const groupLabel = document.createElement('div');
        groupLabel.className = mobile ? 'create-action-sheet-group' : 'create-menu-group';
        groupLabel.textContent = item.group;
        container.appendChild(groupLabel);
        lastGroup = item.group;
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = mobile
        ? buttonClassNames({
          variant: 'ghost',
          extra: ['file-action-sheet-item', 'create-action-sheet-item', 'create-action-sheet-option'],
        })
        : 'create-menu-item';
      button.setAttribute('role', mobile ? 'button' : 'menuitem');
      button.dataset.actionId = item.id;

      const icon = document.createElement('span');
      icon.className = 'create-menu-item-icon';
      icon.setAttribute('aria-hidden', 'true');
      // Menu icons are fixed application-owned markup.
      // pi-lens-ignore: no-inner-html-js
      icon.innerHTML = item.icon || '';
      button.appendChild(icon);

      const copy = document.createElement('span');
      copy.className = 'create-menu-item-copy';

      const label = document.createElement('span');
      label.className = 'create-menu-item-label';
      label.textContent = item.label;
      copy.appendChild(label);

      const meta = item.meta || item.hint;
      if (meta) {
        const metaEl = document.createElement('span');
        metaEl.className = 'create-menu-item-meta';
        metaEl.textContent = meta;
        copy.appendChild(metaEl);
      }

      button.appendChild(copy);
      button.addEventListener('click', () => {
        this.close({ restoreFocus: false });
        item.onSelect?.();
      });

      container.appendChild(button);
    });
  }

  positionDesktopMenu(menu, anchor) {
    const menuRect = menu.getBoundingClientRect();
    const anchorRect = anchor?.getBoundingClientRect?.();
    const viewportPadding = 8;
    const defaultLeft = anchorRect?.left ?? viewportPadding;
    const maxLeft = Math.max(viewportPadding, window.innerWidth - menuRect.width - viewportPadding);
    const left = Math.max(viewportPadding, Math.min(defaultLeft, maxLeft));

    let top = (anchorRect?.bottom ?? viewportPadding) + 8;
    const maxTop = window.innerHeight - menuRect.height - viewportPadding;
    if (top > maxTop && anchorRect) {
      top = Math.max(viewportPadding, anchorRect.top - menuRect.height - 8);
    }

    menu.style.left = `${left}px`;
    menu.style.top = `${Math.max(viewportPadding, top)}px`;
  }

  handleDesktopMenuKeyDown(event, menu) {
    const items = getFocusableItems(menu);
    if (items.length === 0) {
      return;
    }

    const activeIndex = Math.max(0, items.indexOf(document.activeElement));

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        items[(activeIndex + 1) % items.length]?.focus();
        break;
      case 'ArrowUp':
        event.preventDefault();
        items[(activeIndex - 1 + items.length) % items.length]?.focus();
        break;
      case 'Home':
        event.preventDefault();
        items[0]?.focus();
        break;
      case 'End':
        event.preventDefault();
        items[items.length - 1]?.focus();
        break;
      case 'Escape':
        event.preventDefault();
        this.close();
        break;
      case 'Tab':
        this.close({ restoreFocus: false });
        break;
    }
  }
}
