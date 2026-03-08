import { mkdir, rm, copyFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = resolve(rootDir, 'public');
const clientSourceDir = resolve(rootDir, 'src/client');
const clientOutputDir = resolve(publicDir, 'assets/js');
const obsoleteOutputDirs = [
  resolve(publicDir, 'assets/domain'),
  resolve(publicDir, 'assets/vendor/modules'),
];
const clientAppEntrySource = resolve(clientSourceDir, 'main.js');
const previewWorkerSource = resolve(clientSourceDir, 'application/preview-render-worker.js');
const previewWorkerOutput = resolve(clientOutputDir, 'application/preview-render-worker.js');
const browserResolveAliases = new Map([
  ['lib0/webcrypto', resolve(rootDir, 'node_modules/lib0/webcrypto.js')],
]);

function createNodeResolvePlugin() {
  return {
    name: 'node-resolve',
    setup(buildContext) {
      buildContext.onResolve({ filter: /^[^./]|^\.[^./]|^\.\.[^/]/ }, async (args) => {
        const browserAlias = browserResolveAliases.get(args.path);
        if (browserAlias) {
          return { path: browserAlias };
        }

        try {
          const resolvedUrl = args.importer
            ? await import.meta.resolve(args.path, pathToFileURL(args.importer).href)
            : await import.meta.resolve(args.path);

          return {
            path: fileURLToPath(resolvedUrl),
          };
        } catch {
          return null;
        }
      });
    },
  };
}

async function copyHighlightThemeFiles() {
  const themeDir = resolve(publicDir, 'assets/vendor/highlight');
  await mkdir(themeDir, { recursive: true });

  await copyFile(
    require.resolve('highlight.js/styles/github.min.css'),
    resolve(themeDir, 'github.min.css'),
  );

  await copyFile(
    require.resolve('highlight.js/styles/github-dark.min.css'),
    resolve(themeDir, 'github-dark.min.css'),
  );
}

async function copyMermaidBundle() {
  const mermaidDir = resolve(publicDir, 'assets/vendor/mermaid');
  await mkdir(mermaidDir, { recursive: true });
  await copyFile(
    require.resolve('mermaid/dist/mermaid.min.js'),
    resolve(mermaidDir, 'mermaid.min.js'),
  );
}

async function bundlePreviewWorker() {
  await mkdir(resolve(clientOutputDir, 'application'), { recursive: true });
  await build({
    alias: {
      'highlight.js': resolve(rootDir, 'node_modules/highlight.js/lib/index.js'),
      'markdown-it': resolve(rootDir, 'node_modules/markdown-it/dist/markdown-it.js'),
    },
    bundle: true,
    entryPoints: [previewWorkerSource],
    format: 'esm',
    minify: true,
    outfile: previewWorkerOutput,
    platform: 'browser',
    plugins: [createNodeResolvePlugin()],
    target: ['es2022'],
  });
}

async function bundleClientApp() {
  await mkdir(clientOutputDir, { recursive: true });
  await build({
    bundle: true,
    chunkNames: 'chunks/[name]-[hash]',
    entryNames: '[name]',
    entryPoints: {
      main: clientAppEntrySource,
    },
    format: 'esm',
    minify: true,
    outdir: clientOutputDir,
    platform: 'browser',
    plugins: [createNodeResolvePlugin()],
    splitting: true,
    target: ['es2022'],
  });
}

await rm(clientOutputDir, { force: true, recursive: true });
await Promise.all(obsoleteOutputDirs.map((directory) => rm(directory, { force: true, recursive: true })));
await mkdir(clientOutputDir, { recursive: true });
await copyHighlightThemeFiles();
await copyMermaidBundle();
await bundleClientApp();
await bundlePreviewWorker();
