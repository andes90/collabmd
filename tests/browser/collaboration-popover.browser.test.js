import { afterEach, expect, it } from 'vitest';

import '../../src/client/styles/base.css';
import '../../src/client/styles/style.css';

afterEach(() => {
  document.body.innerHTML = '';
});

it('keeps the native chat popover heading on the themed text color', () => {
  document.body.innerHTML = `
    <section class="collaboration-popover chat-panel" popover="manual">
      <h2 class="chat-panel-title">Team chat</h2>
    </section>
  `;
  const panel = document.querySelector('.chat-panel');
  const heading = document.querySelector('.chat-panel-title');

  panel.showPopover();

  expect(getComputedStyle(heading).color).toBe(getComputedStyle(document.body).color);
});

it('keeps inherited presence popover text on the themed text color', () => {
  document.body.innerHTML = `
    <section class="collaboration-popover presence-panel" popover="manual">
      <h2 class="presence-panel-title">Online now</h2>
      <span class="presence-panel-user-name">Dodo</span>
    </section>
  `;
  const panel = document.querySelector('.presence-panel');
  const expectedColor = getComputedStyle(document.body).color;

  panel.showPopover();

  expect(getComputedStyle(document.querySelector('.presence-panel-title')).color).toBe(expectedColor);
  expect(getComputedStyle(document.querySelector('.presence-panel-user-name')).color).toBe(expectedColor);
});
