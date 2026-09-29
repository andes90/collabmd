import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampImageLightboxOffset,
  clampImageLightboxScale,
} from '../../src/client/presentation/image-lightbox-controller.js';

test('clampImageLightboxScale enforces supported zoom bounds', () => {
  assert.equal(clampImageLightboxScale(0.25), 1);
  assert.equal(clampImageLightboxScale(2.5), 2.5);
  assert.equal(clampImageLightboxScale(9), 6);
  assert.equal(clampImageLightboxScale(Number.NaN), 1);
});

test('clampImageLightboxOffset keeps panning inside the visible viewport bounds', () => {
  assert.equal(clampImageLightboxOffset(180, {
    contentSize: 400,
    scale: 2,
    viewportSize: 500,
  }), 150);

  assert.equal(clampImageLightboxOffset(-220, {
    contentSize: 400,
    scale: 2,
    viewportSize: 500,
  }), -150);

  assert.equal(clampImageLightboxOffset(40, {
    contentSize: 300,
    scale: 1,
    viewportSize: 600,
  }), 0);
});
