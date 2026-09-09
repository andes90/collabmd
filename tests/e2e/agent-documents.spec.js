import { expect, openFile, setEditorSelection, test } from './helpers/app-fixture.js';

test('WebMCP reads selected Markdown, validates an edit, and updates the visible editor', async ({ page }) => {
  // Exercise the real app registration/composition with a browser API shim.
  // Native agent discovery and consent remain browser-client compatibility checks.
  await page.addInitScript(() => {
    const tools = new Map();
    window.agentTools = tools;
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: {
        registerTool(tool, { signal }) {
          tools.set(tool.name, tool);
          signal.addEventListener('abort', () => tools.delete(tool.name), { once: true });
        },
      },
    });
  });
  await openFile(page, 'README.md');
  await expect.poll(() => page.evaluate(() => window.agentTools.has('collabmd_get_active_context'))).toBe(true);
  await setEditorSelection(page, 'Welcome to the test vault.');
  const context = await page.evaluate(() => window.agentTools.get('collabmd_get_active_context').execute());
  expect(context.activePath).toBe('README.md');
  expect(context.kind).toBe('markdown');
  expect(context.selection.text).toBe('Welcome to the test vault.');
  expect(context.selection.truncated).toBe(false);
  const read = await page.evaluate(() => window.agentTools.get('collabmd_read_document').execute({ path: 'README.md' }));
  expect(read.revision).toBe(context.localRevision);
  const edited = await page.evaluate(async ({ revision, selected }) => window.agentTools.get('collabmd_apply_text_edits').execute({
    path: 'README.md', revision, validate: true,
    replacements: [{ oldText: selected, newText: 'Welcome from the browser agent.' }],
  }), { revision: read.revision, selected: context.selection.text });
  expect(edited.validation.valid).toBe(true);
  await expect(page.locator('.cm-content')).toContainText('Welcome from the browser agent.');
  const stale = await page.evaluate(({ revision }) => window.agentTools.get('collabmd_apply_text_edits').execute({
    path: 'README.md', revision, replacements: [{ oldText: 'Welcome from the browser agent.', newText: 'stale' }],
  }), { revision: read.revision });
  expect(stale.code).toBe('AGENT_REVISION_CONFLICT');
  await expect(page.locator('.cm-content')).toContainText('Welcome from the browser agent.');
});
