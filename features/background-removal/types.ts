import type { ModelId } from './models.ts';

export type DeviceMode = 'auto' | 'webgpu' | 'wasm';
export type Provider = 'webgpu' | 'wasm';
export interface RemovalSettings { modelId: ModelId; device: DeviceMode }
export interface StoredModel { blob: Blob; name: string; importedAt: number; provider: Provider }
export interface RuntimeFiles { script: Blob; loader: Blob; wasm: Blob }
export interface Progress { stage: string; loaded?: number; total?: number }
export interface RemovalResult {
  layerId: string;
  originalContent: string;
  content: string;
  keepOriginal: boolean;
}
export interface WorkerRequest {
  modelId: ModelId;
  model: Blob;
  runtime: RuntimeFiles;
  device: DeviceMode;
  image: Blob;
}
export type WorkerResponse =
  | { type: 'progress'; stage: string }
  | { type: 'result'; blob: Blob; provider: Provider }
  | { type: 'error'; message: string };

export interface OrtTensor {
  data: Float32Array | Uint16Array;
  dims: readonly number[];
  type: string;
  dispose(): void;
}
export interface OrtSession {
  inputNames: readonly string[];
  outputNames: readonly string[];
  inputMetadata: readonly { type: string; shape: readonly (string | number)[] }[];
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
  release(): Promise<void>;
}
export interface OrtRuntime {
  env: { wasm: { numThreads: number; proxy: boolean; wasmPaths: { mjs: string; wasm: string } } };
  Tensor: new (type: string, values: Float32Array | Uint16Array, dims: number[]) => OrtTensor;
  InferenceSession: { create(bytes: Uint8Array, options: { executionProviders: Provider[] }): Promise<OrtSession> };
}