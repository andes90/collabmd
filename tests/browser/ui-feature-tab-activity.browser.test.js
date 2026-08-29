import { afterEach, describe, expect, it, vi } from 'vitest';

import { uiFeatureTabActivityMethods } from '../../src/client/application/app-shell/ui-feature-tab-activity.js';
import { QuickSwitcherController } from '../../src/client/presentation/quick-switcher-controller.js';

describe('uiFeature tab lock', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('closes an open Quick Switcher before capturing and restoring tab-lock focus', () => {
    document.body.innerHTML = `
      <main id="workspace">
        <button id="launcher">Search</button>
        <dialog id="quickSwitcher">
          <button data-qs-mode="files">Files</button>
          <button data-qs-mode="text">Text</button>
          <input id="quickSwitcherInput">
          <div id="quickSwitcherHint"></div>
          <div id="quickSwitcherScope"></div>
          <div id="quickSwitcherResults"></div>
        </dialog>
      </main>
      <dialog id="tabLockOverlay">
        <h2 id="tabLockTitle"></h2>
        <p id="tabLockCopy"></p>
        <button id="tabLockTakeoverButton">Take over</button>
      </dialog>
    `;
    const trigger = document.getElementById('launcher');
    const quickSwitcher = new QuickSwitcherController({
      getFileList: () => ['README.md'],
      onFileSelect: vi.fn(),
    });
    const context = {
      elements: {
        tabLockCopy: document.getElementById('tabLockCopy'),
        tabLockOverlay: document.getElementById('tabLockOverlay'),
        tabLockTakeoverButton: document.getElementById('tabLockTakeoverButton'),
        tabLockTitle: document.getElementById('tabLockTitle'),
      },
    };
    Object.assign(context, uiFeatureTabActivityMethods);

    trigger.focus();
    quickSwitcher.open();
    context.showTabLockOverlay({ reason: 'taken-over' });

    expect(quickSwitcher.isOpen).toBe(false);
    expect(quickSwitcher.overlay.open).toBe(false);
    expect(context.elements.tabLockOverlay.open).toBe(true);
    expect(document.activeElement).toBe(context.elements.tabLockTakeoverButton);

    context.hideTabLockOverlay();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes every native dialog before showing the blocking overlay', () => {
    document.body.innerHTML = `
      <main id="workspace"></main>
      <dialog id="displayNameDialog" open></dialog>
      <dialog id="fileActionDialog" open></dialog>
      <dialog id="gitCommitDialog" open></dialog>
      <dialog id="gitResetDialog" open></dialog>
      <dialog id="tabLockOverlay">
        <h2 id="tabLockTitle"></h2>
        <p id="tabLockCopy"></p>
        <button id="tabLockTakeoverButton">Take over</button>
      </dialog>
    `;
    const context = {
      elements: {
        displayNameDialog: document.getElementById('displayNameDialog'),
        fileActionDialog: document.getElementById('fileActionDialog'),
        gitCommitDialog: document.getElementById('gitCommitDialog'),
        gitResetDialog: document.getElementById('gitResetDialog'),
        tabLockCopy: document.getElementById('tabLockCopy'),
        tabLockOverlay: document.getElementById('tabLockOverlay'),
        tabLockTakeoverButton: document.getElementById('tabLockTakeoverButton'),
        tabLockTitle: document.getElementById('tabLockTitle'),
      },
    };
    Object.assign(context, uiFeatureTabActivityMethods);

    context.showTabLockOverlay({ reason: 'taken-over' });

    expect(context.elements.displayNameDialog.open).toBe(false);
    expect(context.elements.fileActionDialog.open).toBe(false);
    expect(context.elements.gitCommitDialog.open).toBe(false);
    expect(context.elements.gitResetDialog.open).toBe(false);
    expect(context.elements.tabLockOverlay.open).toBe(true);
    expect(document.activeElement).toBe(context.elements.tabLockTakeoverButton);
  });
});
