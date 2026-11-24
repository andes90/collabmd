import { spawn } from 'node:child_process';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { resetE2EVaultSnapshot, runtimeVaultDir } from '../tests/e2e/helpers/vault-snapshot.js';

const projectRoot = resolve(import.meta.dirname, '..');
const docsAssetsDir = resolve(projectRoot, 'docs/assets');
const tempCaptureDir = resolve(projectRoot, '.tmp/readme-capture');
const tempVideoDir = resolve(tempCaptureDir, 'video');

const HOST = '127.0.0.1';
const PORT = 4173;
const BASE_URL = `http://${HOST}:${PORT}`;
const HERO_PATH = resolve(docsAssetsDir, 'collabmd-hero.webp');
const DEMO_WEBM_PATH = resolve(docsAssetsDir, 'collabmd-demo.webm');
const DEMO_GIF_PATH = resolve(docsAssetsDir, 'collabmd-demo.gif');

const HERO_VIEWPORT = { width: 1600, height: 1000 };
const DEMO_VIEWPORT = { width: 1440, height: 900 };
const DEMO_TRIM_START_SECONDS = '1.0';
const DEMO_TRIM_DURATION_SECONDS = '5.0';

const HERO_FILE = 'showcase.md';
const DEMO_FILE = 'live-demo.md';

const HERO_MARKDOWN = `# CollabMD

Turn any markdown folder into a collaborative workspace.

- Edit together in real time
- Navigate with wiki-links and backlinks
- Review drafts with inline comments and room chat

## Collaboration Flow

\`\`\`mermaid
flowchart LR
    A["Markdown files"] --> B["Editor"]
    B --> C["Preview"]
    C --> D["Shared session"]
    D --> E["Disk"]
\`\`\`

## Linked Notes

- [[projects/collabmd]]
- [[daily/2026-03-05]]
`;

const DEMO_MARKDOWN = `# Live collaboration

- Ava is reviewing the README
- Ben is editing from another browser

## Notes

Changes appear in the preview as they happen.
`;

async function runCommand(command, args, { cwd = projectRoot } = {}) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: 'inherit',
    });

    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function waitForServer(serverProcess, url) {
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    if (serverProcess.exitCode != null) {
      throw new Error(`CollabMD server exited early with code ${serverProcess.exitCode}`);
    }

    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until the server is ready or times out.
    }

    await delay(500);
  }

  throw new Error('Timed out waiting for CollabMD to become healthy');
}

function startServer() {
  return spawn(
    'node',
    ['bin/collabmd.js', '--no-tunnel', '--port', String(PORT), '--host', HOST, runtimeVaultDir],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
      stdio: 'inherit',
    },
  );
}

async function stopServer(serverProcess) {
  if (!serverProcess || serverProcess.exitCode != null) {
    return;
  }

  await new Promise((resolvePromise) => {
    const finish = () => resolvePromise();
    serverProcess.once('exit', finish);
    serverProcess.kill('SIGTERM');

    setTimeout(() => {
      if (serverProcess.exitCode == null) {
        serverProcess.kill('SIGKILL');
      }
    }, 5_000);
  });
}

async function prepareVault() {
  await resetE2EVaultSnapshot();
  await writeFile(resolve(runtimeVaultDir, HERO_FILE), HERO_MARKDOWN);
  await writeFile(resolve(runtimeVaultDir, DEMO_FILE), DEMO_MARKDOWN);
}

async function openFile(page, filePath) {
  await page.goto(`${BASE_URL}/#file=${encodeURIComponent(filePath)}`);
  await page.locator('.cm-editor').waitFor({ state: 'visible' });
}

async function appendEditorContent(page, content) {
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await editor.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type(content, { delay: 20 });
}

async function openChat(page) {
  await page.locator('#chatToggleBtn').click();
  await page.locator('#chatPanel').waitFor({ state: 'visible' });
}

async function sendChatMessage(page, message) {
  await openChat(page);
  await page.locator('#chatInput').fill(message);
  await page.locator('#chatForm').getByRole('button', { name: 'Send' }).click();
}

async function createHero(browser) {
  const contextA = await browser.newContext({ viewport: HERO_VIEWPORT });
  const contextB = await browser.newContext({ viewport: HERO_VIEWPORT });

  await contextA.addInitScript((name) => {
    window.localStorage.setItem('collabmd-user-name', name);
  }, 'Ava');
  await contextB.addInitScript((name) => {
    window.localStorage.setItem('collabmd-user-name', name);
  }, 'Ben');

  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await openFile(pageA, HERO_FILE);
  await openFile(pageB, HERO_FILE);

  await pageA.locator('#userCount').waitFor({ state: 'visible' });
  await pageA.waitForFunction(
    () => document.getElementById('userCount')?.textContent?.includes('2 online'),
  );
  await pageA.locator('#previewContent .mermaid-frame svg').waitFor({
    state: 'visible',
    timeout: 60_000,
  });
  await pageA.locator('#previewContent .mermaid-zoom-btn[aria-label="Zoom out"]').click();
  await pageA.locator('#previewContent .mermaid-zoom-btn[aria-label="Zoom out"]').click();
  await delay(500);

  await pageA.screenshot({
    path: HERO_PATH,
    animations: 'disabled',
  });

  await contextB.close();
  await contextA.close();
}

async function createDemo(browser) {
  const contextA = await browser.newContext({
    viewport: DEMO_VIEWPORT,
    recordVideo: {
      dir: tempVideoDir,
      size: DEMO_VIEWPORT,
    },
  });
  const contextB = await browser.newContext({ viewport: DEMO_VIEWPORT });

  await contextA.addInitScript((name) => {
    window.localStorage.setItem('collabmd-user-name', name);
  }, 'Ava');
  await contextB.addInitScript((name) => {
    window.localStorage.setItem('collabmd-user-name', name);
  }, 'Ben');

  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const pageAVideo = pageA.video();

  await openFile(pageA, DEMO_FILE);
  await openFile(pageB, DEMO_FILE);
  await pageA.waitForFunction(
    () => document.getElementById('userCount')?.textContent?.includes('2 online'),
  );

  await delay(1000);

  await appendEditorContent(
    pageB,
    '## Shared update\n\nThe preview, presence, and chat stay in sync.',
  );
  await pageA.locator('#previewContent').getByText('Shared update').waitFor({ state: 'visible' });

  await delay(750);

  await sendChatMessage(pageB, "Let's ship the README refresh.");
  await pageA.locator('#chatToggleBadge').waitFor({ state: 'visible' });

  await delay(500);

  await openChat(pageA);
  await pageA.locator('#chatMessages').getByText("Let's ship the README refresh.").waitFor({
    state: 'visible',
  });

  await delay(1500);

  await contextB.close();
  await contextA.close();

  if (!pageAVideo) {
    throw new Error('Playwright did not produce a demo recording');
  }

  const rawVideoPath = await pageAVideo.path();
  await rename(rawVideoPath, DEMO_WEBM_PATH);
}

async function convertDemoToGif() {
  const palettePath = resolve(tempCaptureDir, 'palette.png');

  await runCommand('ffmpeg', [
    '-y',
    '-ss',
    DEMO_TRIM_START_SECONDS,
    '-t',
    DEMO_TRIM_DURATION_SECONDS,
    '-i',
    DEMO_WEBM_PATH,
    '-frames:v',
    '1',
    '-update',
    '1',
    '-vf',
    'fps=10,scale=1100:-1:flags=lanczos,palettegen',
    palettePath,
  ]);

  await runCommand('ffmpeg', [
    '-y',
    '-ss',
    DEMO_TRIM_START_SECONDS,
    '-t',
    DEMO_TRIM_DURATION_SECONDS,
    '-i',
    DEMO_WEBM_PATH,
    '-i',
    palettePath,
    '-lavfi',
    'fps=10,scale=1100:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5',
    DEMO_GIF_PATH,
  ]);
}

async function main() {
  let serverProcess;
  const browser = await chromium.launch({ headless: true });

  try {
    await rm(tempCaptureDir, { force: true, recursive: true });
    await mkdir(tempVideoDir, { recursive: true });
    await mkdir(docsAssetsDir, { recursive: true });

    await runCommand('npm', ['run', 'build']);
    await prepareVault();

    serverProcess = startServer();
    await waitForServer(serverProcess, BASE_URL);

    await createHero(browser);
    await createDemo(browser);
  } finally {
    await browser.close();
    await stopServer(serverProcess);
  }

  await convertDemoToGif();
  console.log(`Created ${HERO_PATH}`);
  console.log(`Created ${DEMO_WEBM_PATH}`);
  console.log(`Created ${DEMO_GIF_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
