import type { ModelId } from './models.ts';

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

export function preprocess(rgba: Uint8ClampedArray, modelId: ModelId): Float32Array {
  const pixels = rgba.length / 4;
  const tensor = new Float32Array(pixels * 3);
  let scale = 255;
  if (modelId === 'u2netp') {
    scale = 1;
    for (let offset = 0; offset < rgba.length; offset += 4) {
      scale = Math.max(scale, rgba[offset], rgba[offset + 1], rgba[offset + 2]);
    }
  }
  for (let pixel = 0; pixel < pixels; pixel++) {
    for (let channel = 0; channel < 3; channel++) {
      tensor[channel * pixels + pixel] = modelId === 'modnet'
        ? (rgba[pixel * 4 + channel] / 255 - 0.5) / 0.5
        : (rgba[pixel * 4 + channel] / scale - MEAN[channel]) / STD[channel];
    }
  }
  return tensor;
}

export function halfToFloat(value: number): number {
  const sign = value & 0x8000 ? -1 : 1;
  const exponent = (value >> 10) & 31;
  const fraction = value & 1023;
  if (!exponent) return sign * 2 ** -14 * fraction / 1024;
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

export function createMask(data: Float32Array | Uint16Array, modelId: ModelId): Uint8ClampedArray<ArrayBuffer> {
  const values = data instanceof Uint16Array ? Float32Array.from(data, halfToFloat) : data;
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) throw new Error('Model returned a non-finite mask');
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  if (!values.length) throw new Error('Model returned an empty mask');
  const mask = new Uint8ClampedArray(values.length * 4);
  for (let index = 0; index < values.length; index++) {
    const probability = modelId === 'u2netp'
      ? (maximum > minimum ? (values[index] - minimum) / (maximum - minimum) : Math.max(0, Math.min(1, values[index])))
      : modelId === 'modnet' ? Math.max(0, Math.min(1, values[index])) : 1 / (1 + Math.exp(-values[index]));
    mask[index * 4] = mask[index * 4 + 1] = mask[index * 4 + 2] = probability * 255;
    mask[index * 4 + 3] = 255;
  }
  return mask;
}

export function applyAlpha(original: Uint8ClampedArray, mask: Uint8ClampedArray): void {
  if (original.length !== mask.length) throw new Error('Mask dimensions do not match image');
  for (let offset = 0; offset < original.length; offset += 4) {
    original[offset + 3] = Math.round(original[offset + 3] * mask[offset] / 255);
  }
}