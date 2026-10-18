import { loadResources } from './resources.ts';
import { readRuntime, readSettings, saveModel } from './storage.ts';
import { validateModel, type ModelId } from './models.ts';
import type { DeviceMode, Progress, Provider, RuntimeFiles, WorkerRequest, WorkerResponse } from './types.ts';

interface RunOptions {
  signal: AbortSignal;
  onProgress?: (progress: Progress) => void;
}

interface RemovalOptions extends RunOptions {
  modelId?: ModelId;
  device?: DeviceMode;
}

export function runWorker(request: WorkerRequest, options: RunOptions): Promise<{ blob: Blob; provider: Provider }> {
  options.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./inference.worker.ts', import.meta.url), { type: 'module' });
    const finish = (error?: unknown, result?: { blob: Blob; provider: Provider }) => {
      clearTimeout(timer);
      options.signal.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error);
      else if (result) resolve(result);
    };
    const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('Inference timed out (10 minutes)')), 600_000);
    options.signal.addEventListener('abort', abort, { once: true });
    worker.onerror = event => { event.preventDefault(); finish(new Error(event.message || 'Inference worker failed')); };
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'progress') options.onProgress?.({ stage: message.stage });
      else if (message.type === 'error') finish(new Error(message.message));
      else finish(undefined, message);
    };
    try { worker.postMessage(request); } catch (error) { finish(error); }
  });
}

export async function removeBackground(image: Blob, options: RemovalOptions): Promise<{ blob: Blob; provider: Provider; modelId: ModelId }> {
  const defaults = options.modelId && options.device ? { modelId: options.modelId, device: options.device } : await readSettings();
  const settings = { modelId: options.modelId ?? defaults.modelId, device: options.device ?? defaults.device };
  const resources = await loadResources(settings.modelId, options.signal);
  const result = await runWorker({ ...resources, ...settings, image }, options);
  return { ...result, modelId: settings.modelId };
}

export async function verifyModel(modelId: ModelId, model: Blob, device: DeviceMode, options: RunOptions,
  runtimeOverride?: RuntimeFiles): Promise<Provider> {
  await validateModel(modelId, model);
  const runtime = runtimeOverride || await readRuntime();
  if (!runtime) throw new Error('RUNTIME_MISSING');
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable');
  context.fillStyle = '#808080';
  context.fillRect(0, 0, 32, 32);
  const image = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob =>
    blob ? resolve(blob) : reject(new Error('Image encoding failed')), 'image/png'));
  return (await runWorker({ modelId, model, runtime, device, image }, options)).provider;
}

export async function installModel(modelId: ModelId, blob: Blob, name: string, device: DeviceMode, options: RunOptions): Promise<void> {
  const provider = await verifyModel(modelId, blob, device, options);
  options.signal.throwIfAborted();
  await saveModel(modelId, { blob, name, importedAt: Date.now(), provider });
}

export function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}