import assert from 'node:assert/strict';
import test from 'node:test';

import { VideoEmbedController } from '../../src/client/presentation/video-embed-controller.js';

test('VideoEmbedController reattaches and positions a literal key with selector characters', () => {
  const key = 'video"].mp4#0';
  const placeholder = {
    classList: { add() {} },
    dataset: { videoEmbedKey: key },
    offsetHeight: 200,
    offsetLeft: 10,
    offsetTop: 20,
    offsetWidth: 400,
    style: {},
  };
  const wrapper = { style: {} };
  const controller = new VideoEmbedController({
    previewElement: {
      querySelectorAll(selector) {
        assert.equal(selector, '.video-embed-placeholder[data-video-embed-key]');
        return [{ dataset: { videoEmbedKey: 'other' } }, placeholder];
      },
    },
  });
  controller._ensureOverlayRoot = () => ({ appendChild(node) { assert.equal(node, wrapper); } });
  const entry = { aspectRatio: 2, key, wrapper };
  controller._attachWrapper(entry);
  controller._syncEntryLayout(entry);

  assert.equal(entry.placeholder, placeholder);
  assert.equal(placeholder.dataset.videoEmbedHydrated, 'true');
  assert.equal(wrapper.style.top, '20px');
  assert.equal(wrapper.style.width, '400px');
});
