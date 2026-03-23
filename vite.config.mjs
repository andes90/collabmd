import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const clientAppRoot = resolve(projectRoot, 'src/client/app');
const clientStaticRoot = resolve(projectRoot, 'src/client/static');
const clientDistRoot = resolve(projectRoot, 'dist/client');
const backendProxyTarget = process.env.COLLABMD_DEV_PROXY_TARGET || 'http://127.0.0.1:1234';
const excalidrawMermaidStubSource = resolve(projectRoot, 'src/client/excalidraw-mermaid-stub.js');

export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  build: {
    emptyOutDir: true,
    outDir: clientDistRoot,
    rollupOptions: {
      input: {
        drawioEditor: resolve(clientAppRoot, 'drawio-editor.html'),
        excalidrawEditor: resolve(clientAppRoot, 'excalidraw-editor.html'),
        index: resolve(clientAppRoot, 'index.html'),
      },
      output: {
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
  publicDir: clientStaticRoot,
  resolve: {
    alias: {
      '@excalidraw/mermaid-to-excalidraw': excalidrawMermaidStubSource,
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
