// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { samplePageColor } from './pageColorSampler.ts';

it('maps viewport coordinates to snapshot pixels and rejects outside points', () => {
  const getImageData = vi.fn(() => ({ data: new Uint8ClampedArray([10, 20, 30, 255]) }));
  const canvas = document.createElement('canvas');
  canvas.width = 200;
  canvas.height = 100;
  vi.spyOn(canvas, 'getContext').mockReturnValue({ getImageData } as unknown as CanvasRenderingContext2D);
  const snapshot = { canvas, rect: new DOMRect(50, 100, 400, 200) };
  expect(samplePageColor(snapshot, 150, 150)).toEqual([10, 20, 30, 255]);
  expect(getImageData).toHaveBeenCalledWith(50, 25, 1, 1);
  expect(samplePageColor(snapshot, 450, 150)).toBeNull();
});

it('ignores pixels that the browser refuses to read', () => {
  const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getContext').mockReturnValue({ getImageData: () => { throw new Error('tainted'); } } as unknown as CanvasRenderingContext2D);
  expect(samplePageColor({ canvas, rect: new DOMRect(0, 0, 10, 10) }, 1, 1)).toBeNull();
});