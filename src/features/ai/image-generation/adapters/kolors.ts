import type { ImageAdapter } from '../types.ts';
import { readImageResults } from '../results.ts';

export const KOLORS_SIZES = ['1024x1024', '960x1280', '768x1024', '720x1440', '720x1280'];

export const kolors: ImageAdapter = {
  capabilities: () => ({ sizes: KOLORS_SIZES, sizeDescription: '固定输出尺寸。' }),
  validate(model) {
    if (!KOLORS_SIZES.includes(model.size)) throw new Error(`Unsupported Kolors size "${model.size}". Set size to one of: ${KOLORS_SIZES.join(', ')}.`);
    if (!Number.isInteger(model.steps) || model.steps < 1 || model.steps > 100) throw new Error('Kolors steps must be between 1 and 100.');
    if (!Number.isFinite(model.guidance) || model.guidance < 0 || model.guidance > 20) throw new Error('Kolors guidance must be between 0 and 20.');
  },
  buildRequest(model, prompt, reference) {
    return {
      operation: 'generations', headers: { 'Content-Type': 'application/json', 'X-Enable-Watermark': '0' },
      body: JSON.stringify({ model: model.modelId, prompt, image_size: model.size, num_inference_steps: model.steps, guidance_scale: model.guidance, ...(reference ? { image: reference } : {}) })
    };
  },
  readResults: data => readImageResults(data, 'images')
};