import { access } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

const landingUrl = new URL('../../landing/index.html', import.meta.url).href;

test('landing entrance settles and respects reduced motion', async ({ page }) => {
  await page.addInitScript(() => {
    window.finishedEntrances = [];
    document.addEventListener('animationend', (event) => window.finishedEntrances.push(event.animationName));
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(landingUrl);
  await expect.poll(() => page.evaluate(() => window.finishedEntrances)).toEqual(expect.arrayContaining([
    'landing-page-back', 'landing-page-front', 'landing-enter', 'landing-preview-enter',
  ]));
  for (const selector of ['.hero-actions', '.hero-shot', '#install .section-head', '.install', '#docs .section-head', '.docs-list']) {
    await expect(page.locator(selector)).toHaveCSS('opacity', '1');
    await expect(page.locator(selector)).toHaveCSS('transform', 'none');
  }
  await expect(page.locator('#install .reveal, #docs .reveal')).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  const animations = await page.locator('.nav-mark > *, .hero-enter').evaluateAll((elements) => (
    elements.map((element) => getComputedStyle(element).animationName)
  ));
  expect(animations.every((name) => name === 'none')).toBe(true);
  await expect(page.locator('.hero-shot')).toHaveCSS('opacity', '1');
  await expect(page.locator('.hero-actions')).toHaveCSS('transform', 'none');
});

test('landing explains current workflows and links to maintained documentation', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(landingUrl);

  await expect(page).toHaveTitle('CollabMD | Work together. Keep your files.');
  await expect(page.locator('h1')).toHaveText('CollabMD');
  for (const feature of ['Multiple vaults', 'Git review', 'Connect AI agents', 'Structurizr', 'DOCX', 'revocation']) {
    await expect(page.locator('#features')).toContainText(feature);
  }
  await expect(page.locator('#install')).toContainText('Requires Node.js 26');
  expect((await page.locator('.hero-sub').innerText()).trim().split(/\s+/).length).toBeLessThanOrEqual(20);

  const guides = await page.locator('.docs-list a').evaluateAll((links) => links.map((link) => link.href));
  expect(guides).toHaveLength(6);
  for (const href of guides) {
    const guidePath = new URL(href).pathname.replace('/andes90/collabmd/blob/master/', '');
    expect(guidePath).toMatch(/^docs\/[a-z-]+\.md$/);
    await access(new URL(`../../${guidePath}`, import.meta.url));
  }

  for (const id of ['features', 'demo', 'install', 'docs']) {
    await page.evaluate((sectionId) => {
      window.scrollTo({ top: document.getElementById(sectionId).offsetTop, behavior: 'instant' });
    }, id);
    await expect(page.locator(`.nav-links a[href="#${id}"]`)).toHaveAttribute('aria-current', 'location');
  }

  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const menuToggle = page.getByRole('button', { name: /navigation/ });
  await menuToggle.click();
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(menuToggle).toBeFocused();
  await menuToggle.click();
  await page.locator('.nav-links').getByRole('link', { name: 'Docs', exact: true }).click();
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page).toHaveURL(/#docs$/);
  expect(pageErrors).toEqual([]);
});

test('installation tabs support keyboard navigation and copy the selected command', async ({ page }) => {
  await page.addInitScript(() => {
    window.copiedCommands = [];
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text) => window.copiedCommands.push(text) },
    });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(landingUrl);
  await page.locator('#tab-npx').focus();
  await page.keyboard.press('End');
  await expect(page.locator('#tab-docker')).toBeFocused();
  await expect(page.locator('#tab-docker')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-npx')).toBeHidden();
  await expect(page.locator('#panel-docker')).toBeVisible();
  expect(await page.locator('#panel-docker pre').innerText()).toContain('\\\n  -v');
  await page.locator('#panel-docker .copy-btn').click();
  await expect(page.locator('#panel-docker .copy-label')).toHaveText('Copied');
  expect(await page.evaluate(() => window.copiedCommands)).toEqual([
    'docker run --rm -p 127.0.0.1:1234:1234 -v "$PWD:/data" ghcr.io/andes90/collabmd:latest',
  ]);
  await page.locator('#tab-docker').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-npx')).toBeFocused();
  await expect(page.locator('#panel-npx')).toBeVisible();
});

test('landing keeps guides and installation commands available without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(landingUrl);
  await expect(page.locator('#hero-title')).toBeVisible();
  await expect(page.locator('.install-tabs')).toBeHidden();
  for (const method of ['npx', 'brew', 'docker']) {
    await expect(page.locator(`#panel-${method}`)).toBeVisible();
  }
  await expect(page.getByRole('navigation', { name: 'Documentation guides' })).toBeVisible();
  await context.close();
});
