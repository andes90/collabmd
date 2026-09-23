import {
  CANVAS_NODES_KEY,
  addCanvasNode, addCanvasEdge, updateCanvasNode, updateCanvasEdge,
  deleteCanvasNodes, deleteCanvasEdges, reorderCanvasNode, resolveCanvasExternalConflict,
} from '../domain/canvas-room-codec.js';
import { createRandomUser } from './domain/room.js';
import { createCanvasMarkdownPreview } from './bootstrap/canvas-markdown-preview.js';
import { canvasFilePath } from './domain/canvas-view.js';
import { getActiveVaultId, getClientRuntimeConfig, resolveApiUrl, resolveWsBaseUrl } from './domain/runtime-paths.js';
import { ensureClientAuthenticated } from './infrastructure/auth-client.js';
import { CanvasRoomClient } from './infrastructure/canvas-room-client.js';
import { createCanvasTextEditor } from './infrastructure/canvas-text-editor.js';
import { vaultApiClient } from './infrastructure/vault-api-client.js';
import { CanvasEditorView } from './presentation/canvas-editor-view.js';
import { flattenTree } from './presentation/file-tree-state.js';
import { ImageLightboxController } from './presentation/image-lightbox-controller.js';
import './styles/base.css';
import './styles/surfaces/embedded-editor-base.css';
import './styles/primitives/controls.css';
import './styles/components/actions.css';
import './styles/surfaces/canvas-editor.css';

const params = new URLSearchParams(window.location.search);
const filePath = canvasFilePath(params.get('file'));
const root = document.getElementById('root');
const post = (type, data = {}) => window.parent.postMessage({ type, filePath, ...data }, window.location.origin);
let client;
let view;

function updateTheme(theme) {
  document.body.dataset.theme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = document.body.dataset.theme;
  document.documentElement.style.colorScheme = theme === 'light' ? 'light' : 'dark';
  view?.applyTheme(document.body.dataset.theme);
}

async function initialize() {
  updateTheme(params.get('theme'));
  await ensureClientAuthenticated();
  if (!filePath || !/\.canvas$/i.test(filePath)) throw new Error('Choose a valid Canvas file from the Vault.');
  const config = getClientRuntimeConfig();
  const vaultId = params.get('vaultId') || getActiveVaultId(config);
  if (vaultId) {
    const vault = config.vaults?.find((entry) => entry.id === vaultId);
    if (!vault) throw new Error('Vault unavailable');
    // Keep this iframe's transport pinned to its Vault while the host switches tabs.
    config.vaults = [vault];
    config.activeVault = vaultId;
  }
  window.__COLLABMD_CONFIG__ = config;
  const readFile = (path) => vaultApiClient.readFile(path, config);
  let fileList = [];
  const readTree = async () => {
    const result = await vaultApiClient.readTree(config);
    fileList = flattenTree(result.tree ?? []).files;
    return result;
  };
  await readTree();
  const onOpenFile = (path, subpath) => post('canvas-open-file', { filePath: path, subpath });
  const user = createRandomUser(params.get('userName') || localStorage.getItem('collabmd-user-name'));
  for (const [key, parameter] of [['color', 'userColor'], ['colorLight', 'userColorLight'], ['peerId', 'userPeerId']]) {
    if (params.get(parameter)) user[key] = params.get(parameter);
  }
  client = new CanvasRoomClient({
    filePath, user, readFile, wsBaseUrl: resolveWsBaseUrl(config),
    onChange: (state) => view?.update(state),
    onAwareness: (users) => { view?.renderPresence(users); post('canvas-awareness', { users }); },
    onConnection: (state) => post('canvas-connection', { state }),
  });
  const action = (operation) => client.mutate(operation);
  const actions = {
    addNode: (node) => {
      const id = crypto.randomUUID();
      return action((doc) => {
        addCanvasNode(doc, { ...node, id });
        if (node.type === 'group') reorderCanvasNode(doc, id, 'back');
      }) ? id : null;
    },
    addEdge: (edge) => action((doc) => addCanvasEdge(doc, { ...edge, id: crypto.randomUUID() })),
    updateNode: (id, patch) => action((doc) => updateCanvasNode(doc, id, patch)),
    updateEdge: (id, patch) => action((doc) => updateCanvasEdge(doc, id, patch)),
    updateNodes: (patches, separateUndo = true) => client.mutate((doc) => {
      patches.forEach(({ id, patch }) => updateCanvasNode(doc, id, patch));
    }, { separateUndo }),
    deleteNodes: (ids) => action((doc) => deleteCanvasNodes(doc, ids)),
    deleteEdges: (ids) => action((doc) => deleteCanvasEdges(doc, ids)),
    reorderNode: (id, direction) => action((doc) => reorderCanvasNode(doc, id, direction)),
    presence: (field, value) => client.setPresence(field, value),
    undo: () => client.undo(), redo: () => client.redo(),
    stopUndoCapture: () => client.undoManager.stopCapturing(),
    resolveConflict: (choice) => {
      if (!client.provider?.synced) return;
      view.closeTextEditor();
      client.doc.transact(() => resolveCanvasExternalConflict(client.doc, choice), client.localOrigin);
      client.undoManager.clear();
    },
  };
  view = new CanvasEditorView({
    root, actions, readFile, readTree, vaultId: vaultId || '',
    createMarkdownPreview: (container, markdownText, sourceFilePath = filePath, subpath) => createCanvasMarkdownPreview({
      container, markdownText, sourceFilePath, subpath,
      getFileList: () => fileList,
      getLocalUser: () => client.awareness.getLocalState()?.user ?? user,
      getTheme: () => document.body.dataset.theme,
      onOpenFile, vaultApiClient,
    }),
    getText: (id) => client.doc.getMap(CANVAS_NODES_KEY).get(id)?.get('text'),
    attachmentUrl: (path) => resolveApiUrl(`/attachment?path=${encodeURIComponent(path)}`, config),
    onOpenFile,
    createTextEditor: (id, parent, onClose) => {
      const text = client.doc.getMap(CANVAS_NODES_KEY).get(id)?.get('text');
      if (!text || !client.canEdit) return null;
      return createCanvasTextEditor({ parent, text, onClose, awareness: client.awareness, undoManager: client.undoManager });
    },
  });
  const imageLightbox = new ImageLightboxController({ previewElement: root });
  ['stack-item-added', 'stack-item-popped', 'stack-cleared'].forEach((event) => client.undoManager.on(event, () => client.publish()));
  window.addEventListener('message', async (event) => {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'canvas-theme') updateTheme(message.theme);
    if (message.type === 'canvas-user' && message.user) client.setUser(message.user);
    if (message.type === 'canvas-prepare-disconnect' && message.filePath === filePath && typeof message.requestId === 'string') {
      view.closeTextEditor();
      const ready = await client.prepareDisconnect();
      post(ready ? 'canvas-disconnect-ready' : 'canvas-disconnect-blocked', { requestId: message.requestId });
    }
  });
  window.addEventListener('beforeunload', (event) => {
    if (!client.hasPendingWrites) return;
    event.preventDefault();
    event.returnValue = '';
  });
  window.addEventListener('pagehide', () => { imageLightbox.destroy(); view.destroy(); client.destroy(); });
  post('canvas-ready');
  await client.connect();
}

initialize().catch(() => {
  root.textContent = 'Unable to open this canvas. The file has not been changed.';
  root.setAttribute('role', 'alert');
});
