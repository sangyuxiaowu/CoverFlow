import { generateId } from '../../../utils/helpers.ts';
import type { ImageAdapter, ImageAdapterId, ImageModelConfig } from './types.ts';
import { kolors } from './adapters/kolors.ts';
import { agnes } from './adapters/agnes.ts';
import { gptImage } from './adapters/gptImage.ts';

export { KOLORS_SIZES } from './adapters/kolors.ts';
export { AGNES_SIZES, IMAGE_RATIOS } from './adapters/agnes.ts';

export const DEFAULT_IMAGE_TIMEOUT_SECONDS = 180;

const adapters: Record<ImageAdapterId, ImageAdapter> = { kolors, agnes, 'gpt-image': gptImage };

export function getImageAdapter(adapter: ImageAdapterId): ImageAdapter {
  if (!Object.hasOwn(adapters, adapter)) throw new Error('Invalid image adapter.');
  return adapters[adapter];
}

export function imageCapabilities(model: Pick<ImageModelConfig, 'adapter' | 'modelId'>) {
  return getImageAdapter(model.adapter).capabilities(model);
}

export const IMAGE_MODEL_PRESETS = [
  { id: 'kolors', adapter: 'kolors', label: 'Kolors', modelId: 'Kwai-Kolors/Kolors', version: '', releasedAt: '2024-07-06', timeoutSeconds: 180, size: '1024x1024', description: '快手 Kolors 团队开发的基于潜在扩散的大规模文本到图像生成模型' },
  { id: 'agnes', adapter: 'agnes', label: 'Agnes Image 2.5 Flash', modelId: 'agnes-image-2.5-flash', version: '2.5 Flash', releasedAt: '2026-07-13', timeoutSeconds: 180, size: '1K', description: 'Agnes AI 最新一代图像生成模型，适用于创意设计、营销内容、产品可视化和社交媒体素材生成。' },
  { id: 'gpt-image-2.5-sunburst', adapter: 'gpt-image', label: 'GPT-Image-2.5-Sunburst', modelId: 'gpt-image-2.5-sunburst', version: '2.5 Sunburst', releasedAt: '2026-09-08', timeoutSeconds: 600, size: '1024x1024', description: '图像生成和编辑能力最强的模型，尤其适用于对编辑精度要求最高的场景。' },
  { id: 'gpt-image-2.5-flare', adapter: 'gpt-image', label: 'GPT-Image-2.5-Flare', modelId: 'gpt-image-2.5-flare', version: '2.5 Flare', releasedAt: '2026-09-08', timeoutSeconds: 300, size: '1024x1024', description: '用于高质量、日常图像生成的最快模型。' },
  { id: 'gpt-image-2', adapter: 'gpt-image', label: 'GPT-Image-2', modelId: 'gpt-image-2', version: '2', releasedAt: '2026-04-21', timeoutSeconds: 600, size: '1024x1024', description: '适合高分辨率和 4K 生成，支持改进的图像编辑、宽纵横比和高级人脸保留，实现逼真、一致的结果。' }
] as const satisfies readonly { id: string; adapter: ImageAdapterId; label: string; modelId: string; version: string; releasedAt: string; timeoutSeconds: number; size: string; description: string }[];

export type ImagePresetId = typeof IMAGE_MODEL_PRESETS[number]['id'];

export function imageTimeoutSeconds(model: Pick<ImageModelConfig, 'adapter' | 'modelId' | 'timeoutSeconds'>): number {
  return model.timeoutSeconds ?? IMAGE_MODEL_PRESETS.find(preset => preset.adapter === model.adapter && preset.modelId === model.modelId)?.timeoutSeconds ?? DEFAULT_IMAGE_TIMEOUT_SECONDS;
}

export function createImageModel(presetId: ImagePresetId): ImageModelConfig {
  const preset = IMAGE_MODEL_PRESETS.find(item => item.id === presetId);
  if (!preset) throw new Error('Unknown image model preset.');
  return {
    id: generateId(), adapter: preset.adapter, label: preset.label, description: preset.description, modelId: preset.modelId,
    version: preset.version, releasedAt: preset.releasedAt,
    endpointId: '', requestUrl: '', enabled: false, size: preset.size, ratio: '1:1', steps: 20, guidance: 7.5,
    ...(preset.adapter === 'gpt-image' ? { quality: 'high' as const, n: 1 } : {}),
    timeoutSeconds: preset.timeoutSeconds
  };
}

export function imageModelToolId(model: Pick<ImageModelConfig, 'id'>): string {
  return model.id.replaceAll('-', '').slice(0, 9);
}