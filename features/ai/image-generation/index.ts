import type { AiConfig } from '../types.ts';
import type { GenerateImageInput, ImageModelConfig } from './types.ts';
import { getImageAdapter, imageCapabilities, imageTimeoutSeconds } from './models.ts';
import { downloadImage, validateImageDownloadUrl } from './results.ts';

export * from './types.ts';
export * from './models.ts';

export function validateImageUrl(value: string): URL {
  const url = validateImageDownloadUrl(value);
  if (url.search) throw new Error('Image URL cannot contain query parameters.');
  return url;
}

export function imageRequestUrl(base: string, override = '', operation: 'generations' | 'edits' = 'generations'): string {
  if (override.trim()) {
    const url = validateImageUrl(override.trim());
    if (operation === 'edits') {
      if (!/\/images\/(generations|edits)\/?$/.test(url.pathname)) throw new Error('Reference generation requires a request URL ending in /images/generations or /images/edits.');
      url.pathname = url.pathname.replace(/\/images\/(generations|edits)\/?$/, '/images/edits');
    } else if (/\/images\/edits\/?$/.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/images\/edits\/?$/, '/images/generations');
    }
    return url.href;
  }
  const url = validateImageUrl(base);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}${/\/v\d+$/.test(url.pathname.replace(/\/+$/, '')) ? '' : '/v1'}/images/${operation}`;
  return url.href;
}

export function validateImageModel(model: ImageModelConfig, config: Pick<AiConfig, 'endpoints'>): void {
  if (!model.id || !model.label.trim() || !model.modelId.trim()) throw new Error('Invalid image model.');
  if (typeof model.enabled !== 'boolean' || typeof model.description !== 'string') throw new Error('Invalid image model settings.');
  if (model.version !== undefined && (typeof model.version !== 'string' || model.version.length > 100)) throw new Error('Image model version must contain at most 100 characters.');
  if (model.releasedAt !== undefined) {
    const date = model.releasedAt;
    if (typeof date !== 'string' || (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date))) throw new Error('Image model release date must be a valid YYYY-MM-DD date, or empty when unknown.');
  }
  if (model.timeoutSeconds !== undefined && (!Number.isInteger(model.timeoutSeconds) || model.timeoutSeconds < 60 || model.timeoutSeconds > 600)) throw new Error('Image timeout must be between 60 and 600 seconds.');
  const adapter = getImageAdapter(model.adapter);
  const capabilities = adapter.capabilities(model);
  if (!capabilities.qualities && model.quality !== undefined) throw new Error('quality is not supported by this image model.');
  if (!capabilities.maxImages && model.n !== undefined) throw new Error('n is not supported by this image model.');
  adapter.validate(model);
  const endpoint = config.endpoints.find(item => item.id === model.endpointId);
  if (model.requestUrl.trim()) {
    const target = validateImageUrl(model.requestUrl);
    if (endpoint && target.origin !== validateImageUrl(endpoint.endpoint).origin) throw new Error('Image request URL must share the credential endpoint origin. Create a separate endpoint to authorize another origin.');
  }
  if (model.enabled) {
    if (!endpoint) throw new Error('Select an existing endpoint before enabling an image model.');
    imageRequestUrl(endpoint.endpoint, model.requestUrl);
  }
}

export function availableImageModels(config: AiConfig): ImageModelConfig[] {
  return (config.imageModels || []).filter(model => {
    if (!model.enabled) return false;
    try { validateImageModel(model, config); return true; } catch { return false; }
  });
}

export async function generateImages(config: AiConfig, input: GenerateImageInput, signal: AbortSignal, reference?: string): Promise<Blob[]> {
  signal.throwIfAborted();
  const model = availableImageModels(config).find(item => item.id === input.modelConfigId);
  if (!model) throw new Error('Image model is disabled, unavailable or not found.');
  signal = AbortSignal.any([signal, AbortSignal.timeout(imageTimeoutSeconds(model) * 1000)]);
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 10000) throw new Error('Image prompt must contain 1 to 10000 characters.');
  if (reference && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(reference)) throw new Error('Reference must be a local PNG, JPEG or WebP image.');
  const selected = { ...model, size: input.size ?? model.size, ratio: input.ratio ?? model.ratio, quality: input.quality ?? model.quality, n: input.n ?? model.n };
  const capabilities = imageCapabilities(selected);
  if (input.ratio !== undefined && !capabilities.ratios?.length) throw new Error('ratio is not supported by this image model.');
  if (input.ratio !== undefined && !capabilities.sizes.includes(selected.size)) throw new Error('ratio is only supported with Agnes tier sizes.');
  validateImageModel(selected, config);
  const endpoint = config.endpoints.find(item => item.id === model.endpointId)!;
  const adapter = getImageAdapter(model.adapter);
  const request = adapter.buildRequest(selected, input.prompt.trim(), reference);
  const headers = { ...request.headers, ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}) };
  const response = await fetch(imageRequestUrl(endpoint.endpoint, model.requestUrl, request.operation), { method: 'POST', headers, body: request.body, signal });
  if (!response.ok) throw new Error(`Image generation failed (HTTP ${response.status}). Do not automatically retry: this request may have been billed.`);
  const items = adapter.readResults(await response.json());
  if (!items.length) throw new Error('The image provider returned no image. Do not automatically retry.');
  if (items.length > (capabilities.maxImages ?? 1)) throw new Error('The image provider returned too many images. Do not automatically retry.');
  const images: Blob[] = [];
  for (const item of items) images.push(await downloadImage(item, signal));
  return images;
}