import { expect, it, vi } from 'vitest';

import { PlantUmlPreviewHydrator } from '../../src/client/application/plantuml-preview-hydrator.js';

it('bounds PlantUML SVG revisions while retaining cached hits and deduplicating requests', async () => {
  const renderSvg = vi.fn(async (source) => `<svg xmlns="http://www.w3.org/2000/svg"><text>${source}</text></svg>`);
  const hydrator = new PlantUmlPreviewHydrator({ previewElement: null }, { renderClient: { renderSvg } });

  for (let index = 0; index <= 30; index += 1) {
    await hydrator.fetchSvg(`revision-${index}`);
  }
  expect(hydrator.svgCache.size).toBe(30);
  expect(hydrator.svgCache.has('revision-0')).toBe(false);
  expect(hydrator.svgCache.has('revision-30')).toBe(true);

  expect(await hydrator.fetchSvg('revision-30')).toContain('revision-30');
  expect(renderSvg).toHaveBeenCalledTimes(31);
  await hydrator.fetchSvg('revision-0');
  expect(renderSvg).toHaveBeenCalledTimes(32);

  const [first, second] = await Promise.all([hydrator.fetchSvg('next'), hydrator.fetchSvg('next')]);
  expect(first).toBe(second);
  expect(renderSvg).toHaveBeenCalledTimes(33);
  expect(hydrator.svgCache.size).toBe(30);
  expect(hydrator.svgInflightRequests.size).toBe(0);
  hydrator.destroy();
});
