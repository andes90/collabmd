import { afterEach, expect, it, vi } from 'vitest';

import { pickFiles } from '../../src/client/browser-utils.js';

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('keeps the file picker pending when focus returns before file selection is ready', async () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
  const onSelection = vi.fn();
  const selection = pickFiles({ accept: '.pdf', multiple: true }).then(onSelection);
  const input = document.querySelector('input[type="file"]');

  window.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(1000);

  expect(onSelection).not.toHaveBeenCalled();
  expect(input.isConnected).toBe(true);
  const file = new File(['%PDF-1.7\n%%EOF\n'], 'guide.pdf', { type: 'application/pdf' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change'));
  await selection;

  expect(onSelection).toHaveBeenCalledExactlyOnceWith([file]);
  expect(input.isConnected).toBe(false);
});

it('resolves an empty selection and removes the file input on native cancellation', async () => {
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
  const selection = pickFiles();
  const input = document.querySelector('input[type="file"]');

  input.dispatchEvent(new Event('cancel'));

  expect(await selection).toEqual([]);
  expect(input.isConnected).toBe(false);
});
