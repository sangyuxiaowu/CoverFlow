import type { AiConfig, ImageAdapterId, ImageModelConfig } from '../types.ts';
import { generateId } from '../../../utils/helpers.ts';

export const KOLORS_SIZES = ['1024x1024', '960x1280', '768x1024', '720x1440', '720x1280'];
export const AGNES_SIZES = ['1K', '2K', '3K', '4K'];
export const IMAGE_RATIOS = ['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9'];
export const DEFAULT_TEXT_IMAGE_PROMPT = `建议使用描述为：[主体] + [场景 / 环境] + [风格] + [光照] + [构图] + [质量要求]
例如：日出时分薄雾峡谷上方的发光浮空城市，电影级写实风格，广角构图，丰富的建筑细节，柔和的金色光线，高视觉密度`;
export const DEFAULT_REFERENCE_IMAGE_PROMPT = `建议使用描述为：[改变要求] + [新风格 / 场景] + [需要添加或移除的元素] + [需要保留的元素]
例如：将白天街道场景改为电影级赛博朋克夜景，添加霓虹招牌和湿滑路面倒影，同时保留原始街道布局、相机角度和主要建筑形状。`;
export const DEFAULT_IMAGE_TIMEOUT_SECONDS = 180;

export function imageModelToolId(model: Pick<ImageModelConfig, 'id'>): string {
  return model.id.replaceAll('-', '').slice(0, 9);
}

export function createImageModel(adapter: ImageAdapterId): ImageModelConfig {
  const kolors = adapter === 'kolors';
  return {
    id: generateId(), adapter, label: kolors ? 'Kolors' : 'Agnes Image 2.5 Flash',
    description: kolors ? '通用图像生成，支持文生图和单图参考；固定尺寸。' : 'Agnes AI 最新一代图像生成模型，高信息密度图像生成、编辑时保持原构图。适用于创意设计、营销内容、产品可视化和社交媒体素材生成。',
    modelId: kolors ? 'Kwai-Kolors/Kolors' : 'agnes-image-2.5-flash',
    endpointId: '', requestUrl: '', enabled: false,
    size: kolors ? '1024x1024' : '1K', ratio: '1:1', steps: 20, guidance: 7.5,
    timeoutSeconds: DEFAULT_IMAGE_TIMEOUT_SECONDS,
    textPromptDescription: DEFAULT_TEXT_IMAGE_PROMPT,
    referencePromptDescription: DEFAULT_REFERENCE_IMAGE_PROMPT
  };
}

function validateImageDownloadUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Image requests require HTTPS, or HTTP on localhost.');
  if (url.username || url.password || url.hash) throw new Error('Image URL cannot contain credentials or fragments.');
  return url;
}

export function validateImageUrl(value: string): URL {
  const url = validateImageDownloadUrl(value);
  if (url.search) throw new Error('Image URL cannot contain query parameters.');
  return url;
}

export function imageRequestUrl(base: string, override = ''): string {
  if (override.trim()) return validateImageUrl(override.trim()).href;
  const url = validateImageUrl(base);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}${/\/v\d+$/.test(url.pathname.replace(/\/+$/, '')) ? '' : '/v1'}/images/generations`;
  return url.href;
}

export function validateImageModel(model: ImageModelConfig, config: Pick<AiConfig, 'endpoints'>): void {
  if (!model.id || !model.label.trim() || !model.modelId.trim() || !['kolors', 'agnes'].includes(model.adapter)) throw new Error('Invalid image model.');
  if (typeof model.enabled !== 'boolean' || typeof model.description !== 'string') throw new Error('Invalid image model settings.');
  if (model.timeoutSeconds !== undefined && (!Number.isInteger(model.timeoutSeconds) || model.timeoutSeconds < 60 || model.timeoutSeconds > 600)) throw new Error('Image timeout must be between 60 and 600 seconds.');
  for (const value of [model.textPromptDescription, model.referencePromptDescription]) {
    if (value !== undefined && (typeof value !== 'string' || !value.trim() || value.length > 10000)) throw new Error('Image prompt description must contain 1 to 10000 characters.');
  }
  if (model.adapter === 'kolors') {
    if (!KOLORS_SIZES.includes(model.size)) throw new Error('Unsupported Kolors size.');
    if (!Number.isInteger(model.steps) || model.steps < 1 || model.steps > 100) throw new Error('Kolors steps must be between 1 and 100.');
    if (!Number.isFinite(model.guidance) || model.guidance < 0 || model.guidance > 20) throw new Error('Kolors guidance must be between 0 and 20.');
  } else {
    if (!AGNES_SIZES.includes(model.size) && !/^[1-9]\d{1,3}x[1-9]\d{1,3}$/.test(model.size)) throw new Error('Invalid Agnes size.');
    if (!IMAGE_RATIOS.includes(model.ratio)) throw new Error('Invalid Agnes ratio.');
  }
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

export interface GenerateImageInput {
  modelConfigId: string;
  prompt: string;
  size?: string;
  ratio?: string;
}

async function normalizeGeneratedImage(blob: Blob): Promise<Blob> {
  if (!blob.size) throw new Error('Generated image is empty. Do not regenerate automatically.');
  if (blob.size > 25 * 1024 * 1024) throw new Error('Generated image exceeds 25 MB.');
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = [82, 73, 70, 70].every((value, index) => bytes[index] === value)
    && [87, 69, 66, 80].every((value, index) => bytes[index + 8] === value);
  const mime = png ? 'image/png' : jpeg ? 'image/jpeg' : webp ? 'image/webp' : '';
  if (!mime) throw new Error(`Generated image data is not PNG, JPEG or WebP (reported Content-Type: ${blob.type || 'missing'}). Do not regenerate automatically.`);
  return blob.type === mime ? blob : blob.slice(0, blob.size, mime);
}

export async function generateImage(config: AiConfig, input: GenerateImageInput, signal: AbortSignal, reference?: string): Promise<Blob> {
  signal.throwIfAborted();
  const model = availableImageModels(config).find(item => item.id === input.modelConfigId);
  if (!model) throw new Error('Image model is disabled, unavailable or not found.');
  signal = AbortSignal.any([signal, AbortSignal.timeout((model.timeoutSeconds ?? DEFAULT_IMAGE_TIMEOUT_SECONDS) * 1000)]);
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 10000) throw new Error('Image prompt must contain 1 to 10000 characters.');
  if (reference && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(reference)) throw new Error('Reference must be a local PNG, JPEG or WebP image.');
  const selected = { ...model, size: input.size ?? model.size, ratio: input.ratio ?? model.ratio };
  if (input.ratio !== undefined && (model.adapter !== 'agnes' || !AGNES_SIZES.includes(selected.size))) throw new Error('ratio is only supported with Agnes tier sizes.');
  validateImageModel(selected, config);
  const endpoint = config.endpoints.find(item => item.id === model.endpointId)!;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}) };
  const body: Record<string, unknown> = { model: model.modelId, prompt: input.prompt.trim() };
  if (model.adapter === 'kolors') {
    headers['X-Enable-Watermark'] = '0';
    Object.assign(body, { image_size: selected.size, num_inference_steps: model.steps, guidance_scale: model.guidance, ...(reference ? { image: reference } : {}) });
  } else {
    Object.assign(body, { size: selected.size, ...(AGNES_SIZES.includes(selected.size) ? { ratio: selected.ratio } : {}), ...(reference ? { extra_body: { image: [reference], response_format: 'b64_json' } } : { return_base64: true }) });
  }
  const response = await fetch(imageRequestUrl(endpoint.endpoint, model.requestUrl), { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!response.ok) throw new Error(`Image generation failed (HTTP ${response.status}). Do not automatically retry: this request may have been billed.`);
  const data = await response.json();
  const item = model.adapter === 'kolors' ? data?.images?.[0] : data?.data?.[0];
  let blob: Blob;
  if (typeof item?.b64_json === 'string' && item.b64_json.length) {
    if (item.b64_json.length > 35 * 1024 * 1024) throw new Error('Generated image exceeds 25 MB.');
    const bytes = Uint8Array.from(atob(item.b64_json), character => character.charCodeAt(0));
    blob = new Blob([bytes]);
  } else if (typeof item?.url === 'string') {
    const download = await fetch(validateImageDownloadUrl(item.url), { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!download.ok) throw new Error(`Generated image download failed (HTTP ${download.status}). Do not regenerate automatically.`);
    if (Number(download.headers.get('content-length')) > 25 * 1024 * 1024) throw new Error('Generated image exceeds 25 MB.');
    blob = await download.blob();
  } else throw new Error('The image provider returned no image. Do not automatically retry.');
  signal.throwIfAborted();
  const image = await normalizeGeneratedImage(blob);
  signal.throwIfAborted();
  return image;
}