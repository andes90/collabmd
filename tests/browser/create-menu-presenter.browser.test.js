import { afterEach, describe, expect, it, vi } from 'vitest';

import { uiFeatureTabActivityMethods } from '../../src/client/application/app-shell/ui-feature-tab-activity.js';
import { CreateMenuPresenter } from '../../src/client/presentation/create-menu-presenter.js';

describe('CreateMenuPresenter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('opens an anchored desktop menu, supports keyboard navigation, and restores focus on escape', () => {
    document.body.innerHTML = '<button id="trigger">Create</button>';
    const trigger = document.getElementById('trigger');
    const presenter = new CreateMenuPresenter({
      mobileBreakpointQuery: { matches: false },
    });

    presenter.open({
      anchor: trigger,
      items: [
        { id: 'markdown', label: 'Markdown note', meta: '.md', onSelect: vi.fn() },
        { id: 'folder', label: 'Folder', meta: 'folder', onSelect: vi.fn() },
      ],
    });

    const menu = document.querySelector('.create-menu');
    expect(menu).not.toBeNull();
    expect(document.activeElement?.textContent).toContain('Markdown note');

    menu.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
    expect(document.activeElement?.textContent).toContain('Folder');

    menu.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    expect(document.querySelector('.create-menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps the blocking tab lock operable when it interrupts a create sheet', () => {
    document.body.innerHTML = `
      <main id="workspace"><button id="trigger">Create</button></main>
      <dialog id="tab-lock"><h2 id="title"></h2><p id="copy"></p><button id="takeover">Take over</button></dialog>
    `;
    const trigger = document.getElementById('trigger');
    const overlay = document.getElementById('tab-lock');
    const takeover = document.getElementById('takeover');
    const presenter = new CreateMenuPresenter({ mobileBreakpointQuery: { matches: true } });
    trigger.focus();
    presenter.open({
      anchor: trigger,
      items: [{ id: 'markdown', label: 'Markdown note', onSelect: vi.fn() }],
    });
    const context = {
      elements: {
        tabLockCopy: document.getElementById('copy'),
        tabLockOverlay: overlay,
        tabLockTakeoverButton: takeover,
        tabLockTitle: document.getElementById('title'),
      },
    };
    Object.assign(context, uiFeatureTabActivityMethods);
    context.showTabLockOverlay({ reason: 'taken-over' });

    expect(document.querySelector('.create-action-sheet')).toBeNull();
    expect(overlay.open).toBe(true);
    expect(document.activeElement).toBe(takeover);

    context.hideTabLockOverlay();
    expect(document.activeElement).toBe(trigger);
  });

  it('renders the mobile create picker as a contained dialog with focus restoration', () => {
    document.body.innerHTML = '<button id="trigger">Create</button>';
    const trigger = document.getElementById('trigger');
    trigger.focus();
    const presenter = new CreateMenuPresenter({
      mobileBreakpointQuery: { matches: true },
    });

    presenter.open({
      anchor: trigger,
      items: [
        { id: 'markdown', group: 'Note', label: 'Markdown note', meta: '.md', onSelect: vi.fn() },
        { id: 'drawio', group: 'Diagram', label: 'draw.io diagram', meta: '.drawio', onSelect: vi.fn() },
      ],
    });

    const sheet = document.querySelector('.create-action-sheet');
    expect(sheet).toBeInstanceOf(HTMLDialogElement);
    expect(sheet.open).toBe(true);
    expect(sheet?.textContent).toContain('draw.io diagram');
    expect(document.activeElement?.textContent).toContain('Markdown note');
    expect(document.querySelector('.create-action-sheet-option')).not.toBeNull();
    expect(document.querySelector('.create-action-sheet-cancel')).not.toBeNull();

    sheet.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(document.querySelector('.create-action-sheet')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
