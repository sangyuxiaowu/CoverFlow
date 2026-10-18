import type { ImageResult } from './results.ts';

export type ImageAdapterId = 'kolors' | 'agnes' | 'gpt-image';
export type ImageQuality = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'auto';

export interface ImageModelConfig {
  id: string;
  adapter: ImageAdapterId;
  label: string;
  description: string;
  modelId: string;
  version?: string;
  releasedAt?: string;
  endpointId: string;
  requestUrl: string;
  enabled: boolean;
  size: string;
  ratio: string;
  steps: number;
  guidance: number;
  quality?: ImageQuality;
  n?: number;
  timeoutSeconds?: number;
}

export type ImagePromptConfig = Pick<ImageModelConfig, 'id' | 'label' | 'adapter' | 'modelId' | 'version' | 'releasedAt' | 'timeoutSeconds' | 'description' | 'size' | 'ratio' | 'quality' | 'n'>;

export interface GenerateImageInput {
  modelConfigId: string;
  prompt: string;
  size?: string;
  ratio?: string;
  quality?: ImageQuality;
  n?: number;
}

export interface ImageCapabilities {
  sizes: string[];
  sizeDescription: string;
  sizePattern?: string;
  exactSizeSupported?: boolean;
  ratios?: string[];
  qualities?: ImageQuality[];
  maxImages?: number;
}

export interface ImageAdapter {
  capabilities: (model: Pick<ImageModelConfig, 'modelId'>) => ImageCapabilities;
  validate: (model: ImageModelConfig) => void;
  buildRequest: (model: ImageModelConfig, prompt: string, reference?: string) => {
    operation: 'generations' | 'edits';
    headers: Record<string, string>;
    body: string | FormData;
  };
  readResults: (data: unknown) => ImageResult[];
}