import { afterEach, expect, it } from 'vitest';

import '../../src/client/styles/style.css';
import '../../src/client/styles/features/preview-markdown.css';
import { uiFeatureShellMethods } from '../../src/client/application/app-shell/ui-feature-shell.js';

afterEach(() => {
  document.body.innerHTML = '';
});

it('keeps the copy button at the code container top right while long code scrolls', async () => {
  document.body.innerHTML = '<div class="preview-content" style="width: 320px"><pre><code></code></pre></div>';
  const pre = document.querySelector('pre');
  const code = pre.querySelector('code');
  code.textContent = 'long code line '.repeat(100);
  const context = {};
  uiFeatureShellMethods.attachPreviewCodeCopyButton.call(context, pre);
  const button = pre.querySelector('button');
  const before = button.getBoundingClientRect();
  const container = pre.getBoundingClientRect();
  expect(container.right - before.right).toBeGreaterThan(0);
  expect(container.right - before.right).toBeLessThan(16);
  expect(before.top - container.top).toBeGreaterThan(0);
  expect(before.top - container.top).toBeLessThan(16);
  expect(code.scrollWidth).toBeGreaterThan(code.clientWidth);

  for (const scrollLeft of [200, code.scrollWidth]) {
    code.scrollLeft = scrollLeft;
    await new Promise(requestAnimationFrame);
    expect(code.scrollLeft).toBeGreaterThan(0);
    expect(button.getBoundingClientRect().right).toBe(before.right);
    expect(button.getBoundingClientRect().top).toBe(before.top);
    expect(pre.scrollWidth).toBe(pre.clientWidth);
  }
});
