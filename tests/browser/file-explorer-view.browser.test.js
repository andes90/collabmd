import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileExplorerView } from '../../src/client/presentation/file-explorer-view.js';

function createView(overrides = {}) {
  document.body.innerHTML = `
    <input id="fileSearchInput">
    <nav id="fileTree"></nav>
  `;

  return new FileExplorerView({
    mobileBreakpointQuery: { matches: true },
    onDirectorySelect: vi.fn(),
    onDirectoryToggle: vi.fn(),
    onFileContextMenu: vi.fn(),
    onFileSelect: vi.fn(),
    onSearchChange: vi.fn(),
    onTreeContextMenu: vi.fn(),
    ...overrides,
  });
}

describe('FileExplorerView mobile interactions', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('opens file actions after a mobile long press', () => {
    vi.useFakeTimers();
    const onFileContextMenu = vi.fn();
    const view = createView({ onFileContextMenu });

    view.render({
      activeFilePath: null,
      expandedDirs: new Set(),
      reset: true,
      searchMatches: [],
      searchQuery: '',
      tree: [{ name: 'README.md', path: 'README.md', type: 'file' }],
    });

    const item = document.querySelector('.file-tree-file');
    item.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: 24,
      clientY: 18,
      pointerId: 1,
      pointerType: 'touch',
    }));

    vi.advanceTimersByTime(421);

    expect(onFileContextMenu).toHaveBeenCalledTimes(1);
    expect(onFileContextMenu.mock.calls[0][1]).toEqual({ filePath: 'README.md', type: 'file' });
  });

  it('cancels a long press when the pointer moves like a scroll gesture', () => {
    vi.useFakeTimers();
    const onFileContextMenu = vi.fn();
    const view = createView({ onFileContextMenu });

    view.render({
      activeFilePath: null,
      expandedDirs: new Set(),
      reset: true,
      searchMatches: [],
      searchQuery: '',
      tree: [{ name: 'README.md', path: 'README.md', type: 'file' }],
    });

    const item = document.querySelector('.file-tree-file');
    item.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: 24,
      clientY: 18,
      pointerId: 2,
      pointerType: 'touch',
    }));
    item.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      clientX: 24,
      clientY: 36,
      pointerId: 2,
      pointerType: 'touch',
    }));

    vi.advanceTimersByTime(421);

    expect(onFileContextMenu).not.toHaveBeenCalled();
  });
});
