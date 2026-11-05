import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCanvasBitmapSize } from './canvasSizing';

test('canvas backing bitmap scales independently from CSS coordinates and caps high-DPI work', () => {
  const size = calculateCanvasBitmapSize(1920, 1080, 2);
  assert.equal(size.pixelRatio, 1.5);
  assert.equal(size.width, 2880);
  assert.equal(size.height, 1620);
  assert.equal(size.width / size.pixelRatio, 1920);
  assert.equal(size.height / size.pixelRatio, 1080);
});

test('ultra-wide/fullscreen dimensions retain at least one backing pixel per CSS pixel', () => {
  const size = calculateCanvasBitmapSize(3840, 2160, 2);
  assert.equal(size.pixelRatio, 1);
  assert.equal(size.width, 3840);
  assert.equal(size.height, 2160);
});

test('canvas size calculation rejects invalid scale instead of silently masking it', () => {
  assert.throws(() => calculateCanvasBitmapSize(800, 600, 0), /devicePixelRatio/);
  assert.throws(() => calculateCanvasBitmapSize(Number.NaN, 600, 1), /CSS dimensions/);
});
