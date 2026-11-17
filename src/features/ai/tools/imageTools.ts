import type { ImageToolExtension, ImageToolExtensions, ImageToolResult, ImageToolSchemaExtension } from 'sang-ai-kit/built-in-tools';
import { blobToDataUrl, encodeWebp, imageMimeType } from 'sang-ai-kit/image-attachments';
import { download } from 'sang-ai-kit/background-removal/resources.ts';
import type { Layer, ProjectState } from '../../../types.ts';
import type { WorkspaceBridge } from '../types.ts';
import { safeImage, text } from './validation.ts';
import { generateId } from '../../../utils/helpers.ts';
import { applyRemovalResult } from '../../../utils/backgroundRemovalResult.ts';

export const IMAGE_TOOL_SCHEMAS: ImageToolExtensions<ImageToolSchemaExtension> = {
  generate_image: {
    description: '生成或修改图像并直接添加到当前画布，返回图层 ID。',
    properties: {
      referenceLayerId: { type: 'string', description: '可选，当前页图片图层 ID，使用完整原图作为参考；不能与 referenceImageId 同时使用。' }
    }
  },
  remove_background: {
    description: '移除图层或附件图片背景并直接应用到当前画布。',
    properties: {
      layerId: { type: 'string', description: '当前页图片图层 ID；与 imageId 二选一。' },
      keepOriginal: { type: 'boolean', description: '仅图层抠图可用，默认 true：保留并隐藏原图；false 替换原图。' }
    },
    optional: ['imageId']
  }
};

function currentProject(bridge: WorkspaceBridge, projectId?: string): ProjectState {
  const project = bridge.getProject();
  if (!project || (projectId !== undefined && project.id !== projectId)) throw new Error('The active project changed or is not open. Read get_context again.');
  return project;
}

function currentPage(bridge: WorkspaceBridge, projectId: string, pageId: string | undefined): ProjectState {
  const project = currentProject(bridge, projectId);
  if (project.activePageId !== pageId) throw new Error('The active page changed. Read get_context again.');
  return project;
}

function imageLayer(project: ProjectState, layerId: string, removal: boolean): Layer {
  const layer = project.layers.find(item => item.id === layerId);
  if (!layer || layer.type !== 'image') throw new Error('Target must be an existing image layer on the current page.');
  if (removal && (layer.locked || project.layers.find(item => item.id === layer.parentId)?.locked)) throw new Error('Unlock the image layer and its group before background removal.');
  if (removal && layer.backgroundRemoved) throw new Error('Background already removed.');
  return layer;
}

async function loadLayerImage(content: string, signal: AbortSignal): Promise<Blob> {
  safeImage(content);
  const url = new URL(content);
  if (url.username || url.password) throw new Error('Image URLs must not contain credentials.');
  const blob = await download(content, 25 * 1024 * 1024, signal);
  if (blob.type === 'image/gif') return encodeWebp(blob, Infinity, 0.95);
  imageMimeType(blob.type);
  return blob;
}

async function applyImages(bridge: WorkspaceBridge, projectId: string, pageId: string | undefined, result: ImageToolResult,
  signal: AbortSignal, removal: boolean, source?: { layerId: string; content: string; removal: boolean; keepOriginal: boolean }) {
  const decoded = await Promise.all(result.images.map(async blob => {
    imageMimeType(blob.type);
    if (blob.size > 25 * 1024 * 1024) throw new Error('Image exceeds the 25 MB source limit.');
    const content = await blobToDataUrl(blob);
    const bitmap = await createImageBitmap(blob);
    const width = bitmap.width, height = bitmap.height;
    bitmap.close();
    if (!width || !height || width * height > 67108864) throw new Error('Image has invalid dimensions or exceeds 64 megapixels.');
    return { content, width, height };
  }));
  signal.throwIfAborted();
  let project = currentPage(bridge, projectId, pageId);
  if (source && imageLayer(project, source.layerId, source.removal).content !== source.content) throw new Error('Original image changed while processing; result was not applied.');
  const layerIds: string[] = [];
  for (const image of decoded) {
    const id = generateId();
    if (source?.removal) {
      const next = applyRemovalResult(project, { layerId: source.layerId, originalContent: source.content, content: image.content, keepOriginal: source.keepOriginal }, id);
      if (next === project) throw new Error('Target changed, is locked or already processed; result was not applied.');
      const layerId = source.keepOriginal ? id : source.layerId;
      project = { ...next, selectedLayerId: layerId };
      layerIds.push(layerId);
    } else {
      const scale = Math.min(1, project.canvasConfig.width / image.width, project.canvasConfig.height / image.height);
      const width = Math.max(1, Math.round(image.width * scale)), height = Math.max(1, Math.round(image.height * scale));
      const layer: Layer = {
        id, type: 'image', name: 'Image', content: image.content, width, height,
        imageSource: removal ? 'upload' : result.model, imageDescription: result.prompt ?? '',
        backgroundRemoved: removal,
        x: Math.round((project.canvasConfig.width - width) / 2), y: Math.round((project.canvasConfig.height - height) / 2),
        visible: true, locked: false, rotation: 0, opacity: 1, ratioLocked: true,
        zIndex: Math.max(0, ...project.layers.map(item => item.zIndex)) + 1
      };
      project = { ...project, updatedAt: Date.now(), layers: [...project.layers, layer], selectedLayerId: id };
      layerIds.push(id);
    }
  }
  signal.throwIfAborted();
  try { await bridge.commit(project); }
  catch (error) {
    throw new Error(`Saving failed; changes may already be applied to layers ${layerIds.join(', ')}. Read get_context before retrying. ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  return { success: true, projectId, pageId, layerIds, ...(layerIds.length === 1 ? { layerId: layerIds[0] } : {}),
    ...(removal ? { modelId: result.model, backgroundRemoved: true } : { model: result.model, prompt: result.prompt }),
    ...(source?.removal ? { sourceLayerId: source.layerId, keepOriginal: source.keepOriginal } : {}) };
}

export function createImageToolExtensions(bridge: WorkspaceBridge): ImageToolExtensions<ImageToolExtension> {
  return {
    generate_image: {
      ...IMAGE_TOOL_SCHEMAS.generate_image!,
      prepare: async (args, signal) => {
        const initial = currentProject(bridge);
        const projectId = initial.id;
        const pageId = initial.activePageId;
        if (args.referenceLayerId !== undefined && args.referenceImageId !== undefined) throw new Error('Only one reference image is supported.');
        const layerId = args.referenceLayerId === undefined ? undefined : text(args.referenceLayerId, 'referenceLayerId');
        const content = layerId ? imageLayer(initial, layerId, false).content : undefined;
        const inputImage = content ? await loadLayerImage(content, signal) : undefined;
        signal.throwIfAborted();
        const latest = currentPage(bridge, projectId, pageId);
        if (layerId && imageLayer(latest, layerId, false).content !== content) throw new Error('Reference image changed while reading.');
        return { inputImage, complete: (result, signal) => applyImages(bridge, projectId, pageId, result, signal, false,
          layerId && content ? { layerId, content, removal: false, keepOriginal: false } : undefined) };
      }
    },
    remove_background: {
      ...IMAGE_TOOL_SCHEMAS.remove_background!,
      prepare: async (args, signal) => {
        const initial = currentProject(bridge);
        const projectId = initial.id;
        const pageId = initial.activePageId;
        if ((args.layerId === undefined) === (args.imageId === undefined)) throw new Error('Provide either layerId or imageId.');
        if (args.keepOriginal !== undefined && typeof args.keepOriginal !== 'boolean') throw new Error('keepOriginal must be a boolean.');
        if (args.layerId === undefined && args.keepOriginal !== undefined) throw new Error('keepOriginal requires layerId.');
        const layerId = args.layerId === undefined ? undefined : text(args.layerId, 'layerId');
        const content = layerId ? imageLayer(initial, layerId, true).content : undefined;
        const inputImage = content ? await loadLayerImage(content, signal) : undefined;
        signal.throwIfAborted();
        const latest = currentPage(bridge, projectId, pageId);
        if (layerId && imageLayer(latest, layerId, true).content !== content) throw new Error('Original image changed while reading.');
        return { inputImage, complete: (result, signal) => applyImages(bridge, projectId, pageId, result, signal, true,
          layerId && content ? { layerId, content, removal: true, keepOriginal: args.keepOriginal !== false } : undefined) };
      }
    }
  };
}
