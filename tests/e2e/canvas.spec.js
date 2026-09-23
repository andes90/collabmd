import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, openHome, stubPlantUmlRender, test } from './helpers/app-fixture.js';

const path = 'collaboration.canvas';
const card = (id, text, x = 0) => ({ id, type: 'text', x, y: 0, width: 280, height: 200, text });
const fixture = {
  extension: { preserved: true },
  nodes: [
    { id: 'group', type: 'group', x: -40, y: -50, width: 700, height: 310, label: 'Planning', color: '5' },
    card('a', 'Alpha'), card('b', 'Beta', 350),
    { id: 'link', type: 'link', x: 0, y: 330, width: 280, height: 120, url: 'https://jsoncanvas.org' },
    { id: 'file', type: 'file', x: 350, y: 330, width: 280, height: 180, file: 'README.md', subpath: '#links' },
  ],
  edges: [{ id: 'edge', fromNode: 'a', toNode: 'b', label: 'Next', toEnd: 'arrow', color: '4' }],
};

async function createFixture(page, content = JSON.stringify(fixture, null, '\t').replace(/\n/g, '\r\n') + '\r\n') {
  await openHome(page);
  const response = await page.request.post('/api/file', { data: { path, content } });
  expect(response.ok()).toBeTruthy();
  await expect(page.locator(`[data-path="${path}"]`).first()).toBeVisible();
  return content;
}

async function openCanvas(page) {
  await page.locator(`.file-tree-file[data-path="${path}"]`).click();
  const frame = page.frameLocator('.canvas-file-preview-frame');
  await expect(frame.locator('.canvas-editor[data-editable="true"]')).toBeVisible();
  return frame;
}

async function secondCanvas(browser, baseURL) {
  const context = await browser.newContext({ baseURL });
  await context.addInitScript(() => localStorage.setItem('collabmd-user-name', 'Canvas peer'));
  const page = await context.newPage();
  await page.goto(`/#file=${encodeURIComponent(path)}`);
  const frame = page.frameLocator('.canvas-file-preview-frame');
  await expect(frame.locator('.canvas-editor[data-editable="true"]')).toBeVisible();
  return { context, page, frame };
}

async function editText(frame, id) {
  await frame.locator(`[data-node-id="${id}"] .canvas-card-content`).dblclick();
  const editor = frame.getByRole('textbox', { name: 'Edit canvas text' });
  await expect(editor).toBeVisible();
  return editor;
}

async function saved(page) {
  const response = await page.request.get(`/api/file?path=${path}`);
  return JSON.parse((await response.json()).content);
}

async function showProperties(frame) {
  if (!await frame.locator('.canvas-inspector').isVisible()) await frame.getByRole('button', { name: 'Properties', exact: true }).click();
}

test('canvas renders standard nodes and preserves bytes through open and presence', async ({ page, e2eServer }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const content = await createFixture(page);
  const frame = await openCanvas(page);
  await expect(frame.locator('[data-node-id]')).toHaveCount(5);
  await expect(frame.locator('[data-edge-id]')).toHaveCount(1);
  await expect(frame.getByRole('link', { name: 'https://jsoncanvas.org' })).toBeVisible();
  const edgeBounds = await frame.locator('[data-edge-id="edge"] .canvas-edge-hit').boundingBox();
  await page.mouse.click(edgeBounds.x + edgeBounds.width / 2, edgeBounds.y + edgeBounds.height / 2);
  await showProperties(frame);
  await expect(frame.getByRole('heading', { name: 'Connection', exact: true })).toBeVisible();
  await frame.locator('[data-node-id="a"] .canvas-card-content').click();
  await frame.locator('[data-node-id="file"] .canvas-card-header').click();
  await expect(frame.getByRole('textbox', { name: 'Vault file', exact: true })).toHaveValue('README.md');
  await expect(frame.getByRole('textbox', { name: 'Heading or block (#...)', exact: true })).toHaveValue('#links');
  await frame.getByRole('button', { name: 'Fit canvas', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('canvas.png') });
  await page.locator('.file-tree-file[data-path="README.md"]').click();
  await expect(page.locator('.canvas-file-preview-frame')).toHaveCount(0);
  await expect.poll(() => readFile(join(e2eServer.vaultDir, path), 'utf8')).toBe(content);
  expect(errors).toEqual([]);
});

test('canvas merges simultaneous card typing and independent geometry through save and reopen', async ({ page, browser, baseURL }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await createFixture(page);
  const first = await openCanvas(page);
  const peer = await secondCanvas(browser, baseURL);
  peer.page.on('pageerror', (error) => errors.push(error.message));
  const editorA = await editText(first, 'a');
  const editorB = await editText(peer.frame, 'a');
  await editorA.press('End');
  await editorB.press('End');
  await Promise.all([page.keyboard.insertText(' one'), peer.page.keyboard.insertText(' two')]);
  await editorA.press('Escape');
  await editorB.press('Escape');
  const contentA = first.locator('[data-node-id="a"] .canvas-card-content');
  const contentB = peer.frame.locator('[data-node-id="a"] .canvas-card-content');
  await expect.poll(async () => (await contentA.textContent()) === (await contentB.textContent())).toBeTruthy();
  await expect(contentA).toContainText('one');
  await expect(contentA).toContainText('two');
  await first.locator('[data-node-id="b"] .canvas-card-content').click();
  await showProperties(first);
  await first.getByRole('spinbutton', { name: 'X', exact: true }).fill('420');
  await first.getByRole('spinbutton', { name: 'X', exact: true }).press('Tab');
  await peer.frame.locator('[data-node-id="a"] .canvas-card-content').click();
  await showProperties(peer.frame);
  await peer.frame.getByRole('spinbutton', { name: 'Y', exact: true }).fill('35');
  await peer.frame.getByRole('spinbutton', { name: 'Y', exact: true }).press('Tab');
  await expect(first.locator('[data-node-id="a"]')).toHaveCSS('top', '35px');
  await expect(peer.frame.locator('[data-node-id="b"]')).toHaveCSS('left', '420px');
  await expect.poll(async () => (await saved(page)).nodes.find((node) => node.id === 'b').x).toBe(420);
  const result = await saved(page);
  expect(result.extension).toEqual({ preserved: true });
  expect(result.nodes.find((node) => node.id === 'a').text).toContain('one');
  expect(Object.keys(result).sort()).toEqual(['edges', 'extension', 'nodes']);
  await peer.context.close();
  await page.locator('.file-tree-file[data-path="README.md"]').click();
  const reopened = await openCanvas(page);
  await expect(reopened.locator('[data-node-id="a"]')).toHaveCSS('top', '35px');
  expect(errors).toEqual([]);
});

test('canvas creates cards and connections, reorders, deletes and undoes local changes', async ({ page }) => {
  await createFixture(page, '{"nodes":[],"edges":[]}');
  const frame = await openCanvas(page);
  await frame.getByRole('button', { name: '+ Text card', exact: true }).click();
  let editor = frame.getByRole('textbox', { name: 'Edit canvas text' });
  await editor.fill('First card');
  await editor.press('Escape');
  await frame.getByRole('button', { name: '+ Text card', exact: true }).click();
  editor = frame.getByRole('textbox', { name: 'Edit canvas text' });
  await editor.fill('Second card');
  await editor.press('Escape');
  const cards = frame.locator('[data-node-id]');
  const ids = await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.nodeId));
  await showProperties(frame);
  const firstX = await cards.first().evaluate((node) => Number.parseFloat(node.style.left));
  await frame.getByRole('spinbutton', { name: 'X', exact: true }).fill(String(firstX + 400));
  await frame.getByRole('spinbutton', { name: 'X', exact: true }).press('Tab');
  await frame.getByRole('button', { name: 'Fit canvas', exact: true }).click();
  await frame.locator(`[data-node-id="${ids[0]}"] .canvas-card-content`).click();
  await frame.locator(`[data-node-id="${ids[1]}"] .canvas-card-content`).click({ modifiers: ['Shift'] });
  await frame.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(frame.locator('[data-edge-id]')).toHaveCount(1);
  await frame.locator(`[data-node-id="${ids[0]}"] .canvas-card-content`).click();
  await frame.getByRole('button', { name: 'Send to front', exact: true }).click();
  await expect.poll(async () => (await saved(page)).nodes.at(-1)?.id).toBe(ids[0]);
  await frame.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(cards).toHaveCount(1);
  await expect(frame.locator('[data-edge-id]')).toHaveCount(0);
  await frame.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(cards).toHaveCount(2);
  await expect(frame.locator('[data-edge-id]')).toHaveCount(1);
});

test('canvas reconnects and receives changes made while disconnected', async ({ page, browser, baseURL }) => {
  await createFixture(page);
  const first = await openCanvas(page);
  const peer = await secondCanvas(browser, baseURL);
  await peer.frame.locator('[data-node-id="a"] .canvas-card-content').click();
  await showProperties(peer.frame);
  await peer.context.setOffline(true);
  await expect(peer.frame.locator('.canvas-editor')).toHaveAttribute('data-editable', 'false');
  await peer.frame.getByRole('button', { name: 'Close properties', exact: true }).click();
  await expect(peer.frame.locator('.canvas-inspector')).toBeHidden();
  const editor = await editText(first, 'a');
  await editor.press('End');
  await editor.pressSequentially(' after disconnect');
  await editor.press('Escape');
  await peer.context.setOffline(false);
  await expect(peer.frame.locator('.canvas-editor')).toHaveAttribute('data-editable', 'true');
  await expect(peer.frame.locator('[data-node-id="a"] .canvas-card-content')).toContainText('after disconnect');
  await peer.context.close();
});

test('canvas supports keyboard selection and closes a text editor replaced by an external change', async ({ page, e2eServer }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await createFixture(page);
  const frame = await openCanvas(page);
  const node = frame.locator('[data-node-id="a"]');
  await node.focus();
  await node.press('Space');
  await expect(node).toHaveClass(/is-selected/);
  await node.press('Enter');
  await expect(frame.getByRole('textbox', { name: 'Edit canvas text' })).toBeVisible();
  const replacement = structuredClone(fixture);
  replacement.nodes[1] = { ...card('a', 'unused'), type: 'file', file: 'README.md' };
  delete replacement.nodes[1].text;
  const content = JSON.stringify(replacement);
  // The E2E server disables its filesystem watcher; API writes trigger the same room reconciliation.
  const response = await page.request.put('/api/file', { data: { path, content } });
  expect(response.ok()).toBeTruthy();
  await expect(node).toHaveAttribute('data-type', 'file');
  await expect(frame.getByRole('textbox', { name: 'Edit canvas text' })).toHaveCount(0);
  await expect(frame.locator('.canvas-editor')).toHaveAttribute('data-editable', 'true');
  expect(await readFile(join(e2eServer.vaultDir, path), 'utf8')).toBe(content);
  expect(errors).toEqual([]);
});

test('canvas wheel panning crosses cards while long previews and text editors remain scrollable', async ({ page, e2eServer }) => {
  const content = await createFixture(page, JSON.stringify({
    nodes: [card('short', 'Short card'), card('long', 'A long paragraph.\n\n'.repeat(60), 350)], edges: [],
  }));
  const frame = await openCanvas(page);
  const world = frame.locator('.canvas-world');
  const short = frame.locator('[data-node-id="short"] .canvas-card-content');
  const long = frame.locator('[data-node-id="long"] .canvas-card-content');
  await expect(long).toContainText('A long paragraph.');
  const fit = frame.getByRole('button', { name: 'Fit canvas', exact: true });

  await short.hover();
  const initial = await world.getAttribute('style');
  await page.mouse.wheel(0, 40);
  await expect.poll(() => world.getAttribute('style')).not.toBe(initial);
  expect(await short.evaluate((element) => element.scrollTop)).toBe(0);

  await fit.click();
  const bounds = await long.boundingBox();
  const startY = await world.evaluate((element) => new DOMMatrix(element.style.transform).m42);
  // The first wheel moves the card beneath the pointer; the next must keep panning.
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y - 20);
  await page.mouse.wheel(0, 40);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y - 19);
  await page.mouse.wheel(0, 40);
  await expect.poll(() => world.evaluate((element) => new DOMMatrix(element.style.transform).m42)).toBeCloseTo(startY - 80, 0);
  expect(await long.evaluate((element) => element.scrollTop)).toBe(0);

  await fit.click();
  await long.click();
  const reading = await world.getAttribute('style');
  await page.mouse.wheel(0, 80);
  await expect.poll(() => long.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await world.getAttribute('style')).toBe(reading);
  await long.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await page.mouse.wheel(0, 40);
  await expect.poll(() => world.getAttribute('style')).not.toBe(reading);

  await fit.click();
  await long.evaluate((element) => { element.scrollTop = 0; });
  const editor = await editText(frame, 'long');
  const scroller = frame.locator('.canvas-text-editor .cm-scroller');
  const editing = await world.getAttribute('style');
  await scroller.hover();
  await page.mouse.wheel(0, 80);
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await world.getAttribute('style')).toBe(editing);
  await editor.press('Escape');
  await page.locator('.file-tree-file[data-path="README.md"]').click();
  await expect(page.locator('.canvas-file-preview-frame')).toHaveCount(0);
  expect(await readFile(join(e2eServer.vaultDir, path), 'utf8')).toBe(content);
});

test('canvas pans by touch on mobile and restores Markdown controls for notes', async ({ page, e2eServer }) => {
  const content = await createFixture(page);
  const frame = await openCanvas(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#mobileViewToggle')).toBeHidden();
  await expect(page.locator('#outlineToggle')).toBeHidden();
  await expect(frame.getByRole('button', { name: 'Fit canvas', exact: true })).toBeVisible();
  await expect(frame.getByRole('button', { name: '+ Text card', exact: true })).toBeVisible();
  await frame.locator('.canvas-stage').hover({ position: { x: 10, y: 10 } });
  const stage = await frame.locator('.canvas-stage').boundingBox();
  const before = await frame.locator('[data-node-id="a"]').boundingBox();
  const touch = await page.context().newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: stage.x + 10, y: stage.y + 10 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: stage.x + 40, y: stage.y + 45 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const after = await frame.locator('[data-node-id="a"]').boundingBox();
  expect(after.x - before.x).toBeCloseTo(30, 0);
  expect(after.y - before.y).toBeCloseTo(35, 0);
  expect(await readFile(join(e2eServer.vaultDir, path), 'utf8')).toBe(content);
  await touch.detach();
  await frame.getByRole('button', { name: 'Fit canvas', exact: true }).click();
  await frame.locator('[data-node-id="file"]').focus();
  await frame.locator('[data-node-id="file"]').press('Space');
  await frame.locator('.canvas-color-menu summary').click();
  const palette = await frame.locator('.canvas-colors').boundingBox();
  expect(palette.x).toBeGreaterThanOrEqual(stage.x);
  expect(palette.x + palette.width).toBeLessThanOrEqual(stage.x + stage.width);
  await frame.locator('.canvas-color-menu summary').click();
  expect(await readFile(join(e2eServer.vaultDir, path), 'utf8')).toBe(content);
  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  await page.locator('.file-tree-file[data-path="README.md"]').click();
  await expect(page.locator('.canvas-file-preview-frame')).toHaveCount(0);
  await expect(page.locator('#mobileViewToggle')).toBeVisible();
  await page.locator('#mobileViewToggle').click();
  await expect(page.locator('#outlineToggle')).toBeVisible();
});

test('canvas scopes headings to the selected file and previews the chosen section for collaborators', async ({ page, browser, baseURL }) => {
  await createFixture(page);
  const filePath = 'projects/canvas-guide.md';
  const sectionLabels = ['Whole file', 'Guide', 'Selected section', 'Child section', 'Following section'];
  const response = await page.request.post('/api/file', { data: {
    path: filePath,
    content: `# Guide\n\n${'An introductory paragraph.\n\n'.repeat(60)}## Selected section\n\n${'Section content.\n\n'.repeat(60)}### Child section\n\nNested content.\n\n## Following section\n\nExcluded content.`,
  } });
  expect(response.ok()).toBeTruthy();
  const frame = await openCanvas(page);
  const peer = await secondCanvas(browser, baseURL);
  await peer.frame.locator('[data-node-id="file"] .canvas-card-header').click();
  await showProperties(peer.frame);
  const peerHeading = peer.frame.getByRole('textbox', { name: 'Heading or block (#...)', exact: true });
  await peerHeading.focus();
  await frame.locator('[data-node-id="file"] .canvas-card-header').click();
  await showProperties(frame);
  const file = frame.getByRole('textbox', { name: 'Vault file', exact: true });
  await frame.getByRole('button', { name: 'Change file', exact: true }).click();
  const picker = frame.getByRole('dialog', { name: 'Choose a Vault file' });
  await picker.getByRole('combobox').fill('canvas guide');
  await expect(picker.getByRole('option')).toHaveCount(1);
  await picker.getByRole('combobox').press('Enter');
  const heading = frame.getByRole('textbox', { name: 'Heading or block (#...)', exact: true });
  await expect(file).toHaveValue(filePath);
  const peerFile = peer.frame.getByRole('textbox', { name: 'Vault file', exact: true });
  await expect(peerFile).toHaveValue(filePath);
  await peer.frame.getByRole('button', { name: 'Choose section', exact: true }).click();
  const peerSections = peer.frame.getByRole('dialog', { name: 'Choose a heading' });
  await expect(peerSections.getByRole('option').locator('span')).toHaveText(sectionLabels);
  await peerSections.getByRole('combobox').press('Escape');
  await frame.getByRole('button', { name: 'Choose section', exact: true }).click();
  const sections = frame.getByRole('dialog', { name: 'Choose a heading' });
  await expect(sections.getByRole('option').locator('span')).toHaveText(sectionLabels);
  await sections.getByRole('combobox').fill('Selected section');
  await expect(sections.getByRole('option')).toHaveCount(1);
  await sections.getByRole('combobox').press('Enter');
  await expect(peerHeading).toHaveValue('#selected-section');
  const preview = frame.locator('[data-node-id="file"] .canvas-file-markdown');
  const peerPreview = peer.frame.locator('[data-node-id="file"] .canvas-file-markdown');
  for (const cardPreview of [preview, peerPreview]) {
    await expect(cardPreview).toContainText('Selected section');
    await expect(cardPreview).toContainText('Nested content.');
    await expect(cardPreview).not.toContainText('An introductory paragraph.');
    await expect(cardPreview).not.toContainText('Excluded content.');
  }
  await peerHeading.fill('#draft-in-progress');
  await heading.fill('');
  await heading.press('Tab');
  await expect(preview).toContainText('An introductory paragraph.');
  await expect(preview).toContainText('Excluded content.');
  await expect(peerHeading).toHaveValue('#draft-in-progress');
  await peerHeading.fill('');
  await peerHeading.press('Tab');
  await heading.fill('#missing');
  await heading.press('Tab');
  await expect(preview).toContainText('Heading not found in this file.');
  await expect(preview).not.toContainText('An introductory paragraph.');
  await heading.fill('#^block');
  await heading.press('Tab');
  await expect(preview).toContainText('Block previews are not supported.');
  await heading.fill('#selected-section');
  await heading.press('Tab');
  await file.fill('missing-note.md');
  await file.press('Tab');
  await expect(peerFile).toHaveValue('missing-note.md');
  await expect(preview).toContainText('File unavailable');
  await file.fill(filePath);
  await file.press('Tab');
  await expect.poll(async () => (await saved(page)).nodes.find((node) => node.id === 'file')).toMatchObject({
    file: filePath, subpath: '#selected-section',
  });
  await peer.context.close();
  await frame.getByRole('button', { name: `Open ${filePath}#selected-section`, exact: true }).click();
  await expect(page.locator('.canvas-file-preview-frame')).toHaveCount(0);
  await expect(page.locator('#previewContent #selected-section')).toBeVisible();
  await expect.poll(() => page.locator('#previewContent #selected-section').evaluate((element) => {
    return Math.abs(element.getBoundingClientRect().top - document.getElementById('previewContainer').getBoundingClientRect().top);
  })).toBeLessThan(100);
});

test('canvas pickers preserve bytes on cancel and add files by keyboard or sidebar drag', async ({ page, e2eServer }) => {
  const content = await createFixture(page);
  const frame = await openCanvas(page);
  await expect(frame.locator('.canvas-inspector')).toBeHidden();
  await expect(frame.getByRole('toolbar', { name: 'Selection actions' })).toBeHidden();
  await frame.getByRole('button', { name: '+ File card', exact: true }).click();
  let dialog = frame.getByRole('dialog', { name: 'Choose a Vault file' });
  await dialog.getByRole('combobox').fill('readme');
  await expect(dialog.getByRole('option')).toHaveCount(1);
  await dialog.getByRole('combobox').press('Escape');
  await expect(frame.locator('[data-node-id]')).toHaveCount(5);
  await frame.locator('[data-node-id="file"] .canvas-card-header').click();
  await frame.getByRole('button', { name: 'Choose section', exact: true }).click();
  dialog = frame.getByRole('dialog', { name: 'Choose a heading' });
  await expect(dialog.getByRole('option').first()).toContainText('Whole file');
  await dialog.getByRole('combobox').fill('no such heading');
  await expect(dialog.getByRole('option')).toHaveCount(0);
  await dialog.getByRole('combobox').press('Escape');
  expect(await readFile(join(e2eServer.vaultDir, path), 'utf8')).toBe(content);
  await frame.getByRole('button', { name: '+ File card', exact: true }).click();
  dialog = frame.getByRole('dialog', { name: 'Choose a Vault file' });
  await dialog.getByRole('combobox').fill('readme');
  await expect(dialog.getByRole('option')).toHaveCount(1);
  await dialog.getByRole('combobox').press('Enter');
  await expect(frame.locator('[data-node-id]')).toHaveCount(6);
  await page.locator('.file-tree-file[data-path="README.md"]').dragTo(frame.locator('.canvas-stage'), { targetPosition: { x: 80, y: 120 } });
  await expect(frame.locator('[data-node-id]')).toHaveCount(7);
  await expect.poll(async () => (await saved(page)).nodes.filter((node) => node.file === 'README.md').length).toBe(3);
  expect((await page.request.get('/api/file?path=README.md')).ok()).toBeTruthy();
});

test('canvas floating controls and external labels keep properties optional and preserve file bytes', async ({ page, e2eServer }, testInfo) => {
  const content = await createFixture(page);
  const frame = await openCanvas(page);
  await expect(frame.locator('[data-node-id="a"] .canvas-card-content')).toHaveText('Alpha');
  await expect(frame.locator('[data-node-id="file"] .canvas-card-content')).toContainText('Links');
  const stage = frame.locator('.canvas-stage');
  const rootBounds = await frame.locator('.canvas-editor').boundingBox();
  expect(await stage.boundingBox()).toEqual(rootBounds);
  const dock = await frame.getByRole('toolbar', { name: 'Canvas tools', exact: true }).boundingBox();
  expect(dock.x + dock.width / 2).toBeCloseTo(rootBounds.x + rootBounds.width / 2, 0);
  expect(dock.y).toBeGreaterThan(rootBounds.y + rootBounds.height - 90);
  await expect(frame.locator('[data-node-id="a"] .canvas-card-header')).toBeHidden();
  const file = frame.locator('[data-node-id="file"]');
  const labelBounds = await file.locator('.canvas-card-header').boundingBox();
  expect(labelBounds.y + labelBounds.height).toBeLessThan((await file.boundingBox()).y);
  await file.locator('.canvas-card-content').click({ position: { x: 20, y: 20 } });
  await expect(frame.getByRole('button', { name: 'Choose section', exact: true })).toBeVisible();
  const camera = await frame.locator('.canvas-world').getAttribute('style');
  await showProperties(frame);
  const inspectorBounds = await frame.locator('.canvas-inspector').boundingBox();
  const stageWithProperties = await stage.boundingBox();
  expect(stageWithProperties.x + stageWithProperties.width).toBeLessThanOrEqual(inspectorBounds.x);
  expect(await frame.locator('.canvas-world').getAttribute('style')).toBe(camera);
  await frame.getByRole('button', { name: 'Close properties', exact: true }).click();
  expect(await stage.boundingBox()).toEqual(rootBounds);
  await expect(frame.getByRole('button', { name: 'Properties', exact: true })).toBeFocused();
  await frame.locator('.canvas-help-menu summary').click();
  await expect(frame.getByText('Canvas shortcuts', { exact: true })).toBeVisible();
  await frame.locator('.canvas-help-menu summary').press('Escape');
  await expect(file).toHaveClass(/is-selected/);
  await expect(frame.getByText('Canvas shortcuts', { exact: true })).toBeHidden();
  await frame.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await frame.getByRole('button', { name: 'Reset zoom', exact: true }).click();
  await expect(frame.getByRole('button', { name: 'Reset zoom', exact: true })).toHaveText('100%');
  await frame.getByRole('button', { name: 'Fit canvas', exact: true }).click();
  await frame.locator('html').evaluate((html) => { html.style.colorScheme = 'dark'; });
  await page.screenshot({ path: testInfo.outputPath('canvas-floating-dark.png') });
  await frame.locator('html').evaluate((html) => { html.style.colorScheme = 'light'; });
  await page.screenshot({ path: testInfo.outputPath('canvas-floating-light.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.locator('#sidebar').isVisible()) await page.getByRole('button', { name: 'Close sidebar', exact: true }).click();
  await expect(page.locator('#sidebar')).toBeHidden();
  await frame.getByRole('button', { name: 'Fit canvas', exact: true }).click();
  const mobileStage = await stage.boundingBox();
  for (const selector of ['.canvas-toolbar', '.canvas-navigation', '.canvas-selection-toolbar']) {
    const bounds = await frame.locator(selector).boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(mobileStage.x);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(mobileStage.x + mobileStage.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(mobileStage.y + mobileStage.height);
  }
  await page.screenshot({ path: testInfo.outputPath('canvas-floating-mobile.png') });
  const touch = await page.context().newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await page.setViewportSize({ width: 844, height: 330 });
  const landscapeStage = await stage.boundingBox();
  const navigation = await frame.locator('.canvas-navigation').boundingBox();
  expect(navigation.y + navigation.height).toBeLessThanOrEqual(landscapeStage.y + landscapeStage.height);
  await frame.locator('.canvas-help-menu summary').click();
  const help = await frame.locator('.canvas-help-content').boundingBox();
  expect(help.y + help.height).toBeLessThanOrEqual(landscapeStage.y + landscapeStage.height);
  await page.screenshot({ path: testInfo.outputPath('canvas-floating-landscape.png') });
  await touch.detach();
  expect(await readFile(join(e2eServer.vaultDir, path), 'utf8')).toBe(content);
});

test('canvas moves cards and groups from their labels, backgrounds and frames for collaborators', async ({ page, browser, baseURL, e2eServer }) => {
  const content = await createFixture(page);
  const frame = await openCanvas(page);
  const peer = await secondCanvas(browser, baseURL);
  const a = frame.locator('[data-node-id="a"]');
  const bounds = await a.boundingBox();
  const zoom = bounds.width / fixture.nodes[1].width;
  const start = { x: bounds.x + 24, y: bounds.y + 24 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 2, start.y + 1);
  await page.mouse.up();
  expect(await readFile(join(e2eServer.vaultDir, path), 'utf8')).toBe(content);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 40 * zoom, start.y + 20 * zoom, { steps: 6 });
  await page.mouse.up();
  await expect(peer.frame.locator('[data-node-id="a"]')).toHaveCSS('left', '40px');
  await expect(peer.frame.locator('[data-node-id="a"]')).toHaveCSS('top', '20px');
  for (const surface of ['label', 'background', 'frame', 'touch']) {
    const group = await frame.locator('[data-node-id="group"]').boundingBox();
    const label = await frame.locator('[data-node-id="group"] .canvas-card-header').boundingBox();
    const x = surface === 'label' ? label.x + label.width / 2 : group.x + (surface === 'frame' ? 1 : 24 * zoom);
    const y = surface === 'label' ? label.y + label.height / 2 : group.y + group.height - 40 * zoom;
    if (surface === 'touch') {
      const touch = await page.context().newCDPSession(page);
      await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 30 * zoom, y: y + 20 * zoom }] });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await touch.detach();
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 30 * zoom, y + 20 * zoom, { steps: 6 });
      await page.mouse.up();
    }
    await expect(peer.frame.locator('[data-node-id="group"]'), `Drag group ${surface}`).toHaveCSS('left', '-10px');
    await expect(peer.frame.locator('[data-node-id="a"]')).toHaveCSS('left', '70px');
    await expect(peer.frame.locator('[data-node-id="b"]')).toHaveCSS('left', '380px');
    await expect(peer.frame.locator('[data-node-id="file"]')).toHaveCSS('left', '350px');
    await frame.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(peer.frame.locator('[data-node-id="a"]')).toHaveCSS('left', '40px');
    await expect(peer.frame.locator('[data-node-id="b"]')).toHaveCSS('left', '350px');
  }
  await peer.context.close();
});

test('canvas group interiors preserve selection, panning and connection access without saving', async ({ page, e2eServer }) => {
  const content = await createFixture(page);
  const frame = await openCanvas(page);
  const stage = frame.locator('.canvas-stage');
  const group = frame.locator('[data-node-id="group"]');
  let bounds = await group.boundingBox();
  const point = { x: bounds.x + 24, y: bounds.y + bounds.height - 20 };
  await page.mouse.click(point.x, point.y);
  await expect(group).toHaveClass(/is-selected/);
  await stage.press('Escape');
  const a = await frame.locator('[data-node-id="a"]').boundingBox();
  await page.keyboard.down('Shift');
  await page.mouse.move(a.x - 12, a.y - 12);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width + 12, a.y + a.height + 12, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(frame.locator('.canvas-card.is-selected')).toHaveCount(1);
  await expect(frame.locator('[data-node-id="a"]')).toHaveClass(/is-selected/);
  await page.keyboard.down('Space');
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 25, point.y + 20, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  bounds = await group.boundingBox();
  expect(bounds.x + 24 - point.x).toBeCloseTo(25, 0);
  const edge = await frame.locator('[data-edge-id="edge"] .canvas-edge-hit').boundingBox();
  await page.mouse.click(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await expect(frame.getByRole('textbox', { name: 'Connection label', exact: true })).toHaveValue('Next');
  await page.context().setOffline(true);
  await expect(frame.locator('.canvas-editor')).toHaveAttribute('data-editable', 'false');
  const beforeTouch = await group.boundingBox();
  const touchPoint = { x: beforeTouch.x + 24, y: beforeTouch.y + beforeTouch.height - 40 };
  const touch = await page.context().newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchPoint.x + 25, y: touchPoint.y + 20 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect((await group.boundingBox()).x - beforeTouch.x).toBeCloseTo(25, 0);
  await touch.detach();
  await page.context().setOffline(false);
  await expect(frame.locator('.canvas-editor')).toHaveAttribute('data-editable', 'true');
  expect(await readFile(join(e2eServer.vaultDir, path), 'utf8')).toBe(content);
});

test('canvas draws and labels connections while selection and camera gestures preserve bytes', async ({ page, browser, baseURL, e2eServer }) => {
  const content = JSON.stringify({ nodes: [card('a', 'Alpha'), card('b', 'Beta', 400)], edges: [] });
  await createFixture(page, content);
  const frame = await openCanvas(page);
  const peer = await secondCanvas(browser, baseURL);
  const a = frame.locator('[data-node-id="a"]');
  const b = frame.locator('[data-node-id="b"]');
  const firstBounds = await a.boundingBox();
  const secondBounds = await b.boundingBox();
  await page.mouse.move(firstBounds.x - 12, firstBounds.y - 12);
  await page.mouse.down();
  await page.mouse.move(secondBounds.x + secondBounds.width + 12, secondBounds.y + secondBounds.height + 12, { steps: 8 });
  await page.mouse.up();
  await expect(frame.locator('.canvas-card.is-selected')).toHaveCount(2);
  const stage = frame.locator('.canvas-stage');
  await stage.focus();
  await stage.press('Shift+Digit2');
  const stageBounds = await stage.boundingBox();
  const beforePan = await a.boundingBox();
  await page.keyboard.down('Space');
  await page.mouse.move(stageBounds.x + 20, stageBounds.y + 30);
  await page.mouse.down();
  await page.mouse.move(stageBounds.x + 55, stageBounds.y + 65, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  expect((await a.boundingBox()).x - beforePan.x).toBeCloseTo(35, 0);
  expect(await readFile(join(e2eServer.vaultDir, path), 'utf8')).toBe(content);
  await frame.getByRole('button', { name: 'Fit canvas', exact: true }).click();
  // Start directly from hover with no focused Canvas control.
  await stage.evaluate(() => document.activeElement.blur());
  await a.hover();
  const handle = a.getByRole('button', { name: 'Connect from right', exact: true });
  let start = await handle.boundingBox();
  let target = await b.boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 4, target.y + target.height / 2, { steps: 8 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(frame.locator('[data-edge-id]')).toHaveCount(0);
  expect(await readFile(join(e2eServer.vaultDir, path), 'utf8')).toBe(content);
  await a.locator('.canvas-card-content').click();
  start = await handle.boundingBox();
  target = await b.boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 4, target.y + target.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(peer.frame.locator('[data-edge-id]')).toHaveCount(1);
  await expect.poll(async () => (await saved(page)).edges[0]).toMatchObject({ fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'left' });
  const line = await frame.locator('.canvas-edge-hit').boundingBox();
  await page.mouse.dblclick(line.x + line.width / 2, line.y + line.height / 2);
  const label = frame.getByRole('textbox', { name: 'Connection label', exact: true });
  await expect(label).toBeFocused();
  await label.fill('Related');
  await label.press('Enter');
  await expect(peer.frame.locator('.canvas-edge text')).toHaveText('Related');
  await frame.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(peer.frame.locator('.canvas-edge text')).toHaveCount(0);
  await peer.context.close();
});

test('canvas creates text at the double-click position', async ({ page }) => {
  await createFixture(page, '{"nodes":[],"edges":[]}');
  const frame = await openCanvas(page);
  await frame.locator('.canvas-stage').dblclick({ position: { x: 280, y: 210 } });
  const editor = frame.getByRole('textbox', { name: 'Edit canvas text' });
  await editor.fill('Created here');
  await editor.press('Escape');
  await expect.poll(async () => (await saved(page)).nodes[0]).toMatchObject({ type: 'text', text: 'Created here', x: 60, y: 30 });
  await frame.locator('.canvas-card-content').dblclick();
  await expect(editor).toBeVisible();
  await editor.press('Escape');
  await expect(frame.locator('[data-node-id]')).toHaveCount(1);
});

test('canvas shares rich Markdown rendering and keeps diagrams independent across card updates', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await stubPlantUmlRender(page, 'Canvas handshake');
  const filePath = 'canvas-preview.md';
  const diagrams = '```mermaid\nflowchart TD\nStart --> Finish\n```\n\n![[sample-plantuml.puml|Handshake]]';
  const text = `Editable card.\n\n${diagrams}`;
  await createFixture(page, JSON.stringify({ nodes: [
    { id: 'file', type: 'file', file: filePath, subpath: '#selected', x: 0, y: 0, width: 540, height: 640 },
    { ...card('a', text, 590), width: 540, height: 640 },
  ], edges: [] }));
  const response = await page.request.post('/api/file', { data: {
    path: filePath,
    content: ['---', 'title: Metadata', '---', '# Introduction', '', 'Excluded intro.', '', '## Selected', '', '```js', 'const answer = 42;', '```', '', '[[README]]', '', diagrams, '', '## Following', '', 'Excluded end.'].join('\n'),
  } });
  expect(response.ok()).toBeTruthy();
  await page.locator(`.file-tree-file[data-path="${filePath}"]`).click();
  const normalCode = page.locator('#previewContent code.language-js');
  await expect(normalCode).toBeVisible();
  const normalHighlight = await normalCode.innerHTML();
  const frame = await openCanvas(page);
  const preview = frame.locator('[data-node-id="file"] .canvas-file-markdown');
  const textPreview = frame.locator('[data-node-id="a"] .canvas-card-content');
  await expect(preview.locator('code.language-js')).toHaveText('const answer = 42;\n');
  expect(await preview.locator('code.language-js').innerHTML()).toBe(normalHighlight);
  await expect(preview.locator('.wiki-link[data-wiki-target="README"]')).toBeVisible();
  await expect(preview).not.toContainText('Excluded');
  await expect(preview.locator('.frontmatter-block')).toHaveCount(0);
  for (const content of [preview, textPreview]) {
    await expect(content.locator('.mermaid-frame svg')).toBeVisible({ timeout: 30000 });
    await expect(content.locator('.mermaid-frame svg')).toContainText('Finish');
    await expect(content.locator('.plantuml-frame svg')).toContainText('Canvas handshake');
  }
  const preservedSvg = await preview.locator('.plantuml-frame svg').elementHandle();
  await textPreview.getByText('Editable card.', { exact: true }).dblclick();
  const editor = frame.getByRole('textbox', { name: 'Edit canvas text' });
  const editedText = `Updated card.\n\n${diagrams}`;
  await editor.fill(editedText);
  await editor.press('Escape');
  await expect(textPreview.locator('.mermaid-frame svg')).toBeVisible();
  expect(await preservedSvg.evaluate((svg) => svg.isConnected)).toBe(true);
  await expect.poll(async () => (await saved(page)).nodes.find((node) => node.id === 'a').text).toBe(editedText);

  await preview.locator('.plantuml-maximize-btn').click();
  const maximized = frame.locator('[data-plantuml-maximized-root="true"] .plantuml-shell.is-maximized');
  await expect(maximized).toBeVisible();
  const toolbarPoint = await frame.getByRole('toolbar', { name: 'Selection actions' }).evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  });
  await expect.poll(() => maximized.evaluate((element, point) => element.contains(document.elementFromPoint(point.x, point.y)), toolbarPoint)).toBe(true);
  const remaining = await saved(page);
  remaining.nodes = remaining.nodes.filter((node) => node.id !== 'a');
  expect((await page.request.put('/api/file', { data: { path, content: JSON.stringify(remaining) } })).ok()).toBeTruthy();
  await expect(frame.locator('[data-node-id]')).toHaveCount(1);
  await expect(maximized).toBeVisible();
  await expect(frame.locator('body')).toHaveClass(/plantuml-maximized-open/);
  expect(await preservedSvg.evaluate((svg) => svg.isConnected)).toBe(true);
  await maximized.locator('.plantuml-maximize-btn').click();
  await expect(preview.locator('.plantuml-frame svg')).toBeVisible();
  await preview.locator('.wiki-link[data-wiki-target="README"]').click();
  await expect(page.locator('.canvas-file-preview-frame')).toHaveCount(0);
  await expect(page).toHaveURL(/file=README.md/);
  expect(errors).toEqual([]);
});

test('canvas renders draw.io and Excalidraw embeds and maximizes them beyond the card', async ({ page }) => {
  await createFixture(page, JSON.stringify({ nodes: [{
    ...card('a', '![[canvas-flow.drawio]]\n\n![[sample-excalidraw.excalidraw]]'), width: 640, height: 1200,
  }, card('b', 'Another card', 800)], edges: [] }));
  expect((await page.request.post('/api/file', { data: {
    path: 'canvas-flow.drawio',
    content: '<mxfile><diagram id="page-1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Canvas flow" vertex="1" parent="1"><mxGeometry x="0" y="0" width="120" height="60" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>',
  } })).ok()).toBeTruthy();
  const frame = await openCanvas(page);
  await expect(frame.locator('.drawio-embed .drawio-viewer-frame')).toBeVisible();
  await expect(frame.locator('.excalidraw-embed iframe')).toBeVisible();
  await expect(frame.locator('.excalidraw-embed')).not.toHaveClass(/is-loading/);
  for (const kind of ['drawio', 'excalidraw']) {
    const embed = frame.locator(`.${kind}-embed`);
    const control = embed.getByRole('button', { name: 'Maximize diagram', exact: true });
    await control.click();
    await expect(embed).toHaveClass(/is-maximized/);
    const canvasBounds = await frame.locator('.canvas-editor').boundingBox();
    await expect.poll(async () => (await embed.boundingBox()).width).toBeGreaterThan(canvasBounds.width * 0.8);
    await expect.poll(async () => (await embed.boundingBox()).height).toBeGreaterThan(canvasBounds.height * 0.8);
    const updated = await saved(page);
    updated.nodes.find((node) => node.id === 'b').text = `Updated with ${kind} maximized.`;
    expect((await page.request.put('/api/file', { data: { path, content: JSON.stringify(updated) } })).ok()).toBeTruthy();
    await expect(frame.locator('[data-node-id="b"]')).toContainText(`Updated with ${kind} maximized.`);
    await expect(frame.locator('body')).toHaveClass(new RegExp(`${kind}-maximized-open`));
    await embed.getByRole('button', { name: 'Restore diagram size', exact: true }).click();
    await expect(embed).not.toHaveClass(/is-maximized/);
    await expect(frame.getByRole('button', { name: 'Fit canvas', exact: true })).toBeVisible();
  }
});
