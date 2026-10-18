import type { WorkspaceBridge } from '../types.ts';
import { choice, record, safeImage, text } from './validation.ts';
import { blobDataUrl, removeBackground } from '../../background-removal/index.ts';
import { download, installRuntime } from '../../background-removal/resources.ts';
import { readModel, readRuntime } from '../../background-removal/storage.ts';
import { applyRemovalResult } from '../../background-removal/layerResult.ts';
import { generateId } from '../../../utils/helpers.ts';

function target(bridge: WorkspaceBridge, projectId: string, layerId: string, originalContent?: string) {
  const project = bridge.getProject();
  if (!project || project.id !== projectId) throw new Error('Active project changed or is not open. Read get_context again.');
  const layer = project.layers.find(item => item.id === layerId);
  if (!layer || layer.type !== 'image') throw new Error('Target must be an existing image layer.');
  if (layer.locked || project.layers.find(item => item.id === layer.parentId)?.locked) throw new Error('Unlock the image layer and its group before background removal.');
  if (layer.backgroundRemoved) throw new Error('Background already removed; do not process this image again.');
  if (originalContent !== undefined && layer.content !== originalContent) throw new Error('Original image changed while processing; result was not applied.');
  return { project, layer };
}

function failureMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  let message = error.message || error.name;
  let cause = error.cause;
  for (let depth = 0; cause && depth < 4; depth++) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    if (detail && !message.includes(detail)) message += `; caused by: ${detail}`;
    cause = cause instanceof Error ? cause.cause : undefined;
  }
  return message;
}

export async function executeBackgroundRemovalTool(input: unknown, bridge: WorkspaceBridge, signal: AbortSignal): Promise<unknown> {
  let stage = 'validation';
  let code = 'INVALID_REQUEST';
  let projectId: string | undefined;
  let layerId: string | undefined;
  let modelId: 'u2netp' | 'birefnet' = 'u2netp';
  let runtimeDownloaded = false;
  let resultLayerId: string | undefined;
  let runtimeFile = '';
  try {
    signal.throwIfAborted();
    const args = record(input);
    const allowed = ['projectId', 'layerId', 'modelId', 'keepOriginal', 'device'];
    if (Object.keys(args).some(key => !allowed.includes(key))) throw new Error('Unsupported background-removal parameter.');
    projectId = text(args.projectId, 'projectId');
    layerId = text(args.layerId, 'layerId');
    modelId = args.modelId === undefined ? 'u2netp' : choice(args.modelId, 'modelId', ['u2netp', 'birefnet']);
    const device = args.device === undefined ? 'auto' : choice(args.device, 'device', ['auto', 'webgpu', 'wasm']);
    if (args.keepOriginal !== undefined && typeof args.keepOriginal !== 'boolean') throw new Error('keepOriginal must be a boolean.');
    const keepOriginal = args.keepOriginal !== false;
    code = 'TARGET_NOT_READY';
    const original = target(bridge, projectId, layerId).layer.content;
    safeImage(original);
    const source = new URL(original);
    if (source.username || source.password) throw new Error('Image URLs must not contain credentials.');

    stage = 'model';
    code = 'MODEL_NOT_READY';
    if (modelId === 'birefnet' && !await readModel(modelId)) {
      throw new Error('BiRefNet is not ready. Import or download the model in AI Settings > Background Removal; the large model was not downloaded automatically.');
    }
    signal.throwIfAborted();
    stage = 'runtime';
    code = 'RUNTIME_NOT_READY';
    if (!await readRuntime()) {
      stage = 'runtime_download';
      code = 'RUNTIME_DOWNLOAD_FAILED';
      await installRuntime(AbortSignal.any([signal, AbortSignal.timeout(180_000)]), progress => { runtimeFile = progress.stage; });
      runtimeDownloaded = true;
      if (!await readRuntime()) throw new Error('Runtime download completed but cached resources are unavailable.');
    }
    signal.throwIfAborted();
    stage = 'validation';
    code = 'TARGET_NOT_READY';
    target(bridge, projectId, layerId, original);

    stage = 'image_load';
    code = 'IMAGE_LOAD_FAILED';
    const image = await download(original, 50 * 1024 * 1024, signal);
    signal.throwIfAborted();
    stage = 'validation';
    code = 'TARGET_NOT_READY';
    target(bridge, projectId, layerId, original);
    stage = 'inference';
    code = 'INFERENCE_FAILED';
    const output = await removeBackground(image, { signal, modelId, device });
    const content = await blobDataUrl(output.blob);
    signal.throwIfAborted();

    stage = 'apply';
    code = 'APPLY_FAILED';
    const latest = target(bridge, projectId, layerId, original).project;
    const next = applyRemovalResult(latest, { layerId, originalContent: original, content, keepOriginal }, generateId());
    if (next === latest) throw new Error('Background removal result could not be applied; read get_context before retrying.');
    resultLayerId = keepOriginal ? next.selectedLayerId! : layerId;
    stage = 'commit';
    code = 'COMMIT_FAILED';
    signal.throwIfAborted();
    await bridge.commit(next);
    return {
      success: true, projectId, sourceLayerId: layerId, layerId: resultLayerId,
      modelId, executionProvider: output.provider, keepOriginal, backgroundRemoved: true, runtimeDownloaded
    };
  } catch (error) {
    if (signal.aborted) throw signal.reason || error;
    return {
      success: false, code, stage, error: failureMessage(error), projectId, layerId, modelId, runtimeDownloaded,
      ...(stage === 'runtime_download' && runtimeFile ? { runtimeFile } : {}),
      ...(stage === 'commit' ? {
        resultLayerId, mayHaveApplied: true,
        retryPolicy: 'The layer may already be updated but saving failed. Read get_context before retrying; do not process an already marked image.'
      } : {})
    };
  }
}