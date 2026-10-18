import { describe, expect, it } from 'vitest';
import { applyAlpha, createMask, halfToFloat, preprocess } from './processing.ts';

describe('background-removal pixels', () => {
  it('normalizes RGB into planar ImageNet channels without reading alpha', () => {
    const values = preprocess(new Uint8ClampedArray([255, 0, 0, 0, 0, 255, 0, 255]), 'birefnet');
    expect(values).toHaveLength(6);
    expect(values[0]).toBeCloseTo((1 - 0.485) / 0.229);
    expect(values[1]).toBeCloseTo(-0.485 / 0.229);
    expect(values[3]).toBeCloseTo((1 - 0.456) / 0.224);
  });
  it('normalizes U2NetP using maximum RGB, including a black input', () => {
    expect(preprocess(new Uint8ClampedArray([128, 0, 0, 255]), 'u2netp')[0]).toBeCloseTo((1 - 0.485) / 0.229);
    expect(Number.isFinite(preprocess(new Uint8ClampedArray(4), 'u2netp')[0])).toBe(true);
  });
  it('normalizes U2Net masks and applies sigmoid to BiRefNet logits', () => {
    expect(Array.from(createMask(new Float32Array([0.2, 0.8]), 'u2netp'))).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
    expect(createMask(new Float32Array([0]), 'birefnet')[0]).toBe(128);
    expect(() => createMask(new Float32Array([NaN]), 'birefnet')).toThrow('non-finite');
    expect(() => createMask(new Float32Array(), 'u2netp')).toThrow('empty');
  });
  it('decodes fp16 values and preserves existing transparency', () => {
    expect(halfToFloat(0x3c00)).toBe(1);
    expect(halfToFloat(0xbc00)).toBe(-1);
    expect(halfToFloat(0)).toBe(0);
    const pixels = new Uint8ClampedArray([10, 20, 30, 128, 40, 50, 60, 0]);
    applyAlpha(pixels, new Uint8ClampedArray([128, 128, 128, 255, 255, 255, 255, 255]));
    expect(Array.from(pixels)).toEqual([10, 20, 30, 64, 40, 50, 60, 0]);
  });
});