import { mkdir, mkdtemp, rm, copyFile, readFile, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { build, transform } from 'esbuild';

const require = createRequire(import.meta.url);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = resolve(rootDir, 'public');
const clientSourceDir = resolve(rootDir, 'src/client');
const clientStyleSourceDir = resolve(clientSourceDir, 'styles');
const clientOutputDir = resolve(publicDir, 'assets/js');
const clientStyleOutputDir = resolve(publicDir, 'assets/css');
const obsoleteOutputDirs = [
  resolve(publicDir, 'assets/domain'),
  resolve(publicDir, 'assets/vendor/mermaid'),
  resolve(publicDir, 'assets/vendor/modules'),
];
const clientAppEntrySource = resolve(clientSourceDir, 'main.js');
const excalidrawEditorEntrySource = resolve(clientSourceDir, 'excalidraw-editor.js');
const excalidrawMermaidStubSource = resolve(clientSourceDir, 'excalidraw-mermaid-stub.js');
const previewWorkerSource = resolve(clientSourceDir, 'application/preview-render-worker.js');
const previewWorkerOutput = resolve(clientOutputDir, 'application/preview-render-worker.js');
const excalidrawLoaderOutput = resolve(clientOutputDir, 'excalidraw-editor.js');
const excalidrawCssLoaderOutput = resolve(clientOutputDir, 'excalidraw-editor.css');
const styleAssetFiles = ['base.css', 'style.css'];
const buildWorkingDir = await mkdtemp(join(tmpdir(), 'collabmd-build-'));

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

async function bundlePreviewWorker() {
  await mkdir(resolve(clientOutputDir, 'application'), { recursive: true });
  await build({
    absWorkingDir: buildWorkingDir,
    alias: {
      'highlight.js': resolve(rootDir, 'node_modules/highlight.js/lib/index.js'),
      'markdown-it': resolve(rootDir, 'node_modules/markdown-it/dist/markdown-it.js'),
    },
    bundle: true,
    conditions: ['production'],
    entryPoints: [previewWorkerSource],
    format: 'esm',
    minify: true,
    outfile: previewWorkerOutput,
    platform: 'browser',
    target: ['es2022'],
  });
}

async function bundleMainApp() {
  await mkdir(clientOutputDir, { recursive: true });
  await build({
    absWorkingDir: buildWorkingDir,
    bundle: true,
    chunkNames: 'chunks/[name]-[hash]',
    assetNames: 'assets/[name]-[hash]',
    conditions: ['production'],
    entryNames: '[name]',
    entryPoints: {
      main: clientAppEntrySource,
    },
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    format: 'esm',
    loader: {
      '.ttf': 'file',
      '.woff': 'file',
      '.woff2': 'file',
    },
    minify: true,
    outdir: clientOutputDir,
    platform: 'browser',
    splitting: true,
    target: ['es2022'],
  });
}

async function bundleExcalidrawApp() {
  await mkdir(clientOutputDir, { recursive: true });
  const result = await build({
    absWorkingDir: buildWorkingDir,
    alias: {
      '@excalidraw/mermaid-to-excalidraw': excalidrawMermaidStubSource,
    },
    assetNames: 'assets/[name]-[hash]',
    bundle: true,
    chunkNames: 'chunks/[name]-[hash]',
    conditions: ['production'],
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    entryNames: '[name]-[hash]',
    entryPoints: {
      'excalidraw-editor': excalidrawEditorEntrySource,
    },
    format: 'esm',
    loader: {
      '.ttf': 'file',
      '.woff': 'file',
      '.woff2': 'file',
    },
    metafile: true,
    minify: true,
    outdir: clientOutputDir,
    platform: 'browser',
    splitting: true,
    target: ['es2022'],
    write: true,
  });

  const outputs = result.metafile?.outputs ?? {};
  const hashedJsPath = Object.keys(outputs).find((outputPath) => (
    /(^|\/)excalidraw-editor-[A-Z0-9]+\.(?:js)$/iu.test(outputPath)
  )) ?? null;
  const hashedCssPath = (
    (hashedJsPath ? outputs[hashedJsPath]?.cssBundle : null)
    ?? Object.keys(outputs).find((outputPath) => (
      /(^|\/)excalidraw-editor-[A-Z0-9]+\.(?:css)$/iu.test(outputPath)
    ))
    ?? null
  );

  if (!hashedJsPath || !hashedCssPath) {
    throw new Error('Failed to locate emitted Excalidraw entry assets');
  }

  const hashedJsFile = hashedJsPath.replace(/\\/g, '/').split('/').pop();
  const hashedCssFile = hashedCssPath.replace(/\\/g, '/').split('/').pop();

  await writeFile(
    excalidrawLoaderOutput,
    `import "./${hashedJsFile}";\n`,
    'utf8',
  );

  await writeFile(
    excalidrawCssLoaderOutput,
    `@import url("./${hashedCssFile}");\n`,
    'utf8',
  );
}

async function bundleStyles() {
  await mkdir(clientStyleOutputDir, { recursive: true });

  await Promise.all(styleAssetFiles.map(async (fileName) => {
    const source = await readFile(resolve(clientStyleSourceDir, fileName), 'utf8');
    const result = await transform(source, {
      loader: 'css',
      minify: true,
      target: ['chrome120', 'firefox120', 'safari17'],
    });

    await writeFile(resolve(clientStyleOutputDir, fileName), result.code, 'utf8');
  }));
}

try {
  await rm(clientOutputDir, { force: true, recursive: true });
  await Promise.all(obsoleteOutputDirs.map((directory) => rm(directory, { force: true, recursive: true })));
  await mkdir(clientOutputDir, { recursive: true });
  await mkdir(clientStyleOutputDir, { recursive: true });
  await copyHighlightThemeFiles();
  await bundleStyles();
  await bundleMainApp();
  await bundleExcalidrawApp();
  await bundlePreviewWorker();
} finally {
  await rm(buildWorkingDir, { force: true, recursive: true });
}
