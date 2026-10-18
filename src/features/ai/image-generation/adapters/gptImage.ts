import type { ImageAdapter, ImageQuality } from '../types.ts';
import { readImageResults } from '../results.ts';

const sizes = ['1024x1024', '1536x864', '864x1536', '2560x1440', '3840x2160'];
const extendedQualities: ImageQuality[] = ['low', 'medium', 'high', 'xhigh', 'max', 'auto'];
const standardQualities: ImageQuality[] = ['low', 'medium', 'high'];
const qualities = (modelId: string) => /^gpt-image-2\.5-(sunburst|flare)$/i.test(modelId) ? extendedQualities : standardQualities;

export const gptImage: ImageAdapter = {
  capabilities: model => ({
    sizes, exactSizeSupported: true, qualities: qualities(model.modelId), maxImages: 10,
    sizePattern: '^[1-9]\\d{1,3}x[1-9]\\d{1,3}$',
    sizeDescription: 'WIDTHxHEIGHT；两边均为 16 的倍数且不超过 3840；比例 1:3–3:1；总像素 655360–8294400。2560x1440 为实验尺寸，实际支持取决于接入服务。'
  }),
  validate(model) {
    const match = /^([1-9]\d{1,3})x([1-9]\d{1,3})$/.exec(model.size);
    const width = Number(match?.[1]);
    const height = Number(match?.[2]);
    const pixels = width * height;
    if (!match || width % 16 || height % 16 || Math.max(width, height) > 3840 || width / height < 1 / 3 || width / height > 3 || pixels < 655360 || pixels > 8294400) {
      throw new Error('GPT-Image size requires multiples of 16, edges <= 3840, ratio 1:3 to 3:1 and 655360 to 8294400 pixels.');
    }
    if (!qualities(model.modelId).includes(model.quality ?? 'high')) throw new Error('Unsupported GPT-Image quality.');
    if (!Number.isInteger(model.n ?? 1) || (model.n ?? 1) < 1 || (model.n ?? 1) > 10) throw new Error('Image count must be between 1 and 10; provider limits may be lower.');
  },
  buildRequest(model, prompt, reference): ReturnType<ImageAdapter['buildRequest']> {
    const fields = { model: model.modelId, prompt, size: model.size, quality: model.quality ?? 'high', n: model.n ?? 1, output_format: 'png' };
    if (!reference) return { operation: 'generations', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) };
    const [metadata, encoded] = reference.split(',');
    const mime = metadata.slice(5, metadata.indexOf(';'));
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.append(key, String(value));
    body.append('image', new Blob([bytes], { type: mime }), `reference.${mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1]}`);
    return { operation: 'edits', headers: {}, body };
  },
  readResults: data => readImageResults(data, 'data')
};