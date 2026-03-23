import { ensureRuntimeConfigLoaded } from '../infrastructure/runtime-config-loader.js';

await ensureRuntimeConfigLoaded();
await import('../excalidraw-editor.js');
