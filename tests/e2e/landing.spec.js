import { expect, test } from '@playwright/test';

const landingUrl = new URL('../../landing/index.html', import.meta.url).href;

test('landing reflects current features and stays usable across viewports', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(landingUrl);

  await expect(page).toHaveTitle('CollabMD | Your folder, now multiplayer');
  await expect(page.locator('main')).toContainText('Structurizr');
  await expect(page.locator('main')).toContainText('Searchable PDFs and self-contained document exports');
  await expect(page.locator('main')).toContainText('Connect AI agents');
  await expect(page.locator('main')).toContainText('Open Excalidraw, draw.io, and PDFs');
  await expect(page.locator('#install')).toContainText('Requires Node.js 26');
  await expect(page.locator('#panel-docker .copy-btn')).toHaveAttribute(
    'data-copy',
    'docker run --rm -p 1234:1234 -v "$PWD:/data" ghcr.io/andes90/collabmd:latest',
  );
  await page.locator('#tab-docker').click();
  expect(await page.locator('#panel-docker pre').innerText()).toContain('\\\n  -v');
  await page.locator('#tab-npx').click();
  expect(await page.locator('.hero-sub').innerText().then((text) => text.trim().split(/\s+/).length)).toBeLessThanOrEqual(20);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const capabilityLabelTops = await page.locator('#features .capability-kicker')
    .evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().top)));
  expect(new Set(capabilityLabelTops).size).toBe(1);

  for (const id of ['features', 'demo', 'how', 'install']) {
    await page.evaluate((sectionId) => {
      window.scrollTo({ top: document.getElementById(sectionId).offsetTop, behavior: 'instant' });
    }, id);
    await expect(page.locator(`.nav-links a[href="#${id}"]`)).toHaveAttribute('aria-current', 'location');
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const menuToggle = page.locator('.nav-menu-toggle');
  await menuToggle.click();
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(pageErrors).toEqual([]);
});
