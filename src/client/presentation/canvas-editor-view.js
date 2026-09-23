import { canvasColor, canvasEdgeGeometry, canvasFilePath, canvasLinkUrl, canvasSideAtPoint } from '../domain/canvas-view.js';
import { getMarkdownHeadings } from '../domain/markdown-headings.js';
import { flattenTree } from './file-tree-state.js';
import { openCanvasPicker } from './canvas-picker.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NODE_NAMES = { text: 'Text card', file: 'File card', link: 'Link card', group: 'Group' };
const ICON_PATHS = {
  text: 'M14 3H5v18h14V8Z M14 3v5h5',
  file: 'M14 3H5v18h14V8Z M14 3v5h5 M8 12h8 M8 16h6',
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
  group: 'M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M11 3h2 M21 11v2 M11 21h2 M3 11v2',
  edit: 'm16 3 5 5-12 12-6 1 1-6Z M13 6l5 5',
  color: 'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 0-4 2 2 0 0 1 0-4h4a4 4 0 0 0 4-4c0-3-4-6-9-6Z M7 10h.01 M10 7h.01 M15 7h.01',
  section: 'M9 3 7 21 M17 3l-2 18 M4 8h16 M3 16h16',
  properties: 'M4 6h6 M14 6h6 M4 12h10 M18 12h2 M4 18h2 M10 18h10 M10 3v6 M14 9v6 M6 15v6',
  delete: 'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
  undo: 'M3 10h10a7 7 0 0 1 7 7 M3 10l5-5 M3 10l5 5',
  redo: 'M21 10H11a7 7 0 0 0-7 7 M21 10l-5-5 M21 10l-5 5',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  fit: 'M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5',
  open: 'M14 3h7v7 M21 3 10 14 M10 3H3v18h18v-7',
  close: 'm6 6 12 12 M18 6 6 18',
  resize: 'm9 20 11-11 M15 20l5-5',
  help: 'M21 12a9 9 0 1 0-18 0 9 9 0 0 0 18 0 M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4 M12 17h.01',
};

function icon(name) {
  const svg = svgElement('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  svg.append(svgElement('path', { d: ICON_PATHS[name] }));
  return svg;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, action, iconName) {
  const node = element('button', 'canvas-button');
  node.type = 'button';
  node.title = label;
  node.setAttribute('aria-label', label);
  if (iconName) {
    node.classList.add('canvas-icon-button');
    node.append(icon(iconName));
  } else node.textContent = label;
  node.addEventListener('click', action);
  return node;
}

function svgElement(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

export class CanvasEditorView {
  constructor({ root, actions, createTextEditor, createMarkdownPreview, getText, readFile, readTree, attachmentUrl, onOpenFile, vaultId = '' }) {
    Object.assign(this, { root, actions, createTextEditor, createMarkdownPreview, getText, readFile, readTree, attachmentUrl, onOpenFile, vaultId });
    this.nodes = new Map();
    this.selection = new Set();
    this.document = { nodes: [], edges: [] };
    this.viewport = { x: 80, y: 80, zoom: 1 };
    this.canEdit = false;
    this.selectedEdge = null;
    this.activeEditor = null;
    this.users = [];
    this.inspectorOpen = false;
    this.abort = new AbortController();
    this.mount();
  }

  mount() {
    this.root.replaceChildren();
    this.root.classList.add('canvas-editor');
    this.toolbar = element('div', 'canvas-toolbar');
    this.toolbar.setAttribute('role', 'toolbar');
    this.toolbar.setAttribute('aria-label', 'Canvas tools');
    this.editButtons = [];
    Object.entries(NODE_NAMES).forEach(([type, label]) => {
      const control = button(`+ ${label}`, () => this.addNode(type), type);
      control.title = `Add ${label.toLowerCase()}`;
      this.toolbar.append(control);
      this.editButtons.push(control);
    });
    this.connectButton = button('Connect', () => this.beginConnection(), 'link');
    this.deleteButton = button('Delete', () => this.removeSelection(), 'delete');
    this.undoButton = button('Undo', () => this.actions.undo(), 'undo');
    this.redoButton = button('Redo', () => this.actions.redo(), 'redo');
    this.status = element('span', 'canvas-status', 'Connecting…');
    this.status.setAttribute('role', 'status');
    this.banner = element('div', 'canvas-banner');
    this.banner.hidden = true;
    this.banner.setAttribute('role', 'alert');
    this.body = element('div', 'canvas-body');
    this.stage = element('div', 'canvas-stage');
    this.stage.tabIndex = 0;
    this.stage.setAttribute('aria-label', 'Canvas. Drag to select. Space-drag to pan. Use arrow keys to move selected cards.');
    this.world = element('div', 'canvas-world');
    this.edges = svgElement('svg', { class: 'canvas-edges', 'aria-label': 'Connections' });
    this.world.append(this.edges);
    this.cursors = element('div', 'canvas-cursors');
    this.world.append(this.cursors);
    this.stage.append(this.world);
    this.emptyState = element('div', 'canvas-empty-state');
    this.emptyState.hidden = true;
    this.emptyState.append(element('strong', '', 'Start your canvas'),
      element('span', '', 'Double-click to add text, or choose a card below.'));
    this.mountSelectionToolbar();
    this.inspector = element('aside', 'canvas-inspector');
    this.inspector.setAttribute('aria-label', 'Canvas selection');
    this.inspector.id = 'canvas-properties';
    this.inspector.hidden = true;
    this.body.append(this.stage, this.inspector);
    this.navigation = element('div', 'canvas-navigation');
    this.navigation.setAttribute('role', 'toolbar');
    this.navigation.setAttribute('aria-label', 'Canvas navigation');
    const zoomTools = element('div', 'canvas-tool-group');
    this.zoomLabel = button('Reset zoom', () => this.zoomBy(1 / this.viewport.zoom));
    this.zoomLabel.classList.add('canvas-zoom-label');
    zoomTools.append(button('Zoom in', () => this.zoomBy(1.25), 'plus'), this.zoomLabel,
      button('Fit canvas', () => this.fit(), 'fit'), button('Zoom out', () => this.zoomBy(0.8), 'minus'));
    const historyTools = element('div', 'canvas-tool-group');
    historyTools.append(this.undoButton, this.redoButton);
    this.helpMenu = element('details', 'canvas-help-menu canvas-tool-group');
    const helpToggle = element('summary', 'canvas-button canvas-icon-button');
    helpToggle.title = 'Canvas help';
    helpToggle.setAttribute('aria-label', 'Canvas help');
    helpToggle.append(icon('help'));
    const helpContent = element('div', 'canvas-help-content');
    helpContent.append(element('strong', '', 'Canvas shortcuts'));
    for (const [gesture, description] of [
      ['Double-click', 'Add or edit text'], ['Drag a card', 'Move it'], ['Drag background', 'Select cards'],
      ['Drag a group', 'Move its enclosed cards'], ['Shift-drag', 'Select inside a group'],
      ['Space / middle-drag', 'Pan canvas'], ['Ctrl / ⌘ + scroll', 'Zoom'],
      ['Shift + 1 / 2', 'Fit canvas / selection'], ['Drag a dot', 'Connect cards'],
      ['Choose section', 'Show a Markdown heading'],
    ]) {
      const row = element('div');
      row.append(element('span', '', gesture), element('span', '', description));
      helpContent.append(row);
    }
    this.helpMenu.append(helpToggle, helpContent);
    this.navigation.append(zoomTools, historyTools, this.helpMenu);
    this.help = element('span', 'canvas-help');
    this.help.setAttribute('role', 'status');
    this.stage.append(this.emptyState, this.toolbar, this.navigation, this.status, this.help);
    this.root.append(this.banner, this.body);
    const signal = this.abort.signal;
    this.stage.addEventListener('pointerdown', (event) => this.startPan(event), { signal });
    this.stage.addEventListener('dblclick', (event) => {
      if (event.target === this.stage) {
        const bounds = this.stage.getBoundingClientRect();
        this.addNode('text', this.toWorld(event.clientX - bounds.left, event.clientY - bounds.top));
      }
    }, { signal });
    this.stage.addEventListener('pointermove', (event) => this.publishPointer(event), { signal });
    this.stage.addEventListener('pointerleave', () => this.actions.presence('pointer', null), { signal });
    this.stage.addEventListener('dragover', (event) => {
      if (this.canEdit && event.dataTransfer?.types.includes('application/x-collabmd-vault-file')) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }
    }, { signal });
    this.stage.addEventListener('drop', (event) => { void this.dropFile(event); }, { signal });
    this.stage.addEventListener('wheel', (event) => {
      if (event.target.closest('.canvas-selection-toolbar, .canvas-navigation, .canvas-toolbar')) return;
      if (!event.ctrlKey && !event.metaKey && !this.spaceHeld && event.target.closest('.canvas-card-content, .canvas-text-editor')) return;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey || this.spaceHeld) {
        this.zoomBy(Math.exp(-event.deltaY * 0.005), event.clientX, event.clientY);
      } else {
        this.viewport.x -= event.shiftKey ? event.deltaY : event.deltaX;
        this.viewport.y -= event.shiftKey ? 0 : event.deltaY;
        this.applyViewport();
      }
    }, { signal, passive: false });
    this.root.addEventListener('keydown', (event) => this.onKeyDown(event), { signal });
    this.root.addEventListener('pointerdown', (event) => {
      [this.colorMenu, this.helpMenu].forEach((menu) => { if (!menu.contains(event.target)) menu.open = false; });
    }, { signal, capture: true });
    window.addEventListener('keyup', (event) => { if (event.code === 'Space') this.spaceHeld = false; }, { signal });
    window.addEventListener('blur', () => { this.spaceHeld = false; this.cancelGesture?.(); }, { signal });
    this.resizeObserver = new ResizeObserver(() => this.positionSelectionToolbar());
    this.resizeObserver.observe(this.stage);
    this.renderInspector();
    this.applyViewport();
  }

  mountSelectionToolbar() {
    this.selectionToolbar = element('div', 'canvas-selection-toolbar');
    this.selectionToolbar.setAttribute('role', 'toolbar');
    this.selectionToolbar.setAttribute('aria-label', 'Selection actions');
    this.selectionToolbar.hidden = true;
    this.editTextButton = button('Edit text', () => this.openTextEditor([...this.selection][0]), 'edit');
    this.fileButton = button('Change file', () => this.openFilePicker([...this.selection][0]), 'file');
    this.headingButton = button('Choose section', () => this.openHeadingPicker([...this.selection][0]));
    this.headingButton.prepend(icon('section'));
    this.labelInput = element('input', 'canvas-connection-label');
    this.labelInput.placeholder = 'Connection label';
    this.labelInput.setAttribute('aria-label', 'Connection label');
    this.labelInput.addEventListener('change', () => {
      if (this.canEdit && this.selectedEdge) this.actions.updateEdge(this.selectedEdge, { label: this.labelInput.value || undefined });
    });
    this.labelInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); this.labelInput.blur(); }
      if (event.key === 'Escape') {
        this.labelInput.value = (this.document.edges ?? []).find((edge) => edge.id === this.selectedEdge)?.label || '';
        this.labelInput.blur();
      }
    });
    this.colorMenu = element('details', 'canvas-color-menu');
    const colorToggle = element('summary', 'canvas-button canvas-icon-button');
    colorToggle.title = 'Set color';
    colorToggle.setAttribute('aria-label', 'Set color');
    colorToggle.append(icon('color'));
    this.colorMenu.append(colorToggle);
    const colors = element('div', 'canvas-colors');
    ['', '1', '2', '3', '4', '5', '6'].forEach((color) => {
      const swatch = button('', () => { this.setSelectionColor(color || undefined); this.colorMenu.open = false; });
      swatch.setAttribute('aria-label', color ? `Color ${color}` : 'Default color');
      swatch.title = color ? `Color ${color}` : 'Default color';
      swatch.style.setProperty('--canvas-color', canvasColor(color));
      colors.append(swatch);
    });
    const customColor = element('input');
    customColor.type = 'color';
    customColor.setAttribute('aria-label', 'Custom color');
    customColor.addEventListener('change', () => this.setSelectionColor(customColor.value));
    colors.append(customColor);
    this.colorMenu.append(colors);
    this.propertiesButton = button('Properties', () => {
      this.inspectorOpen = !this.inspectorOpen;
      this.renderInspector();
      this.positionSelectionToolbar();
    }, 'properties');
    this.propertiesButton.setAttribute('aria-controls', 'canvas-properties');
    this.fitSelectionButton = button('Fit selection', () => this.fit([...this.selection]), 'fit');
    this.selectionToolbar.append(this.editTextButton, this.fileButton, this.headingButton,
      this.labelInput, this.colorMenu, this.connectButton, this.fitSelectionButton, this.propertiesButton, this.deleteButton);
    this.stage.append(this.selectionToolbar);
  }

  updateSelectionToolbar() {
    const node = this.selection.size === 1 ? this.getNode([...this.selection][0]) : null;
    const edge = (this.document.edges ?? []).find((entry) => entry.id === this.selectedEdge);
    this.selectionToolbar.hidden = !node && !edge && !this.selection.size;
    this.editTextButton.hidden = node?.type !== 'text';
    this.fileButton.hidden = node?.type !== 'file';
    this.headingButton.hidden = node?.type !== 'file' || !/\.(md|markdown|mdx)$/i.test(node.file);
    this.labelInput.hidden = !edge;
    this.connectButton.hidden = !this.selection.size;
    this.fitSelectionButton.hidden = !this.selection.size;
    if (document.activeElement !== this.labelInput) this.labelInput.value = edge?.label || '';
    [this.editTextButton, this.fileButton, this.headingButton, this.labelInput].forEach((control) => { control.disabled = !this.canEdit; });
    this.colorMenu.querySelectorAll('button, input').forEach((control) => { control.disabled = !this.canEdit; });
    this.propertiesButton.setAttribute('aria-expanded', String(!this.inspector.hidden));
    this.positionSelectionToolbar();
  }

  positionSelectionToolbar() {
    if (this.selectionToolbar.hidden) return;
    const bounds = this.stage.getBoundingClientRect();
    const rectangles = [...this.selection].map((id) => this.nodes.get(id)?.card.getBoundingClientRect()).filter(Boolean);
    if (!rectangles.length) {
      const edge = [...this.edges.querySelectorAll('[data-edge-id]')].find((item) => item.dataset.edgeId === this.selectedEdge);
      if (edge) rectangles.push(edge.getBoundingClientRect());
    }
    if (!rectangles.length) return;
    const left = Math.min(...rectangles.map((rect) => rect.left));
    const right = Math.max(...rectangles.map((rect) => rect.right));
    const labelSpace = [...this.selection].some((id) => this.getNode(id)?.type !== 'text') ? 28 : 0;
    const top = Math.min(...rectangles.map((rect) => rect.top)) - labelSpace;
    const width = this.selectionToolbar.offsetWidth;
    this.selectionToolbar.style.left = `${Math.max(8, Math.min(bounds.width - width - 64, (left + right) / 2 - bounds.left - width / 2))}px`;
    this.selectionToolbar.style.top = `${Math.max(8, Math.min(bounds.height - this.selectionToolbar.offsetHeight - 8, top - bounds.top - this.selectionToolbar.offsetHeight - 10))}px`;
  }

  setSelectionColor(color) {
    if (!this.canEdit) return;
    if (this.selectedEdge) this.actions.updateEdge(this.selectedEdge, { color });
    else this.actions.updateNodes([...this.selection].map((id) => ({ id, patch: { color } })));
  }

  openFilePicker(id = null, position = null) {
    if (!this.canEdit) return;
    this.picker?.close();
    this.picker = openCanvasPicker({
      root: this.root, title: 'Choose a Vault file',
      canChoose: () => this.canEdit && (!id || this.getNode(id)?.type === 'file'),
      loadChoices: async () => flattenTree((await this.readTree()).tree ?? []).files
        .filter(canvasFilePath).sort().map((path) => ({ value: path, label: path.split('/').pop(), detail: path, searchText: path })),
      onChoose: (file) => {
        if (id) {
          if (this.getNode(id)?.file !== file) this.actions.updateNode(id, { file, subpath: undefined });
        } else this.addNode('file', position, { file });
      },
    });
  }

  openHeadingPicker(id) {
    const node = this.getNode(id);
    if (!this.canEdit || node?.type !== 'file') return;
    const file = node.file;
    this.picker?.close();
    this.picker = openCanvasPicker({
      root: this.root, title: 'Choose a heading',
      canChoose: () => this.canEdit && this.getNode(id)?.type === 'file' && this.getNode(id).file === file,
      loadChoices: async () => {
        const { content } = await this.readFile(file);
        return [{ value: '', label: 'Whole file', detail: file },
          ...getMarkdownHeadings(content).map(({ id: anchor, text }) => ({ value: `#${anchor}`, label: text, detail: `#${anchor}` }))];
      },
      onChoose: (subpath) => this.actions.updateNode(id, { subpath: subpath || undefined }),
    });
  }

  async dropFile(event) {
    event.preventDefault();
    if (!this.canEdit) return;
    try {
      const payload = JSON.parse(event.dataTransfer?.getData('application/x-collabmd-vault-file') || 'null');
      if (!payload || payload.vaultId !== this.vaultId || !canvasFilePath(payload.path)) return;
      const bounds = this.stage.getBoundingClientRect();
      const position = this.toWorld(event.clientX - bounds.left, event.clientY - bounds.top);
      const files = flattenTree((await this.readTree()).tree ?? []).files;
      if (!this.abort.signal.aborted && this.canEdit && files.includes(payload.path)) this.addNode('file', position, { file: payload.path });
    } catch { this.status.textContent = 'Unable to add this file. Choose a file from this Vault.'; }
  }

  update({ document: next, canEdit, synced, conflict, error, undoAvailable, redoAvailable }) {
    this.canEdit = canEdit;
    this.status.textContent = error || (conflict ? 'External file conflict' : (canEdit ? 'Live' : (synced ? 'Read only' : 'Reconnecting…')));
    this.status.dataset.state = canEdit ? 'live' : 'readonly';
    this.root.dataset.ready = String(Boolean(next));
    this.root.dataset.editable = String(canEdit);
    this.editButtons.forEach((control) => { control.disabled = !canEdit; });
    this.connectButton.disabled = !canEdit || this.selection.size === 0;
    this.deleteButton.disabled = !canEdit || (!this.selection.size && !this.selectedEdge);
    this.undoButton.disabled = !canEdit || !undoAvailable;
    this.redoButton.disabled = !canEdit || !redoAvailable;
    this.activeEditor?.editor.setReadOnly(!canEdit);
    if (!canEdit) this.cancelGesture?.();
    this.inspector.querySelectorAll('input, select, .canvas-order button').forEach((control) => { control.disabled = !canEdit; });
    this.renderConflict(conflict, synced);
    if (!next) return;
    this.document = next;
    this.emptyState.hidden = Boolean(next.nodes?.length);
    if (this.activeEditor && (this.getNode(this.activeEditor.id)?.type !== 'text'
      || this.getText(this.activeEditor.id) !== this.activeEditor.editor.text)) this.closeTextEditor();
    const present = new Set((next.nodes ?? []).map((node) => node.id));
    for (const [id, entry] of this.nodes) {
      if (present.has(id)) continue;
      if (this.activeEditor?.id === id) this.closeTextEditor();
      entry.preview?.destroy();
      entry.card.remove();
      this.nodes.delete(id);
      this.selection.delete(id);
    }
    (next.nodes ?? []).forEach((node, index) => this.renderNode(node, index));
    if (this.selectedEdge && !(next.edges ?? []).some((edge) => edge.id === this.selectedEdge)) this.selectedEdge = null;
    this.renderEdges();
    if (!this.inspector.contains(document.activeElement)) this.renderInspector();
    else this.syncInspectorFields?.();
    this.updateSelectionToolbar();
    this.renderPresence(this.users);
    if (!this.didFit && this.stage.clientWidth) {
      this.fit();
      this.didFit = true;
    }
  }

  renderConflict(conflict, synced) {
    const signature = JSON.stringify([conflict, synced]);
    if (signature === this.conflictSignature) return;
    this.conflictSignature = signature;
    this.banner.replaceChildren();
    this.banner.hidden = !conflict;
    if (!conflict) return;
    this.banner.append(element('span', '', conflict.invalid
      ? 'The file changed outside CollabMD and is invalid. Your canvas edits are preserved.'
      : 'The file changed outside CollabMD. Choose which version to keep.'));
    const keep = button('Keep canvas edits', () => this.actions.resolveConflict('local'));
    keep.disabled = !synced;
    this.banner.append(keep);
    const external = button('Use external version', () => this.actions.resolveConflict('external'));
    external.disabled = !synced || conflict.invalid;
    this.banner.append(external);
  }

  renderNode(node, index) {
    let entry = this.nodes.get(node.id);
    if (!entry) {
      const card = element('article', 'canvas-card');
      card.dataset.nodeId = node.id;
      card.tabIndex = 0;
      const header = element('div', 'canvas-card-header');
      const title = element('span', 'canvas-card-title');
      const openFile = button('Open file', () => {
        const current = this.getNode(node.id);
        if (current?.type === 'file') this.onOpenFile(current.file, current.subpath);
      }, 'open');
      openFile.classList.add('canvas-open-file');
      header.append(title, openFile);
      const content = element('div', 'canvas-card-content');
      const resize = button('Resize', () => {}, 'resize');
      resize.classList.add('canvas-resize');
      card.append(header, content, resize);
      this.world.append(card);
      entry = { card, header, title, content, resize, openFile };
      this.nodes.set(node.id, entry);
      card.addEventListener('pointerdown', (event) => this.startNodeDrag(event, node.id));
      card.addEventListener('dblclick', (event) => {
        if (event.target.closest('a, button, input, textarea, select, .diagram-preview-shell')) return;
        if (this.getNode(node.id)?.type === 'text') this.openTextEditor(node.id);
      });
      card.addEventListener('keydown', (event) => {
        if (event.target !== card || !['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === ' ') this.spaceHeld = true;
        this.select(node.id, event.shiftKey);
        if (event.key === 'Enter' && this.getNode(node.id)?.type === 'text') this.openTextEditor(node.id);
      });
      resize.addEventListener('pointerdown', (event) => this.startNodeDrag(event, node.id, true));
      for (const side of ['top', 'right', 'bottom', 'left']) {
        const handle = button('', (event) => {
          if (event.detail === 0) this.beginConnection(node.id, side);
        });
        handle.classList.add('canvas-connection-handle');
        handle.dataset.side = side;
        handle.setAttribute('aria-label', `Connect from ${side}`);
        handle.title = `Drag to connect from ${side}`;
        handle.addEventListener('pointerdown', (event) => this.startConnection(event, node.id, side));
        card.append(handle);
      }
    }
    const signature = JSON.stringify([node.type, node.text, node.file, node.subpath, node.url, node.background, node.backgroundStyle]);
    if (entry.signature !== signature) entry.headingLabel = '';
    entry.card.dataset.type = node.type;
    entry.card.style.left = `${node.x}px`;
    entry.card.style.top = `${node.y}px`;
    entry.card.style.width = `${Math.max(1, node.width)}px`;
    entry.card.style.height = `${Math.max(1, node.height)}px`;
    entry.card.style.zIndex = String(index + 1);
    entry.card.style.setProperty('--canvas-color', canvasColor(node.color));
    entry.header.hidden = node.type === 'text';
    entry.title.textContent = node.type === 'group' ? node.label || 'Group'
      : (node.type === 'file' ? `${node.file.split('/').pop() || 'Choose a file'}${node.subpath ? ` › ${entry.headingLabel || node.subpath.slice(1)}` : ''}` : node.url);
    entry.title.title = node.type === 'file' ? `${node.file}${node.subpath || ''}` : entry.title.textContent;
    entry.openFile.hidden = node.type !== 'file' || !canvasFilePath(node.file);
    entry.openFile.setAttribute('aria-label', `Open ${node.file || ''}${node.subpath || ''}`);
    entry.openFile.title = `Open ${node.file || ''}${node.subpath || ''}`;
    entry.card.setAttribute('aria-label', `${NODE_NAMES[node.type]}: ${node.text?.slice(0, 80) || node.label || node.file || node.url || ''}`);
    entry.card.classList.toggle('is-selected', this.selection.has(node.id));
    entry.resize.disabled = !this.canEdit;
    entry.card.querySelectorAll('.canvas-connection-handle').forEach((handle) => { handle.disabled = !this.canEdit; });
    if (this.activeEditor?.id === node.id) return;
    if (entry.signature === signature) return;
    entry.signature = signature;
    entry.preview?.destroy();
    entry.preview = null;
    entry.content.replaceChildren();
    entry.content.style.backgroundImage = '';
    if (node.type === 'text') entry.preview = this.createMarkdownPreview(entry.content, node.text);
    if (node.type === 'link') {
      const href = canvasLinkUrl(node.url);
      const link = element(href ? 'a' : 'span', 'canvas-card-link', node.url);
      if (href) Object.assign(link, { href, target: '_blank', rel: 'noopener noreferrer' });
      entry.content.append(link);
    }
    if (node.type === 'file') void this.renderFile(entry, node, signature);
    if (node.type === 'group' && node.background) {
      const path = canvasFilePath(node.background);
      if (path) entry.content.style.backgroundImage = `url("${this.attachmentUrl(path)}")`;
      entry.content.dataset.backgroundStyle = node.backgroundStyle || 'cover';
    }
  }

  async renderFile(entry, node, signature) {
    const path = canvasFilePath(node.file);
    if (!path) {
      entry.content.append(element('span', '', 'This file path is unavailable in the Vault.'));
      return;
    }
    if (/\.(png|jpe?g|gif|webp|svg)$/i.test(path)) {
      const image = element('img', 'canvas-file-image');
      image.src = this.attachmentUrl(path);
      image.alt = path;
      image.loading = 'lazy';
      image.addEventListener('error', () => { image.replaceWith(element('p', '', 'Image unavailable')); });
      entry.content.append(image);
    } else if (/\.(md|markdown|mdx)$/i.test(path)) {
      const preview = element('div', 'canvas-file-markdown');
      entry.content.append(preview);
      try {
        const result = await this.readFile(path);
        if (entry.signature === signature && preview.isConnected) {
          entry.headingLabel = getMarkdownHeadings(result.content).find(({ id }) => `#${id}` === node.subpath)?.text || '';
          entry.title.textContent = `${path.split('/').pop()}${node.subpath ? ` › ${entry.headingLabel || node.subpath.slice(1)}` : ''}`;
          entry.preview = this.createMarkdownPreview(preview, result.content, path, node.subpath);
          entry.content.scrollTop = 0;
        }
      } catch {
        if (entry.signature === signature) preview.textContent = 'File unavailable';
      }
    } else {
      entry.content.append(element('p', '', 'Open this file in the workspace.'));
    }
  }

  getNode(id) { return (this.document.nodes ?? []).find((node) => node.id === id); }

  select(id, additive = false) {
    if (this.connectFrom && id !== this.connectFrom.id && this.canEdit) {
      this.actions.addEdge({ fromNode: this.connectFrom.id, toNode: id, ...(this.connectFrom.side ? { fromSide: this.connectFrom.side } : {}) });
      this.connectFrom = null;
      this.help.textContent = 'Connection added';
    }
    this.closeTextEditor();
    this.selectedEdge = null;
    if (additive) {
      if (this.selection.has(id)) this.selection.delete(id);
      else this.selection.add(id);
    } else this.selection = new Set([id]);
    this.syncSelection();
  }

  syncSelection() {
    this.nodes.forEach(({ card }, id) => card.classList.toggle('is-selected', this.selection.has(id)));
    this.actions.presence('selectedNodeIds', [...this.selection]);
    this.connectButton.disabled = !this.canEdit || !this.selection.size;
    this.deleteButton.disabled = !this.canEdit || (!this.selection.size && !this.selectedEdge);
    this.renderInspector();
    this.edges.querySelectorAll('[data-edge-id]').forEach((edge) => edge.classList.toggle('is-selected', edge.dataset.edgeId === this.selectedEdge));
    this.updateSelectionToolbar();
  }

  openTextEditor(id) {
    if (!this.canEdit || this.activeEditor?.id === id) return;
    this.select(id);
    const entry = this.nodes.get(id);
    entry.preview?.destroy();
    entry.preview = null;
    entry.content.replaceChildren();
    entry.content.classList.add('canvas-text-editor');
    const editor = this.createTextEditor(id, entry.content, () => this.closeTextEditor());
    if (editor) this.activeEditor = { id, editor };
  }

  closeTextEditor() {
    if (!this.activeEditor) return;
    const { id, editor } = this.activeEditor;
    this.activeEditor = null;
    editor.destroy();
    const entry = this.nodes.get(id);
    if (entry) {
      entry.signature = null;
      entry.content.classList.remove('canvas-text-editor');
      const node = this.getNode(id);
      if (node) this.renderNode(node, (this.document.nodes ?? []).indexOf(node));
      entry.card.focus({ preventScroll: true });
    }
  }

  beginConnection(id = null, side = null) {
    if (!this.canEdit) return;
    if (id) this.select(id);
    if (!id && this.selection.size >= 2) {
      const [fromNode, toNode] = this.selection;
      this.actions.addEdge({ fromNode, toNode });
    } else {
      this.connectFrom = { id: id || [...this.selection][0], side };
      this.help.textContent = 'Select another card to connect. Escape cancels.';
    }
  }

  addNode(type, position = null, values = null) {
    if (!this.canEdit) return;
    if (type === 'file' && !values) { this.openFilePicker(null, position); return; }
    const center = position || this.toWorld(this.stage.clientWidth / 2, this.stage.clientHeight / 2);
    const width = type === 'group' ? 480 : 280;
    const height = type === 'group' ? 360 : 200;
    const defaults = { text: { text: '' }, file: { file: '' }, link: { url: 'https://' }, group: { label: 'Group' } };
    const id = this.actions.addNode({ type, x: Math.round(center.x - width / 2), y: Math.round(center.y - height / 2), width, height, ...defaults[type], ...values });
    if (id) {
      this.select(id);
      if (type === 'text') this.openTextEditor(id);
      else if (type !== 'file') { this.inspectorOpen = true; this.renderInspector(); this.inspector.querySelector('input')?.focus(); }
    }
  }

  removeSelection() {
    if (!this.canEdit) return;
    this.closeTextEditor();
    if (this.selectedEdge) this.actions.deleteEdges([this.selectedEdge]);
    else this.actions.deleteNodes([...this.selection]);
    this.selection.clear();
    this.selectedEdge = null;
    this.syncSelection();
  }

  renderEdges() {
    this.edges.replaceChildren();
    const definitions = svgElement('defs');
    const arrow = svgElement('marker', { id: 'canvas-arrow', markerWidth: 10, markerHeight: 10,
      refX: 9, refY: 5, orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' });
    arrow.append(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 Z', fill: 'context-stroke' }));
    definitions.append(arrow);
    this.edges.append(definitions);
    const nodes = new Map((this.document.nodes ?? []).map((node) => [node.id, node]));
    (this.document.edges ?? []).forEach((edge) => {
      const geometry = canvasEdgeGeometry(edge, nodes);
      if (!geometry) return;
      const group = svgElement('g', { class: `canvas-edge${this.selectedEdge === edge.id ? ' is-selected' : ''}`,
        'data-edge-id': edge.id, tabindex: 0, role: 'button', 'aria-label': `Connection ${edge.label || edge.id}` });
      if (edge.color) group.style.setProperty('--canvas-color', canvasColor(edge.color));
      const path = svgElement('path', { d: geometry.path, class: 'canvas-edge-line' });
      if (edge.fromEnd === 'arrow') path.setAttribute('marker-start', 'url(#canvas-arrow)');
      if (edge.toEnd !== 'none') path.setAttribute('marker-end', 'url(#canvas-arrow)');
      const hit = svgElement('path', { d: geometry.path, class: 'canvas-edge-hit' });
      group.append(path, hit);
      if (edge.label) {
        const text = svgElement('text', { x: geometry.x, y: geometry.y - 10, 'text-anchor': 'middle' });
        text.textContent = edge.label;
        group.append(text);
      }
      const select = () => {
        this.closeTextEditor();
        this.selection.clear();
        this.selectedEdge = edge.id;
        this.syncSelection();
      };
      group.addEventListener('click', select);
      group.addEventListener('dblclick', (event) => { event.stopPropagation(); select(); this.labelInput.focus(); this.labelInput.select(); });
      group.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); }
      });
      this.edges.append(group);
    });
  }

  renderInspector() {
    this.inspector.hidden = !this.inspectorOpen || (!this.selection.size && !this.selectedEdge);
    this.propertiesButton.setAttribute('aria-expanded', String(!this.inspector.hidden));
    this.inspector.replaceChildren();
    this.syncInspectorFields = null;
    const node = this.selection.size === 1 ? this.getNode([...this.selection][0]) : null;
    const edge = (this.document.edges ?? []).find((entry) => entry.id === this.selectedEdge);
    const selected = node || edge;
    const header = element('div', 'canvas-inspector-header');
    header.append(element('h2', '', node ? NODE_NAMES[node.type] : (edge ? 'Connection' : 'Canvas')),
      button('Close properties', () => { this.propertiesButton.click(); this.propertiesButton.focus(); }, 'close'));
    this.inspector.append(header);
    if (!selected) {
      this.inspector.append(element('p', '', this.selection.size ? `${this.selection.size} cards selected` : 'Select a card or connection to edit its properties.'));
      return;
    }
    const currentSelection = () => node ? this.getNode(node.id) : (this.document.edges ?? []).find((entry) => entry.id === edge.id);
    const fields = [];
    this.syncInspectorFields = () => {
      const current = currentSelection();
      if (!current || current.type !== selected.type) { this.renderInspector(); return; }
      fields.forEach(({ input, key }) => {
        if (input === document.activeElement && input.value !== input.dataset.savedValue) return;
        const value = String(current[key] ?? '');
        if (input.value !== value) input.value = value;
        input.dataset.savedValue = input.value;
      });
    };
    const update = (key, value) => {
      if (!this.canEdit) return;
      if (node) this.actions.updateNode(node.id, { [key]: value });
      else this.actions.updateEdge(edge.id, { [key]: value });
    };
    const field = (label, key, { options, numeric = false, optional = false } = {}) => {
      const wrapper = element('label', 'canvas-field');
      wrapper.append(element('span', '', label));
      const input = element(options ? 'select' : 'input');
      input.setAttribute('aria-label', label);
      if (options) options.forEach(([value, text]) => input.append(new Option(text, value)));
      else { input.type = numeric ? 'number' : 'text'; if (numeric) input.step = '1'; }
      input.value = selected[key] ?? '';
      input.dataset.savedValue = input.value;
      fields.push({ input, key });
      input.disabled = !this.canEdit;
      input.addEventListener('change', () => {
        const value = numeric ? Number(input.value) : input.value;
        if (numeric && (!Number.isSafeInteger(value) || ((key === 'width' || key === 'height') && value < 1))) {
          input.value = currentSelection()?.[key] ?? '';
          input.dataset.savedValue = input.value;
          return;
        }
        try { update(key, optional && value === '' ? undefined : value); }
        catch (error) { this.status.textContent = error.message; input.value = currentSelection()?.[key] ?? ''; }
        input.dataset.savedValue = input.value;
      });
      wrapper.append(input);
      this.inspector.append(wrapper);
    };
    if (node) {
      if (node.type === 'file') {
        field('Vault file', 'file');
        field('Heading or block (#...)', 'subpath', { optional: true });
      }
      if (node.type === 'link') field('URL', 'url');
      if (node.type === 'group') {
        field('Label', 'label', { optional: true });
        field('Background image', 'background', { optional: true });
        field('Background style', 'backgroundStyle', { optional: true, options: [['', 'Default'], ['cover', 'Cover'], ['ratio', 'Keep ratio'], ['repeat', 'Repeat']] });
      }
      ['x', 'y', 'width', 'height'].forEach((key) => field(key[0].toUpperCase() + key.slice(1), key, { numeric: true }));
      const order = element('div', 'canvas-order');
      ['back', 'front'].forEach((direction) => {
        const control = button(`Send to ${direction}`, () => this.actions.reorderNode(node.id, direction));
        control.disabled = !this.canEdit;
        order.append(control);
      });
      this.inspector.append(order);
    } else {
      field('Label', 'label', { optional: true });
      const nodeOptions = (this.document.nodes ?? []).map((entry) => [entry.id, `${NODE_NAMES[entry.type]}: ${(entry.text || entry.label || entry.file || entry.url || entry.id).slice(0, 40)}`]);
      field('From card', 'fromNode', { options: nodeOptions });
      field('To card', 'toNode', { options: nodeOptions });
      ['from', 'to'].forEach((end) => {
        field(`${end === 'from' ? 'Start' : 'End'} side`, `${end}Side`, { optional: true,
          options: [['', 'Automatic'], ...['top', 'right', 'bottom', 'left'].map((value) => [value, value])] });
        field(`${end === 'from' ? 'Start' : 'End'} marker`, `${end}End`, { optional: true,
          options: [['', 'Default'], ['none', 'None'], ['arrow', 'Arrow']] });
      });
    }
    field('Color (1–6 or #RRGGBB)', 'color', { optional: true });
  }

  startNodeDrag(event, id, resize = false) {
    if (event.button !== 0 || this.spaceHeld || (!resize && event.target.closest(
      'a, button, input, textarea, select, summary, img, audio, video, [contenteditable="true"], .canvas-text-editor, .diagram-preview-shell, .drawio-embed, .excalidraw-embed',
    ))) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey || !this.selection.has(id)) this.select(id, event.shiftKey);
    if (!this.canEdit || !this.selection.has(id)) return;
    this.closeTextEditor();
    const origin = { x: event.clientX, y: event.clientY };
    const selected = [...this.selection].map((key) => this.getNode(key)).filter(Boolean);
    const moving = resize ? [this.getNode(id)] : [...selected];
    // A group's geometric containment controls group movement; no parent IDs go into the file.
    if (!resize) (this.document.nodes ?? []).forEach((node) => {
      if (moving.some((entry) => entry.id === node.id)) return;
      if (selected.some((group) => group.type === 'group' && node.x >= group.x && node.y >= group.y
        && node.x + node.width <= group.x + group.width && node.y + node.height <= group.y + group.height)) moving.push(node);
    });
    let moved = false;
    const move = (next) => {
      if (!moved && Math.hypot(next.clientX - origin.x, next.clientY - origin.y) < 4) return;
      moved = true;
      const dx = Math.round((next.clientX - origin.x) / this.viewport.zoom);
      const dy = Math.round((next.clientY - origin.y) / this.viewport.zoom);
      const patches = moving.map((node) => ({ id: node.id, patch: resize
        ? { width: Math.max(80, node.width + dx), height: Math.max(64, node.height + dy) }
        : { x: node.x + dx, y: node.y + dy } }));
      // Commit property deltas while dragging so collaborators see movement immediately.
      this.actions.updateNodes(patches.filter(({ id: nodeId }) => this.getNode(nodeId)), false);
    };
    this.actions.stopUndoCapture();
    this.trackPointer(event, move, () => {
      if (!moved && !event.shiftKey) this.select(id);
      this.actions.stopUndoCapture();
    });
  }

  trackPointer(event, move, finish) {
    this.cancelGesture?.();
    this.stage.focus({ preventScroll: true });
    const target = event.currentTarget;
    const end = (next, cancelled = false) => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', cancel);
      target.removeEventListener('lostpointercapture', cancel);
      this.cancelGesture = null;
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
      finish(next, cancelled);
    };
    const cancel = (next = event) => end(next, true);
    this.cancelGesture = cancel;
    target.setPointerCapture(event.pointerId);
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', cancel);
    target.addEventListener('lostpointercapture', cancel);
  }

  startConnection(event, id, side) {
    if (event.button !== 0 || !this.canEdit || this.spaceHeld) return;
    event.preventDefault();
    event.stopPropagation();
    this.select(id);
    this.connectFrom = null;
    const overlay = svgElement('svg', { class: 'canvas-connection-preview' });
    const line = svgElement('path', { class: 'canvas-edge-line' });
    overlay.append(line);
    this.world.append(overlay);
    const endpointId = Symbol();
    const pointFor = (next) => {
      const bounds = this.stage.getBoundingClientRect();
      return this.toWorld(next.clientX - bounds.left, next.clientY - bounds.top);
    };
    const targetFor = (next) => document.elementsFromPoint(next.clientX, next.clientY)
      .map((element) => element.closest('.canvas-card')).find((element) => element && element.dataset.nodeId !== id);
    const move = (next) => {
      const source = this.getNode(id);
      if (!source) { this.cancelGesture?.(); return; }
      const point = pointFor(next);
      const target = this.getNode(targetFor(next)?.dataset.nodeId) || { ...point, width: 0, height: 0 };
      const geometry = canvasEdgeGeometry({ fromNode: id, fromSide: side, toNode: endpointId, toSide: canvasSideAtPoint(target, point) },
        new Map([[id, source], [endpointId, target]]));
      line.setAttribute('d', geometry.path);
    };
    this.trackPointer(event, move, (next, cancelled) => {
      overlay.remove();
      const target = this.getNode(targetFor(next)?.dataset.nodeId);
      if (!cancelled && this.canEdit && this.getNode(id) && target) {
        this.actions.addEdge({ fromNode: id, fromSide: side, toNode: target.id, toSide: canvasSideAtPoint(target, pointFor(next)) });
      }
    });
  }

  startPan(event) {
    if (event.defaultPrevented || event.target.closest('.canvas-selection-toolbar, .canvas-navigation, .canvas-toolbar, .canvas-text-editor')) return;
    const onCard = event.target.closest('.canvas-card, .canvas-edge');
    const bounds = this.stage.getBoundingClientRect();
    const group = !onCard && this.groupAtPoint(this.toWorld(event.clientX - bounds.left, event.clientY - bounds.top));
    const pan = this.spaceHeld || event.button === 1 || (event.pointerType === 'touch' && !onCard && (!group || !this.canEdit));
    if (!pan && onCard) return;
    if (event.button !== 0 && event.button !== 1) return;
    // Group surfaces stay transparent to links and connections; only blank-space gestures reach here.
    if (group && !pan && !event.shiftKey) { this.startNodeDrag(event, group.id); return; }
    event.preventDefault();
    this.closeTextEditor();
    this.stage.focus();
    const initial = { ...this.viewport };
    const client = { x: event.clientX, y: event.clientY };
    const originalSelection = new Set(event.shiftKey || pan ? this.selection : []);
    const marquee = element('div', 'canvas-marquee');
    if (!pan) {
      this.selection = new Set(originalSelection);
      this.selectedEdge = null;
      this.syncSelection();
      this.stage.append(marquee);
    }
    const move = (next) => {
      if (pan) {
        this.viewport.x = initial.x + next.clientX - client.x;
        this.viewport.y = initial.y + next.clientY - client.y;
        this.applyViewport();
        return;
      }
      const bounds = this.stage.getBoundingClientRect();
      const left = Math.min(client.x, next.clientX) - bounds.left;
      const top = Math.min(client.y, next.clientY) - bounds.top;
      const width = Math.abs(next.clientX - client.x);
      const height = Math.abs(next.clientY - client.y);
      Object.assign(marquee.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
      const from = this.toWorld(left, top);
      const to = this.toWorld(left + width, top + height);
      this.selection = new Set(originalSelection);
      for (const node of this.document.nodes ?? []) {
        if (node.type === 'group' && (node.x < from.x || node.y < from.y
          || node.x + node.width > to.x || node.y + node.height > to.y)) continue;
        if (node.x < to.x && node.x + node.width > from.x && node.y < to.y && node.y + node.height > from.y) this.selection.add(node.id);
      }
      this.syncSelection();
    };
    this.trackPointer(event, move, () => marquee.remove());
  }

  toWorld(x, y) { return { x: (x - this.viewport.x) / this.viewport.zoom, y: (y - this.viewport.y) / this.viewport.zoom }; }

  groupAtPoint(point) {
    return (this.document.nodes ?? []).findLast((node) => node.type === 'group'
      && point.x >= node.x && point.x <= node.x + node.width
      && point.y >= node.y && point.y <= node.y + node.height);
  }

  zoomBy(factor, clientX, clientY) {
    const bounds = this.stage.getBoundingClientRect();
    const x = clientX === undefined ? bounds.width / 2 : clientX - bounds.left;
    const y = clientY === undefined ? bounds.height / 2 : clientY - bounds.top;
    const center = this.toWorld(x, y);
    this.viewport.zoom = Math.max(0.1, Math.min(3, this.viewport.zoom * factor));
    this.viewport.x = x - center.x * this.viewport.zoom;
    this.viewport.y = y - center.y * this.viewport.zoom;
    this.applyViewport();
  }

  fit(ids = null) {
    const nodes = (this.document.nodes ?? []).filter((node) => !ids || ids.includes(node.id));
    if (!nodes.length) { this.viewport = { x: 80, y: 80, zoom: 1 }; this.applyViewport(); return; }
    const left = Math.min(...nodes.map((node) => node.x));
    const top = Math.min(...nodes.map((node) => node.y));
    const width = Math.max(...nodes.map((node) => node.x + node.width)) - left;
    const height = Math.max(...nodes.map((node) => node.y + node.height)) - top;
    const zoom = Math.max(0.1, Math.min(1, (this.stage.clientWidth - 100) / Math.max(1, width), (this.stage.clientHeight - 100) / Math.max(1, height)));
    this.viewport = { zoom, x: (this.stage.clientWidth - width * zoom) / 2 - left * zoom,
      y: (this.stage.clientHeight - height * zoom) / 2 - top * zoom };
    this.applyViewport();
  }

  applyViewport() {
    this.world.style.transform = `translate(${this.viewport.x}px, ${this.viewport.y}px) scale(${this.viewport.zoom})`;
    this.stage.style.backgroundPosition = `${this.viewport.x}px ${this.viewport.y}px`;
    this.stage.style.backgroundSize = `${24 * this.viewport.zoom}px ${24 * this.viewport.zoom}px`;
    this.stage.style.setProperty('--canvas-grid-dot', `${0.8 * this.viewport.zoom}px`);
    this.zoomLabel.textContent = `${Math.round(this.viewport.zoom * 100)}%`;
    this.positionSelectionToolbar();
  }

  publishPointer(event) {
    const now = performance.now();
    if (now - (this.lastPointerAt || 0) < 50) return;
    this.lastPointerAt = now;
    const bounds = this.stage.getBoundingClientRect();
    const point = this.toWorld(event.clientX - bounds.left, event.clientY - bounds.top);
    this.stage.classList.toggle('is-over-group', event.target === this.stage && !this.spaceHeld && !event.shiftKey && Boolean(this.groupAtPoint(point)));
    this.actions.presence('pointer', point);
  }

  renderPresence(users) {
    this.users = users;
    this.cursors.replaceChildren();
    this.nodes.forEach(({ card }) => { card.classList.remove('is-remote-selected'); });
    users.filter((user) => !user.isLocal).forEach((user) => {
      (Array.isArray(user.selectedNodeIds) ? user.selectedNodeIds : []).forEach((id) => this.nodes.get(id)?.card.classList.add('is-remote-selected'));
      const { x, y } = user.pointer ?? {};
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const cursor = element('span', 'canvas-cursor', `↖ ${String(user.name || 'Collaborator').slice(0, 32)}`);
      cursor.style.left = `${x}px`;
      cursor.style.top = `${y}px`;
      cursor.style.setProperty('--canvas-color', canvasColor(user.color));
      this.cursors.append(cursor);
    });
  }

  onKeyDown(event) {
    if (event.key === 'Escape') {
      const menu = [this.colorMenu, this.helpMenu].find((entry) => entry.open);
      if (menu) { event.preventDefault(); menu.open = false; menu.querySelector('summary').focus(); return; }
    }
    if (event.defaultPrevented || event.target.closest('input, textarea, select, .diagram-preview-shell, [contenteditable="true"]')) return;
    if (event.key === 'Escape') {
      this.cancelGesture?.();
      this.connectFrom = null;
      this.help.textContent = '';
      this.closeTextEditor();
      this.selection.clear();
      this.selectedEdge = null;
      this.syncSelection();
      this.colorMenu.open = false;
      return;
    }
    if (event.target.closest('a, button, summary, .canvas-help-menu')) return;
    if (event.code === 'Space' && event.target === this.stage) { event.preventDefault(); this.spaceHeld = true; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      this.selection = new Set((this.document.nodes ?? []).map((node) => node.id));
      this.selectedEdge = null;
      this.syncSelection();
    }
    if (event.shiftKey && event.code === 'Digit1') { event.preventDefault(); this.fit(); }
    if (event.shiftKey && event.code === 'Digit2') { event.preventDefault(); this.fit([...this.selection]); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.actions.redo(); else this.actions.undo();
    }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); this.removeSelection(); }
    if (!this.canEdit) return;
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (delta && this.selection.size) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      this.actions.updateNodes([...this.selection].map((id) => {
        const node = this.getNode(id);
        return { id, patch: { x: node.x + delta[0] * step, y: node.y + delta[1] * step } };
      }));
    }
    if (event.key === 'Enter' && this.selection.size === 1) {
      const id = [...this.selection][0];
      if (this.getNode(id)?.type === 'text') { event.preventDefault(); this.openTextEditor(id); }
    }
  }

  applyTheme(theme) {
    this.nodes.forEach((entry) => entry.preview?.applyTheme(theme));
  }

  destroy() {
    this.cancelGesture?.();
    this.picker?.close();
    this.resizeObserver.disconnect();
    this.abort.abort();
    this.closeTextEditor();
    this.nodes.forEach((entry) => entry.preview?.destroy());
    this.root.replaceChildren();
  }
}
