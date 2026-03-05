import { cp, mkdir, rm, copyFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = resolve(rootDir, 'public');
const clientSourceDir = resolve(rootDir, 'src/client');
const sharedDomainSourceDir = resolve(rootDir, 'src/domain');
const clientOutputDir = resolve(publicDir, 'assets/js');
const sharedDomainOutputDir = resolve(publicDir, 'assets/domain');

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

await rm(clientOutputDir, { force: true, recursive: true });
await rm(sharedDomainOutputDir, { force: true, recursive: true });
await mkdir(clientOutputDir, { recursive: true });
await mkdir(sharedDomainOutputDir, { recursive: true });
await cp(clientSourceDir, clientOutputDir, { recursive: true });
await cp(sharedDomainSourceDir, sharedDomainOutputDir, { recursive: true });
await copyHighlightThemeFiles();
await copyMermaidBundle();
