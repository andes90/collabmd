import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const clientAppRoot = resolve(projectRoot, 'src/client/app');
const clientDistRoot = resolve(projectRoot, 'dist/client');
const backendProxyTarget = process.env.COLLABMD_DEV_PROXY_TARGET || 'http://127.0.0.1:1234';
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  build: {
    emptyOutDir: true,
    modulePreload: {
      resolveDependencies: (filename, deps) => deps.filter((dep) => {
        if (/\/yjs-[^/]+\.js$/.test(dep)) {
          return false;
        }
        if (/lobby-presence|workspace-sync-client|deferred-git|deferred-preview|deferred-collab/.test(dep)) {
          return false;
        }
        if (!filename.includes('excalidraw') && /mermaid|editor-session|quick-switcher|prettier|embedpdf|preview-render-|highlight-runtime/.test(dep)) {
          return false;
        }
        return true;
      }),
    },
    outDir: clientDistRoot,
    rollupOptions: {
      input: {
        drawioEditor: resolve(clientAppRoot, 'drawio-editor.html'),
        excalidrawEditor: resolve(clientAppRoot, 'excalidraw-editor.html'),
        exportDocument: resolve(clientAppRoot, 'export-document.html'),
        index: resolve(clientAppRoot, 'index.html'),
      },
      output: {
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
  root: clientAppRoot,
  server: {
    fs: {
      allow: [projectRoot],
    },
    proxy: {
      '/api': {
        changeOrigin: true,
        target: backendProxyTarget,
      },
      '/app-config.js': {
        changeOrigin: true,
        target: backendProxyTarget,
      },
      '/health': {
        changeOrigin: true,
        target: backendProxyTarget,
      },
      '/version.json': {
        changeOrigin: true,
        target: backendProxyTarget,
      },
      '/ws': {
        changeOrigin: true,
        target: backendProxyTarget,
        ws: true,
      },
    },
  },
}));
