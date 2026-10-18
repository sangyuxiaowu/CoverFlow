import { getModel, validateModel, type ModelId } from './models.ts';
import { readModel, readRuntime, RUNTIME_VERSION, saveRuntime } from './storage.ts';
import type { Progress, RuntimeFiles } from './types.ts';

export const RUNTIME_ASSETS = {
  script: 'ort.webgpu.bundle.min.mjs',
  loader: 'ort-wasm-simd-threaded.asyncify.mjs',
  wasm: 'ort-wasm-simd-threaded.asyncify.wasm'
} as const;
export const RUNTIME_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${RUNTIME_VERSION}/dist/`;

export async function download(url: string, maximum: number, signal: AbortSignal,
  onProgress?: (progress: Progress) => void): Promise<Blob> {
  const response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error(`Download HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length')) || undefined;
  if (total && total > maximum) {
    await response.body?.cancel();
    throw new Error('Download exceeds size limit');
  }
  if (!response.body) throw new Error('Download stream unavailable');
  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let loaded = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      loaded += chunk.value.byteLength;
      if (loaded > maximum) throw new Error('Download exceeds size limit');
      chunks.push(chunk.value.slice().buffer);
      onProgress?.({ stage: 'download', loaded, total });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  signal.throwIfAborted();
  if (!loaded) throw new Error('Downloaded file is empty');
  return new Blob(chunks);
}

export async function validateRuntime(files: RuntimeFiles): Promise<void> {
  const magic = new Uint8Array(await files.wasm.slice(0, 4).arrayBuffer());
  if (magic.join(',') !== '0,97,115,109') throw new Error('Invalid WASM binary');
  for (const file of [files.script, files.loader]) {
    const prefix = (await file.slice(0, 256).text()).trimStart();
    if (file.size < 1000 || /^</.test(prefix)) throw new Error('Invalid runtime JavaScript');
  }
}

export async function installRuntime(signal: AbortSignal, onProgress?: (progress: Progress) => void): Promise<void> {
  const files = {} as RuntimeFiles;
  for (const key of Object.keys(RUNTIME_ASSETS) as (keyof RuntimeFiles)[]) {
    onProgress?.({ stage: RUNTIME_ASSETS[key] });
    files[key] = await download(RUNTIME_BASE + RUNTIME_ASSETS[key], 80 * 1024 * 1024, signal,
      progress => onProgress?.({ ...progress, stage: RUNTIME_ASSETS[key] }));
  }
  await validateRuntime(files);
  signal.throwIfAborted();
  await saveRuntime(files);
}

export async function importRuntime(files: File[]): Promise<void> {
  const runtime = {} as RuntimeFiles;
  for (const key of Object.keys(RUNTIME_ASSETS) as (keyof RuntimeFiles)[]) {
    const file = files.find(item => item.name === RUNTIME_ASSETS[key]);
    if (!file) throw new Error(`Missing ${RUNTIME_ASSETS[key]}`);
    if (file.size > 80 * 1024 * 1024) throw new Error('Runtime file exceeds size limit');
    runtime[key] = file;
  }
  await validateRuntime(runtime);
  await saveRuntime(runtime);
}

export async function loadResources(id: ModelId, signal: AbortSignal): Promise<{ model: Blob; runtime: RuntimeFiles }> {
  const runtime = await readRuntime();
  if (!runtime) throw new Error('RUNTIME_MISSING');
  const stored = await readModel(id);
  let model = stored?.blob;
  if (!model && id === 'u2netp') {
    model = await download(`${import.meta.env.BASE_URL}models/u2netp.onnx`, 32 * 1024 * 1024, signal);
  }
  if (!model) throw new Error('MODEL_MISSING');
  await validateModel(id, model);
  signal.throwIfAborted();
  return { model, runtime };
}

export async function downloadModel(id: ModelId, signal: AbortSignal, onProgress?: (progress: Progress) => void): Promise<Blob> {
  const model = await download(getModel(id).url, 1024 * 1024 * 1024, signal, onProgress);
  await validateModel(id, model);
  return model;
}