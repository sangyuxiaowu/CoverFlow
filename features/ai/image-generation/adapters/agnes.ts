import type { ImageAdapter } from '../types.ts';
import { readImageResults } from '../results.ts';

export const AGNES_SIZES = ['1K', '2K', '3K', '4K'];
export const IMAGE_RATIOS = ['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9'];

export const agnes: ImageAdapter = {
  capabilities: () => ({
    sizes: AGNES_SIZES, exactSizeSupported: true, ratios: IMAGE_RATIOS,
    sizePattern: '^[1-9]\\d{1,3}x[1-9]\\d{1,3}$',
    sizeDescription: '档位尺寸可配 ratio；精确尺寸如 1024x768 不使用 ratio，服务商可能标准化不支持的尺寸。'
  }),
  validate(model) {
    if (!AGNES_SIZES.includes(model.size) && !/^[1-9]\d{1,3}x[1-9]\d{1,3}$/.test(model.size)) throw new Error('Invalid Agnes size.');
    if (!IMAGE_RATIOS.includes(model.ratio)) throw new Error('Invalid Agnes ratio.');
  },
  buildRequest(model, prompt, reference) {
    return {
      operation: 'generations', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model.modelId, prompt, size: model.size, ...(AGNES_SIZES.includes(model.size) ? { ratio: model.ratio } : {}), ...(reference ? { extra_body: { image: [reference], response_format: 'b64_json' } } : { return_base64: true }) })
    };
  },
  readResults: data => readImageResults(data, 'data')
};